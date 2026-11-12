/**
 * dsh-compat conflict arbiter — react to a failed plugin entry.
 *
 * THE EVENT IS THE TRIGGER, NOT THE EVIDENCE. `internal/status` is emitted as
 * `(fiber: Fiber, oldValue: FiberState)` whenever a fiber changes state, and a
 * `FiberState.FAILED` transition is how a startup failure becomes visible. The
 * fiber itself carries no readable error and no entry id (its `_error` field is
 * private; `fiber.name` is a display name inherited from the nearest named
 * ancestor), so on a FAILED transition this service re-reads
 * `pluginManager.listPlugins()` and works from `PluginInfo`, which does carry
 * `entryId`, `enabled`, `readOnlyReason`, and `diagnostic`.
 *
 * WHAT IT CAN AND CANNOT DO: arbitration happens AFTER a failure and cannot
 * prevent one. The remedies the installed host offers are
 * `pluginManager.setPluginEnabled(entryId, false)` and nothing else —
 * `PluginManager.reload` is private. A plugin asking for the `isolate` strategy
 * gets an honest `needs-isolated-loader` decision plus a child context from
 * `createIsolateScope()`, because `ctx.isolate()` only scopes plugins loaded
 * below it. Prevention belongs to a static pre-check before install.
 *
 * IDEMPOTENCE: each (entryId, diagnostic digest) pair is decided once. A status
 * transition can fire many times for the same failure, and disabling an entry
 * twice would turn one conflict into an unrelated error.
 */

import { createHash } from 'node:crypto'
import { readFile as readFileCallback } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ARBITER_ACTIONS,
  ARBITER_CODES,
  ARBITER_POLICY_LIMITATIONS,
  ARBITER_POLICY_VERSION,
  ARBITER_STRATEGIES,
  decideArbitration,
  readConflictPolicy,
} from './arbiter-policy.js'
import {
  classifyFailure,
  FAILURE_CLASSIFIER_LIMITATIONS,
  FAILURE_CODES,
  FAILURE_KINDS,
} from './failure-classify.js'

/** Service version, for records. */
export const ARBITER_VERSION = 'conflict-arbiter/0.1-draft.1'

/** Events this service emits, all under its own namespace. */
export const ARBITER_EVENTS = Object.freeze({
  DECIDED: 'dsh-compat/conflict-arbitrated',
})

/** The host signals this service reads. */
export const ARBITER_SIGNALS = Object.freeze(['internal/status'])

/** Cordis `FiberState.FAILED` — the const enum is numeric (0..5) and not importable here. */
export const FIBER_STATE_FAILED = 3

/** Codes this service records beyond the policy vocabulary. */
export const ARBITER_SERVICE_CODES = Object.freeze({
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  INVENTORY_UNAVAILABLE: 'INVENTORY_UNAVAILABLE',
  INVENTORY_READ_FAILED: 'INVENTORY_READ_FAILED',
  DISABLE_APPLIED: 'DISABLE_APPLIED',
  DISABLE_NOT_APPLIED: 'DISABLE_NOT_APPLIED',
  DISABLE_FAILED: 'DISABLE_FAILED',
  POLICY_UNREADABLE: 'POLICY_UNREADABLE',
  NO_STRATEGY_DECLARED: 'NO_STRATEGY_DECLARED',
  ISOLATE_SCOPE_RETURNED: 'ISOLATE_SCOPE_RETURNED',
  ISOLATE_SCOPE_FAILED: 'ISOLATE_SCOPE_FAILED',
})

/** What a decision record does not prove. */
export const ARBITER_LIMITATIONS = Object.freeze([
  'ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE',
  'THE_FAILING_FIBER_IS_IDENTIFIED_THROUGH_THE_INVENTORY_NOT_THE_EVENT',
  'DIAGNOSTIC_TEXT_IS_DIGESTED_AND_NOT_STORED',
  'A_DISABLE_APPLIES_TO_THE_ENTRY_NOT_TO_THE_ALREADY_LOADED_FIBER',
  'ONLY_THE_LOSING_ENTRYS_OWN_DECLARATION_IS_READ',
])

const OPTION_KEYS = Object.freeze([
  'defaultStrategy',
  'maxDecisions',
  'selfEntryId',
  'listPlugins',
  'readFile',
  'resolvePackageJson',
  'baseDirs',
])

/** Default ceiling on retained decision records. */
export const DEFAULT_MAX_DECISIONS = 200

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a Cordis service without assuming it exists (an undeclared service throws on read). */
function resolveService(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try {
      const service = ctx.get(name)
      if (service !== undefined && service !== null) return service
    } catch {
      // Fall through to the guarded property read.
    }
  }
  try {
    const service = ctx?.[name]
    return service === undefined ? null : service
  } catch {
    return null
  }
}

