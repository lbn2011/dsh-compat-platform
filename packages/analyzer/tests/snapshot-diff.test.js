/**
 * Tests for `snapshot-diff.js`.
 *
 * Everything here is in-process: no command, no child process, no host, no
 * network. Snapshot fixtures are built either by the real `buildCombinedReport`
 * or by the local `snapshot()` helper, which produces only shapes the contract
 * accepts — so a passing test says "this module reads these bytes this way", not
 * "some report was published".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCombinedReport, COMBINED_REPORT_VERSION } from '../src/combined-report.js';
import {
  CHANGED_FIELDS,
  DIFF_ISSUE_CODES,
  LANE_COMPARISONS,
  SNAPSHOT_DIFF_LIMITATIONS,
  SNAPSHOT_DIFF_VERSION,
  SNAPSHOT_JSON_BUDGET,
  compareCombinedReports,
  snapshotDiffExitCode,
} from '../src/snapshot-diff.js';

/* ------------------------------------------------------------------ *
 * Fixtures.
 * ------------------------------------------------------------------ */

// A declaration validator's receipt, exactly as `analyze()` reads it
// (`src/analyze.js:276`): `{ valid, issues }`. It is not a report — the analyzer
// wraps the receipt into `{ findings, summary }`, and `buildCombinedReport` never
// consumes a raw receipt.
const acceptAll = () => ({ valid: true, issues: [] });
const emptyDocument = () => ({ evidence: { cases: [] }, baseline: { commit: 'c0ffee', node: '24.9.0' } });

// The only input envelope `analyze()` accepts. With no declarations the validator
// is never invoked, so the lane settles as `clear` without a receipt being read.
const EMPTY_STATIC_INPUT = () => ({ declarations: [], availableCapabilities: [] });

function channel(overrides = {}) {
  return {
    state: 'provided',
    source: 'lane-alias',
    outcome: 'clear',
    result: { summary: { analysisComplete: true } },
    issues: [],
    ...overrides,
  };
}

function absentChannel() {
  return { state: 'absent', source: null, outcome: 'unknown', result: null, issues: [] };
}

function snapshot(overrides = {}) {
  return {
    reportVersion: COMBINED_REPORT_VERSION,
    certification: false,
    correlation: 'not-established',
    channels: {
      static: channel({ result: { summary: { analysisComplete: true }, findings: [] } }),
      runtime: channel({ result: { cases: [], baseline: { commit: 'c0ffee', node: '24.9.0' } } }),
      admission: channel({ result: { findings: [], coverage: { required: [], present: [], unknown: [] } } }),
    },
    limitations: ['CORRELATION_NOT_ESTABLISHED', 'LANES_NOT_MERGED'],
    ...overrides,
  };
}

function cloned(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------ *
 * Constants and envelope.
 * ------------------------------------------------------------------ */

test('the diff envelope carries fixed literals, never a verdict', () => {
  const diff = compareCombinedReports(snapshot(), snapshot());

  assert.equal(diff.diffVersion, SNAPSHOT_DIFF_VERSION);
  assert.equal(diff.valid, true);
  assert.equal(diff.certification, false);
  assert.equal(diff.correlation, 'not-established');
  assert.deepEqual(diff.issues, []);
  assert.deepEqual(diff.limitations, [...SNAPSHOT_DIFF_LIMITATIONS]);
  assert.deepEqual(Object.keys(diff).sort(), [
    'certification',
    'channels',
    'correlation',
    'diffVersion',
    'issues',
    'limitations',
    'limitationsChanged',
    'valid',
  ]);
});

test('the fixed field order and comparison vocabulary are not negotiable', () => {
  assert.deepEqual([...CHANGED_FIELDS], ['state', 'source', 'outcome', 'issues', 'result']);
  assert.deepEqual([...LANE_COMPARISONS], ['unchanged', 'changed', 'incomparable']);
  assert.deepEqual(Object.keys(SNAPSHOT_JSON_BUDGET).sort(), ['depth', 'nodes', 'size']);
  assert.equal(SNAPSHOT_DIFF_LIMITATIONS.length, 5);
  assert.ok(SNAPSHOT_DIFF_LIMITATIONS.every((code) => typeof code === 'string' && code.length > 0));
});

/* ------------------------------------------------------------------ *
 * Round-trip through the real builder.
 * ------------------------------------------------------------------ */

test('a lane the builder refused stays incomparable when both sides refused it', () => {
  const build = () =>
    buildCombinedReport(
      // Not an analyze envelope: `readInput` rejects the unexpected `name` field
      // (`src/analyze.js:331`), so the builder records a failure channel and keeps
      // the source it was handed. Identical failures are still not comparable
      // data, so the comparison is 'incomparable' while `changedFields` is empty.
      { static: { source: 'static-1', document: { name: 'demo' } } },
      { validateDeclaration: acceptAll },
    );

  const before = build();
  const after = build();
  const diff = compareCombinedReports(before, after);

  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.static.before.state, 'provided');
  assert.equal(diff.channels.static.before.outcome, 'invalid');
  assert.equal(diff.channels.static.after.state, 'provided');
  assert.equal(diff.channels.static.after.outcome, 'invalid');
  assert.equal(diff.channels.static.source, undefined);
  assert.equal(diff.channels.static.comparison, 'incomparable');
  assert.deepEqual(diff.channels.static.changedFields, []);
});

