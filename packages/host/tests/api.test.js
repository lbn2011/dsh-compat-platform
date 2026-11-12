/**
 * The E1 diagnostic endpoints: snapshot assembly, the log ring, and the WebSocket
 * channel — including a real socket so the handshake and masked frames are tested
 * as bytes rather than as function calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';

import {
  PAGE_SNAPSHOT_LIMITS,
  PAGE_SNAPSHOT_SCHEMA,
  buildPageSnapshot,
  createSlotCache,
} from '../src/page-snapshot.js';
import {
  FRONTEND_LOG_PATH,
  PAGE_SNAPSHOT_PATH,
  collectHostSnapshot,
  createHostApi,
} from '../src/api.js';
import {
  MAX_LOG_ENTRIES,
  acceptKey,
  closeFrame,
  createFrameReader,
  createLogBuffer,
  decodeFrame,
  encodeFrame,
  handshakeResponse,
  newKey,
  parseLogMessage,
} from '../src/frontend-log.js';

/**
 * A masked client text frame, as a browser would send it.
 *
 * @param {string} text Payload.
 * @returns {Buffer} Frame bytes.
 */
function clientFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x37, 0x21, 0x0a, 0x5c]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  const length = payload.length;
  const header = length < 126
    ? Buffer.from([0x81, 0x80 | length])
    : Buffer.concat([Buffer.from([0x81, 0x80 | 126]), (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(length, 0);
      return b;
    })()]);
  return Buffer.concat([header, mask, masked]);
}

/**
 * A connection service double that records the routes it was given.
 *
 * @param {object} [options] Admission behaviour.
 * @returns {object} Connection double with `routes` and `fetched`.
 */
function fakeConnection(options = {}) {
  const routes = [];
  return {
    routes,
    fetch: {
      register(route) {
        routes.push(route);
        return () => {
          routes.splice(routes.indexOf(route), 1);
        };
      },
    },
    admitConnection: options.admitConnection ?? (() => ({ peer: {}, release: () => {} })),
  };
}

/**
 * A web-server double that records upgrade handlers.
 *
 * @returns {object} Server double with `upgrades`.
 */
function fakeWebServer() {
  const upgrades = [];
  return {
    upgrades,
    registerUpgrade(route) {
      upgrades.push(route);
      return () => {
        upgrades.splice(upgrades.indexOf(route), 1);
      };
    },
  };
}

test('the snapshot reports missing sources instead of empty lists', () => {
  const snapshot = buildPageSnapshot({});
  assert.equal(snapshot.pageSnapshot, PAGE_SNAPSHOT_SCHEMA);
  assert.deepEqual(snapshot.sources, {
    sessions: 'unavailable',
    messages: 'unavailable',
    plugins: 'unavailable',
    slots: 'unavailable',
  });
  assert.deepEqual(snapshot.codes, [
    'SESSIONS_UNAVAILABLE',
    'MESSAGES_UNAVAILABLE',
    'PLUGINS_UNAVAILABLE',
    'SLOTS_UNAVAILABLE',
  ]);
  assert.equal(snapshot.certification, false);
  assert.ok(snapshot.limitations.includes('SNAPSHOT_IS_STRUCTURE_NOT_A_DOM_OR_A_SCREENSHOT'));
});

test('an empty list and an unavailable source are different facts', () => {
  const empty = buildPageSnapshot({ sessions: [], messages: [], plugins: [], slots: [] });
  assert.deepEqual(empty.codes, []);
  assert.deepEqual(empty.sources, {
    sessions: 'provided',
    messages: 'provided',
    plugins: 'provided',
    slots: 'provided',
  });
  assert.equal(empty.counts.messages, 0);
});

test('message text is withheld unless the caller asks for it', () => {
  const message = { id: 'm1', role: 'user', text: 'a private line' };
  const withheld = buildPageSnapshot({ messages: [message] });
  assert.equal(withheld.messages[0].text, null);
  assert.equal(withheld.messages[0].textLength, 14);
  assert.equal(withheld.messageTextIncluded, false);

  const included = buildPageSnapshot({ messages: [message], includeMessageText: true });
  assert.equal(included.messages[0].text, 'a private line');
  assert.equal(included.messageTextIncluded, true);
});

