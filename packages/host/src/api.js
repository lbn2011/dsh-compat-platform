/**
 * `host-api` — diagnostic endpoints mounted on the host's own carrier.
 *
 * ENDPOINTS.
 *   GET  /api/page-snapshot    — a structural snapshot assembled from host state.
 *   GET  /api/frontend-log     — the last entries a page reported.
 *   WS   /api/frontend-log     — the channel a page reports those entries on.
 *   GET  /api/conflict-report  — the live conflict claims table with a summary.
 *   POST /api/repair-preview   — render what a repair plan would change, without changing it.
 *   POST /api/repair-apply     — apply one approved repair plan and return a receipt.
 *
 * THE FENCE IS NOT OURS. All routes are registered on the composition's
 * `connection` carrier, which applies the Host/Origin/token policy before a
 * handler runs. The upgrade path is gated by `admitConnection` explicitly, because
 * an upgrade bypasses the ordinary request pipeline. When the `connection` service
 * is absent this module registers nothing at all: a diagnostic route with no
 * authentication story would be a hole, so absence fails closed.
 *
 * WHAT IS NOT HERE. No second HTTP server, no listening socket of our own, no
 * way to clear or forge a log entry from HTTP.
 *
 * CONFLICT REPORT. The conflict service (`conflictService`, or `compatConflicts`
 * as `dsh-compat-platform-conflicts` provides it) must be present and expose
 * `claims()` plus `conflicts()` or `snapshot()`; sync or async returns are both
 * accepted. When absent the endpoint returns 503 `CONFLICT_SERVICE_UNAVAILABLE`.
 * When any call throws or returns something other than the documented shape the
 * endpoint returns 500 `CONFLICT_SERVICE_ERROR` and never an empty list: an
 * unreadable table must not look like "no conflicts".
 *
 * REPAIR ENDPOINTS. These call the real `dsh-compat-repair` package
 * (`previewRepair`, `planDigest`, `readFixture`, `applyApproved`). It is imported
 * on first use, by package name first and then from the monorepo sibling
 * `../../repair/src`; when neither resolves the repair routes answer 503
 * `REPAIR_PACKAGE_UNAVAILABLE` and every other route keeps working. They are
 * driven by the plugin's `config.repair` section `{root, documents, applyEnabled,
 * approvalsDir}`; without a `root` or with an empty `documents` list they answer
 * 503 `REPAIR_NOT_CONFIGURED`.
 *   GET  /api/repair-targets  → `{documents, applyEnabled}`, never a path.
 *   POST /api/repair-preview  `{name, plan}` → the server reads the document with
 *        `readFixture(root, name)`; a client `beforeText` is refused.
 *   POST /api/repair-apply    `{name, plan}` → 403 unless `applyEnabled`; a body
 *        carrying `approval` is 400; the approval is read from
 *        `approvalsDir/<planDigest>.json` (digest computed here), 409 when absent.
 * Request bodies: not JSON or not an object is 400, a body larger than
 * `MAX_REPAIR_BODY_BYTES` is 413 and is refused from `content-length` or while
 * streaming, before it is buffered whole.
 *
 * TRUST BOUNDARY OF THE WRITE PATH. `repair-apply` WRITES. The write is confined
 * to one document named in `config.repair.documents` inside `config.repair.root`
 * (both from config, never from a request), it is off unless
 * `config.repair.applyEnabled` is true, and it happens only after an approval file
 * exists. An approval is exactly as trustworthy as whoever can write
 * `approvalsDir`, which is the host operator; its `approver` field is a label, not
 * authentication. Anyone who passes the `connection` fence can PREVIEW; nobody
 * can approve through HTTP.
 *
 * ERRORS. A 500 carries only a closed code. The thrown message stays on the
 * server (the context logger when present, otherwise stderr), because it can name
 * paths or internals the browser has no use for.
 *
 * @module host-api
 */

import { constants as fsConstants } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import { basename, isAbsolute, join as joinPath, resolve as resolvePath } from 'node:path'

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

