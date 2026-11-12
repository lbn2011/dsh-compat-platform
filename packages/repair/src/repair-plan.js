/**
 * `repair-plan` — the typed, inert half of approved repair.
 *
 * TRUST BOUNDARY. This module reads a JSON value in memory and returns a verdict.
 * It performs no I/O, starts no process, imports nothing but `node:crypto`, and
 * has no writer of any kind. A valid plan is a *description* of a change that
 * somebody could make later; it is not permission to make it, and nothing in this
 * repository can execute it.
 *
 * WHAT A PLAN IS ALLOWED TO SAY. The vocabulary is deliberately narrow: a small
 * set of text edits that the preview can perform on one entry-list document and
 * then verify byte-for-byte through a digest. That is enough to be a real,
 * checkable operation on a fixture, and narrow enough that no general profile
 * rewriting can be expressed by widening a field here. Anything outside the
 * vocabulary is refused with a closed code, not coerced.
 *
 * Version scoping. `repair-plan/0.1-draft.1` carries exactly one operation
 * (`set-entry-flag` on `disabled`) and a postcondition that repeats the operation's
 * coordinates. `repair-plan/0.2-draft.1` widens the vocabulary to five operations
 * (`set-entry-flag`, `set-entry-config`, `reorder`, `disable-conflicting`,
 * `patch-insert`) and keeps only the document digest in the postcondition, because
 * for a move or an insertion the coordinates of the edit are no longer a single
 * (entry, field, value) triple. A 0.1 plan keeps its old meaning; nothing is
 * silently reinterpreted.
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

/** The plan schema this module emits today. */
export const PLAN_VERSION = 'repair-plan/0.2-draft.1';

/** Every version this module accepts, oldest first. Any other string is refused. */
export const PLAN_VERSIONS = Object.freeze(['repair-plan/0.1-draft.1', PLAN_VERSION]);

/** The complete key set of a plan. Extra keys are refused, not ignored. */
export const PLAN_KEYS = Object.freeze([
  'planVersion',
  'operation',
  'precondition',
  'expectedPostcondition',
]);

/** The complete operation vocabulary of the newest version. Widening it is a design change. */
export const OPERATION_KINDS = Object.freeze([
  'set-entry-flag',
  'set-entry-config',
  'reorder',
  'disable-conflicting',
  'patch-insert',
]);

/** Which operations each accepted version may name. */
export const OPERATION_KINDS_BY_VERSION = Object.freeze({
  'repair-plan/0.1-draft.1': Object.freeze(['set-entry-flag']),
  [PLAN_VERSION]: OPERATION_KINDS,
});

/** The complete key set of `operation`, per operation kind. */
export const OPERATION_KEYS_BY_KIND = Object.freeze({
  'set-entry-flag': Object.freeze(['kind', 'entryIndex', 'field', 'value']),
  'set-entry-config': Object.freeze(['kind', 'entryIndex', 'configKey', 'value']),
  reorder: Object.freeze(['kind', 'fromIndex', 'toIndex']),
  'disable-conflicting': Object.freeze([
    'kind',
    'disableIndex',
    'keepIndex',
    'conflictId',
  ]),
  'patch-insert': Object.freeze(['kind', 'afterIndex', 'entryId']),
});

/** The union of every operation key, used to judge an operation whose kind is unknown. */
export const OPERATION_KEYS_ALL = Object.freeze([
  'kind',
  'entryIndex',
  'field',
  'value',
  'configKey',
  'fromIndex',
  'toIndex',
  'disableIndex',
  'keepIndex',
  'conflictId',
  'afterIndex',
  'entryId',
]);

/** The only boolean fields `set-entry-flag` may set. */
export const FLAG_FIELDS = Object.freeze(['disabled']);

/** The only values it may set them to. */
export const FLAG_VALUES = Object.freeze([true, false]);

/** A config key this version may address: bare, bounded, no quoting needed. */
export const CONFIG_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * The only scalar forms a config value may take. A string that would need YAML
 * quoting has no rendering the preview can guarantee, so it is refused rather
 * than quoted by guesswork.
 */
export const CONFIG_STRING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;

/** A patch entry id this version may insert: bare, bounded, no quoting needed. */
export const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

/** A conflict identifier carried as provenance: `C2|service|catalog|a#-,b#-`. */
export const CONFLICT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9|#.,_:-]{0,255}$/;

/** The complete key set of `precondition`. */
export const PRECONDITION_KEYS = Object.freeze(['documentSha256', 'revision']);

