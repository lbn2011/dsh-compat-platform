import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CASE_IDS,
  CASE_STATUSES,
  EVIDENCE_TIERS,
  ISSUE_CODES,
  SCHEMA_VERSION,
  summarizeRuntimeEvidence,
} from '../src/runtime-evidence.js';

/* ------------------------------------------------------------------ *
 * Test data. These are documents, not rules: the module decides validity.
 * ------------------------------------------------------------------ */

const COMMIT = '9f2c4a7b1d0e3f5a6b8c9d0e1f2a3b4c5d6e7f80';

const assertion = (id, passed) => ({ id, passed });

const caseRecord = ({
  id,
  status = 'passed',
  evidenceTier = 'real-host',
  assertions = [assertion('observed', true)],
  limitations = [],
}) => ({ id, status, evidenceTier, assertions, limitations });

/** A fully valid mixed document: one pass, one recorded failure, one not run. */
function validEvidence() {
  return {
    schemaVersion: SCHEMA_VERSION,
    baseline: { commit: COMMIT, node: 'v24.21.0' },
    cases: [
      caseRecord({
        id: 'same-name-conflict',
        status: 'passed',
        assertions: [
          assertion('second-registration-rejected', true),
          assertion('host-log-names-the-conflict', true),
        ],
        limitations: ['only two host builds were exercised'],
      }),
      caseRecord({
        id: 'dependency-unload',
        status: 'failed',
        assertions: [
          assertion('capability-released-after-unload', false),
          assertion('no-residual-registration', false),
        ],
        limitations: ['unload was observed once, not repeatedly'],
      }),
      caseRecord({ id: 'stale-cleanup', status: 'not-run', assertions: [], limitations: ['not attempted'] }),
    ],
    limitations: ['evidence came from one operator machine', 'no crash-recovery case was run'],
  };
}

const codes = (result) => result.issues.map((issue) => issue.code);
const has = (result, code) => codes(result).includes(code);

/** Summarize a document shape and require the fail-closed outcome. */
function invalid(document) {
  const result = summarizeRuntimeEvidence(document);
  assert.equal(result.valid, false, 'document must be refused');
  assert.equal(result.summary, null, 'a refused document must not be summarized');
  assert.ok(result.issues.length > 0, 'a refusal must always carry at least one issue');
  return result;
}

/* ------------------------------------------------------------------ *
 * 1. The valid path.
 * ------------------------------------------------------------------ */

test('a valid mixed document summarizes with canonical case order and counts', () => {
  const document = validEvidence();
  const result = summarizeRuntimeEvidence(document);

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  const summary = result.summary;

  assert.deepEqual(
    summary.cases.map((entry) => entry.id),
    ['same-name-conflict', 'dependency-unload', 'stale-cleanup'],
  );
  assert.deepEqual(
    summary.cases.map((entry) => entry.status),
    ['passed', 'failed', 'not-run'],
  );
  assert.deepEqual(
    summary.cases.map((entry) => entry.assertionCount),
    [2, 2, 0],
  );
  assert.deepEqual(
    summary.cases.map((entry) => entry.failedAssertionCount),
    [0, 2, 0],
  );
  assert.deepEqual(summary.cases[0].limitations, ['only two host builds were exercised']);
  assert.deepEqual(summary.baseline, { commit: COMMIT, node: 'v24.21.0' });
  assert.deepEqual(summary.limitations, document.limitations);
  // The tier is copied, never upgraded or dropped.
  assert.deepEqual(
    summary.cases.map((entry) => entry.evidenceTier),
    ['real-host', 'real-host', 'real-host'],
  );
});

test('a valid summary has exactly the documented shape and is frozen', () => {
  const result = summarizeRuntimeEvidence(validEvidence());
  const summary = result.summary;

  assert.deepEqual(Object.keys(summary), ['cases', 'baseline', 'limitations', 'certification']);
  assert.deepEqual(Object.keys(summary.cases[0]), [
    'id',
    'status',
    'evidenceTier',
    'assertionCount',
    'failedAssertionCount',
    'limitations',
  ]);
  assert.equal(result.valid, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.issues), true);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.cases), true);
  assert.equal(Object.isFrozen(summary.cases[0]), true);
  assert.equal(Object.isFrozen(summary.cases[0].limitations), true);
  assert.equal(Object.isFrozen(summary.baseline), true);
  assert.equal(Object.isFrozen(summary.limitations), true);
});