/** Path of the conflict-report endpoint. */
export const CONFLICT_REPORT_PATH = '/api/conflict-report'

/** Path of the repair-preview endpoint. */
export const REPAIR_PREVIEW_PATH = '/api/repair-preview'

/** Path of the repair-apply endpoint. */
export const REPAIR_APPLY_PATH = '/api/repair-apply'

/** Plugin-facing name of this module's contribution. */
export const HOST_API_NAME = 'dsh-compat-host-api'

/** Maximum request body size accepted by the repair endpoints (1 MiB). */
export const MAX_REPAIR_BODY_BYTES = 1024 * 1024

/** Service names tried when resolving the conflict service. */
export const CONFLICT_SERVICE_NAMES = Object.freeze([
  'conflictService',
  'compatConflicts',
])

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
 * Resolve a named service by trying a list of candidate names in order.
 *
 * @param {object} ctx Composition context.
 * @param {ReadonlyArray<string>} names Candidate names, tried in order.
 * @returns {unknown|null} The first service found, or null.
 */
function resolveServiceByNames(ctx, names) {
  for (const name of names) {
    const svc = resolveService(ctx, name)
    if (svc !== undefined && svc !== null) return svc
  }
  return null
}

/**
 * Read and parse a JSON request body, enforcing a byte-length ceiling.
 *
 * @param {Request} req Incoming request.
 * @param {number} maxBytes Maximum allowed body size.
 * @returns {Promise<{ok: true, value: unknown}|{ok: false, status: number, body: object}>}
 */
async function readJsonBody(req, maxBytes) {
  const tooLarge = { ok: false, status: 413, body: { code: 'BODY_TOO_LARGE' } }
  // A declared length over the ceiling is refused before a single byte is read.
  const declared = typeof req.headers?.get === 'function' ? req.headers.get('content-length') : null
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return tooLarge
  }
  let text
  try {
    if (req.body === null || req.body === undefined) {
      text = ''
    } else {
      // Stream the body and stop at the ceiling, so an undeclared or lying length
      // cannot make this handler buffer more than `maxBytes` (+ one chunk).
      const reader = req.body.getReader()
      const chunks = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          try { await reader.cancel() } catch { /* the stream is abandoned either way */ }
          return tooLarge
        }
        chunks.push(value)
      }
      text = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8')
    }
  } catch {
    return { ok: false, status: 400, body: { code: 'BODY_READ_ERROR' } }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, body: { code: 'BODY_NOT_JSON' } }
  }
}

/**
 * Build the `{byKind, bySeverity}` summary from a claims array and conflict list.
 *
 * @param {unknown[]} claims All claims.
 * @param {unknown[]} conflicts All conflicts.
 * @returns {{byKind: Record<string, number>, bySeverity: Record<string, number>}} Summary.
 */
function buildConflictSummary(claims, conflicts) {
  const byKind = {}
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (isRecord(claim) && typeof claim.kind === 'string') {
      byKind[claim.kind] = (byKind[claim.kind] ?? 0) + 1
    }
  }
  const bySeverity = {}
  for (const conflict of Array.isArray(conflicts) ? conflicts : []) {
    if (isRecord(conflict) && typeof conflict.severity === 'string') {
      bySeverity[conflict.severity] = (bySeverity[conflict.severity] ?? 0) + 1
    }
  }
  return { byKind, bySeverity }
}

/**
 * Handle `GET /api/conflict-report`.
 *
 * Calls `claims()` and `conflicts()` (or `snapshot().conflicts`) and assembles
 * `{claims, conflicts, summary: {byKind, bySeverity}}`. Returns 503 when the
 * conflict service is not present on the context, and 500
 * `CONFLICT_SERVICE_ERROR` when it is present but cannot be read.
 *
 * @param {object} ctx Composition context.
 * @param {{onError: Function}} settings Per-handle settings (error sink).
 * @returns {Promise<Response>} JSON response.
 */
