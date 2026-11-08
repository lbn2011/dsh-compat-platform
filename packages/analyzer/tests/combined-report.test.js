/**
 * Tests for `combined-report.js`.
 *
 * These exercise the wrapper only. Two lanes are driven through their real
 * modules (`analyze`, `summarizeRuntimeEvidence`); the admission lane is driven
 * through `diagnoseAdmissionEvidence` with a fake §6.6 validator, because the
 * protocol vocabulary belongs to whoever supplies that validator and this
 * package does not own it.
 *
 * Nothing here boots a host, reads a file, or certifies anything.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHANNEL_ISSUE_CODES,
  CHANNEL_OUTCOMES,
  COMBINED_REPORT_LIMITATIONS,
  COMBINED_REPORT_VERSION,
  LANE_IDS,
  MAX_SOURCE_LENGTH,
  buildCombinedReport,
  combinedReportExitCode,
} from '../src/combined-report.js';

/* ------------------------------------------------------------------ *
 * Fixtures.
 * ------------------------------------------------------------------ */

const SCHEMA_VERSION = '0.1.0-draft.1';
const COMMIT = 'a'.repeat(40);

function declaration(id, { required = [], resources = [] } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    plugin: { id, version: '1.0.0' },
    capabilities: { required, optional: [] },
    resources,
  };
}

function staticDocument(...declarations) {
  return { declarations, availableCapabilities: [] };
}

const acceptAll = () => ({ valid: true, issues: [] });

function runtimeCase(id, status) {
  if (status === 'passed') {
    return {
      id,
      status,
      evidenceTier: 'real-host',
      assertions: [{ id: `${id}-observed`, passed: true }],
      limitations: [],
    };
  }
  if (status === 'failed') {
    return {
      id,
      status,
      evidenceTier: 'real-host',
      assertions: [{ id: `${id}-mismatch`, passed: false }],
      limitations: [],
    };
  }
  return {
    id,
    status,
    evidenceTier: 'real-host',
    assertions: [],
    limitations: ['not attempted in this run'],
  };
}

function runtimeDocument([first, second, third]) {
  return {
    schemaVersion: 'coexistence-evidence/0.1',
    baseline: { commit: COMMIT, node: 'v24.21.0' },
    cases: [
      runtimeCase('same-name-conflict', first),
      runtimeCase('dependency-unload', second),
      runtimeCase('stale-cleanup', third),
    ],
    limitations: [],
  };
}

function refusedCase(id) {
  return {
    id,
    status: 'refused',
    assertionCount: 1,
    failedAssertions: [],
    limitations: [],
  };
}

function failedCase(id) {
  return {
    id,
    status: 'failed',
    assertionCount: 2,
    failedAssertions: [`${id}-assertion`],
    limitations: [],
  };
}

function admissionSummary(cases, coverage) {
  return {
    schemaVersion: SCHEMA_VERSION,
    certification: false,
    coverage,
    cases,
    limitations: [],
  };
}

/** A validator that says exactly what the caller wants it to say. */
function admissionValidator(result) {
  return () => result;
}

const admissionClear = admissionValidator({
  valid: true,
  issues: [],
  summary: admissionSummary([refusedCase('catalog-model')], {
    required: ['catalog-model'],
    present: ['catalog-model'],
    unknown: [],
  }),
});

const admissionAttention = admissionValidator({
  valid: true,
  issues: [],
  summary: admissionSummary([failedCase('catalog-model')], {
    required: ['catalog-model'],
    present: ['catalog-model'],
    unknown: [],
  }),
});

const admissionCoverageUnknown = admissionValidator({
  valid: true,
  issues: [],
  summary: admissionSummary([refusedCase('catalog-model')], {
    required: ['catalog-model'],
    present: ['catalog-model'],
    unknown: ['optional-model'],
  }),
});

const admissionInvalid = admissionValidator({
  valid: false,
  issues: [{ code: 'MISSING_FIELD', path: 'coverage' }],
});

function lane(source, document) {
  return { source, document };
}

/* ------------------------------------------------------------------ *
 * Envelope shape.
 * ------------------------------------------------------------------ */