test('the summary does not depend on the order the reporter used', () => {
  const document = validEvidence();
  const reordered = { ...document, cases: [document.cases[2], document.cases[0], document.cases[1]] };

  const first = summarizeRuntimeEvidence(document);
  const second = summarizeRuntimeEvidence(reordered);

  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.deepEqual(second.summary, first.summary);
  assert.equal(JSON.stringify(second.summary), JSON.stringify(first.summary));
});

test('summarizing is deterministic and never mutates its input', () => {
  const document = validEvidence();
  const before = structuredClone(document);

  const first = summarizeRuntimeEvidence(document);
  const second = summarizeRuntimeEvidence(document);

  assert.deepEqual(document, before, 'the input document must be untouched');
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('a not-run case with zero assertions is valid, not a defect', () => {
  const document = validEvidence();
  const result = summarizeRuntimeEvidence(document);
  const notRun = result.summary.cases.find((entry) => entry.id === 'stale-cleanup');

  assert.equal(result.valid, true);
  assert.equal(notRun.status, 'not-run');
  assert.equal(notRun.assertionCount, 0);
  assert.equal(notRun.failedAssertionCount, 0);
});

test('uppercase hexadecimal commits are accepted and preserved verbatim', () => {
  const document = validEvidence();
  document.baseline.commit = 'A'.repeat(40);
  const result = summarizeRuntimeEvidence(document);

  assert.equal(result.valid, true);
  assert.equal(result.summary.baseline.commit, 'A'.repeat(40));
});

/* ------------------------------------------------------------------ *
 * 2. Coverage: all three cases, exactly once each.
 * ------------------------------------------------------------------ */

test('a missing case is refused instead of being read as passed or skipped', () => {
  const document = validEvidence();
  document.cases = document.cases.filter((entry) => entry.id !== 'stale-cleanup');

  const result = invalid(document);
  assert.deepEqual(codes(result), [ISSUE_CODES.MISSING_CASE_ID]);
  assert.match(result.issues[0].message, /stale-cleanup/);
  assert.equal(result.issues[0].path, 'cases');
});

test('duplicate cases are refused: two copies are never merged or overridden', () => {
  const document = validEvidence();
  const conflict = document.cases[0];
  const other = caseRecord({
    id: 'same-name-conflict',
    status: 'not-run',
    assertions: [],
  });
  document.cases = [conflict, other, document.cases[1], document.cases[2]];

  const result = invalid(document);
  assert.equal(has(result, ISSUE_CODES.DUPLICATE_CASE_ID), true);
  assert.equal(result.issues[0].path, 'cases[1].id');
});

test('an unknown case id is refused and never counted as coverage', () => {
  const document = validEvidence();
  document.cases.push(caseRecord({ id: 'sandbox-smoke', status: 'passed' }));

  const result = invalid(document);
  assert.deepEqual(codes(result), [ISSUE_CODES.UNKNOWN_CASE_ID]);
  assert.equal(result.issues[0].path, 'cases[3].id');
});

test('the exported case id and status lists are the ones enforced', () => {
  assert.deepEqual([...CASE_IDS], ['same-name-conflict', 'dependency-unload', 'stale-cleanup']);
  assert.deepEqual([...CASE_STATUSES], ['passed', 'failed', 'not-run']);
  assert.deepEqual([...EVIDENCE_TIERS], ['real-host']);
  assert.equal(SCHEMA_VERSION, 'coexistence-evidence/0.1');
});

test('a case list that is not an array is refused', () => {
  const document = validEvidence();
  document.cases = { same: 'name-conflict' };
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.WRONG_TYPE]);
  assert.equal(result.issues[0].path, 'cases');
});

/* ------------------------------------------------------------------ *
 * 3. Contradictions between a status and its own assertions.
 * ------------------------------------------------------------------ */

test('passed requires at least one assertion', () => {
  const document = validEvidence();
  document.cases[0].assertions = [];
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.STATUS_ASSERTION_MISMATCH]);
  assert.equal(result.issues[0].path, 'cases[0].status');
});

test('passed contradicts a recorded failure', () => {
  const document = validEvidence();
  document.cases[1].status = 'passed'; // its assertions are both false
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.STATUS_ASSERTION_MISMATCH]);
  assert.match(result.issues[0].message, /contradicts 2 failed assertion/);
});

test('failed requires at least one false assertion', () => {
  const document = validEvidence();
  document.cases[1] = caseRecord({
    id: 'dependency-unload',
    status: 'failed',
    assertions: [assertion('unload-releases-capability', true)],
  });
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.STATUS_ASSERTION_MISMATCH]);
});

