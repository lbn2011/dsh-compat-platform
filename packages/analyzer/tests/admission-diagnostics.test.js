/**
 * Tests for `src/admission-diagnostics.js`.
 *
 * WRITTEN BUT NOT RUN as part of this change. They state a contract only.
 *
 * WHAT IS MOCKED, AND WHY
 * -----------------------
 * The validator is injected in production, and this package must not import the
 * protocol's implementation (it does not live in this repository, and the
 * `coexistence-evidence/0.1` lane is not touched). So every test here injects a
 * **test double** at the validator boundary and asserts what the wrapper does with
 * its *return value*. Nothing below claims that a real cross-repository run
 * happened, or that the doubles agree with the protocol beyond the §6.6 shape they
 * are built to satisfy.
 *
 * The case and assertion ids appearing as fixture data are the spec's catalog
 * (§6.1/§6.2). They are data here, not rules: this module deliberately holds no
 * catalog of its own, and no test asserts that it does.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DIAGNOSTIC_CODES,
  WRAPPER_ISSUE_CODES,
  diagnoseAdmissionEvidence,
} from '../src/admission-diagnostics.js';

/* ------------------------------------------------------------------ *
 * Fixtures. The wrapper never validates a document, so these are only
 * *summary-shaped* objects; the double decides validity.
 * ------------------------------------------------------------------ */

const REQUIRED_CASES = Object.freeze([
  'admission-admitted',
  'admission-refused-conflict',
  'admission-activation-throw',
  'admission-cleanup-failure',
]);

const OPTIONAL_CASES = Object.freeze([
  'admission-lease-state',
  'admission-tuple-shape',
  'admission-remount-same-coordinator',
  'admission-visibility',
]);

const casePortion = ({
  id,
  status = 'passed',
  assertionCount = 1,
  failedAssertions = [],
  limitations = [],
}) => ({ id, status, assertionCount, failedAssertions, limitations });

/**
 * A §6.6 summary. `coverage.present` is derived from the cases unless given, so
 * the common fixture is internally coherent; tests that need an incoherent
 * summary pass the override explicitly.
 */
function summary({
  cases,
  required = REQUIRED_CASES,
  present,
  unknown = [],
  limitations = [],
} = {}) {
  return {
    schemaVersion: 'admission-evidence/0.1-draft.1',
    certification: false,
    coverage: {
      required: [...required],
      present: [...(present ?? cases.map((entry) => entry.id))],
      unknown: [...unknown],
    },
    cases,
    limitations: [...limitations],
  };
}

const accepted = (summaryObject) => ({ valid: true, issues: [], summary: summaryObject });

const refusedByValidator = (issues) => ({ valid: false, issues });

/** Inject a fixed return value and count the calls. */
function fixed(result) {
  const calls = [];
  const validateAdmissionEvidence = (value) => {
    calls.push(value);
    return result;
  };
  return { calls, options: { validateAdmissionEvidence } };
}

function diagnose(value, result) {
  const { calls, options } = fixed(result);
  return { calls, result: diagnoseAdmissionEvidence(value, options) };
}

const codesOf = (findings) => findings.map((finding) => finding.code);

/* ------------------------------------------------------------------ *
 * Accepted results.
 * ------------------------------------------------------------------ */

test('every case passed: no findings at all, certification false', () => {
  const fixture = summary({ cases: REQUIRED_CASES.map((id) => casePortion({ id })) });
  const { result } = diagnose({}, accepted(fixture));

  assert.equal(result.valid, true);
  assert.equal(result.certification, false);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.findings, []);
  // Passed through by reference: no copy, no re-freeze, no rewriting.
  assert.equal(result.summary, fixture);
});

test('a reported failure yields one finding carrying the case id and its counts', () => {
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted' }),
      casePortion({
        id: 'admission-refused-conflict',
        status: 'failed',
        assertionCount: 5,
        failedAssertions: ['contender-activation-ran-zero', 'holder-claim-still-held'],
      }),
    ],
    required: REQUIRED_CASES.slice(0, 2),
  });

  const { result } = diagnose({}, accepted(fixture));

  assert.deepEqual(codesOf(result.findings), [DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED]);
  const [finding] = result.findings;
  assert.equal(finding.caseId, 'admission-refused-conflict');
  assert.equal(finding.status, 'failed');
  assert.match(finding.message, /2 of 5/);
  assert.equal(Object.isFrozen(finding), true);
});

