/**
 * Read a plugin's `dsh.conflicts` declaration and decide what the arbiter may do.
 *
 * WHAT THE FIELD IS: a PROPOSED extension. `DshManifest` (the type behind
 * `package.json.dsh`) declares exactly `manifestVersion`, `bundle`, `profile`,
 * and `client`; no installed package declares `conflicts`. So a plugin opts into
 * arbitration with a field the host ignores, and the capability exists only
 * while this plugin is installed.
 *
 * THE THREE STRATEGIES, AND WHY THERE ARE ONLY THREE:
 *
 * - `report-only` (default) records the decision and changes nothing.
 * - `disable-later` disables the losing entry through
 *   `pluginManager.setPluginEnabled(entryId, false)` — the ONLY public remedy
 *   the installed host offers. `PluginManager.reload` is private, and a
 *   disable→enable cycle reloads in the profile's own scope.
 * - `isolate` cannot be carried out by this plugin. `ctx.isolate(name, label?)`
 *   returns a CHILD CONTEXT, and only plugins loaded BELOW that context resolve
 *   `name` against the new label; a fiber that already failed was loaded above
 *   it. So `isolate` is recorded as `STRATEGY_NEEDS_ISOLATED_LOADER` and the
 *   arbiter exposes `createIsolateScope(serviceName)` for a host or HMR
 *   implementation that can actually load the loser there. Reporting the
 *   limitation is the honest outcome; pretending to have repaired a failed fiber
 *   would not be.
 *
 * The decision function is pure: it takes the failure classification, the
 * declared policy, and the entry's control availability, and returns what should
 * happen. Acting is the service's job.
 */

/** Version of this policy reader, for records. */
export const ARBITER_POLICY_VERSION = 'arbiter-policy/0.1-draft.1'

/** Declared strategies, in the order this module documents them. */
export const ARBITER_STRATEGIES = Object.freeze(['report-only', 'disable-later', 'isolate'])

/** The strategy used when a plugin declares none, or this plugin is misconfigured. */
export const DEFAULT_STRATEGY = 'report-only'

/** Actions a decision can name. */
export const ARBITER_ACTIONS = Object.freeze(['report', 'disable-entry', 'needs-isolated-loader', 'refuse'])

/** Codes for policy reading and decisions. */
export const ARBITER_CODES = Object.freeze({
  CONFLICTS_NOT_OBJECT: 'CONFLICTS_NOT_OBJECT',
  CONFLICTS_UNKNOWN_KEY: 'CONFLICTS_UNKNOWN_KEY',
  STRATEGY_NOT_STRING: 'STRATEGY_NOT_STRING',
  STRATEGY_UNKNOWN: 'STRATEGY_UNKNOWN',
  SERVICE_NOT_STRING: 'SERVICE_NOT_STRING',
  SERVICE_DISAGREES_WITH_FAILURE: 'SERVICE_DISAGREES_WITH_FAILURE',
  ENTRY_NOT_ADDRESSABLE: 'ENTRY_NOT_ADDRESSABLE',
  ENTRY_IS_READ_ONLY: 'ENTRY_IS_READ_ONLY',
  STRATEGY_NEEDS_ISOLATED_LOADER: 'STRATEGY_NEEDS_ISOLATED_LOADER',
  ARBITER_DOES_NOT_DISABLE_ITSELF: 'ARBITER_DOES_NOT_DISABLE_ITSELF',
})

/** What arbitration cannot do, stated once. */
export const ARBITER_POLICY_LIMITATIONS = Object.freeze([
  'ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE',
  'CONFLICT_POLICY_IS_DECLARED_BY_THE_PLUGIN_THAT_LOSES_AND_IS_UNVERIFIED',
  'ISOLATE_STRATEGY_NEEDS_AN_ISOLATED_LOADER_THIS_PLUGIN_DOES_NOT_OWN',
  'PREVENTION_BELONGS_TO_A_STATIC_PRE_CHECK_BEFORE_INSTALL',
])

const CONFLICT_KEYS = Object.freeze(['strategy', 'service'])

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read `dsh.conflicts` from a parsed manifest.
 *
 * @param {unknown} pkg - Parsed `package.json`.
 * @returns {{ present: boolean, strategy: string, service: string|null, issues: object[] }} The policy.
 */
