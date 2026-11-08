/**
 * `repair-plan` — the typed, inert half of approved repair.
 *
 * TRUST BOUNDARY. This module reads a JSON value in memory and returns a verdict.
 * It performs no I/O, starts no process, imports nothing but `node:crypto`, and
 * has no writer of any kind. A valid plan is a *description* of a change that
 * somebody could make later; it is not permission to make it, and nothing in this
 * repository can execute it.
 *
 * WHAT A PLAN IS ALLOWED TO SAY. The vocabulary is deliberately one element wide:
 * set one boolean field (`disabled`) on one entry of an entry-list document. That
 * is enough to be a real, checkable operation on a fixture, and narrow enough that
 * no general profile rewriting can be expressed by widening a field here. Anything
 * outside the vocabulary is refused with a closed code, not coerced.
 *
 * WHAT PINS THE PLAN. `precondition.documentSha256` is the digest of the exact bytes
 * the plan was computed against, and `precondition.revision` is a caller-supplied
 * label for the revision it believed it was looking at. A preview recomputes the
 * digest; a mismatch is `PLAN_STALE` and stops before any writer could exist. The
 * revision is *not* verified by this module — nothing here can reach the document's
 * history, so it is carried and displayed, never trusted.
 *
 * @module repair-plan
 */

import { createHash } from 'node:crypto';

/** The plan schema this module accepts. Any other string is refused. */
export const PLAN_VERSION = 'repair-plan/0.1-draft.1';

/** The complete key set of a plan. Extra keys are refused, not ignored. */
export const PLAN_KEYS = Object.freeze([
  'planVersion',
  'operation',
  'precondition',
  'expectedPostcondition',
]);

/** The complete key set of `operation`. */
export const OPERATION_KEYS = Object.freeze(['kind', 'entryIndex', 'field', 'value']);

/** The complete operation vocabulary. Widening this list is a design change. */
export const OPERATION_KINDS = Object.freeze(['set-entry-flag']);

/** The only boolean fields this version may set. */
export const FLAG_FIELDS = Object.freeze(['disabled']);

/** The only values this version may set them to. */
export const FLAG_VALUES = Object.freeze([true, false]);

/** The complete key set of `precondition`. */
export const PRECONDITION_KEYS = Object.freeze(['documentSha256', 'revision']);

/** The complete key set of `expectedPostcondition`. */
export const POSTCONDITION_KEYS = Object.freeze([
  'documentSha256',
  'entryIndex',
  'field',
  'value',
]);

/** A lowercase hex SHA-256, and nothing else. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Longest revision label accepted; the label is carried, never verified. */
export const MAX_REVISION_LENGTH = 128;

/** Closed refusal vocabulary. Every code here is reachable. */
export const PLAN_ISSUE_CODES = Object.freeze([
  'PLAN_NOT_RECORD',
  'PLAN_UNKNOWN_FIELD',
  'PLAN_MISSING_FIELD',
  'PLAN_VERSION_UNSUPPORTED',
  'PLAN_OPERATION_NOT_RECORD',
  'PLAN_OPERATION_UNKNOWN_FIELD',
  'PLAN_OPERATION_MISSING_FIELD',
  'PLAN_OPERATION_UNSUPPORTED',
  'PLAN_FIELD_UNSUPPORTED',
  'PLAN_VALUE_UNSUPPORTED',
  'PLAN_ENTRY_INDEX_INVALID',
  'PLAN_PRECONDITION_NOT_RECORD',
  'PLAN_PRECONDITION_UNKNOWN_FIELD',
  'PLAN_PRECONDITION_MISSING_FIELD',
  'PLAN_DIGEST_INVALID',
  'PLAN_REVISION_INVALID',
  'PLAN_POSTCONDITION_NOT_RECORD',
  'PLAN_POSTCONDITION_UNKNOWN_FIELD',
  'PLAN_POSTCONDITION_MISSING_FIELD',
  'PLAN_POSTCONDITION_MISMATCH',
]);

/**
 * What a plan does not establish, printed wherever a plan is shown. Every entry is
 * a claim someone might otherwise read into a validated plan.
 */