test('a refused case is reported as refused, not as a failure', () => {
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted' }),
      casePortion({
        id: 'admission-refused-conflict',
        status: 'refused',
        assertionCount: 5,
        limitations: [],
      }),
    ],
    required: REQUIRED_CASES.slice(0, 2),
  });

  const { result } = diagnose({}, accepted(fixture));

  assert.deepEqual(codesOf(result.findings), [DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED]);
  const [finding] = result.findings;
  assert.equal(finding.status, 'refused');
  // The distinction the lane exists for: a refusal is the expected outcome.
  assert.match(finding.message, /expected outcome/);
  assert.doesNotMatch(finding.message, /failed/);
  assert.ok(!codesOf(result.findings).includes(DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED));
});

test('a not-run case is unknown, never a pass', () => {
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted' }),
      casePortion({
        id: 'admission-activation-throw',
        status: 'not-run',
        assertionCount: 0,
        failedAssertions: [],
        limitations: ['fixture declined to start'],
      }),
    ],
    // `required` names what this run was obliged to cover: both present case ids.
    required: ['admission-admitted', 'admission-activation-throw'],
  });

  const { result } = diagnose({}, accepted(fixture));

  assert.deepEqual(codesOf(result.findings), [DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN]);
  assert.match(result.findings[0].message, /unknown/);
  // The limitation text is preserved in the summary but never echoed into findings.
  assert.doesNotMatch(result.findings[0].message, /fixture declined/);
  assert.deepEqual(result.summary.cases[1].limitations, ['fixture declined to start']);
});

test('absent optional coverage is named, one finding per id, after case findings', () => {
  const fixture = summary({
    cases: REQUIRED_CASES.map((id) => casePortion({ id })),
    unknown: OPTIONAL_CASES,
  });

  const { result } = diagnose({}, accepted(fixture));

  assert.deepEqual(codesOf(result.findings), OPTIONAL_CASES.map(() => DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN));
  assert.deepEqual(result.findings.map((finding) => finding.caseId), [...OPTIONAL_CASES]);
  assert.deepEqual(result.findings.map((finding) => finding.status), [null, null, null, null]);
  assert.deepEqual(result.summary.coverage.unknown, [...OPTIONAL_CASES]);
});

test('mixed statuses keep summary order, then coverage order', () => {
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted', status: 'failed', failedAssertions: ['close-fulfilled'] }),
      casePortion({ id: 'admission-refused-conflict', status: 'refused' }),
      casePortion({
        id: 'admission-activation-throw',
        status: 'not-run',
        assertionCount: 0,
        limitations: ['host fixture unavailable, so the case was never attempted'],
      }),
      casePortion({ id: 'admission-cleanup-failure' }),
    ],
    unknown: ['admission-visibility'],
  });

  const { result } = diagnose({}, accepted(fixture));

  assert.deepEqual(codesOf(result.findings), [
    DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED,
    DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED,
    DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN,
    DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN,
  ]);
  assert.equal(result.findings[0].caseId, 'admission-admitted');
  assert.equal(result.findings[3].caseId, 'admission-visibility');
});

/* ------------------------------------------------------------------ *
 * The validator's own refusal is passed through untouched.
 * ------------------------------------------------------------------ */

test('a validator refusal keeps its issues by reference and produces no finding', () => {
  const issues = [
    { code: 'MISSING_REQUIRED_CASE', path: '' },
    { code: 'INVALID_COMMIT', path: 'baseline.commit' },
  ];
  const { result } = diagnose({}, refusedByValidator(issues));

  assert.equal(result.valid, false);
  assert.equal(result.certification, false);
  assert.equal(result.issues, issues, 'issues must be passed through, not rebuilt');
  assert.deepEqual(result.findings, []);
  assert.equal('summary' in result, false, 'an invalid result must carry no summary key');
});

/* ------------------------------------------------------------------ *
 * Fail-closed: the validator did not answer within the contract.
 * ------------------------------------------------------------------ */

