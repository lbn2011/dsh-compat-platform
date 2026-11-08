/**
 * dsh-compat-platform — structural diff between two combined reports.
 *
 * ## What this module is for
 *
 * `buildCombinedReport()` produces one envelope over three evidence lanes. Two
 * such envelopes can be put side by side; this module answers exactly one
 * question about such a pair: *which of the five channel fields differ?*
 *
 * ## What it deliberately does not do
 *
 * - **No verdict about resolution.** A lane that read `attention` before and
 *   `clear` after is *changed*, nothing more. This module never emits
 *   `resolved`, `improved` or `degraded`: a later `clear` does not prove that
 *   anything was fixed, because the two documents may describe different
 *   subjects, different runs, or different questions.
 * - **No identity.** `source` is a caller-chosen alias, never an identity and
 *   never a join key; a changed alias is reported as a changed field and
 *   nothing else. `correlation` stays the literal `'not-established'`.
 * - **No merging, no scoring, no nested semantics.** The per-lane `result`
 *   objects are compared as *data*, not interpreted: no field of a static
 *   analysis, runtime summary or admission diagnosis is given meaning here.
 * - **No certification.** `certification` is the literal `false`.
 * - **No I/O.** Callers pass parsed values; this module reads no file.
 *
 * ## The JSON budget
 *
 * Each snapshot is walked before anything is compared, under three fixed
 * ceilings (depth, value nodes, accumulated key + string length). A snapshot
 * over budget is **refused**, never truncated: truncation would silently turn
 * "the document grew" into "the documents look equal".
 *
 * Those ceilings are a *work* limit, not a memory guarantee. Enumerating a
 * snapshot's own keys (`Reflect.ownKeys`, `Object.getOwnPropertyNames`,
 * `Object.getOwnPropertySymbols`) is itself observable work: it allocates a key
 * array, and on a `Proxy` it runs the `ownKeys` trap before a single descriptor
 * is read. This module never *invokes* a getter — it reads own property
 * descriptors and takes `descriptor.value` — which removes the ordinary
 * accessor case, including an accessor defined at the root. It does not remove
 * the enumeration cost, and it makes no attempt to contain a hostile `Proxy`:
 * a trap that throws ends in a fixed refusal rather than in a propagated error,
 * and the `Proxy` is explicitly outside what this module promises.
 *
 * @packageDocumentation
 */

import { COMBINED_REPORT_VERSION, LANE_IDS, MAX_SOURCE_LENGTH } from './combined-report.js';

/** Version of the diff envelope. Fixed string, never negotiated. */
export const SNAPSHOT_DIFF_VERSION = 'combined-report-diff/0.1-draft.1';

/**
 * Fields compared inside one channel, in the order every `changedFields` list
 * uses. Fixed here so two readers cannot disagree about the order.
 */
export const CHANGED_FIELDS = Object.freeze(['state', 'source', 'outcome', 'issues', 'result']);

/** The three comparison outcomes a lane may carry. */
export const LANE_COMPARISONS = Object.freeze(['unchanged', 'changed', 'incomparable']);

/**
 * Codes this module invents. Every one describes what *this* module could or
 * could not read; none of them is a protocol code, and none is copied from a
 * channel's own issue list.
 */