test('the envelope has exactly the five documented keys', () => {
  const report = buildCombinedReport({ runtime: lane('run-1', runtimeDocument(['passed', 'passed', 'passed'])) });

  assert.deepEqual(Object.keys(report), [
    'reportVersion',
    'certification',
    'correlation',
    'channels',
    'limitations',
  ]);
  assert.equal(report.reportVersion, COMBINED_REPORT_VERSION);
  assert.equal(report.reportVersion, 'combined-report/0.1-draft.1');
  assert.equal(report.certification, false);
  assert.equal(report.correlation, 'not-established');
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.channels), true);
});

test('every channel and every issue has the documented closed shape', () => {
  const report = buildCombinedReport(
    {
      static: lane('static-1', staticDocument(declaration('alpha'), declaration('alpha'))),
      admission: lane('admission-1', {}),
    },
    { validateDeclaration: acceptAll, validateAdmissionEvidence: admissionAttention },
  );

  assert.deepEqual(Object.keys(report.channels), ['static', 'runtime', 'admission']);

  for (const id of LANE_IDS) {
    const channel = report.channels[id];
    assert.deepEqual(Object.keys(channel), ['state', 'source', 'outcome', 'result', 'issues']);
    assert.equal(CHANNEL_OUTCOMES.includes(channel.outcome), true);
    for (const issue of channel.issues) {
      assert.deepEqual(Object.keys(issue), ['code']);
      assert.equal(typeof issue.code, 'string');
    }
  }
});

test('the limitation list is the exported frozen array itself, not a copy', () => {
  const report = buildCombinedReport({ admission: lane('a', {}) }, { validateAdmissionEvidence: admissionClear });

  assert.equal(report.limitations, COMBINED_REPORT_LIMITATIONS);
  assert.equal(Object.isFrozen(COMBINED_REPORT_LIMITATIONS), true);
  assert.deepEqual([...COMBINED_REPORT_LIMITATIONS], [
    'CORRELATION_NOT_ESTABLISHED',
    'LANES_NOT_MERGED',
    'ABSENT_CHANNEL_IS_UNKNOWN',
    'CERTIFICATION_NOT_CLAIMED',
    'INPUT_IS_PARSED_JSON_NOT_A_SANDBOX',
  ]);
});

/* ------------------------------------------------------------------ *
 * Envelope refusals.
 * ------------------------------------------------------------------ */

test('a non-object input, an unknown field, or no lane at all is a TypeError', () => {
  assert.throws(() => buildCombinedReport(null), TypeError);
  assert.throws(() => buildCombinedReport([]), TypeError);
  assert.throws(() => buildCombinedReport({ other: {} }), TypeError);
  assert.throws(() => buildCombinedReport({}), TypeError);
  assert.throws(
    () => buildCombinedReport({ runtime: lane('r', runtimeDocument(['passed', 'passed', 'passed'])), extra: 1 }),
    TypeError,
  );
});

test('an unknown option, or a non-object options bag, is a TypeError', () => {
  const input = { admission: lane('a', {}) };

  assert.throws(() => buildCombinedReport(input, { validateAdmission: () => ({}) }), TypeError);
  assert.throws(() => buildCombinedReport(input, null), TypeError);
  assert.throws(() => buildCombinedReport(input, 'options'), TypeError);
});

test('an accessor on the envelope or on options is refused instead of invoked', () => {
  const accessorInput = {};
  Object.defineProperty(accessorInput, 'static', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('the accessor must not run');
    },
  });
  assert.throws(() => buildCombinedReport(accessorInput, { validateDeclaration: acceptAll }), TypeError);

  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'validateDeclaration', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('the accessor must not run');
    },
  });
  assert.throws(
    () => buildCombinedReport({ static: lane('s', staticDocument(declaration('alpha'))) }, accessorOptions),
    TypeError,
  );
});

/* ------------------------------------------------------------------ *
 * Absent versus null.
 * ------------------------------------------------------------------ */

test('an absent lane is unknown with no result, and is never clear', () => {
  const report = buildCombinedReport({ admission: lane('a', {}) }, { validateAdmissionEvidence: admissionClear });

  assert.deepEqual(report.channels.static, {
    state: 'absent',
    source: null,
    outcome: 'unknown',
    result: null,
    issues: [],
  });
  assert.equal(report.channels.runtime.outcome, 'unknown');
  assert.equal(report.channels.admission.outcome, 'clear');
});