test('a throwing validator becomes VALIDATOR_THREW, and nothing propagates', () => {
  const options = {
    validateAdmissionEvidence() {
      throw new Error('boom: validator internals');
    },
  };
  const result = diagnoseAdmissionEvidence({}, options);

  assert.equal(result.valid, false);
  assert.equal(result.certification, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [WRAPPER_ISSUE_CODES.VALIDATOR_THREW]);
  assert.equal('summary' in result, false);
  assert.deepEqual(result.findings, []);
  // The thrown message is not echoed: only the closed code is reported.
  assert.doesNotMatch(JSON.stringify(result), /boom/);
});

test('an async validator becomes VALIDATOR_ASYNC', () => {
  const options = { validateAdmissionEvidence: async () => accepted(summary({ cases: [] })) };
  const result = diagnoseAdmissionEvidence({}, options);

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [WRAPPER_ISSUE_CODES.VALIDATOR_ASYNC]);
});

test('malformed and self-contradictory returns fail closed with a located code', () => {
  const cases = REQUIRED_CASES.map((id) => casePortion({ id }));
  const good = summary({ cases });

  const table = [
    // Not a §6.6 result at all.
    ['null result', null, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['array result', [], WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['string result', 'valid', WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['non-boolean valid', { valid: 'true', issues: [] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.valid'],
    // Closed member sets.
    ['extra member', { valid: false, issues: [{ code: 'INVALID_INPUT', path: '' }], extra: 1 }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    // `Object.keys` would miss both of these; own keys must not.
    ['symbol-keyed extra member', { valid: false, issues: [{ code: 'INVALID_INPUT', path: '' }], [Symbol('extra')]: 1 }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['non-enumerable extra member', Object.defineProperty({ valid: false, issues: [{ code: 'INVALID_INPUT', path: '' }] }, 'extra', { value: 1, enumerable: false }), WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['missing issues', { valid: false }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result'],
    ['issue with a third member', { valid: false, issues: [{ code: 'X', path: '', message: 'why' }] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.issues[0]'],
    ['issue with empty code', { valid: false, issues: [{ code: '', path: '' }] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.issues[0].code'],
    ['non-string issue path', { valid: false, issues: [{ code: 'X', path: 7 }] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.issues[0].path'],
    // "summary iff valid", in both directions.
    ['summary on a refusal', { valid: false, issues: [{ code: 'X', path: '' }], summary: good }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.summary'],
    ['null summary on a refusal', { valid: false, issues: [{ code: 'X', path: '' }], summary: null }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.summary'],
    ['no summary when valid', { valid: true, issues: [] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result.summary'],
    ['issues when valid', { valid: true, issues: [{ code: 'X', path: '' }], summary: good }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'result.issues'],
    ['no issues when invalid', { valid: false, issues: [] }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'result.issues'],
    // Summary members.
    ['summary extra member', { valid: true, issues: [], summary: { ...good, tier: 'real-host' } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary'],
    ['empty schemaVersion', { valid: true, issues: [], summary: { ...good, schemaVersion: '' } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.schemaVersion'],
    ['certification true', { valid: true, issues: [], summary: { ...good, certification: true } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.certification'],
    ['certification "false"', { valid: true, issues: [], summary: { ...good, certification: 'false' } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.certification'],
    ['coverage missing member', { valid: true, issues: [], summary: { ...good, coverage: { required: [], present: [] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.coverage'],
    ['duplicate present id', { valid: true, issues: [], summary: { ...good, coverage: { ...good.coverage, present: [...good.coverage.present, cases[0].id] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.coverage.present'],
    // Case members.
    ['unknown status word', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'skipped' })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.cases[0].status'],
    ['negative assertionCount', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', assertionCount: -1 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.cases[0].assertionCount'],
    ['non-integer assertionCount', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', assertionCount: 1.5 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.cases[0].assertionCount'],
    ['duplicate failed assertion id', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'failed', assertionCount: 2, failedAssertions: ['a', 'a'] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'summary.cases[0].failedAssertions'],
    ['more failures than recorded assertions', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'failed', assertionCount: 1, failedAssertions: ['a', 'b'] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].failedAssertions'],
    // Status/count agreement: each status admits exactly one combination.
    ['failed with no failed assertion', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'failed', assertionCount: 2, failedAssertions: [] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].failedAssertions'],
    ['failed with zero assertions', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'failed', assertionCount: 0 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].assertionCount'],
    ['passed with zero assertions', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', assertionCount: 0 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].assertionCount'],
    ['refused with zero assertions', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'refused', assertionCount: 0 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].assertionCount'],
    ['refused that also failed an assertion', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'refused', assertionCount: 2, failedAssertions: ['contender-ran'] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].failedAssertions'],
    ['not-run that recorded assertions', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'not-run', assertionCount: 3, limitations: ['skipped'] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].assertionCount'],
    ['not-run that recorded failures', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'not-run', assertionCount: 0, failedAssertions: ['a'], limitations: ['skipped'] })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].failedAssertions'],
    ['not-run without a limitation', { valid: true, issues: [], summary: { ...good, cases: [casePortion({ id: 'admission-admitted', status: 'not-run', assertionCount: 0 })] } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases[0].limitations'],
    // Cross-member coherence.
    ['duplicate case id', { valid: true, issues: [], summary: { ...good, cases: [cases[0], cases[0]], coverage: { ...good.coverage, present: [cases[0].id] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.cases'],
    ['present does not match cases', { valid: true, issues: [], summary: { ...good, coverage: { ...good.coverage, present: [cases[0].id] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.coverage.present'],
    ['required not a subset of present', { valid: true, issues: [], summary: { ...good, coverage: { ...good.coverage, required: ['admission-visibility'] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.coverage.required'],
    ['unknown overlapping present', { valid: true, issues: [], summary: { ...good, coverage: { ...good.coverage, unknown: [cases[0].id] } } }, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, 'summary.coverage.unknown'],
  ];

  for (const [label, value, code, path] of table) {
    const result = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: () => value });
    assert.equal(result.valid, false, `${label}: must not be accepted`);
    assert.equal(result.certification, false, `${label}: never certifies`);
    assert.deepEqual(result.issues.map((issue) => issue.code), [code], `${label}: code`);
    assert.equal(result.issues[0].path, path, `${label}: path`);
    assert.equal('summary' in result, false, `${label}: no summary`);
    assert.deepEqual(result.findings, [], `${label}: no findings`);
  }
});

test('a missing validator is a caller error, not an evidence verdict', () => {
  assert.throws(() => diagnoseAdmissionEvidence({}, undefined), TypeError);
  assert.throws(() => diagnoseAdmissionEvidence({}, {}), TypeError);
  assert.throws(() => diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: 'nope' }), TypeError);
});

/* ------------------------------------------------------------------ *
 * Purity, determinism, no mutation.
 * ------------------------------------------------------------------ */

test('the validator is called once, with the value unchanged', () => {
  const document = { schemaVersion: 'admission-evidence/0.1-draft.1' };
  const { calls, result } = diagnose(document, accepted(summary({ cases: [], required: [] })));

  assert.equal(calls.length, 1);
  assert.equal(calls[0], document);
  assert.equal(result.valid, true);
});

test('the same inputs yield deeply equal results, twice', () => {
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted', status: 'failed', failedAssertions: ['close-fulfilled'] }),
      casePortion({ id: 'admission-refused-conflict', status: 'refused' }),
    ],
    required: REQUIRED_CASES.slice(0, 2),
    unknown: ['admission-visibility'],
  });
  const options = { validateAdmissionEvidence: () => accepted(fixture) };

  const first = diagnoseAdmissionEvidence({}, options);
  const second = diagnoseAdmissionEvidence({}, options);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.findings), true);
});

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

test('a deep-frozen document is accepted and the summary is not frozen by us', () => {
  const document = deepFreeze({ schemaVersion: 'admission-evidence/0.1-draft.1', cases: [] });
  const fixture = summary({ cases: [], required: [] });

  const result = diagnoseAdmissionEvidence(document, { validateAdmissionEvidence: () => accepted(fixture) });

  assert.equal(result.valid, true);
  assert.equal(result.summary, fixture);
  // Freezing the caller's summary would be a mutation of the validator's object.
  assert.equal(Object.isFrozen(fixture), false);
  assert.equal(Object.keys(fixture).length, 5);
});

test('a hostile case id stays in the typed field and never reaches finding text', () => {
  const hostile = '"><script>alert(1)</script>';
  const fixture = summary({
    cases: [
      casePortion({ id: 'admission-admitted', status: 'failed', failedAssertions: ['x'] }),
      casePortion({
        id: hostile,
        status: 'not-run',
        assertionCount: 0,
        limitations: ['not attempted'],
      }),
    ],
    // Covered = exactly the two ids above; the hostile id is present, not unknown.
    required: ['admission-admitted', hostile],
  });

  const result = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: () => accepted(fixture) });

  const finding = result.findings.find((entry) => entry.caseId === hostile);
  assert.ok(finding, 'the id is preserved as data');
  assert.equal(finding.message.includes('<script>'), false);
  for (const entry of result.findings) {
    assert.equal(entry.message.includes('<script>'), false);
  }
  // The same holds for an issue path this module composes itself.
  const broken = diagnoseAdmissionEvidence({}, {
    validateAdmissionEvidence: () => ({ valid: true, issues: [], summary: { ...fixture, cases: [{ ...fixture.cases[0], status: hostile }] } }),
  });
  assert.equal(broken.issues[0].path, 'summary.cases[0].status');
  assert.equal(broken.issues[0].path.includes('<script>'), false);
});

/* ------------------------------------------------------------------ *
 * Hostile return values. A validator that returns an object whose reads
 * run code can throw *after* it returned; that must close, not propagate.
 * ------------------------------------------------------------------ */

test('a returned value that throws on its own members fails closed', () => {
  const hostile = {
    get valid() {
      throw new Error('hostile getter');
    },
    issues: [],
  };

  const result = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: () => hostile });

  assert.equal(result.valid, false);
  assert.equal(result.certification, false);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED,
  ]);
  assert.deepEqual(result.findings, []);
  assert.equal('summary' in result, false);
});

test('a proxy trap that throws after the verdict is readable still fails closed', () => {
  const fixture = summary({ cases: [casePortion({ id: 'admission-admitted' })], required: ['admission-admitted'] });
  const target = { valid: true, issues: [], summary: fixture };
  const hostile = new Proxy(target, {
    get(object, key, receiver) {
      if (key === 'summary') throw new Error('hostile proxy trap');
      return Reflect.get(object, key, receiver);
    },
  });

  const result = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: () => hostile });

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED,
  ]);
  assert.deepEqual(result.findings, []);
});

test('a cases array that throws while findings are built fails closed', () => {
  // Inspection indexes the array; only finding construction iterates it, so this
  // exercises the second guarded step rather than the shape checks.
  const cases = [casePortion({ id: 'admission-admitted' })];
  const fixture = { ...summary({ cases, required: ['admission-admitted'] }), cases: new Proxy(cases, {
    get(object, key, receiver) {
      if (key === Symbol.iterator) throw new Error('hostile iterator');
      return Reflect.get(object, key, receiver);
    },
  }) };

  const result = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence: () => accepted(fixture) });

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((entry) => entry.code), [
    WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED,
  ]);
  assert.deepEqual(result.findings, []);
});

test('a stateful validator is followed, not cached or smoothed over', () => {
  let call = 0;
  const fixture = summary({ cases: [casePortion({ id: 'admission-admitted' })], required: ['admission-admitted'] });
  const validateAdmissionEvidence = () => {
    call += 1;
    return call === 1 ? accepted(fixture) : refusedByValidator([{ code: 'ADMISSION_CASE_FAILED', path: 'cases' }]);
  };

  const first = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence });
  const second = diagnoseAdmissionEvidence({}, { validateAdmissionEvidence });

  // Two calls, two answers: the wrapper holds no memory between invocations.
  assert.equal(call, 2);
  assert.equal(first.valid, true);
  assert.equal(second.valid, false);
  assert.equal('summary' in second, false);
  assert.equal(second.issues[0].path, 'cases');
});

/* ------------------------------------------------------------------ *
 * Source hygiene: this module must stay free of effects.
 * ------------------------------------------------------------------ */

test('the module imports no effectful API and no sibling lane module', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../src/admission-diagnostics.js', import.meta.url)),
    'utf8',
  );

  for (const forbidden of [
    'node:fs',
    'node:child_process',
    'node:net',
    'node:http',
    'process.',
    'Date.now',
    'Math.random',
    'require(',
    'eval(',
  ]) {
    assert.equal(source.includes(forbidden), false, `source must not contain ${forbidden}`);
  }
  // No imports at all: the validator is injected, and the sibling coexistence lane
  // is neither imported nor re-implemented here.
  assert.equal(/^\s*import\s/m.test(source), false, 'the module must import nothing');
  // It is a wrapper with exactly one entry point, not a second validator.
  assert.equal(/export function diagnoseAdmissionEvidence/.test(source), true);
});
