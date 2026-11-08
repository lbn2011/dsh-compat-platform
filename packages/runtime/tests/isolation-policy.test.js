import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUDGET,
  REFUSALS,
  checkBudget,
  checkEvidenceIsolation,
  checkIdentity,
  checkMounts,
  checkSentinels,
  evaluateGates,
} from '../src/isolation-policy.js'

const OK_IDENTITY = {
  uid: 65534,
  gid: 65534,
  capEff: '0000000000000000',
  capPrm: '0000000000000000',
  noNewPrivs: 1,
}

const OK_MOUNTS = [
  { mountPoint: '/', fsType: 'tmpfs' },
  { mountPoint: '/usr', fsType: 'ext4' },
  { mountPoint: '/lib', fsType: 'ext4' },
  { mountPoint: '/lib64', fsType: 'ext4' },
  { mountPoint: '/bin', fsType: 'ext4' },
  { mountPoint: '/www', fsType: 'ext4' },
  { mountPoint: '/proc', fsType: 'proc' },
  { mountPoint: '/proc/sysrq-trigger', fsType: 'proc' },
  { mountPoint: '/dev', fsType: 'tmpfs' },
  { mountPoint: '/dev/null', fsType: 'devtmpfs' },
  { mountPoint: '/dev/pts', fsType: 'devpts' },
  { mountPoint: '/tmp', fsType: 'tmpfs' },
  { mountPoint: '/runner', fsType: 'ext4' },
  { mountPoint: '/run-fixture', fsType: 'ext4' },
  { mountPoint: '/out', fsType: 'ext4' },
]

const OK_SENTINELS = {
  outOfPolicyRead: 'denied',
  outOfPolicyWrite: 'denied',
  networkConnect: 'denied',
  unixSocket: 'absent',
  descendants: 'none',
}

test('the declared budget leaves room to kill, reap and read back', () => {
  assert.equal(checkBudget(BUDGET), null)
  assert.ok(BUDGET.outerSeconds > BUDGET.phaseSeconds + BUDGET.killGraceSeconds + BUDGET.readbackSeconds)
})

test('a budget that equals the sum of its parts is refused', () => {
  assert.equal(
    checkBudget({ outerSeconds: 120, phaseSeconds: 90, killGraceSeconds: 10, readbackSeconds: 20 }),
    REFUSALS.budget,
  )
  assert.equal(
    checkBudget({ outerSeconds: 100, phaseSeconds: 90, killGraceSeconds: 10, readbackSeconds: 20 }),
    REFUSALS.budget,
  )
})

test('a non-integer or non-positive budget field is refused', () => {
  for (const bad of [{ ...BUDGET, outerSeconds: 0 }, { ...BUDGET, phaseSeconds: 1.5 }, { ...BUDGET, killGraceSeconds: -1 }]) {
    assert.equal(checkBudget(bad), REFUSALS.budget)
  }
})

test('the expected mount set passes', () => {
  assert.equal(checkMounts(OK_MOUNTS, ['/out']), null)
})

test('a missing declared mount is refused', () => {
  const missing = OK_MOUNTS.filter((row) => row.mountPoint !== '/www')
  assert.equal(checkMounts(missing, ['/out']), REFUSALS.mount)
})

test('a mount outside the allowlist is refused even when everything else is present', () => {
  const leaked = [...OK_MOUNTS, { mountPoint: '/root', fsType: 'ext4' }]
  assert.equal(checkMounts(leaked, ['/out']), REFUSALS.mount)
})

test('an empty mount report is refused rather than treated as clean', () => {
  assert.equal(checkMounts([], ['/out']), REFUSALS.mount)
  assert.equal(checkMounts(null, []), REFUSALS.mount)
})

test('a root identity is refused', () => {
  assert.equal(checkIdentity({ ...OK_IDENTITY, uid: 0 }), REFUSALS.identity)
  assert.equal(checkIdentity({ ...OK_IDENTITY, gid: 0 }), REFUSALS.identity)
})

test('a mapped-root-user namespace is refused because it still reports uid 0', () => {
  // `unshare --user --map-root-user` shows uid 0 inside the namespace; that is
  // not an unprivileged target and must not count as one.
  assert.equal(checkIdentity({ ...OK_IDENTITY, uid: 0, gid: 0 }), REFUSALS.identity)
})

test('retained capabilities or an unset no-new-privs flag are refused', () => {
  assert.equal(checkIdentity({ ...OK_IDENTITY, capEff: '0000000000200000' }), REFUSALS.identity)
  assert.equal(checkIdentity({ ...OK_IDENTITY, capPrm: '0000000000200000' }), REFUSALS.identity)
  assert.equal(checkIdentity({ ...OK_IDENTITY, noNewPrivs: 0 }), REFUSALS.identity)
  assert.equal(checkIdentity(null), REFUSALS.identity)
})

test('a writable supervisor path fails the evidence gate', () => {
  const attempts = [
    { label: 'supervisor:/run/x/receipt.json', ok: true },
    { label: 'own-write', ok: true },
  ]
  assert.equal(checkEvidenceIsolation(attempts), REFUSALS.evidence)
})

test('an empty or non-array write report fails the evidence gate', () => {
  assert.equal(checkEvidenceIsolation([]), REFUSALS.evidence)
  assert.equal(checkEvidenceIsolation(null), REFUSALS.evidence)
})

test('the child writing only its own area passes the evidence gate', () => {
  assert.equal(
    checkEvidenceIsolation([
      { label: 'supervisor:/run/x/receipt.json', ok: false },
      { label: 'own-write', ok: true },
    ]),
    null,
  )
})

test('every sentinel must show the boundary held', () => {
  assert.equal(checkSentinels(OK_SENTINELS), null)
  for (const [key, value] of Object.entries({
    outOfPolicyRead: 'readable',
    outOfPolicyWrite: 'writable',
    networkConnect: 'accepted',
    unixSocket: 'present',
    descendants: 'survived',
  })) {
    assert.equal(checkSentinels({ ...OK_SENTINELS, [key]: value }), REFUSALS.sentinel)
  }
  assert.equal(checkSentinels(null), REFUSALS.sentinel)
})

test('gates are evaluated in order and stop at the first refusal', () => {
  const verdict = evaluateGates({
    budget: BUDGET,
    childMounts: OK_MOUNTS,
    identity: { ...OK_IDENTITY, uid: 0 },
    writeAttempts: [{ label: 'supervisor:/x', ok: true }],
    sentinels: { ...OK_SENTINELS, outOfPolicyRead: 'readable' },
    extraWritable: ['/out'],
  })
  assert.deepEqual(verdict, { gate: 'identity', refusal: REFUSALS.identity })
})

test('all-satisfied observations produce no refusal', () => {
  const verdict = evaluateGates({
    budget: BUDGET,
    childMounts: OK_MOUNTS,
    identity: OK_IDENTITY,
    writeAttempts: [{ label: 'supervisor:/x', ok: false }, { label: 'own-write', ok: true }],
    sentinels: OK_SENTINELS,
    extraWritable: ['/out'],
  })
  assert.deepEqual(verdict, { gate: null, refusal: null })
})
