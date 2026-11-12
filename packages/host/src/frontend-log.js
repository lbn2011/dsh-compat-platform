/**
 * `frontend-log` — collect browser-side errors through one WebSocket, and the
 * minimal protocol machinery that requires no dependency.
 *
 * WHY A HAND-ROLLED FRAME CODEC. The alternative is a `ws` dependency, and this
 * package's manifest asserts it has none. The subset a log collector needs is
 * narrow: a server that speaks the opening handshake, decodes masked text frames
 * from the browser, and answers ping and close. That is small enough to write down
 * and bound — anything outside the subset is refused with a code rather than
 * half-supported.
 *
 * TRUST BOUNDARY. Every byte that arrives is untrusted. The decoder validates the
 * mask bit, the length encoding, and the opcode against the closed set in use,
 * refuses frames over the ceiling instead of allocating, and never passes unknown
 * opcodes to a caller. The parser accepts only the documented JSON shape and never
 * copies a field it has not type-checked and bounded.
 *
 * @module frontend-log
 */

import { createHash, randomBytes } from 'node:crypto';

/** Message kind a page must use. */
export const LOG_MESSAGE_KIND = 'frontend-log';

/** Largest number of retained entries. Older entries are dropped, never merged. */
export const MAX_LOG_ENTRIES = 100;

/** Per-field ceilings. A field over its ceiling is truncated, and said to be. */
export const LOG_FIELD_LIMITS = Object.freeze({
  message: 2048,
  stack: 4096,
  source: 256,
});

/** Closed log levels. */
export const LOG_LEVELS = Object.freeze(['error', 'warn', 'uncaught', 'react']);

/** Closed parse and protocol codes. */
export const LOG_CODES = Object.freeze([
  'LOG_MESSAGE_NOT_TEXT',
  'LOG_MESSAGE_NOT_JSON',
  'LOG_MESSAGE_NOT_OBJECT',
  'LOG_KIND_UNSUPPORTED',
  'LOG_LEVEL_UNSUPPORTED',
  'LOG_TEXT_MISSING',
  'LOG_FIELD_TRUNCATED',
  'LOG_BUFFER_FULL',
  'FRAME_INCOMPLETE',
  'FRAME_TOO_LARGE',
  'FRAME_UNMASKED',
  'FRAME_OPCODE_UNSUPPORTED',
  'FRAME_FRAGMENTED_UNSUPPORTED',
  'HANDSHAKE_INVALID',
]);

/** RFC 6455 §1.3 magic string. */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Opcodes this collector speaks. */
const OPCODE = Object.freeze({ TEXT: 0x1, CLOSE: 0x8, PING: 0x9, PONG: 0xA });

/** Largest frame payload accepted, in bytes. */
export const MAX_FRAME_PAYLOAD = 64 * 1024;

/**
 * Bound one string field, reporting whether it was cut.
 *
 * @param {unknown} value Candidate.
 * @param {number} max Maximum length.
 * @returns {{value: string, truncated: boolean}|null} Bounded value, or null when not a string.
 */
function bound(value, max) {
  if (typeof value !== 'string') return null;
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max), truncated: true };
}

/**
 * Parse one browser message into a log entry.
 *
 * The accepted shape is exactly: `{kind: 'frontend-log', level, message, stack?,
 * source?, at?}`. Unknown keys are ignored rather than copied, so a page cannot
 * smuggle arbitrary data into the host's log through this channel.
 *
 * @param {unknown} raw Text received from the socket.
 * @returns {{ok: true, entry: object, truncated: boolean}
 *   | {ok: false, codes: string[]}} A parsed entry, or why it was refused.
 */