test('a long message text is truncated and said to be', () => {
  const text = 'x'.repeat(PAGE_SNAPSHOT_LIMITS.maxMessageText + 10);
  const snapshot = buildPageSnapshot({ messages: [{ id: 'm', role: 'user', text }], includeMessageText: true });
  assert.equal(snapshot.messages[0].text.length, PAGE_SNAPSHOT_LIMITS.maxMessageText);
  assert.equal(snapshot.truncated.messageText, true);
  assert.ok(snapshot.codes.includes('MESSAGE_TEXT_TRUNCATED'));
});

test('the message window is bounded and the total is still reported', () => {
  const messages = Array.from({ length: PAGE_SNAPSHOT_LIMITS.maxMessages + 5 }, (_, index) => ({
    id: `m${index}`,
    role: 'user',
    text: '',
  }));
  const snapshot = buildPageSnapshot({ messages });
  assert.equal(snapshot.messages.length, PAGE_SNAPSHOT_LIMITS.maxMessages);
  assert.equal(snapshot.counts.messagesTotal, messages.length);
  assert.equal(snapshot.truncated.messages, true);
  assert.ok(snapshot.codes.includes('MESSAGE_WINDOW_TRUNCATED'));
});

test('an unreadable entry is skipped and counted, never silently dropped', () => {
  const snapshot = buildPageSnapshot({
    messages: [{ id: 'm1', role: 'user' }, { nothing: true }],
    plugins: [{ entryId: 'p1' }, 42],
    slots: ['a.b', ''],
  });
  assert.equal(snapshot.counts.messages, 1);
  assert.equal(snapshot.counts.messagesTotal, 2);
  assert.equal(snapshot.counts.plugins, 1);
  assert.equal(snapshot.counts.slots, 1);
  assert.ok(snapshot.codes.includes('ENTRY_SKIPPED_MALFORMED'));
});

test('an unknown active session is reported, not invented', () => {
  const snapshot = buildPageSnapshot({ sessions: [{ id: 's1' }], activeSessionId: 's9' });
  assert.deepEqual(snapshot.activeSession, { id: 's9', known: false });
  assert.ok(snapshot.codes.includes('ACTIVE_SESSION_UNKNOWN'));
});

test('a record that is not a record is refused as a whole', () => {
  for (const value of [null, [], 'snapshot', 7]) {
    const snapshot = buildPageSnapshot(value);
    assert.deepEqual(snapshot.codes, ['SNAPSHOT_INPUT_NOT_RECORD'], String(value));
    assert.equal(snapshot.pageSnapshot, PAGE_SNAPSHOT_SCHEMA);
  }
});

test('the snapshot is frozen all the way down and JSON-serialisable', () => {
  const snapshot = buildPageSnapshot({
    sessions: [{ id: 's1' }],
    messages: [{ id: 'm1', role: 'user', text: 'x' }],
    plugins: [{ entryId: 'p1' }],
    slots: ['a.b'],
    activeSessionId: 's1',
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.messages[0]), true);
  assert.equal(Object.isFrozen(snapshot.sources), true);
  assert.equal(JSON.stringify(snapshot).includes('undefined'), false);
});

test('the slot cache learns keys, never removes them, and bounds itself', () => {
  const cache = createSlotCache({ maxKeys: 2 });
  assert.equal(cache.record('a'), true);
  assert.equal(cache.record('a'), true);
  assert.equal(cache.record('b'), true);
  assert.equal(cache.record('c'), false);
  assert.equal(cache.size(), 2);
  assert.equal(cache.dropped(), 1);
  assert.deepEqual(cache.list().map((row) => row.key), ['a', 'b']);
  assert.equal(cache.record(''), false);
  cache.clear();
  assert.equal(cache.size(), 0);
});