/**
 * Resolve a module's `package.json` from its specifier.
 *
 * @param {string} moduleName - Module specifier from the inventory.
 * @param {string[]} baseDirs - Directories to resolve from.
 * @returns {{ ok: boolean, path?: string, reason?: string }} The result.
 */
export function resolvePackageJson(moduleName, baseDirs) {
  if (typeof moduleName !== 'string' || moduleName === '') {
    return { ok: false, reason: 'module-name-missing' }
  }
  for (const baseDir of baseDirs) {
    if (typeof baseDir !== 'string' || baseDir === '') continue
    let requireFrom
    try {
      requireFrom = createRequire(pathToFileURL(join(baseDir, 'index.js')))
    } catch {
      continue
    }
    try {
      return { ok: true, path: requireFrom.resolve(`${moduleName}/package.json`) }
    } catch {
      // The manifest may not be exported; walk up from the resolved entry instead.
    }
    try {
      const entry = requireFrom.resolve(moduleName)
      let directory = dirname(entry)
      for (let depth = 0; depth < 8; depth += 1) {
        try {
          requireFrom.resolve(join(directory, 'package.json'))
          return { ok: true, path: join(directory, 'package.json') }
        } catch {
          const parent = dirname(directory)
          if (parent === directory) break
          directory = parent
        }
      }
    } catch {
      // Unresolvable from this base; try the next.
    }
  }
  return { ok: false, reason: 'unresolved' }
}

/**
 * Validate arbiter options.
 *
 * @param {unknown} options - Raw options.
 * @returns {object} Resolved options.
 */
export function readArbiterOptions(options) {
  if (options === undefined) options = {}
  if (!isPlainRecord(options)) throw new TypeError('conflict-arbiter: options must be an object')
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`conflict-arbiter: options carry an unknown key: ${key}`)
    }
  }
  const defaultStrategy = options.defaultStrategy ?? 'report-only'
  if (!ARBITER_STRATEGIES.includes(defaultStrategy)) {
    throw new TypeError(`conflict-arbiter: option.defaultStrategy must be one of ${ARBITER_STRATEGIES.join(', ')}`)
  }
  if (options.maxDecisions !== undefined
    && (!Number.isInteger(options.maxDecisions) || options.maxDecisions < 1)) {
    throw new TypeError('conflict-arbiter: option.maxDecisions must be a positive integer')
  }
  if (options.selfEntryId !== undefined && typeof options.selfEntryId !== 'string') {
    throw new TypeError('conflict-arbiter: option.selfEntryId must be a string')
  }
  for (const field of ['listPlugins', 'readFile', 'resolvePackageJson']) {
    if (options[field] !== undefined && typeof options[field] !== 'function') {
      throw new TypeError(`conflict-arbiter: option.${field} must be a function`)
    }
  }
  if (options.baseDirs !== undefined) {
    if (!Array.isArray(options.baseDirs) || options.baseDirs.some((dir) => typeof dir !== 'string')) {
      throw new TypeError('conflict-arbiter: option.baseDirs must be an array of strings')
    }
  }
  return {
    defaultStrategy,
    maxDecisions: options.maxDecisions ?? DEFAULT_MAX_DECISIONS,
    selfEntryId: options.selfEntryId ?? null,
    listPlugins: options.listPlugins ?? null,
    readFile: options.readFile ?? null,
    resolvePackageJson: options.resolvePackageJson ?? null,
    baseDirs: options.baseDirs ?? null,
  }
}

/**
 * Digest a diagnostic message.
 *
 * The message is operator-facing text that may quote paths or package content,
 * so the record keeps a digest and a length, never the text.
 *
 * @param {string} message - Diagnostic text.
 * @returns {{ digest: string, length: number }} The record fields.
 */
export function digestDiagnostic(message) {
  return {
    digest: createHash('sha256').update(message, 'utf8').digest('hex').slice(0, 32),
    length: message.length,
  }
}

/**
 * Create the conflict arbiter service.
 *
 * @param {object} ctx - Composition context.
 * @param {object} [options] - See {@link readArbiterOptions}.
 * @returns {object} The service.
 */