export function parseLogMessage(raw) {
  if (typeof raw !== 'string') return { ok: false, codes: ['LOG_MESSAGE_NOT_TEXT'] };

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, codes: ['LOG_MESSAGE_NOT_JSON'] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, codes: ['LOG_MESSAGE_NOT_OBJECT'] };
  }
  if (value.kind !== LOG_MESSAGE_KIND) return { ok: false, codes: ['LOG_KIND_UNSUPPORTED'] };
  if (!LOG_LEVELS.includes(value.level)) return { ok: false, codes: ['LOG_LEVEL_UNSUPPORTED'] };

  const message = bound(value.message, LOG_FIELD_LIMITS.message);
  if (message === null || message.value.length === 0) return { ok: false, codes: ['LOG_TEXT_MISSING'] };

  const stack = bound(value.stack, LOG_FIELD_LIMITS.stack);
  const source = bound(value.source, LOG_FIELD_LIMITS.source);
  const truncated = message.truncated
    || (stack !== null && stack.truncated)
    || (source !== null && source.truncated);

  return {
    ok: true,
    entry: {
      level: value.level,
      message: message.value,
      stack: stack === null ? null : stack.value,
      source: source === null ? null : source.value,
      at: Number.isFinite(value.at) ? value.at : null,
    },
    truncated,
  };
}

/**
 * A bounded, append-only log ring.
 *
 * The oldest entry is dropped when the ring is full; entries are never merged or
 * rewritten, so what a reader sees is exactly what a page sent.
 *
 * @param {{maxEntries?: number}} [options] Ring size.
 * @returns {{append: (entry: object) => object, list: () => object[],
 *   size: () => number, dropped: () => number, clear: () => void}} A log ring.
 */
export function createLogBuffer(options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : MAX_LOG_ENTRIES;
  const entries = [];
  let dropped = 0;
  let seq = 0;

  return {
    append(entry) {
      seq += 1;
      const stored = Object.freeze({ seq, ...entry });
      entries.push(stored);
      while (entries.length > maxEntries) {
        entries.shift();
        dropped += 1;
      }
      return stored;
    },
    list() {
      return entries.slice();
    },
    size() {
      return entries.length;
    },
    dropped() {
      return dropped;
    },
    clear() {
      entries.length = 0;
      dropped = 0;
      seq = 0;
    },
  };
}

/**
 * Compute the `Sec-WebSocket-Accept` value for a client key.
 *
 * @param {string} key The `Sec-WebSocket-Key` header value.
 * @returns {string} Base64 SHA-1 of the key plus the RFC GUID.
 */
export function acceptKey(key) {
  return createHash('sha1').update(`${key}${WS_GUID}`, 'binary').digest('base64');
}

/**
 * Build the handshake response for an upgrade request, or explain the refusal.
 *
 * Only `GET` with `Upgrade: websocket`, a `Sec-WebSocket-Key`, and version 13 are
 * accepted. A request that fails any of those is reported, never guessed at.
 *
 * @param {{method?: unknown, headers?: unknown}} req An `IncomingMessage`-like value.
 * @returns {{ok: true, response: string} | {ok: false, codes: string[]}} Response or refusal.
 */
export function handshakeResponse(req) {
  if (typeof req !== 'object' || req === null) return { ok: false, codes: ['HANDSHAKE_INVALID'] };
  const method = req.method;
  const headers = req.headers;
  if (typeof headers !== 'object' || headers === null) return { ok: false, codes: ['HANDSHAKE_INVALID'] };
  if (method !== 'GET') return { ok: false, codes: ['HANDSHAKE_INVALID'] };

  const upgrade = headers.upgrade;
  if (typeof upgrade !== 'string' || upgrade.toLowerCase() !== 'websocket') {
    return { ok: false, codes: ['HANDSHAKE_INVALID'] };
  }
  const key = headers['sec-websocket-key'];
  if (typeof key !== 'string' || key.length === 0) return { ok: false, codes: ['HANDSHAKE_INVALID'] };
  const version = headers['sec-websocket-version'];
  if (typeof version === 'string' && version !== '13') return { ok: false, codes: ['HANDSHAKE_INVALID'] };

  return {
    ok: true,
    response: [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '',
      '',
    ].join('\r\n'),
  };
}