test('a page message must be the documented shape', () => {
  const good = JSON.stringify({ kind: 'frontend-log', level: 'error', message: 'boom' });
  const parsed = parseLogMessage(good);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entry.message, 'boom');
  assert.equal(parsed.entry.stack, null);

  assert.deepEqual(parseLogMessage('{').codes, ['LOG_MESSAGE_NOT_JSON']);
  assert.deepEqual(parseLogMessage(7).codes, ['LOG_MESSAGE_NOT_TEXT']);
  assert.deepEqual(parseLogMessage('[]').codes, ['LOG_MESSAGE_NOT_OBJECT']);
  assert.deepEqual(parseLogMessage(JSON.stringify({ kind: 'other', level: 'error', message: 'x' })).codes, ['LOG_KIND_UNSUPPORTED']);
  assert.deepEqual(parseLogMessage(JSON.stringify({ kind: 'frontend-log', level: 'debug', message: 'x' })).codes, ['LOG_LEVEL_UNSUPPORTED']);
  assert.deepEqual(parseLogMessage(JSON.stringify({ kind: 'frontend-log', level: 'error' })).codes, ['LOG_TEXT_MISSING']);
});

test('a page cannot smuggle extra fields into a log entry', () => {
  const parsed = parseLogMessage(JSON.stringify({
    kind: 'frontend-log',
    level: 'error',
    message: 'boom',
    cookie: 'session=secret',
    __proto__: { polluted: true },
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.entry).sort(), ['at', 'level', 'message', 'source', 'stack']);
  assert.equal({}.polluted, undefined);
});

test('a long log field is truncated and flagged', () => {
  const parsed = parseLogMessage(JSON.stringify({
    kind: 'frontend-log',
    level: 'error',
    message: 'm'.repeat(3000),
    stack: 's'.repeat(5000),
  }));
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.entry.message.length, 2048);
  assert.equal(parsed.entry.stack.length, 4096);
});

test('the log ring keeps the newest entries and counts what it dropped', () => {
  const buffer = createLogBuffer({ maxEntries: 3 });
  for (let index = 0; index < 5; index += 1) {
    buffer.append({ level: 'error', message: `m${index}`, stack: null, source: null, at: null });
  }
  assert.equal(buffer.size(), 3);
  assert.equal(buffer.dropped(), 2);
  assert.deepEqual(buffer.list().map((entry) => entry.message), ['m2', 'm3', 'm4']);
  assert.equal(buffer.list()[0].seq, 3);
  assert.equal(MAX_LOG_ENTRIES, 100);
});

test('an appended entry is frozen so a reader cannot rewrite history', () => {
  const buffer = createLogBuffer();
  const stored = buffer.append({ level: 'error', message: 'x', stack: null, source: null, at: null });
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    'use strict';
    stored.message = 'forged';
  }, TypeError);
});

test('the handshake accepts a browser upgrade and refuses anything else', () => {
  const key = 'dGhlIHNhbXBsZSBub25jZQ==';
  assert.equal(acceptKey(key), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');

  const ok = handshakeResponse({
    method: 'GET',
    headers: { upgrade: 'WebSocket', 'sec-websocket-key': key, 'sec-websocket-version': '13' },
  });
  assert.equal(ok.ok, true);
  assert.match(ok.response, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
  assert.match(ok.response, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=\r\n/);

  for (const req of [
    { method: 'POST', headers: { upgrade: 'websocket', 'sec-websocket-key': key } },
    { method: 'GET', headers: {} },
    { method: 'GET', headers: { upgrade: 'h2c', 'sec-websocket-key': key } },
    { method: 'GET', headers: { upgrade: 'websocket' } },
    { method: 'GET', headers: { upgrade: 'websocket', 'sec-websocket-key': key, 'sec-websocket-version': '8' } },
    null,
  ]) {
    assert.deepEqual(handshakeResponse(req).codes, ['HANDSHAKE_INVALID'], JSON.stringify(req));
  }
});

test('a server frame is unmasked and round-trips through the reader', () => {
  const frame = encodeFrame('hello');
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 5);
  assert.equal(frame.subarray(2).toString(), 'hello');

  const reader = createFrameReader();
  const result = reader.push(clientFrame('hello'));
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].payload.toString(), 'hello');
  assert.equal(reader.pendingBytes(), 0);
});