export const DIFF_ISSUE_CODES = Object.freeze({
  /** The value could not be read at all (for example a hostile Proxy trap). */
  SNAPSHOT_UNREADABLE: 'SNAPSHOT_UNREADABLE',
  SNAPSHOT_NOT_RECORD: 'SNAPSHOT_NOT_RECORD',
  SNAPSHOT_KEYS_INVALID: 'SNAPSHOT_KEYS_INVALID',
  SNAPSHOT_VERSION_MISMATCH: 'SNAPSHOT_VERSION_MISMATCH',
  SNAPSHOT_CERTIFICATION_INVALID: 'SNAPSHOT_CERTIFICATION_INVALID',
  SNAPSHOT_CORRELATION_INVALID: 'SNAPSHOT_CORRELATION_INVALID',
  SNAPSHOT_CHANNELS_INVALID: 'SNAPSHOT_CHANNELS_INVALID',
  SNAPSHOT_LIMITATIONS_INVALID: 'SNAPSHOT_LIMITATIONS_INVALID',
  CHANNEL_KEYS_INVALID: 'CHANNEL_KEYS_INVALID',
  CHANNEL_STATE_INVALID: 'CHANNEL_STATE_INVALID',
  CHANNEL_ABSENT_INCONSISTENT: 'CHANNEL_ABSENT_INCONSISTENT',
  CHANNEL_OUTCOME_INVALID: 'CHANNEL_OUTCOME_INVALID',
  CHANNEL_SOURCE_INVALID: 'CHANNEL_SOURCE_INVALID',
  CHANNEL_ISSUES_INVALID: 'CHANNEL_ISSUES_INVALID',
  CHANNEL_RESULT_INVALID: 'CHANNEL_RESULT_INVALID',
  JSON_ACCESSOR: 'JSON_ACCESSOR',
  JSON_SYMBOL_KEY: 'JSON_SYMBOL_KEY',
  JSON_NON_ENUMERABLE: 'JSON_NON_ENUMERABLE',
  JSON_SPARSE_ARRAY: 'JSON_SPARSE_ARRAY',
  JSON_ARRAY_EXTRA_PROPERTY: 'JSON_ARRAY_EXTRA_PROPERTY',
  JSON_NON_PLAIN_OBJECT: 'JSON_NON_PLAIN_OBJECT',
  JSON_CYCLE: 'JSON_CYCLE',
  JSON_NON_FINITE_NUMBER: 'JSON_NON_FINITE_NUMBER',
  JSON_NON_JSON_VALUE: 'JSON_NON_JSON_VALUE',
  JSON_DEPTH_EXCEEDED: 'JSON_DEPTH_EXCEEDED',
  JSON_NODES_EXCEEDED: 'JSON_NODES_EXCEEDED',
  JSON_SIZE_EXCEEDED: 'JSON_SIZE_EXCEEDED',
});

/** Fixed walk ceilings, per snapshot. Not configurable: two callers with two budgets compare nothing. */
export const SNAPSHOT_JSON_BUDGET = Object.freeze({
  /** Deepest accepted container; the snapshot itself sits at 0. */
  depth: 64,
  /** Total accepted value nodes, scalars included. */
  nodes: 100000,
  /** Accumulated key lengths plus string lengths, in UTF-16 code units. */
  size: 2097152,
});

/**
 * What every result states about itself, including an invalid one.
 *
 * These are codes, not prose, and identical for every result: they say what the
 * diff cannot establish, not what a particular pair happened to contain.
 */
export const SNAPSHOT_DIFF_LIMITATIONS = Object.freeze([
  'NO_CERTIFICATION_CLAIMED',
  'CORRELATION_NOT_ESTABLISHED',
  'STRUCTURAL_COMPARISON_ONLY',
  'ABSENCE_IS_NOT_RESOLUTION',
  'NESTED_SEMANTICS_NOT_VERIFIED',
]);

const SNAPSHOT_KEYS = Object.freeze([
  'reportVersion',
  'certification',
  'correlation',
  'channels',
  'limitations',
]);
const CHANNEL_KEYS = Object.freeze(['state', 'source', 'outcome', 'result', 'issues']);
const PROVIDED_OUTCOMES = Object.freeze(['clear', 'attention', 'invalid', 'error']);
const COMPARABLE_OUTCOMES = Object.freeze(['clear', 'attention']);
const SIDE_ORDER = Object.freeze(['before', 'after']);

const EXIT_TYPE_ERROR =
  'snapshotDiffExitCode(result): result must be the value returned by compareCombinedReports(), with three known channel comparisons.';

/* ------------------------------------------------------------------ *
 * Small structural predicates.
 * ------------------------------------------------------------------ */

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isArrayIndex(name) {
  if (name === '') return false;
  const index = Number(name);
  return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === name;
}

