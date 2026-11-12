/**
 * Classify a startup failure message.
 *
 * WHY A MESSAGE CLASSIFIER: a failed fiber keeps its error in a private field
 * (`Fiber._error`), so the only public evidence of WHY an entry failed is
 * `PluginInfo.diagnostic` — a message string. The arbiter therefore reads
 * strings, and reading strings demands a closed taxonomy plus an explicit
 * "unclassified" outcome: a failure we cannot name must never be silently
 * treated as a conflict.
 *
 * THE ONE PATTERN THAT MATTERS: the duplicate-service conflict, thrown by
 * cordis when two fibers provide the same service in the same isolate scope —
 *
 *     service "catalog" has been registered at <plugin-a>
 *
 * (`cordis/lib/index.js:1400`, inside `reflect.provide`.) That is the C2
 * duplicate-occupancy case seen at load time, and it is the only conflict whose
 * text is stable enough to match. Everything else is unclassified on purpose:
 * guessing would let the arbiter act on a failure it does not understand.
 */

/** Version of this classifier, for records. */
export const FAILURE_CLASSIFIER_VERSION = 'failure-classifier/0.1-draft.1'

/** Failure kinds this classifier can name. */
export const FAILURE_KINDS = Object.freeze(['duplicate-service', 'property-conflict', 'unclassified'])

/** Codes for the reasons a classification carries. */
export const FAILURE_CODES = Object.freeze({
  DUPLICATE_SERVICE: 'DUPLICATE_SERVICE',
  PROPERTY_CONFLICT: 'PROPERTY_CONFLICT',
  UNCLASSIFIED: 'UNCLASSIFIED',
  MESSAGE_ABSENT: 'MESSAGE_ABSENT',
})

/** What a classification does not prove. */
export const FAILURE_CLASSIFIER_LIMITATIONS = Object.freeze([
  'FAILURE_TEXT_IS_A_MESSAGE_AND_MAY_BE_TRUNCATED_OR_REFORMATTED',
  'CLASSIFICATION_MATCHES_TEXT_NOT_A_TYPED_ERROR',
  'AN_UNCLASSIFIED_FAILURE_IS_NOT_EVIDENCE_OF_AN_ABSENT_CONFLICT',
])

/**
 * `service "<name>" has been registered at <owner>` anywhere in the message.
 *
 * Anchored to a line start so a message that merely QUOTES the sentence (for
 * example a log wrapper) does not classify: the thrown message begins the line.
 */
const DUPLICATE_SERVICE_PATTERN = /(?:^|\n)service "([^"]+)" has been registered at <([^>]*)>/

/** `property "<name>" is already declared as <kind>` from `reflect.provide`. */
const PROPERTY_CONFLICT_PATTERN = /(?:^|\n)property "([^"]+)" is already declared as ([a-z]+)/

/** ANSI control sequences may wrap a message that was captured from a terminal. */
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * Classify one failure message.
 *
 * @param {unknown} message - `PluginInfo.diagnostic` or any failure text.
 * @returns {{ kind: string, code: string, service: string|null, existingOwner: string|null, declaredAs: string|null }} The classification.
 */
export function classifyFailure(message) {
  const base = {
    kind: 'unclassified',
    code: FAILURE_CODES.UNCLASSIFIED,
    service: null,
    existingOwner: null,
    declaredAs: null,
  }
  if (typeof message !== 'string' || message === '') {
    return { ...base, code: FAILURE_CODES.MESSAGE_ABSENT }
  }
  const text = message.replace(ANSI_PATTERN, '')
  const duplicate = DUPLICATE_SERVICE_PATTERN.exec(text)
  if (duplicate) {
    return {
      kind: 'duplicate-service',
      code: FAILURE_CODES.DUPLICATE_SERVICE,
      service: duplicate[1],
      existingOwner: duplicate[2],
      declaredAs: null,
    }
  }
  const property = PROPERTY_CONFLICT_PATTERN.exec(text)
  if (property) {
    return {
      kind: 'property-conflict',
      code: FAILURE_CODES.PROPERTY_CONFLICT,
      service: property[1],
      existingOwner: null,
      declaredAs: property[2],
    }
  }
  return base
}

/**
 * True when a classification names a conflict the arbiter knows how to arbitrate.
 *
 * @param {{ kind: string }} classification - Result of {@link classifyFailure}.
 * @returns {boolean} Whether the kind is arbitrable.
 */
export function isArbitrable(classification) {
  // A predicate is asked about data that may be missing (no diagnostic, no
  // classification yet); `false` is an answer, a TypeError is not.
  const kind = classification?.kind
  return kind === 'duplicate-service' || kind === 'property-conflict'
}