async function handleConflictReport(ctx, settings) {
  const svc = resolveServiceByNames(ctx, CONFLICT_SERVICE_NAMES)
  if (!isRecord(svc)) {
    return jsonResponse(503, {
      code: 'CONFLICT_SERVICE_UNAVAILABLE',
      message: 'The conflict service is not available on this context.',
    })
  }

  // Every failure below is a 500 and never an empty table: a page that cannot
  // read the claims must say so instead of rendering "no conflicts" (R2).
  let claims
  let conflicts
  try {
    if (typeof svc.claims !== 'function') throw new TypeError('conflict service has no claims()')
    claims = await svc.claims()
    if (!Array.isArray(claims)) throw new TypeError('claims() did not return an array')
    // snapshot() gives us the conflicts list; we also accept a direct conflicts() method.
    if (typeof svc.conflicts === 'function') {
      conflicts = await svc.conflicts()
    } else if (typeof svc.snapshot === 'function') {
      const snap = await svc.snapshot()
      conflicts = isRecord(snap) ? snap.conflicts : undefined
    } else {
      throw new TypeError('conflict service has neither conflicts() nor snapshot()')
    }
    if (!Array.isArray(conflicts)) throw new TypeError('conflicts are not an array')
  } catch (error) {
    return serverError(settings, 'CONFLICT_SERVICE_ERROR', error)
  }

  const summary = buildConflictSummary(claims, conflicts)
  return jsonResponse(200, { claims, conflicts, summary })
}

/**
 * Report a 500 with a closed code only. The thrown value goes to the server-side
 * sink, never into the response body (R12).
 *
 * @param {{onError?: Function}} settings Per-handle settings.
 * @param {string} code Closed error code.
 * @param {unknown} error What was thrown.
 * @returns {Response} The 500 response.
 */
function serverError(settings, code, error) {
  try {
    if (settings && typeof settings.onError === 'function') settings.onError(code, error)
  } catch {
    // A failing sink must not turn a 500 into an unhandled rejection.
  }
  return jsonResponse(500, { code })
}

/**
 * The default error sink: the composition logger when there is one, else stderr.
 *
 * @param {object} ctx Composition context.
 * @returns {(code: string, error: unknown) => void} Sink.
 */
function defaultErrorSink(ctx) {
  return (code, error) => {
    const text = `${HOST_API_NAME}: ${code}: ${String(error?.stack ?? error?.message ?? error)}`
    if (typeof ctx?.logger === 'function') {
      const logger = ctx.logger(HOST_API_NAME)
      if (logger && typeof logger.warn === 'function') {
        logger.warn(text)
        return
      }
    }
    console.error(text)
  }
}

/** Module specifiers tried, in order, when the repair package is first needed. */
export const REPAIR_MODULE_SOURCES = Object.freeze([
  Object.freeze({
    source: 'package',
    preview: 'dsh-compat-repair/repair-preview',
    plan: 'dsh-compat-repair/repair-plan',
    applier: 'dsh-compat-repair/fixture-applier',
  }),
  Object.freeze({
    source: 'monorepo',
    preview: '../../repair/src/repair-preview.js',
    plan: '../../repair/src/repair-plan.js',
    applier: '../../repair/src/fixture-applier.js',
  }),
])

/**
 * The default importer. `import()` resolves relative specifiers against THIS
 * module, so the monorepo fallback reaches `packages/repair/src`.
 *
 * @param {string} specifier Module specifier.
 * @returns {Promise<object>} Module namespace.
 */
const defaultRepairImporter = (specifier) => import(specifier)

/**
 * Load the real `dsh-compat-repair` functions: the package name first, then the
 * monorepo sibling. Never throws.
 *
 * @param {(specifier: string) => Promise<object>} [importer] Injectable for tests.
 * @returns {Promise<{ok: true, source: string, previewRepair: Function,
 *   planDigest: Function, readFixture: Function, applyApproved: Function}
 *   |{ok: false, failures: Array<{source: string, error: unknown}>}>} Outcome.
 */
