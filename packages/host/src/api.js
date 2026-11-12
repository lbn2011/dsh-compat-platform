/**
 * `host-api` — the two read-only diagnostic endpoints, mounted on the host's own
 * carrier.
 *
 * ENDPOINTS.
 *   GET /api/page-snapshot  — a structural snapshot assembled from host state.
 *   GET /api/frontend-log   — the last entries a page reported.
 *   WS  /api/frontend-log   — the channel a page reports those entries on.
 *
 * THE FENCE IS NOT OURS. Both routes are registered on the composition's
 * `connection` carrier, which applies the Host/Origin/token policy before a
 * handler runs. The upgrade path is gated by `admitConnection` explicitly, because
 * an upgrade bypasses the ordinary request pipeline. When the `connection` service
 * is absent this module registers nothing at all: a diagnostic route with no
 * authentication story would be a hole, so absence fails closed.
 *
 * WHAT IS NOT HERE. No second HTTP server, no listening socket of our own, no
 * write path, no way to clear or forge a log entry from HTTP.
 *
 * @module host-api
 */

import {
  PAGE_SNAPSHOT_SCHEMA,
  buildPageSnapshot,
  createSlotCache,
} from './page-snapshot.js'
import {
  MAX_LOG_ENTRIES,
  closeFrame,
  createFrameReader,
  createLogBuffer,
  handshakeResponse,
  parseLogMessage,
  pongFrame,
} from './frontend-log.js'

/** Path of the snapshot endpoint, absolute below `/api`. */
export const PAGE_SNAPSHOT_PATH = '/api/page-snapshot'

/** Path of the log endpoint, used by both the fetch route and the upgrade. */
export const FRONTEND_LOG_PATH = '/api/frontend-log'

/** Plugin-facing name of this module's contribution. */
export const HOST_API_NAME = 'dsh-compat-host-api'

/**
 * Is this an ordinary record?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped objects.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve a service without assuming it was injected.
 *
 * `ctx.get` is the documented way to ask for a service the plugin did not declare
 * in `inject`; the property read is a fallback for a plain object context in a
 * test. Both are guarded, because reading an undeclared service through the proxy
 * is not a pure lookup.
 *
 * @param {object} ctx Composition context.
 * @param {string} name Service name.
 * @returns {unknown} The service, or undefined.
 */
function resolveService(ctx, name) {
  if (isRecord(ctx) && typeof ctx.get === 'function') {
    try {
      const service = ctx.get(name)
      if (service !== undefined && service !== null) return service
    } catch {
      // A context without a registry answers nothing; fall through to the property.
    }
  }
  try {
    return isRecord(ctx) ? ctx[name] : undefined
  } catch {
    return undefined
  }
}

/**
 * Build a `Response` carrying JSON and forbidding caching.
 *
 * @param {number} status HTTP status.
 * @param {unknown} value Body value.
 * @param {Record<string, string>} [headers] Extra headers.
 * @returns {Response} Response.
 */
function jsonResponse(status, value, headers = {}) {
  return new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  })
}

/**
 * Read session records through whichever public read path the host offers.
 *
 * @param {object} ctx Composition context.
 * @returns {Promise<unknown[]|null>} Records, or null when no read path exists.
 */
async function readSessions(ctx) {
  const query = resolveService(ctx, 'sessionQuery')
  if (isRecord(query) && typeof query.listSessions === 'function') {
    const records = await query.listSessions()
    return Array.isArray(records) ? records : null
  }
  const store = resolveService(ctx, 'sessions')
  if (isRecord(store) && typeof store.list === 'function') {
    const sessions = store.list()
    return Array.isArray(sessions) ? sessions : null
  }
  return null
}

/**
 * Read the active session's messages through the public read path.
 *
 * @param {object} ctx Composition context.
 * @param {string|null} sessionId Active session id, when known.
 * @returns {Promise<unknown[]|null>} Messages, or null when they cannot be derived.
 */
async function readMessages(ctx, sessionId) {
  if (sessionId === null) return null
  const query = resolveService(ctx, 'sessionQuery')
  if (!isRecord(query) || typeof query.readSession !== 'function') return null

  const snapshot = await query.readSession(sessionId)
  if (!isRecord(snapshot)) return null
  for (const key of ['messages', 'projectedMessages', 'entries']) {
    const value = snapshot[key]
    if (Array.isArray(value)) return value
  }
  return null
}

/**
 * Read plugin rows, preferring the entry list over the bundle list.
 *
 * @param {object} ctx Composition context.
 * @returns {Promise<unknown[]|null>} Rows, or null when the service is absent.
 */
async function readPlugins(ctx) {
  const manager = resolveService(ctx, 'pluginManager')
  if (!isRecord(manager) || typeof manager.listPlugins !== 'function') return null
  const rows = await manager.listPlugins()
  return Array.isArray(rows) ? rows : null
}

/**
 * Collect the plain values a snapshot is assembled from.
 *
 * Each part is collected independently so one absent service cannot erase the
 * others: the snapshot says which parts it could not see instead of reporting a
 * wholesale failure.
 *
 * @param {object} ctx Composition context.
 * @param {{slots: {list: () => object[]}, includeMessageText?: boolean}} settings Adapter settings.
 * @returns {Promise<object>} Snapshot summary.
 */