test('a clear report survives a JSON round trip unchanged', () => {
  const report = buildCombinedReport(
    { static: { source: 'static-1', document: EMPTY_STATIC_INPUT() } },
    { validateDeclaration: acceptAll },
  );
  const diff = compareCombinedReports(report, cloned(report));

  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.static.before.outcome, 'clear');
  assert.equal(diff.channels.static.comparison, 'unchanged');
  assert.deepEqual(diff.channels.static.changedFields, []);
  // A report that never mentioned runtime or admission stays absent: two absent
  // lanes are not comparable data, they are equally unknown.
  assert.equal(diff.channels.runtime.before.state, 'absent');
  assert.equal(diff.channels.runtime.comparison, 'incomparable');
  assert.equal(diff.channels.admission.comparison, 'incomparable');
  assert.equal(diff.limitationsChanged, false);
  assert.equal(snapshotDiffExitCode(diff), 1);
});

/* ------------------------------------------------------------------ *
 * Field-level differences.
 * ------------------------------------------------------------------ */

test('a nested result change is reported as result only', () => {
  const before = snapshot();
  const after = snapshot();
  after.channels.static.result.summary.analysisComplete = false;

  const diff = compareCombinedReports(before, after);

  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.static.comparison, 'changed');
  assert.deepEqual(diff.channels.static.changedFields, ['result']);
  assert.equal(diff.channels.runtime.comparison, 'unchanged');
  assert.equal(snapshotDiffExitCode(diff), 1);
});

test('object key order is ignored when comparing result', () => {
  const before = snapshot();
  const after = snapshot();
  // Same entries, different insertion order: this is the same JSON object.
  after.channels.static.result = { findings: [], summary: { analysisComplete: true } };

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.static.comparison, 'unchanged');
});

test('array order is preserved when comparing result', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.static.result = { findings: [{ code: 'A' }, { code: 'B' }] };
  after.channels.static.result = { findings: [{ code: 'B' }, { code: 'A' }] };

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.static.comparison, 'changed');
  assert.deepEqual(diff.channels.static.changedFields, ['result']);
});

test('issue order is preserved and a reorder is a change', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.admission.issues = [{ code: 'A' }, { code: 'B' }];
  after.channels.admission.issues = [{ code: 'B' }, { code: 'A' }];

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.admission.comparison, 'changed');
  assert.deepEqual(diff.channels.admission.changedFields, ['issues']);
});

test('a different code set is a change', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.admission.issues = [{ code: 'A' }];
  after.channels.admission.issues = [{ code: 'B' }];

  const diff = compareCombinedReports(before, after);
  assert.deepEqual(diff.channels.admission.changedFields, ['issues']);
});