function hasExactKeys(record, expected) {
  const actual = Object.getOwnPropertyNames(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length) return false;
  for (let i = 0; i < wanted.length; i += 1) {
    if (actual[i] !== wanted[i]) return false;
  }
  return true;
}

function isValidSource(source) {
  if (typeof source !== 'string') return false;
  if (source.length === 0 || source.length > MAX_SOURCE_LENGTH) return false;
  return source === source.trim();
}

function isIssueList(issues) {
  if (!Array.isArray(issues)) return false;
  for (let i = 0; i < issues.length; i += 1) {
    const entry = issues[i];
    if (!isPlainRecord(entry)) return false;
    if (!hasExactKeys(entry, ['code'])) return false;
    if (typeof entry.code !== 'string' || entry.code.length === 0) return false;
  }
  return true;
}

function isLimitations(limitations) {
  // An empty array is a legal limitations list: the contract is "every element is
  // a non-empty string", not "at least one element". A report that states nothing
  // it could not establish states exactly that, and the diff reports it as an
  // empty list rather than inventing an entry.
  if (!Array.isArray(limitations)) return false;
  for (let i = 0; i < limitations.length; i += 1) {
    if (typeof limitations[i] !== 'string' || limitations[i].length === 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Bounded JSON walk.
 * ------------------------------------------------------------------ */

/**
 * Walk `root` under the fixed budget, reading own property descriptors only.
 *
 * Returns `{ ok: true }` or `{ ok: false, code }`. The code is one of the
 * `JSON_*` members of {@link DIFF_ISSUE_CODES}; the caller decides which fixed
 * path to attach, so no input-supplied key name is ever echoed.
 */
function inspectJson(root) {
  const counters = { nodes: 0, size: 0 };
  const ancestry = new Set();
  return walk(root, 0);

  function walk(value, depth) {
    counters.nodes += 1;
    if (counters.nodes > SNAPSHOT_JSON_BUDGET.nodes) return { ok: false, code: 'JSON_NODES_EXCEEDED' };
    if (depth > SNAPSHOT_JSON_BUDGET.depth) return { ok: false, code: 'JSON_DEPTH_EXCEEDED' };

    if (value === null) return { ok: true };
    const type = typeof value;

    if (type === 'string') {
      counters.size += value.length;
      if (counters.size > SNAPSHOT_JSON_BUDGET.size) return { ok: false, code: 'JSON_SIZE_EXCEEDED' };
      return { ok: true };
    }
    if (type === 'boolean') return { ok: true };
    if (type === 'number') {
      return Number.isFinite(value) ? { ok: true } : { ok: false, code: 'JSON_NON_FINITE_NUMBER' };
    }
    if (type !== 'object') return { ok: false, code: 'JSON_NON_JSON_VALUE' };

    if (ancestry.has(value)) return { ok: false, code: 'JSON_CYCLE' };

    if (Object.getOwnPropertySymbols(value).length > 0) return { ok: false, code: 'JSON_SYMBOL_KEY' };

    ancestry.add(value);
    const failure = Array.isArray(value) ? walkArray(value, depth) : walkObject(value, depth);
    ancestry.delete(value);
    return failure;
  }

  function walkArray(array, depth) {
    const names = Object.getOwnPropertyNames(array);
    const length = array.length;
    let indexCount = 0;
    for (const name of names) {
      if (name === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(array, name);
      if (descriptor === undefined) return { ok: false, code: 'JSON_NON_JSON_VALUE' };
      if (descriptor.get !== undefined || descriptor.set !== undefined) return { ok: false, code: 'JSON_ACCESSOR' };
      if (descriptor.enumerable === false) return { ok: false, code: 'JSON_NON_ENUMERABLE' };
      if (!isArrayIndex(name)) return { ok: false, code: 'JSON_ARRAY_EXTRA_PROPERTY' };
      indexCount += 1;
      counters.size += name.length;
      if (counters.size > SNAPSHOT_JSON_BUDGET.size) return { ok: false, code: 'JSON_SIZE_EXCEEDED' };
    }
    // A hole is not a `null`: `[1,,3]` and `[1,null,3]` must not compare equal,
    // and a hole also means the array is not parsed JSON.
    if (indexCount !== length) return { ok: false, code: 'JSON_SPARSE_ARRAY' };

    for (let i = 0; i < length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(array, String(i));
      if (descriptor === undefined) return { ok: false, code: 'JSON_SPARSE_ARRAY' };
      if (descriptor.get !== undefined || descriptor.set !== undefined) return { ok: false, code: 'JSON_ACCESSOR' };
      const failure = walk(descriptor.value, depth + 1);
      if (!failure.ok) return failure;
    }
    return { ok: true };
  }

  function walkObject(object, depth) {
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) return { ok: false, code: 'JSON_NON_PLAIN_OBJECT' };

    const names = Object.getOwnPropertyNames(object);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      if (descriptor === undefined) return { ok: false, code: 'JSON_NON_JSON_VALUE' };
      if (descriptor.get !== undefined || descriptor.set !== undefined) return { ok: false, code: 'JSON_ACCESSOR' };
      if (descriptor.enumerable === false) return { ok: false, code: 'JSON_NON_ENUMERABLE' };
      counters.size += name.length;
      if (counters.size > SNAPSHOT_JSON_BUDGET.size) return { ok: false, code: 'JSON_SIZE_EXCEEDED' };
      const failure = walk(descriptor.value, depth + 1);
      if (!failure.ok) return failure;
    }
    return { ok: true };
  }
}

/* ------------------------------------------------------------------ *
 * Snapshot shell.
 * ------------------------------------------------------------------ */

function makeIssue(side, code, path) {
  return { side, code, path };
}

function validateChannel(channel, lane, add) {
  const path = `snapshot.channels.${lane}`;
  if (!isPlainRecord(channel) || !hasExactKeys(channel, CHANNEL_KEYS)) {
    add('CHANNEL_KEYS_INVALID', path);
    return;
  }
  const { state, source, outcome, result, issues } = channel;
  if (state !== 'absent' && state !== 'provided') {
    add('CHANNEL_STATE_INVALID', path);
    return;
  }

  if (state === 'absent') {
    if (source !== null || result !== null || outcome !== 'unknown' || !Array.isArray(issues) || issues.length !== 0) {
      add('CHANNEL_ABSENT_INCONSISTENT', path);
    }
    return;
  }

  if (!PROVIDED_OUTCOMES.includes(outcome)) add('CHANNEL_OUTCOME_INVALID', path);
  // `invalid` and `error` are the two outcomes that may describe a lane with no
  // readable subject at all: a missing file, an unparsable document, a validator
  // that could not be imported. Both may carry `source: null`. Only the two
  // comparable outcomes require a non-null, trimmed alias.
  if (COMPARABLE_OUTCOMES.includes(outcome)) {
    if (!isValidSource(source)) add('CHANNEL_SOURCE_INVALID', path);
    if (!isPlainRecord(result)) add('CHANNEL_RESULT_INVALID', path);
  } else if (source !== null && !isValidSource(source)) {
    add('CHANNEL_SOURCE_INVALID', path);
  }
  if (!isIssueList(issues)) add('CHANNEL_ISSUES_INVALID', path);

  if (!COMPARABLE_OUTCOMES.includes(outcome) && result !== null && !isPlainRecord(result)) {
    add('CHANNEL_RESULT_INVALID', path);
  }
}

/**
 * Validate one side's envelope shell and return the issues found.
 *
 * Only the shell: no nested outcome is recomputed, and no channel `result` is
 * interpreted. The caller compares the two snapshots only when both sides came
 * back clean.
 */
function validateSnapshot(value, side) {
  const issues = [];
  const add = (code, path) => issues.push(makeIssue(side, code, path));

  // "Not a record at all" is checked before the walk: `undefined` is not a JSON
  // value, but calling it a non-JSON value would hide the real complaint (this
  // side was never given a snapshot).
  if (!isPlainRecord(value)) {
    add('SNAPSHOT_NOT_RECORD', 'snapshot');
    return { issues };
  }
  const json = inspectJson(value);
  if (!json.ok) {
    add(json.code, 'snapshot');
    return { issues };
  }
  if (!hasExactKeys(value, SNAPSHOT_KEYS)) {
    add('SNAPSHOT_KEYS_INVALID', 'snapshot');
    return { issues };
  }
  if (value.reportVersion !== COMBINED_REPORT_VERSION) {
    add('SNAPSHOT_VERSION_MISMATCH', 'snapshot.reportVersion');
  }
  if (value.certification !== false) {
    add('SNAPSHOT_CERTIFICATION_INVALID', 'snapshot.certification');
  }
  if (value.correlation !== 'not-established') {
    add('SNAPSHOT_CORRELATION_INVALID', 'snapshot.correlation');
  }
  if (!isLimitations(value.limitations)) {
    add('SNAPSHOT_LIMITATIONS_INVALID', 'snapshot.limitations');
  }
  if (!isPlainRecord(value.channels) || !hasExactKeys(value.channels, LANE_IDS)) {
    add('SNAPSHOT_CHANNELS_INVALID', 'snapshot.channels');
    return { issues };
  }
  for (const lane of LANE_IDS) validateChannel(value.channels[lane], lane, add);
  return { issues };
}

/* ------------------------------------------------------------------ *
 * Comparison.
 * ------------------------------------------------------------------ */

/**
 * Structural equality over validated JSON data: object key order is ignored,
 * array order is kept.
 */
function jsonEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== 'object' || typeof right !== 'object') return false;

  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;

  if (leftIsArray) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!jsonEqual(left[i], right[i])) return false;
    }
    return true;
  }

  const leftKeys = Object.getOwnPropertyNames(left).sort();
  const rightKeys = Object.getOwnPropertyNames(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  for (const key of leftKeys) {
    if (!jsonEqual(left[key], right[key])) return false;
  }
  return true;
}