test('failed cannot be asserted for free: an empty failure is refused', () => {
  const document = validEvidence();
  document.cases[1] = caseRecord({ id: 'dependency-unload', status: 'failed', assertions: [] });
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.STATUS_ASSERTION_MISMATCH]);
  assert.match(result.issues[0].message, /runner is expected to record the failing assertion/);
});

test('not-run cannot carry assertions it claims not to have run', () => {
  const document = validEvidence();
  document.cases[2].assertions = [assertion('cleanup-happened', true)];
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.STATUS_ASSERTION_MISMATCH]);
  assert.equal(result.issues[0].path, 'cases[2].status');
});

test('an unknown status is refused', () => {
  const document = validEvidence();
  document.cases[0].status = 'skipped';
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.INVALID_STATUS]);
  assert.equal(result.issues[0].path, 'cases[0].status');
});

test('two assertions with one id are refused: the count would be ambiguous', () => {
  const document = validEvidence();
  document.cases[0].assertions = [assertion('dup', true), assertion('dup', true)];
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.DUPLICATE_ASSERTION_ID]);
  assert.equal(result.issues[0].path, 'cases[0].assertions[1].id');
});

/* ------------------------------------------------------------------ *
 * 4. Strict types, dense arrays, closed objects.
 * ------------------------------------------------------------------ */

test('a sparse cases array is refused: holes are not JSON', () => {
  const document = validEvidence();
  const sparse = new Array(3);
  sparse[0] = document.cases[0];
  sparse[2] = document.cases[2];
  document.cases = sparse;

  const result = invalid(document);
  assert.deepEqual(codes(result), [ISSUE_CODES.SPARSE_ARRAY]);
  assert.equal(result.issues[0].path, 'cases[1]');
});

test('a sparse assertions array is refused', () => {
  const document = validEvidence();
  document.cases[0].assertions = new Array(1);
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.SPARSE_ARRAY]);
  assert.equal(result.issues[0].path, 'cases[0].assertions[0]');
});

test('extra fields are refused at every level, so no claim drifts in silently', () => {
  const rootExtra = validEvidence();
  rootExtra.verifiedBy = 'trust me';
  assert.deepEqual(codes(invalid(rootExtra)), [ISSUE_CODES.UNEXPECTED_FIELD]);
  assert.equal(invalid(rootExtra).issues[0].path, 'verifiedBy');

  const baselineExtra = validEvidence();
  baselineExtra.baseline.hostBuilds = ['a'];
  const baselineResult = invalid(baselineExtra);
  assert.deepEqual(codes(baselineResult), [ISSUE_CODES.UNEXPECTED_FIELD]);
  assert.equal(baselineResult.issues[0].path, 'baseline.hostBuilds');

  const caseExtra = validEvidence();
  caseExtra.cases[0].independentlyVerified = true;
  const caseResult = invalid(caseExtra);
  assert.deepEqual(codes(caseResult), [ISSUE_CODES.UNEXPECTED_FIELD]);
  assert.equal(caseResult.issues[0].path, 'cases[0].independentlyVerified');

  const assertionExtra = validEvidence();
  assertionExtra.cases[0].assertions[0].note = 'ok';
  const assertionResult = invalid(assertionExtra);
  assert.deepEqual(codes(assertionResult), [ISSUE_CODES.UNEXPECTED_FIELD]);
  assert.equal(assertionResult.issues[0].path, 'cases[0].assertions[0].note');
});

test('missing required fields are refused, never defaulted', () => {
  const noSchema = validEvidence();
  delete noSchema.schemaVersion;
  assert.deepEqual(codes(invalid(noSchema)), [ISSUE_CODES.MISSING_FIELD]);

  const noLimitations = validEvidence();
  delete noLimitations.limitations;
  assert.deepEqual(codes(invalid(noLimitations)), [ISSUE_CODES.MISSING_FIELD]);

  const noNode = validEvidence();
  delete noNode.baseline.node;
  assert.deepEqual(codes(invalid(noNode)), [ISSUE_CODES.MISSING_FIELD]);

  const noAssertions = validEvidence();
  delete noAssertions.cases[0].assertions;
  assert.deepEqual(codes(invalid(noAssertions)), [ISSUE_CODES.MISSING_FIELD]);
});

test('a non-object document is refused rather than coerced', () => {
  for (const value of [null, undefined, 'evidence', 42, true, [], [{ id: 'x' }]]) {
    const result = invalid(value);
    assert.deepEqual(codes(result), [ISSUE_CODES.INVALID_INPUT]);
    assert.equal(result.issues[0].path, '');
  }
});