/** The complete key set of `expectedPostcondition` for a 0.1 plan. */
export const POSTCONDITION_KEYS = Object.freeze([
  'documentSha256',
  'entryIndex',
  'field',
  'value',
]);

/** The complete key set of `expectedPostcondition` for a 0.2 plan. */
export const POSTCONDITION_KEYS_V2 = Object.freeze(['documentSha256']);

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
  'PLAN_OPERATION_NOOP',
  'PLAN_FIELD_UNSUPPORTED',
  'PLAN_VALUE_UNSUPPORTED',
  'PLAN_CONFIG_KEY_INVALID',
  'PLAN_ENTRY_ID_INVALID',
  'PLAN_CONFLICT_ID_INVALID',
  'PLAN_CONFLICT_PROVENANCE_INVALID',
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
  'APPLY_PATH_IS_CONFINED_TO_A_FIXTURE_DIRECTORY',
  'PLAN_EDITS_ARE_LIMITED_TO_THE_ENTRY_LIST_SUBSET',
  'REVISION_LABEL_IS_CALLER_SUPPLIED_AND_UNVERIFIED',
  'PRECONDITION_PINS_BYTES_NOT_AUTHORITY',
  'CONFLICT_PROVENANCE_IS_CALLER_SUPPLIED_AND_UNVERIFIED',
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
 * Is this a 1-based entry index?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for a positive integer.
 */