test('a frame split across chunks is assembled, not refused', () => {
  const frame = clientFrame('split across chunks');
  const reader = createFrameReader();
  assert.equal(reader.push(frame.subarray(0, 4)).frames.length, 0);
  assert.equal(reader.push(frame.subarray(4, 9)).frames.length, 0);
  const done = reader.push(frame.subarray(9));
  assert.equal(done.frames.length, 1);
  assert.equal(done.frames[0].payload.toString(), 'split across chunks');
});

test('unmasked, fragmented and unknown opcodes are refused', () => {
  const bare = Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63]);
  assert.deepEqual(decodeFrame(bare).codes, ['FRAME_UNMASKED']);
  assert.deepEqual(decodeFrame(Buffer.from([0x01, 0x80, 1, 2, 3, 4])).codes, ['FRAME_FRAGMENTED_UNSUPPORTED']);
  assert.deepEqual(decodeFrame(Buffer.from([0x83, 0x80, 1, 2, 3, 4])).codes, ['FRAME_OPCODE_UNSUPPORTED']);
  assert.deepEqual(decodeFrame(Buffer.from([0x81])).codes, ['FRAME_INCOMPLETE']);
});

test('an announced length over the ceiling is refused before allocating', () => {
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(1024 * 1024), 2);
  assert.deepEqual(decodeFrame(Buffer.concat([header, Buffer.alloc(4)])).codes, ['FRAME_TOO_LARGE']);
});