test('changedFields is reported in the fixed order, not in discovery order', () => {
  const before = snapshot();
  const after = snapshot();
  // All five fields move at once: outcome and issues through `attention`, the
  // rest through the lane going absent. The list must come back in contract
  // order, not in the order the comparisons happened to run.
  before.channels.static.outcome = 'attention';
  before.channels.static.issues = [{ code: 'STATIC_ERROR' }];
  after.channels.static = absentChannel();

  const diff = compareCombinedReports(before, after);
  assert.deepEqual(diff.channels.static.changedFields, ['state', 'source', 'outcome', 'issues', 'result']);
  assert.equal(diff.channels.static.comparison, 'incomparable');
});

/* ------------------------------------------------------------------ *
 * Comparability.
 * ------------------------------------------------------------------ */

test('an absent lane is incomparable even when the shell fields are recorded', () => {
  const before = snapshot();
  const after = snapshot();
  after.channels.runtime = absentChannel();

  const diff = compareCombinedReports(before, after);

  assert.equal(diff.channels.runtime.comparison, 'incomparable');
  assert.deepEqual(diff.channels.runtime.changedFields, ['state', 'source', 'outcome', 'result']);
  assert.deepEqual(diff.channels.runtime.before, { state: 'provided', outcome: 'clear' });
  assert.deepEqual(diff.channels.runtime.after, { state: 'absent', outcome: 'unknown' });
  assert.equal(snapshotDiffExitCode(diff), 1);
});

test('attention to clear is changed, never resolved or improved', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.static.outcome = 'attention';
  before.channels.static.issues = [{ code: 'STATIC_ERROR' }];

  const diff = compareCombinedReports(before, after);

  assert.equal(diff.channels.static.comparison, 'changed');
  assert.deepEqual(diff.channels.static.changedFields, ['outcome', 'issues']);
  const keys = Object.keys(diff.channels.static).sort();
  assert.deepEqual(keys, ['after', 'before', 'changedFields', 'comparison']);
});

test('clear to attention is changed, and still not a regression verdict', () => {
  const before = snapshot();
  const after = snapshot();
  after.channels.static.outcome = 'attention';

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.static.comparison, 'changed');
  assert.deepEqual(diff.channels.static.changedFields, ['outcome']);
});

test('a legal error channel is read, not repaired', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.runtime = {
    state: 'provided',
    source: null,
    outcome: 'error',
    result: null,
    issues: [{ code: 'INPUT_READ_FAILED' }],
  };

  const diff = compareCombinedReports(before, after);

  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.runtime.comparison, 'incomparable');
  assert.deepEqual(diff.channels.runtime.before, { state: 'provided', outcome: 'error' });
  assert.equal(snapshotDiffExitCode(diff), 1);
});

test('an invalid lane on either side is incomparable, not a difference of results', () => {
  const before = snapshot();
  const after = snapshot();
  before.channels.admission.outcome = 'invalid';
  before.channels.admission.issues = [{ code: 'INVALID_DECLARATION' }];
  after.channels.admission.outcome = 'invalid';
  after.channels.admission.issues = [{ code: 'INVALID_DECLARATION' }];

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.admission.comparison, 'incomparable');
  assert.deepEqual(diff.channels.admission.changedFields, []);
});

test('limitationsChanged compares the top-level arrays in order', () => {
  const before = snapshot();
  const after = snapshot();
  after.limitations = ['LANES_NOT_MERGED', 'CORRELATION_NOT_ESTABLISHED'];

  const diff = compareCombinedReports(before, after);

  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.limitationsChanged, true);
  assert.equal(diff.channels.static.comparison, 'unchanged');
  assert.equal(snapshotDiffExitCode(diff), 1);
});

/* ------------------------------------------------------------------ *
 * Refusals: version, shape, channel invariants.
 * ------------------------------------------------------------------ */

function assertRefused(diff, expectedCode, expectedSide) {
  assert.equal(diff.valid, false);
  assert.equal(diff.channels, null);
  assert.equal(diff.limitationsChanged, null);
  assert.equal(diff.certification, false);
  assert.equal(diff.correlation, 'not-established');
  assert.deepEqual(diff.limitations, [...SNAPSHOT_DIFF_LIMITATIONS]);
  assert.ok(diff.issues.length > 0);
  assert.ok(
    diff.issues.some((issue) => issue.code === expectedCode && issue.side === expectedSide),
    JSON.stringify(diff.issues),
  );
  for (const issue of diff.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'path', 'side']);
  }
  assert.equal(snapshotDiffExitCode(diff), 2);
}