export const PLAN_LIMITATIONS = Object.freeze([
  'PLAN_IS_A_DESCRIPTION_NOT_AN_APPROVAL',
  'NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY',
  'PLAN_COVERS_ONE_BOOLEAN_ON_ONE_FIXTURE_ENTRY',
  'REVISION_LABEL_IS_CALLER_SUPPLIED_AND_UNVERIFIED',
  'PRECONDITION_PINS_BYTES_NOT_AUTHORITY',
  'NOTHING_IS_LOADED_OR_ACTIVATED_BY_A_PLAN',
]);

/**
 * Is this an ordinary record (not a class instance, not an array, not null)?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped objects.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Compare a record's own enumerable keys against an allowed set.
 *
 * @param {object} value Record to inspect.
 * @param {readonly string[]} allowed The complete allowed key set.
 * @returns {{unknown: string[], missing: string[]}} Keys outside the set, and
 *   allowed keys that are absent.
 */
function diffKeys(value, allowed) {
  const own = Object.keys(value);
  const unknown = own.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  return { unknown, missing };
}

/**
 * Serialize a JSON value with object keys sorted, so the same plan always yields
 * the same digest. Non-JSON values are refused rather than coerced.
 *
 * @param {unknown} value Value to serialize.
 * @returns {string} Canonical JSON text.
 * @throws {TypeError} When the value is not representable as JSON.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: only finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError('canonicalJson: value is not representable as JSON');
}

/**
 * The digest that identifies a plan. Two byte-different serializations of the same
 * plan share it, so an approval can name a plan without depending on formatting.
 *
 * @param {unknown} plan A plan value (validated or not — the digest is mechanical).
 * @returns {string} Lowercase hex SHA-256 of the canonical JSON.
 */
export function planDigest(plan) {
  return createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex');
}

/**
 * Validate a repair plan against the closed schema.
 *
 * @param {unknown} value Candidate plan.
 * @returns {{valid: boolean, issues: ReadonlyArray<{code: string, path: string}>}} A
 *   frozen verdict. `valid` is true only when `issues` is empty. Never throws for
 *   JSON values.
 */