test('a null lane entry is provided-but-invalid, not absent', () => {
  const report = buildCombinedReport({ static: null }, { validateDeclaration: acceptAll });

  assert.equal(report.channels.static.state, 'provided');
  assert.equal(report.channels.static.outcome, 'invalid');
  assert.equal(report.channels.static.source, null);
  assert.equal(report.channels.static.result, null);
  assert.deepEqual(report.channels.static.issues, [{ code: CHANNEL_ISSUE_CODES.INPUT_INVALID }]);
  assert.equal(report.channels.runtime.outcome, 'unknown');
});

test('a well-formed entry is clear — positive control for the malformed cases below', () => {
  // Split out of the malformed-entry table on purpose: this entry is completely
  // valid, so it must be `clear`. Left inside that table it would have asserted
  // `invalid` against a legal input and reported a failure that belongs to the
  // test, not to the adapter.
  const report = buildCombinedReport(
    { static: lane('s', staticDocument(declaration('alpha'))) },
    { validateDeclaration: acceptAll },
  );

  assert.equal(report.channels.static.state, 'provided');
  assert.equal(report.channels.static.outcome, 'clear');
  assert.deepEqual(report.channels.static.issues, []);
  assert.equal(report.channels.static.source, 's');
});

test('a malformed entry is invalid for its own lane and does not stop another lane', () => {
  // One label per case, quoted in every assertion message: when this table fails,
  // the label says which entry did it. The count is unchanged at six negative
  // cases; the legal entry that used to sit at index 0 now has its own control.
  const malformed = [
    {
      label: 'extra key',
      entry: { ...lane('s', staticDocument(declaration('alpha'))), extra: true },
    },
    {
      label: 'whitespace-only source',
      entry: lane('   ', staticDocument(declaration('alpha'))),
    },
    {
      label: 'padded source',
      entry: lane(' padded ', staticDocument(declaration('alpha'))),
    },
    {
      label: 'source over the alias limit',
      entry: lane('x'.repeat(MAX_SOURCE_LENGTH + 1), staticDocument(declaration('alpha'))),
    },
    {
      label: 'non-string source',
      entry: { source: 7, document: staticDocument(declaration('alpha')) },
    },
    {
      label: 'missing document',
      entry: { source: 's' },
    },
  ];

  assert.equal(malformed.length, 6);

  for (const { label, entry } of malformed) {
    const report = buildCombinedReport(
      { static: entry, admission: lane('a', {}) },
      { validateDeclaration: acceptAll, validateAdmissionEvidence: admissionClear },
    );
    assert.equal(
      report.channels.static.outcome,
      'invalid',
      `case "${label}" should be invalid for its own lane`,
    );
    assert.deepEqual(
      report.channels.static.issues,
      [{ code: CHANNEL_ISSUE_CODES.INPUT_INVALID }],
      `case "${label}" should report exactly INPUT_INVALID`,
    );
    assert.equal(
      report.channels.admission.outcome,
      'clear',
      `case "${label}" must not disturb the admission lane`,
    );
  }
});

test('a one-hundred-and-twenty-eight character alias is accepted', () => {
  const report = buildCombinedReport(
    { static: lane('x'.repeat(MAX_SOURCE_LENGTH), staticDocument(declaration('alpha'))) },
    { validateDeclaration: acceptAll },
  );

  assert.equal(report.channels.static.outcome, 'clear');
  assert.equal(report.channels.static.source.length, MAX_SOURCE_LENGTH);
});

/* ------------------------------------------------------------------ *
 * Static lane.
 * ------------------------------------------------------------------ */

test('static is clear when the validator accepts everything', () => {
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('alpha'))) },
    { validateDeclaration: acceptAll },
  );

  assert.equal(report.channels.static.outcome, 'clear');
  assert.deepEqual(report.channels.static.issues, []);
  assert.equal(report.channels.static.result.summary.analysisComplete, true);
});