export async function loadRepairPackage(importer = defaultRepairImporter) {
  const failures = []
  for (const entry of REPAIR_MODULE_SOURCES) {
    try {
      const [preview, plan, applier] = await Promise.all([
        importer(entry.preview), importer(entry.plan), importer(entry.applier),
      ])
      const fns = {
        previewRepair: preview?.previewRepair,
        planDigest: plan?.planDigest,
        readFixture: applier?.readFixture,
        applyApproved: applier?.applyApproved,
      }
      const missing = Object.keys(fns).filter((key) => typeof fns[key] !== 'function')
      if (missing.length > 0) throw new TypeError(`missing exports: ${missing.join(', ')}`)
      return { ok: true, source: entry.source, ...fns }
    } catch (error) {
      failures.push({ source: entry.source, error })
    }
  }
  return { ok: false, failures }
}

/** Path of the repair-targets endpoint. */
export const REPAIR_TARGETS_PATH = '/api/repair-targets'

/** Largest `afterText` a preview response carries; a bigger one is withheld. */
export const MAX_PREVIEW_AFTER_TEXT_BYTES = 64 * 1024

/** Largest approval file read from `approvalsDir`; checked before reading. */
export const MAX_APPROVAL_FILE_BYTES = 16 * 1024

/** Body keys each repair endpoint accepts. Anything else is refused. */
const PREVIEW_BODY_KEYS = new Set(['name', 'plan'])
const APPLY_BODY_KEYS = new Set(['name', 'plan'])

const SHA256_HEX = /^[0-9a-f]{64}$/
const REPAIR_CONFIG_KEYS = new Set(['root', 'documents', 'applyEnabled', 'approvalsDir'])
const CONFIG_PREFIX = 'dsh-compat-diagnostics-ui: config.repair'

/**
 * Validate the plugin's `repair` config section.
 *
 * `root` and `approvalsDir` come only from here, never from a request. A missing
 * section, a missing `root` or an empty `documents` list means "not configured"
 * (the repair routes answer 503); a present but malformed value is a TypeError at
 * load that names the field.
 *
 * @param {unknown} value Raw `config.repair`.
 * @returns {Readonly<{configured: boolean, root: string|null, documents: readonly string[],
 *   applyEnabled: boolean, approvalsDir: string|null}>} Normalized settings.
 */
export function readRepairConfig(value) {
  const off = Object.freeze({
    configured: false, root: null, documents: Object.freeze([]), applyEnabled: false, approvalsDir: null,
  })
  if (value === undefined || value === null) return off
  if (!isRecord(value)) throw new TypeError(`${CONFIG_PREFIX} must be an object`)
  for (const key of Object.keys(value)) {
    if (!REPAIR_CONFIG_KEYS.has(key)) throw new TypeError(`${CONFIG_PREFIX}.${key} is not a known field`)
  }

  const absolute = (field) => {
    const raw = value[field]
    if (raw === undefined || raw === null) return null
    if (typeof raw !== 'string' || raw === '' || !isAbsolute(raw) || raw.includes('\0')) {
      throw new TypeError(`${CONFIG_PREFIX}.${field} must be an absolute path`)
    }
    return resolvePath(raw)
  }
  const root = absolute('root')
  const approvalsDir = absolute('approvalsDir')

  let documents = []
  if (value.documents !== undefined && value.documents !== null) {
    if (!Array.isArray(value.documents)) {
      throw new TypeError(`${CONFIG_PREFIX}.documents must be an array of file names`)
    }
    const seen = new Set()
    for (const name of value.documents) {
      const plain = typeof name === 'string' && name !== '' && name.length <= 255
        && name !== '.' && name !== '..' && !name.includes('\0')
        && basename(name) === name && !name.includes('/') && !name.includes('\\')
      if (!plain) {
        throw new TypeError(`${CONFIG_PREFIX}.documents entries must be plain file names inside root`)
      }
      if (seen.has(name)) throw new TypeError(`${CONFIG_PREFIX}.documents must not repeat a name`)
      seen.add(name)
    }
    documents = [...seen]
  }

  if (value.applyEnabled !== undefined && typeof value.applyEnabled !== 'boolean') {
    throw new TypeError(`${CONFIG_PREFIX}.applyEnabled must be a boolean`)
  }
  const applyEnabled = value.applyEnabled === true
  if (applyEnabled && approvalsDir === null) {
    throw new TypeError(`${CONFIG_PREFIX}.approvalsDir is required when applyEnabled is true`)
  }
  if (root !== null && approvalsDir !== null && root === approvalsDir) {
    throw new TypeError(`${CONFIG_PREFIX}.approvalsDir must not be the repair root`)
  }

  return Object.freeze({
    configured: root !== null && documents.length > 0,
    root,
    documents: Object.freeze(documents),
    applyEnabled,
    approvalsDir,
  })
}