test('a version mismatch refuses the whole diff, naming the side', () => {
  const before = snapshot();
  const after = snapshot({ reportVersion: 'combined-report/9.9.9' });

  assertRefused(compareCombinedReports(before, after), 'SNAPSHOT_VERSION_MISMATCH', 'after');
});

test('a missing before snapshot is refused, not treated as an empty report', () => {
  assertRefused(compareCombinedReports(undefined, snapshot()), 'SNAPSHOT_NOT_RECORD', 'before');
  assertRefused(compareCombinedReports(snapshot(), null), 'SNAPSHOT_NOT_RECORD', 'after');
});

test('an extra top-level key is refused without echoing that key', () => {
  const before = snapshot();
  before.extra = true;

  const diff = compareCombinedReports(before, snapshot());
  assertRefused(diff, 'SNAPSHOT_KEYS_INVALID', 'before');
  assert.ok(!JSON.stringify(diff.issues).includes('extra'));
});

test('certification and correlation are literals, not flags to trust', () => {
  const certified = snapshot({ certification: true });
  assertRefused(compareCombinedReports(certified, snapshot()), 'SNAPSHOT_CERTIFICATION_INVALID', 'before');

  const correlated = snapshot({ correlation: 'established' });
  assertRefused(compareCombinedReports(snapshot(), correlated), 'SNAPSHOT_CORRELATION_INVALID', 'after');
});

test('a missing lane, or an extra one, refuses the channels object', () => {
  const before = snapshot();
  delete before.channels.runtime;
  assertRefused(compareCombinedReports(before, snapshot()), 'SNAPSHOT_CHANNELS_INVALID', 'before');

  const extra = snapshot();
  extra.channels.dependency = channel();
  assertRefused(compareCombinedReports(snapshot(), extra), 'SNAPSHOT_CHANNELS_INVALID', 'after');
});

test('an absent channel must be internally consistent', () => {
  const before = snapshot();
  before.channels.static = { state: 'absent', source: 's', outcome: 'unknown', result: null, issues: [] };
  assertRefused(compareCombinedReports(before, snapshot()), 'CHANNEL_ABSENT_INCONSISTENT', 'before');
});

test('a comparable lane must carry a source and a result record', () => {
  const noSource = snapshot();
  noSource.channels.static.source = null;
  assertRefused(compareCombinedReports(noSource, snapshot()), 'CHANNEL_SOURCE_INVALID', 'before');

  const noResult = snapshot();
  noResult.channels.static.result = null;
  assertRefused(compareCombinedReports(snapshot(), noResult), 'CHANNEL_RESULT_INVALID', 'after');

  const untrimmed = snapshot();
  untrimmed.channels.static.source = ' padded ';
  assertRefused(compareCombinedReports(untrimmed, snapshot()), 'CHANNEL_SOURCE_INVALID', 'before');

  const tooLong = snapshot();
  tooLong.channels.static.source = 'x'.repeat(129);
  assertRefused(compareCombinedReports(tooLong, snapshot()), 'CHANNEL_SOURCE_INVALID', 'before');
});

test('a null source is legal exactly for invalid and error channels', () => {
  for (const outcome of ['invalid', 'error']) {
    const before = snapshot();
    before.channels.runtime = { state: 'provided', source: null, outcome, result: null, issues: [] };
    const diff = compareCombinedReports(before, snapshot());
    assert.equal(diff.valid, true, `${outcome}: ${JSON.stringify(diff.issues)}`);
    assert.equal(diff.channels.runtime.comparison, 'incomparable');
  }
});

test('a null source on a clear channel is refused', () => {
  const before = snapshot();
  before.channels.static.source = null;
  assertRefused(compareCombinedReports(before, snapshot()), 'CHANNEL_SOURCE_INVALID', 'before');
});