test('static is attention when the analyzer reports an error finding', () => {
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('dup'), declaration('dup'))) },
    { validateDeclaration: acceptAll },
  );

  assert.equal(report.channels.static.outcome, 'attention');
  assert.deepEqual(report.channels.static.issues, [{ code: 'DUPLICATE_PLUGIN_ID' }]);
  assert.equal(report.channels.static.result.evidenceLevel, 'static-declaration');
});

test('static is invalid when the validator rejects a declaration', () => {
  const reject = () => ({ valid: false, issues: [{ code: 'NOT_A_DECLARATION', path: 'plugin' }] });
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('alpha'))) },
    { validateDeclaration: reject },
  );

  assert.equal(report.channels.static.outcome, 'invalid');
  // `analyze` may attach further error findings for the same declaration; what
  // this adapter promises is that the lane's own codes survive, unre-written.
  assert.equal(
    report.channels.static.issues.some((issue) => issue.code === 'INVALID_DECLARATION'),
    true,
  );
  assert.equal(report.channels.static.result.summary.analysisComplete, false);
});

test('a malformed validator return is invalid, not an error', () => {
  // `analyze` normalizes a non-§5 return into VALIDATOR_CONTRACT_VIOLATION
  // issues and then into an INVALID_DECLARATION finding; it does not throw.
  const malformed = () => 42;
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('alpha'))) },
    { validateDeclaration: malformed },
  );

  assert.equal(report.channels.static.outcome, 'invalid');
  assert.equal(
    report.channels.static.issues.some((issue) => issue.code === 'INVALID_DECLARATION'),
    true,
  );
});

test('a throwing validator is an error carrying VALIDATOR_FAILED', () => {
  // Regression: the thrown value is an `Error` instance, whose own `code` is a
  // data property. Treating it as a plain record made this path unreachable.
  const throwing = () => {
    throw new Error('validator exploded');
  };
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('alpha'))) },
    { validateDeclaration: throwing },
  );

  assert.equal(report.channels.static.outcome, 'error');
  assert.deepEqual(report.channels.static.issues, [{ code: CHANNEL_ISSUE_CODES.VALIDATOR_FAILED }]);
  assert.equal(report.channels.static.result, null);
});

test('a missing declaration validator is an error for that lane only', () => {
  const report = buildCombinedReport(
    { static: lane('static-1', staticDocument(declaration('alpha'))), admission: lane('a', {}) },
    { validateAdmissionEvidence: admissionClear },
  );

  assert.equal(report.channels.static.outcome, 'error');
  assert.deepEqual(report.channels.static.issues, [{ code: CHANNEL_ISSUE_CODES.VALIDATOR_MISSING }]);
  assert.equal(report.channels.admission.outcome, 'clear');
});

/* ------------------------------------------------------------------ *
 * Runtime lane.
 * ------------------------------------------------------------------ */

test('runtime is clear when all three cases passed', () => {
  const report = buildCombinedReport({
    runtime: lane('run-1', runtimeDocument(['passed', 'passed', 'passed'])),
  });

  assert.equal(report.channels.runtime.outcome, 'clear');
  assert.deepEqual(report.channels.runtime.issues, []);
  assert.equal(report.channels.runtime.result.summary.cases.length, 3);
});

test('a not-run case is attention and never a pass', () => {
  const report = buildCombinedReport({
    runtime: lane('run-1', runtimeDocument(['passed', 'not-run', 'passed'])),
  });

  assert.equal(report.channels.runtime.outcome, 'attention');
  assert.deepEqual(report.channels.runtime.issues, [{ code: 'RUNTIME_CASE_NOT_RUN' }]);
});

test('a failed case is attention with RUNTIME_CASE_FAILED', () => {
  const report = buildCombinedReport({
    runtime: lane('run-1', runtimeDocument(['failed', 'passed', 'passed'])),
  });

  assert.equal(report.channels.runtime.outcome, 'attention');
  assert.deepEqual(report.channels.runtime.issues, [{ code: 'RUNTIME_CASE_FAILED' }]);
});