export function createConflictArbiter(ctx, options) {
  const settings = readArbiterOptions(options)
  const errors = []
  const records = []
  const handled = new Set()
  const disposers = []
  const scopes = []
  let inflight = null
  let disposed = false
  let triggers = 0

  function recordError(stage, error) {
    errors.push({ stage, name: error?.name ?? 'Error', message: String(error?.message ?? error) })
  }

  function record(entry) {
    records.push(entry)
    // Bounded retention: a runaway failure loop must not grow memory without end.
    if (records.length > settings.maxDecisions) records.splice(0, records.length - settings.maxDecisions)
  }

  function readFile(path) {
    if (settings.readFile) return settings.readFile(path)
    return readFileCallback(path, 'utf8')
  }

  function listPlugins() {
    if (settings.listPlugins) return settings.listPlugins()
    const pluginManager = resolveService(ctx, 'pluginManager')
    if (!pluginManager || typeof pluginManager.listPlugins !== 'function') {
      return Promise.reject(new Error('plugin inventory is unavailable'))
    }
    return pluginManager.listPlugins()
  }

  function baseDirs() {
    if (settings.baseDirs) return settings.baseDirs
    const dirs = []
    try {
      const baseDir = ctx?.baseDir
      if (typeof baseDir === 'string' && baseDir !== '') dirs.push(baseDir)
    } catch {
      // A context without baseDir is normal in tests.
    }
    dirs.push(process.cwd())
    return dirs
  }

  async function readPolicyFor(moduleName) {
    const resolver = settings.resolvePackageJson ?? resolvePackageJson
    const located = resolver(moduleName, baseDirs())
    if (!located.ok) return { policy: null, code: ARBITER_SERVICE_CODES.POLICY_UNREADABLE }
    let text
    try {
      text = await readFile(located.path)
    } catch (error) {
      recordError('read', error)
      return { policy: null, code: ARBITER_SERVICE_CODES.POLICY_UNREADABLE }
    }
    let pkg
    try {
      pkg = JSON.parse(text)
    } catch {
      return { policy: null, code: ARBITER_SERVICE_CODES.POLICY_UNREADABLE }
    }
    return { policy: readConflictPolicy(pkg), code: null }
  }

  async function applyDecision(decision, moduleName) {
    if (decision.action === 'disable-entry') {
      const pluginManager = resolveService(ctx, 'pluginManager')
      if (!pluginManager || typeof pluginManager.setPluginEnabled !== 'function') {
        return { applied: false, code: ARBITER_SERVICE_CODES.DISABLE_FAILED }
      }
      try {
        const result = await pluginManager.setPluginEnabled(decision.entryId, false)
        // `ChangeResult.application` is the public outcome vocabulary:
        // 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'.
        const application = typeof result?.application === 'string' ? result.application : 'unknown'
        const changed = result?.changed === true
        const applied = application === 'applied' || application === 'restart-required'
        return {
          applied,
          code: applied ? ARBITER_SERVICE_CODES.DISABLE_APPLIED : ARBITER_SERVICE_CODES.DISABLE_NOT_APPLIED,
          application,
          changed,
          restartReason: typeof result?.restartReason === 'string' ? result.restartReason : null,
        }
      } catch (error) {
        recordError('disable', error)
        return { applied: false, code: ARBITER_SERVICE_CODES.DISABLE_FAILED }
      }
    }
    if (decision.action === 'needs-isolated-loader') {
      // The service name is what a loader would isolate; the scope itself is
      // created and retained so a host callback can install into it.
      const scope = createIsolateScope(decision.service)
      return {
        applied: false,
        code: scope.ok ? ARBITER_SERVICE_CODES.ISOLATE_SCOPE_RETURNED : ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED,
      }
    }
    return { applied: false, code: null }
  }

  /**
   * Create a child context whose `serviceName` resolves in its own scope.
   *
   * This is the mechanism `ctx.isolate()` actually provides. It does NOT repair
   * anything by itself: a loader must start the losing plugin inside the
   * returned context for the isolation to take effect.
   *
   * @param {string} serviceName - Service to isolate.
   * @returns {{ ok: boolean, scope?: object, code?: string }} The scope, or a refusal.
   */
  function createIsolateScope(serviceName) {
    if (typeof serviceName !== 'string' || serviceName === '') {
      return { ok: false, code: ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED }
    }
    if (typeof ctx?.isolate !== 'function') {
      return { ok: false, code: ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED }
    }
    try {
      const scope = ctx.isolate(serviceName)
      scopes.push({ service: serviceName, scope })
      return { ok: true, scope }
    } catch (error) {
      recordError('isolate', error)
      return { ok: false, code: ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED }
    }
  }

  /**
   * Inspect the inventory and arbitrate every failure not yet decided.
   *
   * @returns {Promise<object>} A summary of the pass.
   */
  function inspect() {
    if (inflight) return inflight
    inflight = (async () => {
      let inventory
      try {
        inventory = await listPlugins()
      } catch (error) {
        recordError('inventory', error)
        return { ok: false, failed: 0, decided: 0 }
      }
      if (!Array.isArray(inventory)) {
        recordError('inventory', new TypeError('plugin inventory is not an array'))
        return { ok: false, failed: 0, decided: 0 }
      }
      let failed = 0
      let decided = 0
      for (const plugin of inventory) {
        const diagnostic = typeof plugin?.diagnostic === 'string' ? plugin.diagnostic : null
        // `diagnostic` is documented as "Current startup failure message; absent
        // when this entry has no failed fiber" — the inventory's own statement of
        // failure, independent of which fiber triggered this pass.
        if (diagnostic === null || diagnostic === '') continue
        failed += 1
        const entryId = typeof plugin.entryId === 'string' ? plugin.entryId : null
        const { digest, length } = digestDiagnostic(diagnostic)
        const key = `${entryId ?? 'unknown'}\u0000${digest}`
        if (handled.has(key)) continue
        handled.add(key)
        decided += 1
        const classification = classifyFailure(diagnostic)
        const moduleName = typeof plugin.moduleName === 'string' ? plugin.moduleName : null
        const { policy, code: policyCode } = moduleName === null
          ? { policy: null, code: ARBITER_SERVICE_CODES.POLICY_UNREADABLE }
          : await readPolicyFor(moduleName)
        const decision = decideArbitration({
          classification,
          policy: policy ?? { present: false, strategy: settings.defaultStrategy, service: null, issues: [] },
          entry: {
            entryId: entryId ?? undefined,
            readOnly: typeof plugin.readOnlyReason === 'string',
          },
          selfEntryId: settings.selfEntryId ?? undefined,
          defaultStrategy: settings.defaultStrategy,
        })
        const outcome = await applyDecision(decision, moduleName)
        const recordEntry = {
          entryId,
          moduleName,
          diagnosticDigest: digest,
          diagnosticLength: length,
          classification: {
            kind: classification.kind,
            code: classification.code,
            service: classification.service,
            existingOwner: classification.existingOwner,
          },
          strategy: decision.strategy,
          action: decision.action,
          code: decision.code,
          reasons: [...decision.reasons],
          policyCode,
          applied: outcome.applied,
          applicationCode: outcome.code,
          application: outcome.application ?? null,
        }
        record(recordEntry)
        emit(ARBITER_EVENTS.DECIDED, recordEntry)
      }
      return { ok: true, failed, decided }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  function emit(event, payload) {
    if (typeof ctx?.emit !== 'function') return
    try {
      ctx.emit(event, payload)
    } catch (error) {
      recordError('emit', error)
    }
  }

  function schedule() {
    if (disposed) return
    triggers += 1
    inspect().catch((error) => recordError('inspect', error))
  }

  function onStatus(fiber, oldState) {
    if (disposed) return
    // Only a transition INTO the failed state is a failure event. `oldValue` is
    // the previous FiberState, so a repeated notification for the same state is
    // not re-examined.
    if (fiber?.state !== FIBER_STATE_FAILED) return
    if (oldState === FIBER_STATE_FAILED) return
    schedule()
  }

  function attach() {
    if (disposed) return
    try {
      const dispose = ctx.on('internal/status', onStatus)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      recordError('subscribe', error)
    }
    // One pass at attach time: a plugin that failed during this composition's own
    // startup produced its status transition before this service listened.
    schedule()
  }

  function detach() {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        recordError('dispose', error)
      }
    }
  }

  return {
    version: ARBITER_VERSION,
    options: settings,
    attach,
    detach,
    inspect,
    createIsolateScope,
    decisions: () => records.map((entry) => ({ ...entry })),
    errors: () => errors.map((entry) => ({ ...entry })),
    scopes: () => scopes.map((entry) => entry.service),
    state: () => ({
      version: ARBITER_VERSION,
      signals: ARBITER_SIGNALS,
      triggers,
      decided: records.length,
      disposed,
    }),
    limitations: () => [
      ...ARBITER_LIMITATIONS,
      ...ARBITER_POLICY_LIMITATIONS,
      ...FAILURE_CLASSIFIER_LIMITATIONS,
    ],
  }
}

export {
  ARBITER_ACTIONS,
  ARBITER_CODES,
  ARBITER_STRATEGIES,
  FAILURE_CODES,
  FAILURE_KINDS,
  ARBITER_POLICY_VERSION,
}