/**
 * Shared front half of both repair POST routes: configured, JSON record, known
 * keys only, allowed document name.
 *
 * @returns {Promise<{ok: true, name: string, plan: unknown}|{ok: false, response: Response}>}
 */
async function readRepairRequest(repair, req, allowedKeys, extraCheck) {
  const bodyResult = await readJsonBody(req, MAX_REPAIR_BODY_BYTES)
  if (!bodyResult.ok) return { ok: false, response: jsonResponse(bodyResult.status, bodyResult.body) }
  const input = bodyResult.value
  if (!isRecord(input)) return { ok: false, response: jsonResponse(400, { code: 'BODY_NOT_RECORD' }) }
  if (extraCheck) {
    const refusal = extraCheck(input)
    if (refusal) return { ok: false, response: refusal }
  }
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) return { ok: false, response: jsonResponse(400, { code: 'BODY_UNKNOWN_FIELD' }) }
  }
  if (typeof input.name !== 'string' || !repair.documents.includes(input.name)) {
    return { ok: false, response: jsonResponse(400, { code: 'REPAIR_DOCUMENT_NOT_ALLOWED' }) }
  }
  return { ok: true, name: input.name, plan: input.plan }
}

const notConfigured = () => jsonResponse(503, { code: 'REPAIR_NOT_CONFIGURED' })
const packageUnavailable = () => jsonResponse(503, { code: 'REPAIR_PACKAGE_UNAVAILABLE' })

/**
 * The plan's digest, or null when the plan is not a JSON record.
 *
 * @returns {string|null} Lowercase hex digest.
 */
function digestOf(pkg, plan) {
  if (!isRecord(plan)) return null
  try {
    const digest = pkg.planDigest(plan)
    return typeof digest === 'string' && SHA256_HEX.test(digest) ? digest : null
  } catch {
    return null
  }
}

/** Closed reasons `readFixture` throws with; anything else is a 500. */
const FIXTURE_REASONS = new Set([
  'FIXTURE_ROOT_MISSING', 'FIXTURE_ROOT_NOT_DIRECTORY', 'FIXTURE_NAME_ABSOLUTE',
  'FIXTURE_NAME_ESCAPES_ROOT', 'FIXTURE_FILE_MISSING', 'FIXTURE_FILE_NOT_REGULAR',
  'FIXTURE_FILE_TOO_LARGE',
])

/**
 * Handle `GET /api/repair-targets`: the allowed document names and whether apply
 * is switched on. No path of any kind leaves the server.
 */
function handleRepairTargets(settings) {
  const repair = settings.repair
  if (!repair.configured) return notConfigured()
  return jsonResponse(200, { documents: [...repair.documents], applyEnabled: repair.applyEnabled })
}

/**
 * Handle `POST /api/repair-preview` with body `{name, plan}`.
 *
 * The document text is read on the server with `readFixture(root, name)`; a
 * client-supplied `beforeText` is refused as an unknown field. The answer mirrors
 * the real `previewRepair` result: one entry per plan operation (a plan carries
 * exactly one) with its `edit` and the matching `diff`, plus the verdict and the
 * three digests.
 */