test('the snapshot endpoint answers 200 with a snapshot body', async () => {
  const connection = fakeConnection();
  const ctx = {
    connection,
    webServer: fakeWebServer(),
    on: () => () => {},
    pluginManager: { listPlugins: async () => [{ entryId: 'p1', moduleName: 'mod', enabled: true, fiberPhase: 'ACTIVE' }] },
    sessions: { list: () => [{ id: 's1' }] },
  };
  createHostApi(ctx);

  const route = connection.routes.find((entry) => entry.path === PAGE_SNAPSHOT_PATH);
  assert.ok(route);
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch(new Request('http://127.0.0.1/api/page-snapshot'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.pageSnapshot, PAGE_SNAPSHOT_SCHEMA);
  assert.equal(body.plugins.length, 1);
  assert.equal(body.sources.messages, 'unavailable');
});

test('the log endpoint answers with the ring, and the upgrade is fenced', async () => {
  const connection = fakeConnection();
  const server = fakeWebServer();
  const handle = createHostApi({ connection, webServer: server, on: () => () => {} });

  const logRoute = connection.routes.find((entry) => entry.path === FRONTEND_LOG_PATH);
  assert.ok(logRoute);
  assert.deepEqual(logRoute.methods, ['GET']);

  const empty = await logRoute.fetch(new Request('http://127.0.0.1/api/frontend-log'));
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.deepEqual(emptyBody.entries, []);
  assert.equal(emptyBody.maxEntries, MAX_LOG_ENTRIES);
  assert.equal(emptyBody.dropped, 0);

  handle.buffer.append({
    level: 'error',
    message: 'ringed',
    stack: null,
    source: null,
    at: null,
  });
  const filled = await (await logRoute.fetch(new Request('http://127.0.0.1/api/frontend-log'))).json();
  assert.deepEqual(filled.entries.map((entry) => entry.message), ['ringed']);
  assert.equal(filled.size, 1);

  const upgrade = server.upgrades.find((entry) => entry.path === FRONTEND_LOG_PATH);
  assert.ok(upgrade);
  assert.equal(upgrade.path, FRONTEND_LOG_PATH);
});

test('a rejected admission never receives a handshake', () => {
  const destroyed = [];
  const connection = fakeConnection({
    admitConnection: () => ({ rejection: 401 }),
  });
  const server = fakeWebServer();
  createHostApi({ connection, webServer: server, on: () => () => {} });

  const upgrade = server.upgrades[0];
  upgrade.handler(
    { method: 'GET', headers: { upgrade: 'websocket', 'sec-websocket-key': newKey() } },
    { destroy: () => destroyed.push('destroy'), write: () => destroyed.push('write') },
  );
  assert.deepEqual(destroyed, ['destroy']);
});

test('nothing is mounted when the composition has no connection service', () => {
  const server = fakeWebServer();
  const ctx = { webServer: server, on: () => () => {} };
  const handle = createHostApi(ctx);
  assert.equal(handle.routes.snapshot, false);
  assert.equal(handle.routes.logFetch, false);
  assert.equal(handle.routes.logUpgrade, false);
  assert.equal(server.upgrades.length, 0);
});

test('the collector reports each unavailable part separately', async () => {
  const slots = createSlotCache();
  slots.record('chat.footer');
  const snapshot = await collectHostSnapshot({}, { slots });
  assert.equal(snapshot.sources.sessions, 'unavailable');
  assert.equal(snapshot.sources.plugins, 'unavailable');
  assert.equal(snapshot.sources.slots, 'provided');
  assert.deepEqual(snapshot.slots, [{ key: 'chat.footer', count: null }]);
});

test('the slot cache follows slots/changed events on the context', () => {
  const listeners = new Map();
  const ctx = {
    connection: fakeConnection(),
    webServer: fakeWebServer(),
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  };
  const handle = createHostApi(ctx);
  listeners.get('slots/changed')('chat.composer');
  assert.deepEqual(handle.slots.list().map((row) => row.key), ['chat.composer']);
  handle.dispose();
  assert.equal(listeners.has('slots/changed'), false);
});

test('disposal removes every route and is idempotent', () => {
  const connection = fakeConnection();
  const server = fakeWebServer();
  const handle = createHostApi({ connection, webServer: server, on: () => () => {} });
  assert.equal(connection.routes.length, 2);
  assert.equal(server.upgrades.length, 1);
  handle.dispose();
  handle.dispose();
  assert.equal(connection.routes.length, 0);
  assert.equal(server.upgrades.length, 0);
  assert.equal(handle.disposed, true);
});

/**
 * Read an HTTP request head off a socket, then hand the parsed request plus any
 * trailing bytes to an upgrade handler — the shape `registerUpgrade` promises.
 *
 * @param {import('node:net').Socket} socket Client socket.
 * @param {(req: object, socket: import('node:net').Socket, head: Buffer) => void} handler Upgrade handler.
 * @returns {void}
 */
function serveUpgrade(socket, handler) {
  let pending = Buffer.alloc(0)
  const onData = (chunk) => {
    pending = Buffer.concat([pending, chunk])
    const end = pending.indexOf('\r\n\r\n')
    if (end === -1) return
    socket.off('data', onData)
    const head = pending.subarray(0, end).toString('latin1').split('\r\n')
    const headers = {}
    for (const line of head.slice(1)) {
      const index = line.indexOf(':')
      if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim()
    }
    handler({ method: head[0].split(' ')[0], headers }, socket, pending.subarray(end + 4))
  }
  socket.on('data', onData)
}

test('a real socket completes the handshake and delivers a logged entry', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const handle = createHostApi({ connection, webServer, on: () => () => {} })
  const upgrade = webServer.upgrades[0]

  const server = createServer((socket) => {
    serveUpgrade(socket, upgrade.handler)
  })

  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  const { port } = server.address()

  const client = connect(port, '127.0.0.1')
  await new Promise((resolveOpen) => client.once('connect', resolveOpen))

  const clientKey = newKey()
  let received = ''
  client.on('data', (chunk) => {
    received += chunk.toString('latin1')
  })
  client.write([
    'GET /api/frontend-log HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${clientKey}`,
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n'))

  await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  assert.match(received, /^HTTP\/1\.1 101 Switching Protocols/)
  assert.ok(received.includes(`Sec-WebSocket-Accept: ${acceptKey(clientKey)}`))

  client.write(clientFrame(JSON.stringify({
    kind: 'frontend-log',
    level: 'uncaught',
    message: 'socket boom',
    stack: 'at handler',
  })))

  for (let attempt = 0; attempt < 40 && handle.buffer.size() === 0; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  assert.equal(handle.buffer.size(), 1)
  const entry = handle.buffer.list()[0]
  assert.equal(entry.message, 'socket boom')
  assert.equal(entry.level, 'uncaught')
  assert.equal(entry.seq, 1)

  client.destroy()
  await new Promise((resolveClose) => server.close(resolveClose))
  handle.dispose()
})