test('an unusable runtime document is invalid and carries its own issue codes', () => {
  const report = buildCombinedReport({
    runtime: lane('run-1', { schemaVersion: 'coexistence-evidence/9.9', baseline: {}, cases: [] }),
  });

  assert.equal(report.channels.runtime.outcome, 'invalid');
  assert.equal(report.channels.runtime.issues.length > 0, true);
  assert.equal(report.channels.runtime.issues.every((issue) => typeof issue.code === 'string'), true);
  assert.equal(report.channels.runtime.result.valid, false);
});

/* ------------------------------------------------------------------ *
 * Admission lane.
 * ------------------------------------------------------------------ */

test('admission stays clear when the only finding is the expected refusal', () => {
  const report = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    { validateAdmissionEvidence: admissionClear },
  );

  assert.equal(report.channels.admission.outcome, 'clear');
  assert.deepEqual(report.channels.admission.issues, []);
});

test('admission is attention for a failed case and for unknown coverage', () => {
  const failed = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    { validateAdmissionEvidence: admissionAttention },
  );
  assert.equal(failed.channels.admission.outcome, 'attention');
  assert.deepEqual(failed.channels.admission.issues, [{ code: 'ADMISSION_CASE_FAILED' }]);

  const unknown = buildCombinedReport(
    { admission: lane('admission-2', {}) },
    { validateAdmissionEvidence: admissionCoverageUnknown },
  );
  assert.equal(unknown.channels.admission.outcome, 'attention');
  assert.deepEqual(unknown.channels.admission.issues, [{ code: 'ADMISSION_COVERAGE_UNKNOWN' }]);
});

test('a protocol rejection is invalid; a broken validator is an error', () => {
  const rejected = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    { validateAdmissionEvidence: admissionInvalid },
  );
  assert.equal(rejected.channels.admission.outcome, 'invalid');
  assert.deepEqual(rejected.channels.admission.issues, [{ code: 'MISSING_FIELD' }]);

  const throwing = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    {
      validateAdmissionEvidence: () => {
        throw new Error('validator exploded');
      },
    },
  );
  assert.equal(throwing.channels.admission.outcome, 'error');
  assert.deepEqual(throwing.channels.admission.issues, [{ code: 'VALIDATOR_THREW' }]);

  const asynchronous = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    { validateAdmissionEvidence: () => Promise.resolve({ valid: true, issues: [] }) },
  );
  assert.equal(asynchronous.channels.admission.outcome, 'error');
  assert.deepEqual(asynchronous.channels.admission.issues, [{ code: 'VALIDATOR_ASYNC' }]);
});

test('a missing admission validator is an error for that lane only', () => {
  const report = buildCombinedReport({
    admission: lane('admission-1', {}),
    runtime: lane('run-1', runtimeDocument(['passed', 'passed', 'passed'])),
  });

  assert.equal(report.channels.admission.outcome, 'error');
  assert.deepEqual(report.channels.admission.issues, [{ code: CHANNEL_ISSUE_CODES.VALIDATOR_MISSING }]);
  assert.equal(report.channels.runtime.outcome, 'clear');
});

/* ------------------------------------------------------------------ *
 * Three lanes together, and what is deliberately not done.
 * ------------------------------------------------------------------ */

test('three lanes coexist, each keeping its own result and issues', () => {
  const report = buildCombinedReport(
    {
      static: lane('session-42', staticDocument(declaration('dup'), declaration('dup'))),
      runtime: lane('session-42', runtimeDocument(['passed', 'not-run', 'passed'])),
      admission: lane('session-42', {}),
    },
    { validateDeclaration: acceptAll, validateAdmissionEvidence: admissionAttention },
  );

  assert.equal(report.channels.static.outcome, 'attention');
  assert.equal(report.channels.runtime.outcome, 'attention');
  assert.equal(report.channels.admission.outcome, 'attention');
  assert.deepEqual(report.channels.static.issues, [{ code: 'DUPLICATE_PLUGIN_ID' }]);
  assert.deepEqual(report.channels.runtime.issues, [{ code: 'RUNTIME_CASE_NOT_RUN' }]);
  assert.deepEqual(report.channels.admission.issues, [{ code: 'ADMISSION_CASE_FAILED' }]);

  // No merged finding list, no score: each result is the lane's own object.
  assert.equal(report.channels.static.result.evidenceLevel, 'static-declaration');
  assert.equal(report.channels.runtime.result.summary.cases.length, 3);
  assert.equal(report.channels.admission.result.summary.cases.length, 1);
});

