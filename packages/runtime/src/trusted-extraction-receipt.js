// Receipt for one trusted-extraction observation.
//
// Inert: this module validates and projects a receipt document. It never starts
// a process and never reads a target.

export const RECEIPT_VERSION = 'trusted-extraction-receipt/0.1-draft.1'

export const RECEIPT_STATUS = Object.freeze([
  'observed',
  'refused',
  'incomplete',
  'host-error',
])

export const RECEIPT_KEYS = Object.freeze([
  'receiptVersion',
  'status',
  'policyVersion',
  'requestDigest',
  'runtime',
  'inputWitness',
  'gates',
  'process',
  'capture',
  'phases',
  'entries',
  'cleanup',
  'certification',
  'correlation',
  'notDerived',
  'limitations',
])

export const NOT_DERIVED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
])

export const LIMITATIONS = Object.freeze([
  'SYNTHETIC_FIXTURE_ONLY',
  'PHASES_OBSERVED_NOT_CERTIFIED',
  'ENTRY_NAMES_ARE_FIXTURE_LABELS',
  'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
  'NO_LOADABILITY_OR_ACTIVATION_CERTIFIED',
  'NO_PRODUCTION_PROFILE_READ',
  'ISOLATION_IS_A_BOUNDARY_NOT_A_SANDBOX_PROOF',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_EXECUTED_CODE_NOT_INERT_DATA',
  'FAILURE_PHASE_READ_BY_REIMPORT',
])

const PHASE_WORDS = new Set(['not-observed', 'observed', 'failed', 'interrupted'])

export function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

export function checkReceipt(receipt) {
  if (!isPlainRecord(receipt)) return 'RECEIPT_NOT_AN_OBJECT'
  const keys = Object.keys(receipt).sort()
  const expected = [...RECEIPT_KEYS].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return 'RECEIPT_KEYS'
  }
  if (receipt.receiptVersion !== RECEIPT_VERSION) return 'RECEIPT_VERSION'
  if (!RECEIPT_STATUS.includes(receipt.status)) return 'RECEIPT_STATUS'
  if (receipt.certification !== false) return 'RECEIPT_CERTIFICATION'
  if (receipt.correlation !== 'not-established') return 'RECEIPT_CORRELATION'
  if (!isPlainRecord(receipt.phases)) return 'RECEIPT_PHASES'
  for (const [phase, word] of Object.entries(receipt.phases)) {
    if (!['resolve', 'import', 'activate', 'settle', 'cleanup'].includes(phase)) return 'RECEIPT_PHASE_NAME'
    if (!PHASE_WORDS.has(word)) return 'RECEIPT_PHASE_WORD'
  }
  if (!Array.isArray(receipt.entries)) return 'RECEIPT_ENTRIES'
  if (!Array.isArray(receipt.notDerived) || receipt.notDerived.length !== NOT_DERIVED.length) {
    return 'RECEIPT_NOT_DERIVED'
  }
  for (let i = 0; i < NOT_DERIVED.length; i += 1) {
    if (receipt.notDerived[i] !== NOT_DERIVED[i]) return 'RECEIPT_NOT_DERIVED'
  }
  if (!Array.isArray(receipt.limitations) || receipt.limitations.length !== LIMITATIONS.length) {
    return 'RECEIPT_LIMITATIONS'
  }
  for (let i = 0; i < LIMITATIONS.length; i += 1) {
    if (receipt.limitations[i] !== LIMITATIONS[i]) return 'RECEIPT_LIMITATIONS'
  }
  return null
}

// A green receipt needs every gate satisfied, a confirmed cleanup and at least
// one observed phase. Anything less is `incomplete`, never quietly `observed`.
export function receiptStatus({ gates, phases, cleanup }) {
  if (gates !== null && gates !== undefined) return 'refused'
  if (cleanup !== 'confirmed') return 'incomplete'
  const observed = Object.values(phases ?? {}).filter((word) => word === 'observed').length
  if (observed === 0) return 'incomplete'
  return 'observed'
}