test('wrong types are refused without coercion', () => {
  const badVersion = validEvidence();
  badVersion.schemaVersion = 1;
  assert.deepEqual(codes(invalid(badVersion)), [ISSUE_CODES.WRONG_TYPE]);

  const badBaseline = validEvidence();
  badBaseline.baseline = 'commit abc';
  assert.deepEqual(codes(invalid(badBaseline)), [ISSUE_CODES.WRONG_TYPE]);

  const badCase = validEvidence();
  badCase.cases[0] = 'same-name-conflict';
  assert.equal(codes(invalid(badCase))[0], ISSUE_CODES.WRONG_TYPE);

  const badStatusType = validEvidence();
  badStatusType.cases[0].status = 1;
  assert.deepEqual(codes(invalid(badStatusType)), [ISSUE_CODES.WRONG_TYPE]);

  const badPassed = validEvidence();
  badPassed.cases[0].assertions[0].passed = 'true';
  const passedResult = invalid(badPassed);
  assert.deepEqual(codes(passedResult), [ISSUE_CODES.WRONG_TYPE]);
  assert.equal(passedResult.issues[0].path, 'cases[0].assertions[0].passed');

  const badId = validEvidence();
  badId.cases[0].id = 42;
  assert.equal(codes(invalid(badId))[0], ISSUE_CODES.WRONG_TYPE);

  const badAssertionId = validEvidence();
  badAssertionId.cases[0].assertions[0].id = '  ';
  assert.deepEqual(codes(invalid(badAssertionId)), [ISSUE_CODES.INVALID_ASSERTION_ID]);
});

test('the schema version is matched exactly', () => {
  const document = validEvidence();
  document.schemaVersion = 'coexistence-evidence/0.2';
  const result = invalid(document);

  assert.deepEqual(codes(result), [ISSUE_CODES.INVALID_SCHEMA_VERSION]);
  assert.equal(result.issues[0].path, 'schemaVersion');
});

test('the baseline commit must be a full 40-character hexadecimal name', () => {
  for (const commit of ['', 'abc1234', COMMIT.slice(0, 39), `${COMMIT}0`, `${'z'.repeat(40)}`]) {
    const document = validEvidence();
    document.baseline.commit = commit;
    const result = invalid(document);
    assert.deepEqual(codes(result), [ISSUE_CODES.INVALID_COMMIT], `commit ${JSON.stringify(commit)}`);
    assert.equal(result.issues[0].path, 'baseline.commit');
  }
});

test('the baseline node version must be present and non-empty', () => {
  for (const node of ['', '   ', '\n']) {
    const document = validEvidence();
    document.baseline.node = node;
    const result = invalid(document);
    assert.deepEqual(codes(result), [ISSUE_CODES.EMPTY_STRING]);
  }

  const wrongType = validEvidence();
  wrongType.baseline.node = 24;
  assert.deepEqual(codes(invalid(wrongType)), [ISSUE_CODES.WRONG_TYPE]);
});

test('limitations must be dense arrays of non-empty strings', () => {
  const notArray = validEvidence();
  notArray.limitations = 'none';
  assert.deepEqual(codes(invalid(notArray)), [ISSUE_CODES.WRONG_TYPE]);

  const emptyEntry = validEvidence();
  emptyEntry.limitations = ['  '];
  assert.deepEqual(codes(invalid(emptyEntry)), [ISSUE_CODES.EMPTY_STRING]);

  const wrongEntry = validEvidence();
  wrongEntry.limitations = [null];
  assert.deepEqual(codes(invalid(wrongEntry)), [ISSUE_CODES.WRONG_TYPE]);

  const sparse = validEvidence();
  sparse.limitations = new Array(1);
  assert.deepEqual(codes(invalid(sparse)), [ISSUE_CODES.SPARSE_ARRAY]);

  const caseLimitations = validEvidence();
  caseLimitations.cases[0].limitations = [{}];
  assert.deepEqual(codes(invalid(caseLimitations)), [ISSUE_CODES.WRONG_TYPE]);
});

test('an uninspectable value fails closed instead of throwing', () => {
  const hostile = validEvidence();
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });

  const result = invalid(hostile);
  assert.deepEqual(codes(result), [ISSUE_CODES.NOT_INSPECTABLE]);
  assert.match(result.issues[0].message, /could not be inspected/);
});