function sameIssueCodes(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].code !== right[i].code) return false;
  }
  return true;
}

function isComparable(channel) {
  return (
    channel.state === 'provided' &&
    COMPARABLE_OUTCOMES.includes(channel.outcome) &&
    isPlainRecord(channel.result)
  );
}

function diffChannel(before, after) {
  const changed = [];
  if (before.state !== after.state) changed.push('state');
  if (before.source !== after.source) changed.push('source');
  if (before.outcome !== after.outcome) changed.push('outcome');
  if (!sameIssueCodes(before.issues, after.issues)) changed.push('issues');
  if (!jsonEqual(before.result, after.result)) changed.push('result');

  const ordered = CHANGED_FIELDS.filter((field) => changed.includes(field));
  const comparable = isComparable(before) && isComparable(after);

  return {
    comparison: comparable ? (ordered.length === 0 ? 'unchanged' : 'changed') : 'incomparable',
    changedFields: ordered,
    before: { state: before.state, outcome: before.outcome },
    after: { state: after.state, outcome: after.outcome },
  };
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => {
    const sideDelta = SIDE_ORDER.indexOf(left.side) - SIDE_ORDER.indexOf(right.side);
    if (sideDelta !== 0) return sideDelta;
    if (left.code !== right.code) return left.code < right.code ? -1 : 1;
    if (left.path === right.path) return 0;
    return left.path < right.path ? -1 : 1;
  });
}