export function validateRepairPlan(value) {
  const issues = [];
  const add = (code, path) => issues.push(Object.freeze({ code, path }));

  if (!isRecord(value)) {
    add('PLAN_NOT_RECORD', 'plan');
    return Object.freeze({ valid: false, issues: Object.freeze(issues) });
  }

  const top = diffKeys(value, PLAN_KEYS);
  for (const key of top.unknown) add('PLAN_UNKNOWN_FIELD', key);
  for (const key of top.missing) add('PLAN_MISSING_FIELD', key);

  if (Object.hasOwn(value, 'planVersion') && value.planVersion !== PLAN_VERSION) {
    add('PLAN_VERSION_UNSUPPORTED', 'planVersion');
  }

  checkOperation(value.operation, add);
  const operationValid = issues.length === 0;

  checkPrecondition(value.precondition, add);
  checkPostcondition(value.expectedPostcondition, add);

  // The postcondition must describe the same entry and the same field as the
  // operation, or the plan is internally inconsistent and no preview can mean
  // anything. Only compared when both halves are individually well formed.
  if (operationValid
    && isRecord(value.operation)
    && isRecord(value.expectedPostcondition)
    && Object.hasOwn(value.expectedPostcondition, 'entryIndex')
    && Object.hasOwn(value.expectedPostcondition, 'field')
    && Object.hasOwn(value.expectedPostcondition, 'value')) {
    const post = value.expectedPostcondition;
    if (post.entryIndex !== value.operation.entryIndex
      || post.field !== value.operation.field
      || post.value !== value.operation.value) {
      add('PLAN_POSTCONDITION_MISMATCH', 'expectedPostcondition');
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

/**
 * Check the `operation` member.
 *
 * @param {unknown} operation Candidate.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkOperation(operation, add) {
  if (!isRecord(operation)) {
    add('PLAN_OPERATION_NOT_RECORD', 'operation');
    return;
  }
  const { unknown, missing } = diffKeys(operation, OPERATION_KEYS);
  for (const key of unknown) add('PLAN_OPERATION_UNKNOWN_FIELD', `operation.${key}`);
  for (const key of missing) add('PLAN_OPERATION_MISSING_FIELD', `operation.${key}`);

  if (Object.hasOwn(operation, 'kind') && !OPERATION_KINDS.includes(operation.kind)) {
    add('PLAN_OPERATION_UNSUPPORTED', 'operation.kind');
  }
  if (Object.hasOwn(operation, 'entryIndex')) {
    const index = operation.entryIndex;
    if (!Number.isInteger(index) || index < 1) add('PLAN_ENTRY_INDEX_INVALID', 'operation.entryIndex');
  }
  if (Object.hasOwn(operation, 'field') && !FLAG_FIELDS.includes(operation.field)) {
    add('PLAN_FIELD_UNSUPPORTED', 'operation.field');
  }
  if (Object.hasOwn(operation, 'value') && !FLAG_VALUES.includes(operation.value)) {
    add('PLAN_VALUE_UNSUPPORTED', 'operation.value');
  }
}

/**
 * Check the `precondition` member.
 *
 * @param {unknown} precondition Candidate.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkPrecondition(precondition, add) {
  if (!isRecord(precondition)) {
    add('PLAN_PRECONDITION_NOT_RECORD', 'precondition');
    return;
  }
  const { unknown, missing } = diffKeys(precondition, PRECONDITION_KEYS);
  for (const key of unknown) add('PLAN_PRECONDITION_UNKNOWN_FIELD', `precondition.${key}`);
  for (const key of missing) add('PLAN_PRECONDITION_MISSING_FIELD', `precondition.${key}`);

  if (Object.hasOwn(precondition, 'documentSha256')
    && !(typeof precondition.documentSha256 === 'string'
      && SHA256_PATTERN.test(precondition.documentSha256))) {
    add('PLAN_DIGEST_INVALID', 'precondition.documentSha256');
  }
  if (Object.hasOwn(precondition, 'revision')) {
    const revision = precondition.revision;
    if (typeof revision !== 'string' || revision.length === 0 || revision.length > MAX_REVISION_LENGTH) {
      add('PLAN_REVISION_INVALID', 'precondition.revision');
    }
  }
}

/**
 * Check the `expectedPostcondition` member.
 *
 * @param {unknown postcondition} postcondition Candidate.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkPostcondition(postcondition, add) {
  if (!isRecord(postcondition)) {
    add('PLAN_POSTCONDITION_NOT_RECORD', 'expectedPostcondition');
    return;
  }
  const { unknown, missing } = diffKeys(postcondition, POSTCONDITION_KEYS);
  for (const key of unknown) add('PLAN_POSTCONDITION_UNKNOWN_FIELD', `expectedPostcondition.${key}`);
  for (const key of missing) add('PLAN_POSTCONDITION_MISSING_FIELD', `expectedPostcondition.${key}`);

  if (Object.hasOwn(postcondition, 'documentSha256')
    && !(typeof postcondition.documentSha256 === 'string'
      && SHA256_PATTERN.test(postcondition.documentSha256))) {
    add('PLAN_DIGEST_INVALID', 'expectedPostcondition.documentSha256');
  }
  if (Object.hasOwn(postcondition, 'entryIndex')) {
    const index = postcondition.entryIndex;
    if (!Number.isInteger(index) || index < 1) {
      add('PLAN_ENTRY_INDEX_INVALID', 'expectedPostcondition.entryIndex');
    }
  }
  if (Object.hasOwn(postcondition, 'field') && !FLAG_FIELDS.includes(postcondition.field)) {
    add('PLAN_FIELD_UNSUPPORTED', 'expectedPostcondition.field');
  }
  if (Object.hasOwn(postcondition, 'value') && !FLAG_VALUES.includes(postcondition.value)) {
    add('PLAN_VALUE_UNSUPPORTED', 'expectedPostcondition.value');
  }
}