test('the same source alias across lanes establishes no correlation', () => {
  const report = buildCombinedReport(
    {
      static: lane('same/alias', staticDocument(declaration('alpha'))),
      admission: lane('same/alias', {}),
    },
    { validateDeclaration: acceptAll, validateAdmissionEvidence: admissionClear },
  );

  assert.equal(report.correlation, 'not-established');
  assert.equal(report.channels.static.source, 'same/alias');
  assert.equal(report.channels.admission.source, 'same/alias');
  assert.equal(Object.keys(report).includes('findings'), false);
});

/* ------------------------------------------------------------------ *
 * Borrowed objects.
 * ------------------------------------------------------------------ */

test('input and validator-owned objects are neither frozen nor mutated', () => {
  const summary = admissionSummary([refusedCase('catalog-model')], {
    required: ['catalog-model'],
    present: ['catalog-model'],
    unknown: [],
  });
  const document = {};
  const input = { admission: { source: 'admission-1', document } };
  const before = JSON.stringify(input);

  const report = buildCombinedReport(input, {
    validateAdmissionEvidence: () => ({ valid: true, issues: [], summary }),
  });

  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(document), false);
  assert.equal(Object.isFrozen(summary), false);
  // The lane's own result is passed through by reference, not copied.
  assert.equal(report.channels.admission.result.summary, summary);
});

test('the same input and a deterministic validator give the same report', () => {
  const build = () => buildCombinedReport(
    {
      static: lane('static-1', staticDocument(declaration('alpha'))),
      runtime: lane('run-1', runtimeDocument(['passed', 'passed', 'not-run'])),
    },
    { validateDeclaration: acceptAll },
  );

  assert.deepEqual(build(), build());
});

/* ------------------------------------------------------------------ *
 * Exit codes.
 * ------------------------------------------------------------------ */

test('the exit code is 4 for an error, ahead of invalid, attention and unknown', () => {
  const report = buildCombinedReport(
    {
      static: lane('static-1', staticDocument(declaration('alpha'))),
      runtime: lane('run-1', { schemaVersion: 'wrong' }),
      admission: lane('admission-1', {}),
    },
    {
      validateDeclaration: () => {
        throw new Error('validator exploded');
      },
      validateAdmissionEvidence: admissionAttention,
    },
  );

  assert.equal(combinedReportExitCode(report), 4);
});

test('the exit code is 2 when the worst outcome is invalid', () => {
  const report = buildCombinedReport({
    runtime: lane('run-1', runtimeDocument(['failed', 'passed', 'passed'])),
    admission: lane('admission-1', {}),
  }, { validateAdmissionEvidence: admissionInvalid });

  assert.equal(combinedReportExitCode(report), 2);
});

test('the exit code is 1 when a lane needs attention or is absent', () => {
  const attention = buildCombinedReport({
    runtime: lane('run-1', runtimeDocument(['passed', 'not-run', 'passed'])),
  });
  assert.equal(combinedReportExitCode(attention), 1);

  const absent = buildCombinedReport(
    { admission: lane('admission-1', {}) },
    { validateAdmissionEvidence: admissionClear },
  );
  assert.equal(combinedReportExitCode(absent), 1);
});

test('the exit code is 0 only when every lane is provided and clear', () => {
  const report = buildCombinedReport(
    {
      static: lane('static-1', staticDocument(declaration('alpha'))),
      runtime: lane('run-1', runtimeDocument(['passed', 'passed', 'passed'])),
      admission: lane('admission-1', {}),
    },
    { validateDeclaration: acceptAll, validateAdmissionEvidence: admissionClear },
  );

  assert.equal(combinedReportExitCode(report), 0);
});

test('a value that is not a report is a TypeError for the exit code', () => {
  assert.throws(() => combinedReportExitCode(null), TypeError);
  assert.throws(() => combinedReportExitCode({}), TypeError);
  assert.throws(() => combinedReportExitCode({ channels: {} }), TypeError);
});