test('an empty limitations list is legal, and [] to [] is not a change', () => {
  const before = snapshot({ limitations: [] });
  const after = snapshot({ limitations: [] });

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.limitationsChanged, false);

  const grown = snapshot({ limitations: ['LANES_NOT_MERGED'] });
  const grownDiff = compareCombinedReports(before, grown);
  assert.equal(grownDiff.valid, true, JSON.stringify(grownDiff.issues));
  assert.equal(grownDiff.limitationsChanged, true);
  assert.equal(snapshotDiffExitCode(grownDiff), 1);
});

test('channel issues allow any non-empty code, including CLI-only codes', () => {
  const before = snapshot();
  before.channels.runtime.outcome = 'invalid';
  before.channels.runtime.issues = [{ code: 'INPUT_JSON_INVALID' }, { code: 'VALIDATOR_LOAD_FAILED' }];

  const diff = compareCombinedReports(before, snapshot());
  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.runtime.comparison, 'incomparable');
});

test('channel issues reject extra fields, empty codes and non-records', () => {
  for (const issues of [[{ code: '' }], [{ code: 'A', extra: 1 }], ['A'], [null]]) {
    const before = snapshot();
    before.channels.static.outcome = 'invalid';
    before.channels.static.issues = issues;
    assertRefused(compareCombinedReports(before, snapshot()), 'CHANNEL_ISSUES_INVALID', 'before');
  }
});

test('a provided channel with unknown outcome is refused', () => {
  const before = snapshot();
  before.channels.static.outcome = 'unknown';
  assertRefused(compareCombinedReports(before, snapshot()), 'CHANNEL_OUTCOME_INVALID', 'before');
});

/* ------------------------------------------------------------------ *
 * Refusals: JSON budget and JSON-shape hazards.
 * ------------------------------------------------------------------ */

test('depth beyond the budget is refused, never truncated', () => {
  let deep = {};
  const root = deep;
  for (let i = 0; i < SNAPSHOT_JSON_BUDGET.depth + 2; i += 1) {
    deep.next = {};
    deep = deep.next;
  }
  const before = snapshot();
  before.channels.static.result = root;

  assertRefused(compareCombinedReports(before, snapshot()), DIFF_ISSUE_CODES.JSON_DEPTH_EXCEEDED, 'before');
});

test('a node overrun is refused', () => {
  const before = snapshot();
  before.channels.static.result = { list: new Array(SNAPSHOT_JSON_BUDGET.nodes).fill(0) };

  assertRefused(compareCombinedReports(before, snapshot()), DIFF_ISSUE_CODES.JSON_NODES_EXCEEDED, 'before');
});

test('a string overrun is refused', () => {
  const before = snapshot();
  before.channels.static.result = { text: 'x'.repeat(SNAPSHOT_JSON_BUDGET.size + 1) };

  assertRefused(compareCombinedReports(before, snapshot()), DIFF_ISSUE_CODES.JSON_SIZE_EXCEEDED, 'before');
});

test('non-finite numbers, sparse arrays and non-plain objects are refused', () => {
  const nonFinite = snapshot();
  nonFinite.channels.static.result = { value: Number.POSITIVE_INFINITY };
  assertRefused(compareCombinedReports(nonFinite, snapshot()), 'JSON_NON_FINITE_NUMBER', 'before');

  const sparse = snapshot();
  sparse.channels.static.result = { list: [1, , 3] };
  assertRefused(compareCombinedReports(sparse, snapshot()), 'JSON_SPARSE_ARRAY', 'before');

  const exotic = snapshot();
  exotic.channels.static.result = { when: new Date(0) };
  assertRefused(compareCombinedReports(exotic, snapshot()), 'JSON_NON_PLAIN_OBJECT', 'before');

  const extraArrayProp = snapshot();
  const list = [1, 2];
  list.note = 'x';
  extraArrayProp.channels.static.result = { list };
  assertRefused(compareCombinedReports(extraArrayProp, snapshot()), 'JSON_ARRAY_EXTRA_PROPERTY', 'before');
});