export async function collectHostSnapshot(ctx, settings) {
  const sessions = await readSessions(ctx)
  // The composition may name the active session on the context; when it does not,
  // the snapshot says the active session is unknown rather than guessing one.
  const named = resolveService(ctx, 'activeSessionId')
  const session = resolveService(ctx, 'session')
  const activeSessionId = typeof named === 'string' && named.length > 0
    ? named
    : (isRecord(session) && typeof session.id === 'string' ? session.id : null)
  const messages = sessions === null ? null : await readMessages(ctx, activeSessionId)
  const plugins = await readPlugins(ctx)

  return buildPageSnapshot({
    sessions: sessions ?? undefined,
    messages: messages ?? undefined,
    plugins: plugins ?? undefined,
    slots: settings.slots.list(),
    activeSessionId,
    includeMessageText: settings.includeMessageText === true,
  })
}

/**
 * Mount the diagnostic endpoints.
 *
 * @param {object} ctx Composition context.
 * @param {{connection?: object, webServer?: object, maxEntries?: number,
 *   includeMessageText?: boolean}} [options] Overrides, mainly for tests.
 * @returns {{disposed: boolean, dispose: () => void, buffer: object, slots: object,
 *   snapshot: () => Promise<object>, routes: object}} A handle describing what was mounted.
 */
export function createHostApi(ctx, options = {}) {
  const connection = options.connection ?? resolveService(ctx, 'connection')
  const webServer = options.webServer ?? resolveService(ctx, 'webServer')
  const buffer = createLogBuffer({ maxEntries: options.maxEntries ?? MAX_LOG_ENTRIES })
  const slots = createSlotCache()
  const settings = { slots, includeMessageText: options.includeMessageText === true }

  const disposers = []
  const routes = { snapshot: false, logFetch: false, logUpgrade: false }
  let disposed = false

  const onSlotsChanged = (key) => {
    slots.record(key)
  }

  if (isRecord(connection) && isRecord(connection.fetch)
    && typeof connection.fetch.register === 'function') {
    disposers.push(connection.fetch.register({
      path: PAGE_SNAPSHOT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(200, await collectHostSnapshot(ctx, settings)),
    }))
    routes.snapshot = true

    disposers.push(connection.fetch.register({
      path: FRONTEND_LOG_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => jsonResponse(200, {
        entries: buffer.list(),
        size: buffer.size(),
        dropped: buffer.dropped(),
        maxEntries: options.maxEntries ?? MAX_LOG_ENTRIES,
      }),
    }))
    routes.logFetch = true
  }

  // The upgrade is registered on the carrier only, and only when the same service
  // can admit a connection. Without admission there is no fence, so no route.
  if (isRecord(webServer) && typeof webServer.registerUpgrade === 'function'
    && isRecord(connection) && typeof connection.admitConnection === 'function') {
    disposers.push(webServer.registerUpgrade({
      path: FRONTEND_LOG_PATH,
      handler: (req, socket, head) => {
        const admission = connection.admitConnection(req)
        if (isRecord(admission) && 'rejection' in admission) {
          socket.destroy()
          return
        }
        const release = isRecord(admission) && typeof admission.release === 'function'
          ? admission.release
          : () => {}

        const handshake = handshakeResponse(req)
        if (!handshake.ok) {
          socket.destroy()
          release()
          return
        }

        socket.write(handshake.response)
        const reader = createFrameReader()
        const onData = (chunk) => {
          const { frames, codes } = reader.push(chunk)
          if (codes.length > 0) {
            // A protocol violation ends the connection rather than being logged
            // and skipped: a socket this module cannot parse is not a log channel.
            socket.destroy()
            return
          }
          for (const frame of frames) {
            if (frame.opcode === 0x8) {
              socket.end(closeFrame())
              return
            }
            if (frame.opcode === 0x9) {
              socket.write(pongFrame(frame.payload))
              continue
            }
            if (frame.opcode !== 0x1) continue
            const parsed = parseLogMessage(frame.payload.toString('utf8'))
            if (parsed.ok) buffer.append(parsed.entry)
          }
        }

        socket.on('data', onData)
        // Bytes the HTTP parser already pulled past the request head belong to the
        // first frame; dropping them would lose a log line that arrived early.
        if (Buffer.isBuffer(head) && head.length > 0) onData(head)
        socket.on('error', () => {
          release()
        })
        socket.on('close', () => {
          release()
        })
      },
    }))
    routes.logUpgrade = true
  }

  if (typeof ctx.on === 'function') {
    disposers.push(ctx.on('slots/changed', onSlotsChanged))
  }

  return {
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // A failing disposer must not strand the others; the host is already
          // shutting this contribution down.
        }
      }
      disposers.length = 0
    },
    buffer,
    slots,
    snapshot() {
      return collectHostSnapshot(ctx, settings)
    },
    routes,
  }
}

/**
 * Register the endpoints as a Cordis effect when the carrier is present.
 *
 * @param {object} ctx Composition context.
 * @param {object} [options] Passed through to `createHostApi`.
 * @returns {object|null} The handle, or null when the carrier is absent.
 */
export function applyHostApi(ctx, options = {}) {
  const connection = options.connection ?? resolveService(ctx, 'connection')
  if (!isRecord(connection) || !isRecord(connection.fetch)
    || typeof connection.fetch.register !== 'function') {
    return null
  }

  const handle = createHostApi(ctx, options)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => handle.dispose(), `${HOST_API_NAME}: routes`)
  }
  return handle
}

export { PAGE_SNAPSHOT_SCHEMA }