export function readConflictPolicy(pkg) {
  const state = { present: false, strategy: DEFAULT_STRATEGY, service: null, issues: [] }
  if (!isPlainRecord(pkg)) return state
  const dsh = pkg.dsh
  if (!isPlainRecord(dsh)) return state
  if (!Object.hasOwn(dsh, 'conflicts')) return state
  state.present = true
  const conflicts = dsh.conflicts
  if (!isPlainRecord(conflicts)) {
    state.issues.push({ code: ARBITER_CODES.CONFLICTS_NOT_OBJECT })
    return state
  }
  for (const key of Object.keys(conflicts)) {
    if (!CONFLICT_KEYS.includes(key)) state.issues.push({ code: ARBITER_CODES.CONFLICTS_UNKNOWN_KEY, key })
  }
  if (Object.hasOwn(conflicts, 'strategy')) {
    if (typeof conflicts.strategy !== 'string') {
      state.issues.push({ code: ARBITER_CODES.STRATEGY_NOT_STRING })
    } else if (!ARBITER_STRATEGIES.includes(conflicts.strategy)) {
      // An unknown strategy is refused rather than coerced to the default: a
      // plugin that asked for something we do not implement must not silently
      // get a different action.
      state.issues.push({ code: ARBITER_CODES.STRATEGY_UNKNOWN, strategy: conflicts.strategy })
      state.strategy = DEFAULT_STRATEGY
      state.refused = true
    } else {
      state.strategy = conflicts.strategy
    }
  }
  if (Object.hasOwn(conflicts, 'service')) {
    if (typeof conflicts.service !== 'string' || conflicts.service === '') {
      state.issues.push({ code: ARBITER_CODES.SERVICE_NOT_STRING })
    } else {
      state.service = conflicts.service
    }
  }
  return state
}

/**
 * Decide what to do about one failed entry.
 *
 * @param {object} input - Decision input.
 * @param {{ kind: string, service: string|null }} input.classification - Failure classification.
 * @param {{ strategy: string, service: string|null, refused?: boolean }} input.policy - Declared policy.
 * @param {{ entryId?: string, readOnly?: boolean }} input.entry - The failing entry.
 * @param {string} input.selfEntryId - The arbiter's own entry id, if known.
 * @param {string} [input.defaultStrategy] - Strategy for a plugin that declares none.
 * @returns {{ action: string, strategy: string, code: string|null, entryId: string|null, service: string|null, reasons: string[] }} The decision.
 */
export function decideArbitration(input) {
  const { classification, policy, entry } = input
  const strategy = policy?.present === true && policy.refused !== true
    ? policy.strategy
    : (input.defaultStrategy ?? DEFAULT_STRATEGY)
  const reasons = []
  const decision = {
    action: 'report',
    strategy,
    code: null,
    entryId: typeof entry?.entryId === 'string' ? entry.entryId : null,
    service: classification?.service ?? null,
    reasons,
  }

  // A declared service that disagrees with the failing one is recorded, not
  // enforced: the declaration is the plugin's claim about itself, and the error
  // text is the host's observation. Reporting both is more useful than picking.
  if (policy?.service !== null && policy?.service !== undefined
    && classification?.service !== null && policy.service !== classification.service) {
    reasons.push(ARBITER_CODES.SERVICE_DISAGREES_WITH_FAILURE)
  }

  if (strategy === 'report-only') return decision

  if (strategy === 'isolate') {
    decision.action = 'needs-isolated-loader'
    decision.code = ARBITER_CODES.STRATEGY_NEEDS_ISOLATED_LOADER
    return decision
  }

  // strategy === 'disable-later'
  if (decision.entryId === null) {
    decision.action = 'refuse'
    decision.code = ARBITER_CODES.ENTRY_NOT_ADDRESSABLE
    return decision
  }
  if (decision.entryId === input.selfEntryId) {
    // Disabling ourselves would end the only thing that could report the
    // outcome, and would disable the arbiter because it was doing its job.
    decision.action = 'refuse'
    decision.code = ARBITER_CODES.ARBITER_DOES_NOT_DISABLE_ITSELF
    return decision
  }
  if (entry?.readOnly === true) {
    // `PluginInfo.readOnlyReason` marks entries a profile control cannot modify
    // (`management-required`, `unaddressable`). Asking anyway would produce an
    // error the operator cannot act on.
    decision.action = 'refuse'
    decision.code = ARBITER_CODES.ENTRY_IS_READ_ONLY
    return decision
  }
  decision.action = 'disable-entry'
  return decision
}