test('a cycle is refused instead of recursing forever', () => {
  const before = snapshot();
  const cyclic = { name: 'loop' };
  cyclic.self = cyclic;
  before.channels.static.result = cyclic;

  assertRefused(compareCombinedReports(before, snapshot()), 'JSON_CYCLE', 'before');
});

test('shared references are not cycles', () => {
  const shared = { name: 'shared' };
  const before = snapshot();
  before.channels.static.result = { left: shared, right: shared };

  const diff = compareCombinedReports(before, snapshot());
  assert.equal(diff.valid, true, JSON.stringify(diff.issues));
  assert.equal(diff.channels.static.comparison, 'changed');
  assert.ok(diff.issues.every((issue) => issue.code !== 'JSON_CYCLE'), JSON.stringify(diff.issues));
});

test('a getter is refused without being invoked', () => {
  let invoked = 0;
  const before = snapshot();
  Object.defineProperty(before.channels.static, 'result', {
    enumerable: true,
    configurable: true,
    get() {
      invoked += 1;
      return { summary: {} };
    },
  });

  assertRefused(compareCombinedReports(before, snapshot()), 'JSON_ACCESSOR', 'before');
  assert.equal(invoked, 0);
});

test('a symbol key and a non-enumerable key are refused', () => {
  const symbolKey = snapshot();
  symbolKey[Symbol('hidden')] = 1;
  assertRefused(compareCombinedReports(symbolKey, snapshot()), 'JSON_SYMBOL_KEY', 'before');

  const hidden = snapshot();
  Object.defineProperty(hidden.channels.static.result, 'secret', { value: 1, enumerable: false });
  assertRefused(compareCombinedReports(hidden, snapshot()), 'JSON_NON_ENUMERABLE', 'before');
});

test('a throwing Proxy ends in a fixed refusal, not a propagated error', () => {
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('trap');
      },
    },
  );

  let diff;
  assert.doesNotThrow(() => {
    diff = compareCombinedReports(hostile, snapshot());
  });
  assert.equal(diff.valid, false);
  assert.deepEqual(diff.issues.map((issue) => issue.code), ['SNAPSHOT_UNREADABLE']);
  assert.ok(!JSON.stringify(diff).includes('trap'));
});

/* ------------------------------------------------------------------ *
 * Inputs are read, never mutated or frozen.
 * ------------------------------------------------------------------ */

test('neither snapshot is modified or frozen by the comparison', () => {
  const before = snapshot();
  const after = snapshot();
  after.channels.static.result.summary.analysisComplete = false;

  const beforeCopy = cloned(before);
  const afterCopy = cloned(after);

  const diff = compareCombinedReports(before, after);
  assert.equal(diff.channels.static.comparison, 'changed');

  assert.deepEqual(before, beforeCopy);
  assert.deepEqual(after, afterCopy);
  assert.equal(Object.isFrozen(before), false);
  assert.equal(Object.isFrozen(after), false);
  assert.equal(Object.isFrozen(before.channels.static.result), false);
});

/* ------------------------------------------------------------------ *
 * Exit codes.
 * ------------------------------------------------------------------ */

test('exit codes: 0 unchanged, 1 any change or incomparable, 2 refused', () => {
  assert.equal(snapshotDiffExitCode(compareCombinedReports(snapshot(), snapshot())), 0);

  const changed = snapshot();
  changed.limitations = ['LANES_NOT_MERGED'];
  assert.equal(snapshotDiffExitCode(compareCombinedReports(snapshot(), changed)), 1);

  const absent = snapshot();
  absent.channels.static = absentChannel();
  assert.equal(snapshotDiffExitCode(compareCombinedReports(snapshot(), absent)), 1);

  assert.equal(snapshotDiffExitCode(compareCombinedReports({}, snapshot())), 2);
});

test('exit code rejects anything this module did not produce', () => {
  const bad = [
    undefined,
    null,
    'diff',
    { valid: true },
    { valid: true, channels: { static: { comparison: 'same' } }, limitationsChanged: false },
    { valid: 'yes', channels: {}, limitationsChanged: false },
  ];
  for (const value of bad) {
    assert.throws(() => snapshotDiffExitCode(value), TypeError);
  }
});