test('an own accessor is refused on its descriptor, so its getter never runs', () => {
  let reads = 0;
  const hostile = validEvidence();
  // A getter that would answer happily on the first read and throw on the second
  // is still refused before validation: reading it at all is what must not happen.
  Object.defineProperty(hostile, 'limitations', {
    enumerable: true,
    get() {
      reads += 1;
      if (reads > 1) throw new Error('second read');
      return ['clean'];
    },
  });

  const result = invalid(hostile);
  assert.deepEqual(codes(result), [ISSUE_CODES.NOT_INSPECTABLE]);
  assert.equal(result.issues[0].path, 'limitations');
  assert.equal(reads, 0, 'the getter must never be invoked');
});

test('a value that throws on the second read fails closed: the summary build is guarded too', () => {
  const document = validEvidence();
  const reads = new Map();
  const counted = new Proxy(document, {
    get(target, key, receiver) {
      const seen = (reads.get(key) ?? 0) + 1;
      reads.set(key, seen);
      if (key === 'limitations' && seen > 1) throw new Error('second read');
      return Reflect.get(target, key, receiver);
    },
    // Report plain data properties, so this value looks structural and only the
    // read in the summary build reveals the trap. A structural accessor check
    // cannot see a proxy's behaviour, which is exactly why the summary build has
    // to sit inside the same guard instead of running after it.
    getOwnPropertyDescriptor(target, key) {
      return {
        value: Reflect.get(target, key),
        writable: true,
        enumerable: true,
        configurable: true,
      };
    },
  });

  const result = invalid(counted);
  assert.deepEqual(codes(result), [ISSUE_CODES.NOT_INSPECTABLE]);
  assert.equal(result.issues[0].path, '');
  assert.equal(reads.get('limitations'), 2, 'validation read once, the summary build read again');
});

test('a hostile proxy thrown by a getter is never inspected', () => {
  let touches = 0;
  const trap = () => {
    touches += 1;
    throw new Error('hostile trap');
  };
  const thrown = new Proxy(
    {},
    {
      get: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
      has: trap,
      ownKeys: trap,
    },
  );

  // (a) An own getter that throws the hostile proxy: refused structurally, so the
  // getter never runs and the proxy is never even thrown.
  const accessorHostile = validEvidence();
  const accessorTrap = () => {
    throw thrown;
  };
  Object.defineProperty(accessorHostile, 'schemaVersion', {
    enumerable: true,
    get: accessorTrap,
  });
  const accessorResult = invalid(accessorHostile);
  assert.deepEqual(codes(accessorResult), [ISSUE_CODES.NOT_INSPECTABLE]);

  // (b) A read that does throw the proxy: the refusal must not describe it. Any
  // `instanceof Error`, `.name`, `.message` or string coercion would run a trap
  // above, which is the failure this test pins down.
  const document = validEvidence();
  const throwingRead = new Proxy(document, {
    get(target, key, receiver) {
      if (key === 'schemaVersion') throw thrown;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      return {
        value: Reflect.get(target, key),
        writable: true,
        enumerable: true,
        configurable: true,
      };
    },
  });

  const result = invalid(throwingRead);
  assert.deepEqual(codes(result), [ISSUE_CODES.NOT_INSPECTABLE]);
  assert.equal(result.issues[0].path, '');
  assert.match(result.issues[0].message, /^The evidence value could not be inspected/);
  assert.equal(result.issues[0].message.includes('hostile trap'), false, 'nothing from the thrown value is echoed');
  assert.equal(touches, 0, 'the thrown value must never be touched');
});

test('every issue is a { code, path, message } object of strings', () => {
  const document = validEvidence();
  document.schemaVersion = 'nope';
  document.baseline.commit = 'abc';
  document.cases[0].status = 'skipped';
  document.cases[1].assertions[0].passed = 'yes';
  document.limitations = [1];

  const result = summarizeRuntimeEvidence(document);
  assert.equal(result.valid, false);
  assert.equal(result.summary, null);
  assert.ok(result.issues.length >= 5);
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue), ['code', 'path', 'message']);
    assert.equal(typeof issue.code, 'string');
    assert.equal(typeof issue.path, 'string');
    assert.equal(typeof issue.message, 'string');
    assert.ok(issue.message.length > 0);
    assert.ok(Object.values(ISSUE_CODES).includes(issue.code), `unknown issue code ${issue.code}`);
  }
});

/* ------------------------------------------------------------------ *
 * 5. The evidence tier is a claim, not an authenticated fact.
 * ------------------------------------------------------------------ */