async function handleRepairPreview(settings, req) {
  const repair = settings.repair
  if (!repair.configured) return notConfigured()
  const pkg = await settings.loadRepair()
  if (!pkg.ok) return packageUnavailable()

  const request = await readRepairRequest(repair, req, PREVIEW_BODY_KEYS)
  if (!request.ok) return request.response

  let preview
  let document
  try {
    try {
      document = pkg.readFixture(repair.root, request.name)
    } catch (error) {
      if (typeof error?.code === 'string' && FIXTURE_REASONS.has(error.code)) {
        return jsonResponse(422, { code: 'REPAIR_DOCUMENT_UNREADABLE', reason: error.code })
      }
      throw error
    }
    preview = pkg.previewRepair({ plan: request.plan, beforeText: document.text })
  } catch (error) {
    return serverError(settings, 'REPAIR_PREVIEW_THREW', error)
  }
  if (!isRecord(preview)) return serverError(settings, 'REPAIR_PREVIEW_BAD_RESULT', preview)

  const operation = isRecord(request.plan) && isRecord(request.plan.operation) ? request.plan.operation : null
  const operations = preview.edit
    ? [{
      kind: preview.edit.kind,
      ...(operation && operation.kind === 'set-entry-flag' ? { value: operation.value } : {}),
      edit: preview.edit,
      diff: preview.diff ?? null,
    }]
    : []
  const issues = Array.isArray(preview.reasons) ? [...preview.reasons] : []
  const afterText = typeof preview.afterText === 'string' ? preview.afterText : null
  const afterTextFits = afterText !== null
    && Buffer.byteLength(afterText, 'utf8') <= MAX_PREVIEW_AFTER_TEXT_BYTES

  return jsonResponse(200, {
    name: request.name,
    verdict: preview.verdict,
    valid: preview.verdict === 'ready',
    issues,
    errors: issues,
    operations,
    beforeDigest: preview.beforeDigest ?? null,
    afterDigest: preview.afterDigest ?? null,
    planDigest: digestOf(pkg, request.plan),
    afterText: afterTextFits ? afterText : null,
    afterTextWithheld: afterText !== null && !afterTextFits,
    limitations: Array.isArray(preview.limitations) ? [...preview.limitations] : [],
  })
}

/**
 * Read `approvalsDir/<planDigest>.json`. The file name is built only from the
 * server-computed digest, opened without following a final symlink, and its size
 * is checked on the open descriptor before a byte is read.
 *
 * @returns {Promise<{ok: true, approval: unknown}|{ok: false, missing: boolean}>}
 */
