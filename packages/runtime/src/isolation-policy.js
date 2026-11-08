// Isolation policy for the trusted-extraction supervisor.
//
// Pure decisions only: no filesystem, no process, no network. The supervisor
// gathers observations and hands them here; every function returns either null
// (gate satisfied) or a refusal word from REFUSALS. Nothing in this module can
// start a target.

export const POLICY_VERSION = 'isolation-policy/0.1-draft.1'

export const REFUSALS = Object.freeze({
  mount: 'ISOLATION_MOUNT_MISMATCH',
  identity: 'ISOLATION_IDENTITY_UNVERIFIED',
  evidence: 'ISOLATION_EVIDENCE_EXPOSED',
  budget: 'ISOLATION_BUDGET_INVALID',
  sentinel: 'ISOLATION_SENTINEL_FAILURE',
})

// Outer wall limit must dominate the work it contains, so a wedged target
// cannot consume the whole budget and leave no time to kill, reap or read back.
// 120 > 80 + 10 + 20 = 110, leaving 10 s of slack beyond the three reserved
// slices. The first draft used 90 s of phase work, which summed to exactly the
// outer limit and would have left nothing for the kill itself.
export const BUDGET = Object.freeze({
  outerSeconds: 120,
  phaseSeconds: 80,
  killGraceSeconds: 10,
  readbackSeconds: 20,
})

// The only host paths a target may see. Everything else must be absent.
export const ALLOWED_MOUNTS = Object.freeze([
  { path: '/usr', mode: 'ro' },
  { path: '/lib', mode: 'ro' },
  { path: '/lib64', mode: 'ro' },
  { path: '/bin', mode: 'ro' },
  { path: '/www', mode: 'ro' },
])

// Fixed infrastructure mounts the sandbox always provides.
export const FIXED_MOUNTS = Object.freeze(['/proc', '/dev', '/tmp'])

// Run-specific mounts the supervisor declares, part of the policy rather than
// ad-hoc additions: the runner's own read-only code, the fixture tree, and the
// one writable output directory.
export const RUN_MOUNTS = Object.freeze(['/runner', '/run-fixture', '/out'])

export const REQUIRED_MOUNTS = Object.freeze([
  ...ALLOWED_MOUNTS.map((m) => m.path),
  ...FIXED_MOUNTS,
  ...RUN_MOUNTS,
])

// Subtrees that may legitimately appear beneath an allowed or fixed mount when
// bubblewrap enumerates device and proc entries. A mount outside every prefix is
// a leak.
export const ALLOWED_PREFIXES = Object.freeze([
  '/',
  ...ALLOWED_MOUNTS.map((m) => m.path),
  ...FIXED_MOUNTS,
  ...RUN_MOUNTS,
])

export function checkBudget(budget = BUDGET) {
  const { outerSeconds, phaseSeconds, killGraceSeconds, readbackSeconds } = budget
  for (const value of [outerSeconds, phaseSeconds, killGraceSeconds, readbackSeconds]) {
    if (!Number.isInteger(value) || value <= 0) return REFUSALS.budget
  }
  const reserved = phaseSeconds + killGraceSeconds + readbackSeconds
  if (!(outerSeconds > reserved)) return REFUSALS.budget
  return null
}

// A prefix allows itself and its descendants. '/' is special: it allows only
// the sandbox root itself, never every absolute path — treating '/' as a blanket
// prefix would silently accept any leaked mount.
function underAllowedPrefix(mountPoint) {
  return ALLOWED_PREFIXES.some((prefix) => {
    if (prefix === '/') return mountPoint === '/'
    return mountPoint === prefix || mountPoint.startsWith(prefix + '/')
  })
}