function invalidResult(issues) {
  return {
    diffVersion: SNAPSHOT_DIFF_VERSION,
    valid: false,
    certification: false,
    correlation: 'not-established',
    issues: sortIssues(issues),
    channels: null,
    limitationsChanged: null,
    limitations: [...SNAPSHOT_DIFF_LIMITATIONS],
  };
}

/**
 * Compare two reports produced by `buildCombinedReport()`.
 *
 * Strictly structural: the two shells are validated first, then each of the
 * three fixed lanes is compared field by field. A lane is only compared as data
 * when both sides are `provided`, both outcomes are `clear` or `attention`, and
 * both results are plain JSON objects; otherwise the lane is `incomparable`,
 * while its `changedFields` are still computed from the shell.
 *
 * `changedFields` never triggers `resolved`: a lane reading `attention` before
 * and `clear` after is a *changed* lane, not a solved one.
 *
 * @param {unknown} before
 * @param {unknown} after
 * @returns {object} the diff envelope described in `snapshot-diff.d.ts`
 */
export function compareCombinedReports(before, after) {
  let side = 'before';
  try {
    const beforeResult = validateSnapshot(before, 'before');
    side = 'after';
    const afterResult = validateSnapshot(after, 'after');

    const issues = [...beforeResult.issues, ...afterResult.issues];
    if (issues.length > 0) return invalidResult(issues);

    const channels = {};
    for (const lane of LANE_IDS) {
      channels[lane] = diffChannel(before.channels[lane], after.channels[lane]);
    }

    const limitationsChanged = !jsonEqual(before.limitations, after.limitations);

    return {
      diffVersion: SNAPSHOT_DIFF_VERSION,
      valid: true,
      certification: false,
      correlation: 'not-established',
      issues: [],
      channels,
      limitationsChanged,
      limitations: [...SNAPSHOT_DIFF_LIMITATIONS],
    };
  } catch {
    // A hostile Proxy can throw from any trap. The thrown value is never
    // inspected, never echoed and never propagated: the caller gets one fixed
    // refusal. `side` is the last side whose validation had started, not a
    // precise attribution of where the trap fired — during comparison it is
    // already 'after', and a trap may fire while both snapshots are inspected.
    return invalidResult([makeIssue(side, 'SNAPSHOT_UNREADABLE', 'snapshot')]);
  }
}