/**
 * Encode a server frame. Server frames are never masked (RFC 6455 §5.1).
 *
 * @param {string} text Payload.
 * @param {number} [opcode] Frame opcode.
 * @returns {Buffer} A complete frame.
 */
export function encodeFrame(text, opcode = OPCODE.TEXT) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Decode one client frame from the front of a buffer.
 *
 * Returns `{ok:false, codes:['FRAME_INCOMPLETE']}` when more bytes are needed, so a
 * caller can keep accumulating without treating a partial frame as an error.
 *
 * @param {Buffer} buffer Bytes received so far.
 * @returns {{ok: true, opcode: number, payload: Buffer, consumed: number, fin: boolean}
 *   | {ok: false, codes: string[], consumed?: number}} The frame, or why it cannot be read.
 */
export function decodeFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) {
    return { ok: false, codes: ['FRAME_INCOMPLETE'] };
  }

  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;

  if (![OPCODE.TEXT, OPCODE.CLOSE, OPCODE.PING, OPCODE.PONG].includes(opcode)) {
    return { ok: false, codes: ['FRAME_OPCODE_UNSUPPORTED'], consumed: buffer.length };
  }
  if (!masked) return { ok: false, codes: ['FRAME_UNMASKED'], consumed: buffer.length };
  if (!fin) return { ok: false, codes: ['FRAME_FRAGMENTED_UNSUPPORTED'], consumed: buffer.length };

  let offset = 2;
  let length = second & 0x7f;
  if (length === 126) {
    if (buffer.length < offset + 2) return { ok: false, codes: ['FRAME_INCOMPLETE'] };
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return { ok: false, codes: ['FRAME_INCOMPLETE'] };
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_FRAME_PAYLOAD)) return { ok: false, codes: ['FRAME_TOO_LARGE'], consumed: buffer.length };
    length = Number(big);
    offset += 8;
  }
  // Refuse before allocating: an announced length over the ceiling ends the read.
  if (length > MAX_FRAME_PAYLOAD) {
    return { ok: false, codes: ['FRAME_TOO_LARGE'], consumed: buffer.length };
  }
  if (buffer.length < offset + 4 + length) return { ok: false, codes: ['FRAME_INCOMPLETE'] };

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = buffer[offset + index] ^ mask[index % 4];
  }

  return { ok: true, opcode, payload, consumed: offset + length, fin };
}

/**
 * A per-connection reader that accumulates bytes and yields complete frames.
 *
 * @returns {{push: (chunk: Buffer) => {frames: object[], codes: string[]}}} Reader.
 */
export function createFrameReader() {
  let pending = Buffer.alloc(0);

  return {
    push(chunk) {
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return { frames: [], codes: [] };
      pending = Buffer.concat([pending, chunk]);

      const frames = [];
      const codes = [];
      for (;;) {
        const result = decodeFrame(pending);
        if (result.ok) {
          frames.push(result);
          pending = pending.subarray(result.consumed);
          continue;
        }
        if (result.codes.includes('FRAME_INCOMPLETE')) break;
        codes.push(...result.codes);
        // A protocol violation ends the connection: drop what cannot be trusted.
        pending = Buffer.alloc(0);
        break;
      }
      return { frames, codes };
    },
    pendingBytes() {
      return pending.length;
    },
  };
}

/** A close frame a server can send before ending the socket. */
export function closeFrame() {
  return encodeFrame('', OPCODE.CLOSE);
}

/** A pong frame answering a ping. */
export function pongFrame(payload) {
  return encodeFrame(Buffer.isBuffer(payload) ? payload.toString('utf8') : '', OPCODE.PONG);
}

/** A fresh key for a test or for a server that wants one. */
export function newKey() {
  return randomBytes(16).toString('base64');
}