function isEntryIndex(value) {
  return Number.isInteger(value) && value >= 1;
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
 * The postcondition key set a version uses.
 *
 * @param {string|null} version A version string, or null when it is unusable.
 * @returns {readonly string[]} Allowed postcondition keys.
 */
export function postconditionKeysFor(version) {
  return version === 'repair-plan/0.1-draft.1' ? POSTCONDITION_KEYS : POSTCONDITION_KEYS_V2;
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

  let version = null;
  if (Object.hasOwn(value, 'planVersion')) {
    if (!PLAN_VERSIONS.includes(value.planVersion)) {
      add('PLAN_VERSION_UNSUPPORTED', 'planVersion');
    } else {
      version = value.planVersion;
    }
  }

  checkOperation(value.operation, version, add);
  const operationValid = issues.length === 0;

  checkPrecondition(value.precondition, add);
  const preconditionValid = issues.length === 0;

  // A 0.1 postcondition repeats the operation's coordinates, and the two halves
  // must agree or no preview can mean anything. A 0.2 postcondition carries only
  // the document digest, so there is nothing to compare beyond its shape.
  checkPostcondition(value.expectedPostcondition, version, add);

  if (version === 'repair-plan/0.1-draft.1'
    && operationValid
    && preconditionValid
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
 * @param {string|null} version A supported version, or null when unusable.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkOperation(operation, version, add) {
  if (!isRecord(operation)) {
    add('PLAN_OPERATION_NOT_RECORD', 'operation');
    return;
  }

  const hasKind = Object.hasOwn(operation, 'kind');
  const knownKind = hasKind && OPERATION_KINDS.includes(operation.kind);

  // An unrecognised kind is the whole problem: enumerating which keys the unknown
  // operation is missing would report the absence of fields that belong to a kind
  // the caller never named.
  if (hasKind && !knownKind) {
    add('PLAN_OPERATION_UNSUPPORTED', 'operation.kind');
    return;
  }

  const allowedKeys = knownKind
    ? OPERATION_KEYS_BY_KIND[operation.kind]
    : OPERATION_KEYS_ALL;
  const { unknown, missing } = diffKeys(operation, allowedKeys);
  for (const key of unknown) add('PLAN_OPERATION_UNKNOWN_FIELD', `operation.${key}`);
  for (const key of missing) add('PLAN_OPERATION_MISSING_FIELD', `operation.${key}`);

  if (!hasKind) return;

  // Version scope: a known operation that the named version does not carry is
  // refused as unsupported rather than silently accepted under the newer meaning.
  if (version !== null && !OPERATION_KINDS_BY_VERSION[version].includes(operation.kind)) {
    add('PLAN_OPERATION_UNSUPPORTED', 'operation.kind');
    return;
  }

  switch (operation.kind) {
    case 'set-entry-flag':
      checkEntryIndex(operation, 'entryIndex', add);
      if (Object.hasOwn(operation, 'field') && !FLAG_FIELDS.includes(operation.field)) {
        add('PLAN_FIELD_UNSUPPORTED', 'operation.field');
      }
      if (Object.hasOwn(operation, 'value') && !FLAG_VALUES.includes(operation.value)) {
        add('PLAN_VALUE_UNSUPPORTED', 'operation.value');
      }
      break;
    case 'set-entry-config':
      checkEntryIndex(operation, 'entryIndex', add);
      if (Object.hasOwn(operation, 'configKey')
        && !(typeof operation.configKey === 'string'
          && CONFIG_KEY_PATTERN.test(operation.configKey))) {
        add('PLAN_CONFIG_KEY_INVALID', 'operation.configKey');
      }
      if (Object.hasOwn(operation, 'value') && !isConfigScalar(operation.value)) {
        add('PLAN_VALUE_UNSUPPORTED', 'operation.value');
      }
      break;
    case 'reorder':
      checkEntryIndex(operation, 'fromIndex', add);
      checkEntryIndex(operation, 'toIndex', add);
      if (Object.hasOwn(operation, 'fromIndex')
        && Object.hasOwn(operation, 'toIndex')
        && operation.fromIndex === operation.toIndex) {
        add('PLAN_OPERATION_NOOP', 'operation');
      }
      break;
    case 'disable-conflicting':
      checkEntryIndex(operation, 'disableIndex', add);
      checkEntryIndex(operation, 'keepIndex', add);
      if (Object.hasOwn(operation, 'conflictId')
        && !(typeof operation.conflictId === 'string'
          && CONFLICT_ID_PATTERN.test(operation.conflictId))) {
        add('PLAN_CONFLICT_ID_INVALID', 'operation.conflictId');
      }
      if (Object.hasOwn(operation, 'keepIndex')
        && Object.hasOwn(operation, 'disableIndex')
        && isEntryIndex(operation.keepIndex)
        && isEntryIndex(operation.disableIndex)
        && operation.keepIndex >= operation.disableIndex) {
        // The later-installed party is the one a conflict resolution disables;
        // a plan that disables the earlier one would silently invert the rule.
        add('PLAN_CONFLICT_PROVENANCE_INVALID', 'operation');
      }
      break;
    case 'patch-insert':
      if (Object.hasOwn(operation, 'afterIndex')
        && !(Number.isInteger(operation.afterIndex) && operation.afterIndex >= 0)) {
        add('PLAN_ENTRY_INDEX_INVALID', 'operation.afterIndex');
      }
      if (Object.hasOwn(operation, 'entryId')
        && !(typeof operation.entryId === 'string'
          && ENTRY_ID_PATTERN.test(operation.entryId))) {
        add('PLAN_ENTRY_ID_INVALID', 'operation.entryId');
      }
      break;
    default:
      break;
  }
}

/**
 * Report a non-index at the named operation member.
 *
 * @param {object} operation Operation record.
 * @param {string} field Member name.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkEntryIndex(operation, field, add) {
  if (Object.hasOwn(operation, field) && !isEntryIndex(operation[field])) {
    add('PLAN_ENTRY_INDEX_INVALID', `operation.${field}`);
  }
}

/**
 * Is this a config value the preview can render without inventing quoting?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for a boolean, null, a finite number, or a bare string.
 */
export function isConfigScalar(value) {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && CONFIG_STRING_PATTERN.test(value);
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
 * Check the `expectedPostcondition` member against the version's key set.
 *
 * @param {unknown} postcondition Candidate.
 * @param {string|null} version A supported version, or null when unusable.
 * @param {(code: string, path: string) => void} add Issue sink.
 * @returns {void}
 */
function checkPostcondition(postcondition, version, add) {
  if (!isRecord(postcondition)) {
    add('PLAN_POSTCONDITION_NOT_RECORD', 'expectedPostcondition');
    return;
  }
  const allowed = postconditionKeysFor(version);
  const { unknown, missing } = diffKeys(postcondition, allowed);
  for (const key of unknown) add('PLAN_POSTCONDITION_UNKNOWN_FIELD', `expectedPostcondition.${key}`);
  for (const key of missing) add('PLAN_POSTCONDITION_MISSING_FIELD', `expectedPostcondition.${key}`);

  if (Object.hasOwn(postcondition, 'documentSha256')
    && !(typeof postcondition.documentSha256 === 'string'
      && SHA256_PATTERN.test(postcondition.documentSha256))) {
    add('PLAN_DIGEST_INVALID', 'expectedPostcondition.documentSha256');
  }
  if (version === 'repair-plan/0.1-draft.1') {
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
}