async function readApprovalFile(approvalsDir, digest) {
  if (!SHA256_HEX.test(digest)) return { ok: false, missing: false }
  const path = joinPath(approvalsDir, `${digest}.json`)
  let handle
  try {
    handle = await openFile(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  } catch (error) {
    return { ok: false, missing: error?.code === 'ENOENT' }
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_APPROVAL_FILE_BYTES) return { ok: false, missing: false }
    const buffer = Buffer.alloc(stat.size)
    const { bytesRead } = stat.size === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, stat.size, 0)
    return { ok: true, approval: JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) }
  } catch {
    return { ok: false, missing: false }
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Handle `POST /api/repair-apply` with body `{name, plan}`.
 *
 * TRUST. The request never carries the approval. It is read from the configured
 * `approvalsDir`, so an approval is exactly as trustworthy as whoever can write
 * that directory (the host operator); its `approver` field is a label, not an
 * identity. Apply is off unless `repair.applyEnabled` is true, and the write is
 * confined by `applyApproved` to one allowed document inside `repair.root`.
 */
async function handleRepairApply(settings, req) {
  const repair = settings.repair
  if (!repair.configured) return notConfigured()
  if (!repair.applyEnabled) return jsonResponse(403, { code: 'REPAIR_APPLY_DISABLED' })
  const pkg = await settings.loadRepair()
  if (!pkg.ok) return packageUnavailable()

  const request = await readRepairRequest(repair, req, APPLY_BODY_KEYS, (input) => (
    Object.hasOwn(input, 'approval') ? jsonResponse(400, { code: 'BODY_APPROVAL_NOT_ACCEPTED' }) : null
  ))
  if (!request.ok) return request.response

  const digest = digestOf(pkg, request.plan)
  if (digest === null) return jsonResponse(400, { code: 'REPAIR_PLAN_NOT_RECORD' })

  // One apply at a time per handle: two approved plans racing on one document
  // would make both receipts' before/after digests meaningless.
  const run = settings.applyQueue.then(async () => {
    const approval = await readApprovalFile(repair.approvalsDir, digest)
    if (!approval.ok) {
      return jsonResponse(409, {
        code: approval.missing ? 'REPAIR_APPROVAL_MISSING' : 'REPAIR_APPROVAL_UNREADABLE',
        planDigest: digest,
      })
    }
    let receipt
    try {
      receipt = pkg.applyApproved({
        root: repair.root,
        name: request.name,
        plan: request.plan,
        approval: approval.approval,
        nowMs: settings.now(),
      })
    } catch (error) {
      return serverError(settings, 'REPAIR_APPLY_THREW', error)
    }
    if (!isRecord(receipt)) return serverError(settings, 'REPAIR_APPLY_BAD_RESULT', receipt)
    return jsonResponse(receipt.status === 'applied' ? 200 : 422, receipt)
  })
  settings.applyQueue = run.catch(() => {})
  return run
}

/**
 * Mount the diagnostic endpoints.
 *
 * @param {object} ctx Composition context.
 * @param {{connection?: object, webServer?: object, maxEntries?: number,
 *   includeMessageText?: boolean, repair?: object, repairImporter?: Function,
 *   now?: () => number, onError?: Function}} [options] `repair` is the plugin's
 *   `config.repair` section (validated by `readRepairConfig`); the rest are
 *   overrides, mainly for tests.
 * @returns {{disposed: boolean, dispose: () => void, buffer: object, slots: object,
 *   snapshot: () => Promise<object>, routes: object}} A handle describing what was mounted.
 */
export function createHostApi(ctx, options = {}) {
  const connection = options.connection ?? resolveService(ctx, 'connection')
  const webServer = options.webServer ?? resolveService(ctx, 'webServer')
  const buffer = createLogBuffer({ maxEntries: options.maxEntries ?? MAX_LOG_ENTRIES })
  const slots = createSlotCache()
  const repairLoader = typeof options.repairImporter === 'function'
    ? () => loadRepairPackage(options.repairImporter)
    : () => loadRepairPackage()
  let repairPackage = null
  const settings = {
    slots,
    includeMessageText: options.includeMessageText === true,
    repair: readRepairConfig(options.repair),
    // The package is imported on first use and the outcome is kept, success or
    // failure: a host without dsh-compat-repair keeps every other route.
    loadRepair: () => {
      repairPackage ??= repairLoader()
      return repairPackage
    },
    applyQueue: Promise.resolve(),
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
    onError: typeof options.onError === 'function' ? options.onError : defaultErrorSink(ctx),
  }

  const disposers = []
  const routes = { snapshot: false, logFetch: false, logUpgrade: false,
    conflictReport: false, repairTargets: false, repairPreview: false, repairApply: false }
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

    disposers.push(connection.fetch.register({
      path: CONFLICT_REPORT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => handleConflictReport(ctx, settings),
    }))
    routes.conflictReport = true

    disposers.push(connection.fetch.register({
      path: REPAIR_TARGETS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => handleRepairTargets(settings),
    }))
    routes.repairTargets = true

    disposers.push(connection.fetch.register({
      path: REPAIR_PREVIEW_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (req) => handleRepairPreview(settings, req),
    }))
    routes.repairPreview = true

    disposers.push(connection.fetch.register({
      path: REPAIR_APPLY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (req) => handleRepairApply(settings, req),
    }))
    routes.repairApply = true
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