/**
 * Map a diff result to a *processing* exit code: `2` when either snapshot was
 * refused, else `1` when anything changed or was incomparable, else `0`.
 *
 * This is not a verdict about the subject of either report, and `1` is not a
 * regression: `incomparable` is the expected answer for two snapshots that
 * cannot be compared as data.
 *
 * @param {unknown} result
 * @returns {0 | 1 | 2}
 */
export function snapshotDiffExitCode(result) {
  if (!isPlainRecord(result)) throw new TypeError(EXIT_TYPE_ERROR);
  // The discriminating fields of the envelope, not a re-validation: this does
  // not walk the snapshots and does not re-check the JSON budget, so a hand-made
  // object that happens to carry these fields is mapped rather than certified.
  if (result.diffVersion !== SNAPSHOT_DIFF_VERSION) throw new TypeError(EXIT_TYPE_ERROR);
  if (result.certification !== false) throw new TypeError(EXIT_TYPE_ERROR);
  if (result.correlation !== 'not-established') throw new TypeError(EXIT_TYPE_ERROR);

  if (result.valid === false) {
    // The refused shape is part of the mapping: a refusal that still carried
    // channel data would not be a value this module produced.
    if (result.channels !== null || result.limitationsChanged !== null) throw new TypeError(EXIT_TYPE_ERROR);
    if (!Array.isArray(result.issues) || result.issues.length === 0) throw new TypeError(EXIT_TYPE_ERROR);
    return 2;
  }
  if (result.valid !== true) throw new TypeError(EXIT_TYPE_ERROR);
  if (!Array.isArray(result.issues) || result.issues.length !== 0) throw new TypeError(EXIT_TYPE_ERROR);
  if (!isPlainRecord(result.channels)) throw new TypeError(EXIT_TYPE_ERROR);
  if (typeof result.limitationsChanged !== 'boolean') throw new TypeError(EXIT_TYPE_ERROR);

  let changed = result.limitationsChanged;
  for (const lane of LANE_IDS) {
    const channel = result.channels[lane];
    if (!isPlainRecord(channel)) throw new TypeError(EXIT_TYPE_ERROR);
    if (!LANE_COMPARISONS.includes(channel.comparison)) throw new TypeError(EXIT_TYPE_ERROR);
    if (channel.comparison !== 'unchanged') changed = true;
  }
  return changed ? 1 : 0;
}
