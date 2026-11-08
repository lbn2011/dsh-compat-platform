import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LIMITATIONS,
  NOT_DERIVED,
  RECEIPT_VERSION,
  checkReceipt,
  receiptStatus,
} from '../src/trusted-extraction-receipt.js'

function validReceipt(overrides = {}) {
  return {
    receiptVersion: RECEIPT_VERSION,
    status: 'observed',
    policyVersion: 'isolation-policy/0.1-draft.1',
    requestDigest: null,
    runtime: { node: 'v24.21.0', platform: 'linux', arch: 'x64' },
    inputWitness: { config: 'a'.repeat(64) },
    gates: { gate: null, refusal: null },
    process: { status: 0, signal: null, stdoutBytes: 12, stderrBytes: 0, timedOut: false },
    capture: { stdoutBytes: 12, stderrBytes: 0, truncated: false },
    phases: {
      resolve: 'observed',
      import: 'observed',
      activate: 'observed',
      settle: 'observed',
      cleanup: 'observed',
    },
    entries: [{ id: 'ok', state: 'active', missingCount: 0, failurePhase: null }],
    cleanup: 'confirmed',
    certification: false,
    correlation: 'not-established',
    notDerived: [...NOT_DERIVED],
    limitations: [...LIMITATIONS],
    ...overrides,
  }
}

test('a well-formed receipt passes', () => {
  assert.equal(checkReceipt(validReceipt()), null)
})

test('the notDerived list pins the six names verbatim', () => {
  assert.deepEqual([...NOT_DERIVED], [
    'declarations',
    'availableCapabilities',
    'resources',
    'activation',
    'loadability',
    'dependencyResolution',
  ])
})

test('every limitation is a fixed code, including the reimport disclosure', () => {
  assert.ok(LIMITATIONS.includes('FAILURE_PHASE_READ_BY_REIMPORT'))
  assert.ok(LIMITATIONS.includes('INPUT_IS_EXECUTED_CODE_NOT_INERT_DATA'))
  assert.ok(LIMITATIONS.includes('SYNTHETIC_FIXTURE_ONLY'))
})

test('an extra or missing key is refused', () => {
  assert.equal(checkReceipt({ ...validReceipt(), extra: 1 }), 'RECEIPT_KEYS')
  const missing = validReceipt()
  delete missing.cleanup
  assert.equal(checkReceipt(missing), 'RECEIPT_KEYS')
})

test('a certificate claim is refused', () => {
  assert.equal(checkReceipt(validReceipt({ certification: true })), 'RECEIPT_CERTIFICATION')
  assert.equal(checkReceipt(validReceipt({ correlation: 'established' })), 'RECEIPT_CORRELATION')
})

test('an unknown status or phase word is refused', () => {
  assert.equal(checkReceipt(validReceipt({ status: 'green' })), 'RECEIPT_STATUS')
  assert.equal(
    checkReceipt(validReceipt({ phases: { ...validReceipt().phases, activate: 'ok' } })),
    'RECEIPT_PHASE_WORD',
  )
  assert.equal(
    checkReceipt(validReceipt({ phases: { ...validReceipt().phases, mystery: 'observed' } })),
    'RECEIPT_PHASE_NAME',
  )
})

test('a truncated or reordered guard list is refused', () => {
  assert.equal(checkReceipt(validReceipt({ notDerived: NOT_DERIVED.slice(0, 3) })), 'RECEIPT_NOT_DERIVED')
  assert.equal(checkReceipt(validReceipt({ limitations: [...LIMITATIONS].reverse() })), 'RECEIPT_LIMITATIONS')
})

test('a non-object is refused without throwing', () => {
  for (const value of [null, [], 'receipt', 7]) assert.equal(checkReceipt(value), 'RECEIPT_NOT_AN_OBJECT')
})

test('a refused gate wins over everything else', () => {
  assert.equal(receiptStatus({ gates: { gate: 'identity', refusal: 'ISOLATION_IDENTITY_UNVERIFIED' }, phases: {}, cleanup: 'not-attempted' }), 'refused')
})

test('an unconfirmed cleanup is incomplete even with observed phases', () => {
  assert.equal(receiptStatus({ gates: null, phases: { resolve: 'observed' }, cleanup: 'unconfirmed' }), 'incomplete')
})

test('no observed phase is incomplete rather than silently green', () => {
  assert.equal(receiptStatus({ gates: null, phases: { resolve: 'not-observed' }, cleanup: 'confirmed' }), 'incomplete')
  assert.equal(receiptStatus({ gates: null, phases: {}, cleanup: 'confirmed' }), 'incomplete')
})

test('a confirmed cleanup with an observed phase is observed', () => {
  assert.equal(receiptStatus({ gates: null, phases: { resolve: 'observed' }, cleanup: 'confirmed' }), 'observed')
})