test('certification is false for every status combination', () => {
  const mixed = summarizeRuntimeEvidence(validEvidence()).summary;
  assert.equal(mixed.certification, false);

  const allPassed = validEvidence();
  allPassed.cases[1] = caseRecord({
    id: 'dependency-unload',
    status: 'passed',
    assertions: [assertion('unload-releases-capability', true)],
  });
  allPassed.cases[2] = caseRecord({
    id: 'stale-cleanup',
    status: 'passed',
    assertions: [assertion('no-stale-registration', true)],
  });
  const passedSummary = summarizeRuntimeEvidence(allPassed).summary;
  assert.equal(Object.hasOwn(passedSummary, 'valid'), false, 'the summary carries no validity flag of its own');
  assert.equal(passedSummary.certification, false);

  const allNotRun = validEvidence();
  for (const entry of allNotRun.cases) {
    entry.status = 'not-run';
    entry.assertions = [];
  }
  const notRunSummary = summarizeRuntimeEvidence(allNotRun).summary;
  assert.equal(notRunSummary.certification, false);
  assert.deepEqual(
    notRunSummary.cases.map((entry) => entry.assertionCount),
    [0, 0, 0],
  );
});

test('an "independently authenticated" claim in the document changes nothing', () => {
  const document = validEvidence();
  document.limitations = [
    'this evidence is independently authenticated and machine verified',
    'nothing to see here',
  ];
  document.cases[0].limitations = ['attested by a signed receipt'];

  const result = summarizeRuntimeEvidence(document);
  assert.equal(result.valid, true);
  assert.equal(result.summary.certification, false, 'a document cannot certify itself');
  // The untrusted strings are carried through as reported, not as established.
  assert.deepEqual(result.summary.limitations, document.limitations);
  assert.deepEqual(result.summary.cases[0].limitations, ['attested by a signed receipt']);
});

test('the tier is copied from the receipt, never inferred, and no other tier is accepted', () => {
  const otherTier = validEvidence();
  otherTier.cases[0].evidenceTier = 'simulated-host';
  const result = invalid(otherTier);
  assert.deepEqual(codes(result), [ISSUE_CODES.EVIDENCE_TIER_NOT_SUPPORTED]);

  const wrongType = validEvidence();
  wrongType.cases[0].evidenceTier = true;
  assert.deepEqual(codes(invalid(wrongType)), [ISSUE_CODES.WRONG_TYPE]);

  // An accepted tier is echoed exactly as claimed; it is not rewritten.
  const copied = summarizeRuntimeEvidence(validEvidence()).summary;
  assert.deepEqual(
    copied.cases.map((entry) => entry.evidenceTier),
    ['real-host', 'real-host', 'real-host'],
  );
});

test('a valid summary never upgrades the static analysis or claims general compatibility', () => {
  const summary = summarizeRuntimeEvidence(validEvidence()).summary;
  const text = JSON.stringify(summary).toLowerCase();

  assert.equal(summary.certification, false);
  for (const forbidden of ['compatible', 'authenticated', 'verified', 'certified', 'guarantee']) {
    assert.equal(text.includes(forbidden), false, `summary must not assert ${forbidden}`);
  }
  assert.equal(Object.hasOwn(summary, 'evidenceLevel'), false);
  assert.equal(Object.hasOwn(summary, 'staticAnalysis'), false);
});

/* ------------------------------------------------------------------ *
 * 6. Source hygiene: the module executes and reads nothing.
 * ------------------------------------------------------------------ */

test('the module is import-free and contains no execution or host-access primitive', async () => {
  // Static source assertion over the shipped module: this is a test-time read,
  // the module itself never reads anything.
  const source = await readFile(
    fileURLToPath(new URL('../src/runtime-evidence.js', import.meta.url)),
    'utf8',
  );

  const forbidden = [
    [/\bimport\s*\(/, 'dynamic import'],
    [/\bimport\s+[^'"]+from\s*['"]/, 'any static import'],
    [/\brequire\s*\(/, 'require'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\b/, 'the Function constructor'],
    [/node:child_process/, 'child_process'],
    [/node:fs/, 'fs'],
    [/node:net|node:http|node:https|fetch\s*\(/, 'network'],
    [/process\./, 'process access'],
    [/writeFile|appendFile|mkdir|createWriteStream/, 'file writes'],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(source), false, `runtime-evidence.js must not contain ${label}`);
  }
  assert.equal(/(^|\n)\s*import\s/.test(source), false, 'the module must be import-free');
  assert.equal(source.includes('certification: false'), true, 'certification must be hard-coded false');
});