// Every declared mount must be present, and nothing may appear outside the
// allowlist. `childMounts` is [{ mountPoint, fsType }] read from the child.
export function checkMounts(childMounts, extraWritable = []) {
  if (!Array.isArray(childMounts) || childMounts.length === 0) return REFUSALS.mount
  const points = new Set(childMounts.map((m) => m.mountPoint))
  for (const path of REQUIRED_MOUNTS) {
    if (!points.has(path)) return REFUSALS.mount
  }
  const extra = new Set(extraWritable)
  for (const { mountPoint } of childMounts) {
    if (extra.has(mountPoint)) continue
    if (!underAllowedPrefix(mountPoint)) return REFUSALS.mount
  }
  return null
}

// The target must be a non-root identity with no capabilities, proven from
// inside. A user namespace that maps root to itself is not unprivileged.
export function checkIdentity(report) {
  if (report === null || typeof report !== 'object') return REFUSALS.identity
  const { uid, gid, capEff, capPrm, noNewPrivs } = report
  if (typeof uid !== 'number' || uid === 0) return REFUSALS.identity
  if (typeof gid !== 'number' || gid === 0) return REFUSALS.identity
  if (capEff !== '0000000000000000') return REFUSALS.identity
  if (capPrm !== '0000000000000000') return REFUSALS.identity
  if (noNewPrivs !== 1) return REFUSALS.identity
  return null
}

// Every supervisor-side path the child tried to write must have been refused.
export function checkEvidenceIsolation(writeAttempts) {
  if (!Array.isArray(writeAttempts)) return REFUSALS.evidence
  if (writeAttempts.length === 0) return REFUSALS.evidence
  for (const attempt of writeAttempts) {
    if (attempt.label === 'own-write') continue
    if (attempt.ok !== false) return REFUSALS.evidence
  }
  return null
}

// Errno values that mean the outbound attempt never left the boundary. Any
// other outcome — a successful connect, or an error the sandbox did not cause —
// must not be reported as a denial.
export const NETWORK_DENY_CODES = Object.freeze([
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'EACCES',
  'EPERM',
  'ENOENT',
  'EAI_AGAIN',
])

// The network word is a decision about an observation, so it lives here with the
// other closed vocabularies: an attempt the sandbox refused is `denied`, a
// successful connect is `reachable` (never called a denial), and anything else —
// no attempt, no record, an unclassified errno — is `unknown`.
export function networkVerdict(attempt) {
  if (attempt === null || typeof attempt !== 'object' || attempt.attempted !== true) return 'unknown'
  if (attempt.ok === true) return 'reachable'
  if (typeof attempt.code === 'string' && NETWORK_DENY_CODES.includes(attempt.code)) return 'denied'
  return 'unknown'
}

// Sentinels are launcher-controlled probes. Each must show the boundary held.
export function checkSentinels(sentinels) {
  if (sentinels === null || typeof sentinels !== 'object') return REFUSALS.sentinel
  const { outOfPolicyRead, outOfPolicyWrite, networkConnect, unixSocket, descendants } = sentinels
  if (outOfPolicyRead !== 'denied') return REFUSALS.sentinel
  if (outOfPolicyWrite !== 'denied') return REFUSALS.sentinel
  if (networkConnect !== 'denied') return REFUSALS.sentinel
  if (unixSocket !== 'absent') return REFUSALS.sentinel
  if (descendants !== 'none') return REFUSALS.sentinel
  return null
}

// Ordered evaluation: stop at the first refusal.
export function evaluateGates({ budget, childMounts, identity, writeAttempts, sentinels, extraWritable }) {
  const ordered = [
    ['budget', () => checkBudget(budget)],
    ['mounts', () => checkMounts(childMounts, extraWritable)],
    ['identity', () => checkIdentity(identity)],
    ['evidence', () => checkEvidenceIsolation(writeAttempts)],
    ['sentinels', () => checkSentinels(sentinels)],
  ]
  for (const [gate, check] of ordered) {
    const refusal = check()
    if (refusal !== null) return { gate, refusal }
  }
  return { gate: null, refusal: null }
}
