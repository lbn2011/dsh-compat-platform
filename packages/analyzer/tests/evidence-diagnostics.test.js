/**
 * Tests for `src/evidence-diagnostics.js`.
 *
 * These tests are written but NOT RUN as part of this change. They state the
 * contract only: `diagnoseRuntimeEvidence` delegates schema validation to
 * `summarizeRuntimeEvidence`, adds per-case findings for `failed` / `not-run`,
 * keeps `certification` false, is deterministic, and never mutates its input.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DIAGNOSTIC_CASE_ORDER,
  DIAGNOSTIC_CODES,
  diagnoseRuntimeEvidence,
} from '../src/evidence-diagnostics.js';
import {
  ISSUE_CODES,
  SCHEMA_VERSION,
  summarizeRuntimeEvidence,
} from '../src/runtime-evidence.js';

/* ------------------------------------------------------------------ *
 * Test data. These are documents, not rules: the summarizer decides validity.
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

/** A document where every case passed. */
function allPassedEvidence() {
  const document = validEvidence();
  document.cases[1] = caseRecord({
    id: 'dependency-unload',
    status: 'passed',
    assertions: [assertion('capability-released-after-unload', true)],
  });
  document.cases[2] = caseRecord({
    id: 'stale-cleanup',
    status: 'passed',
    assertions: [assertion('no-stale-registration', true)],
  });
  return document;
}

const codes = (result) => result.findings.map((finding) => finding.code);
const caseIds = (result) => result.findings.map((finding) => finding.caseId);

/* ------------------------------------------------------------------ *
 * 1. The valid path.
 * ------------------------------------------------------------------ */

test('a valid mixed document produces one finding per failed and not-run case', () => {
  const result = diagnoseRuntimeEvidence(validEvidence());

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(codes(result), [DIAGNOSTIC_CODES.RUNTIME_CASE_FAILED, DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN]);
  assert.deepEqual(caseIds(result), ['dependency-unload', 'stale-cleanup']);
  assert.deepEqual(
    result.findings.map((finding) => finding.status),
    ['failed', 'not-run'],
  );
});

test('case ids are preserved exactly as reported', () => {
  const document = validEvidence();
  const result = diagnoseRuntimeEvidence(document);
  const reported = document.cases.map((entry) => entry.id);

  for (const finding of result.findings) {
    assert.equal(reported.includes(finding.caseId), true, `unknown case id echoed: ${finding.caseId}`);
  }
  assert.deepEqual(new Set(caseIds(result)), new Set(['dependency-unload', 'stale-cleanup']));
});

test('a passed case yields no problem finding at all', () => {
  const result = diagnoseRuntimeEvidence(allPassedEvidence());

  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, []);
  assert.equal(Object.isFrozen(result.findings), true);
});

test('an all-passed document is valid, finding-free and still not certified', () => {
  const result = diagnoseRuntimeEvidence(allPassedEvidence());

  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.certification, false);
});

test('an all-not-run document reports every case as unknown, never as a pass', () => {
  const document = validEvidence();
  for (const entry of document.cases) {
    entry.status = 'not-run';
    entry.assertions = [];
  }

  const result = diagnoseRuntimeEvidence(document);
  assert.equal(result.valid, true);
  assert.deepEqual(caseIds(result), ['same-name-conflict', 'dependency-unload', 'stale-cleanup']);
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    [
      DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN,
      DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN,
      DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN,
    ],
  );
});

test('findings are emitted in canonical case order, not report order', () => {
  const document = validEvidence();
  document.cases = [document.cases[2], document.cases[0], document.cases[1]];

  const result = diagnoseRuntimeEvidence(document);
  assert.deepEqual(caseIds(result), ['dependency-unload', 'stale-cleanup']);
  assert.deepEqual(DIAGNOSTIC_CASE_ORDER, ['same-name-conflict', 'dependency-unload', 'stale-cleanup']);
});

/* ------------------------------------------------------------------ *
 * 2. The result shape.
 * ------------------------------------------------------------------ */

test('the result has exactly the documented keys and is frozen throughout', () => {
  const result = diagnoseRuntimeEvidence(validEvidence());

  assert.deepEqual(Object.keys(result), ['valid', 'certification', 'issues', 'findings']);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.issues), true);
  assert.equal(Object.isFrozen(result.findings), true);

  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding), ['code', 'caseId', 'status', 'message']);
    assert.equal(Object.isFrozen(finding), true);
    assert.equal(typeof finding.code, 'string');
    assert.equal(typeof finding.caseId, 'string');
    assert.equal(typeof finding.status, 'string');
    assert.equal(typeof finding.message, 'string');
    assert.ok(finding.message.length > 0);
  }
});

test('every finding code is one of the fixed codes and matches its status', () => {
  const result = diagnoseRuntimeEvidence(validEvidence());

  for (const finding of result.findings) {
    const expected =
      finding.status === 'failed'
        ? DIAGNOSTIC_CODES.RUNTIME_CASE_FAILED
        : DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN;
    assert.equal(finding.code, expected);
    assert.ok(Object.values(DIAGNOSTIC_CODES).includes(finding.code));
  }
});

/* ------------------------------------------------------------------ *
 * 3. Invalid documents: existing issues, no findings.
 * ------------------------------------------------------------------ */

test('an invalid document passes the summarizer issues through and yields no findings', () => {
  const document = validEvidence();
  document.cases = document.cases.filter((entry) => entry.id !== 'stale-cleanup');

  const result = diagnoseRuntimeEvidence(document);
  const expected = summarizeRuntimeEvidence(document);

  assert.equal(result.valid, false);
  assert.equal(result.certification, false);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.issues, expected.issues, 'issues must be the summarizer\'s own, unchanged');
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [ISSUE_CODES.MISSING_CASE_ID],
  );
});

test('a document that is otherwise well formed but has one failure is not diagnosed when invalid', () => {
  // The failure case is present, but an unknown extra field makes the document
  // invalid: no finding may be derived from a document that was not understood.
  const document = validEvidence();
  document.verifiedBy = 'trust me';

  const result = diagnoseRuntimeEvidence(document);
  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [ISSUE_CODES.UNEXPECTED_FIELD],
  );
});

test('a non-object document is refused with the summarizer issue and no findings', () => {
  for (const value of [null, undefined, 'evidence', 42, true, [], [{ id: 'x' }]]) {
    const result = diagnoseRuntimeEvidence(value);
    assert.equal(result.valid, false);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      [ISSUE_CODES.INVALID_INPUT],
    );
  }
});

test('a contradictory status is refused by the summarizer, not re-judged here', () => {
  const document = validEvidence();
  document.cases[0].status = 'passed';
  document.cases[0].assertions = [];

  const result = diagnoseRuntimeEvidence(document);
  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [ISSUE_CODES.STATUS_ASSERTION_MISMATCH],
  );
});

test('every issue in a refusal is a { code, path, message } record', () => {
  const document = validEvidence();
  document.schemaVersion = 'nope';
  document.cases[0].status = 'skipped';

  const result = diagnoseRuntimeEvidence(document);
  assert.equal(result.valid, false);
  assert.ok(result.issues.length >= 2);
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue), ['code', 'path', 'message']);
    assert.equal(typeof issue.code, 'string');
    assert.equal(typeof issue.path, 'string');
    assert.equal(typeof issue.message, 'string');
    assert.ok(Object.values(ISSUE_CODES).includes(issue.code));
  }
});

/* ------------------------------------------------------------------ *
 * 4. Determinism and no mutation.
 * ------------------------------------------------------------------ */

test('diagnosing is deterministic and never mutates its input', () => {
  const document = validEvidence();
  const before = structuredClone(document);

  const first = diagnoseRuntimeEvidence(document);
  const second = diagnoseRuntimeEvidence(document);

  assert.deepEqual(document, before, 'the input document must be untouched');
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('the result does not depend on the order the reporter used', () => {
  const document = validEvidence();
  const reordered = { ...document, cases: [document.cases[2], document.cases[1], document.cases[0]] };

  const first = diagnoseRuntimeEvidence(document);
  const second = diagnoseRuntimeEvidence(reordered);

  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
  assert.deepEqual(second.findings, first.findings);
  assert.equal(JSON.stringify(second.findings), JSON.stringify(first.findings));
});

test('mutating the returned findings cannot affect a later call', () => {
  const document = validEvidence();
  const first = diagnoseRuntimeEvidence(document);

  assert.throws(() => {
    first.findings.push({ code: DIAGNOSTIC_CODES.RUNTIME_CASE_FAILED, caseId: 'stale-cleanup', status: 'failed', message: 'x' });
  }, TypeError);

  const second = diagnoseRuntimeEvidence(document);
  assert.equal(JSON.stringify(second.findings).includes('"x"'), false);
  assert.deepEqual(second.findings, first.findings);
});

test('findings never assert compatibility or certification', () => {
  const result = diagnoseRuntimeEvidence(validEvidence());
  const text = JSON.stringify(result).toLowerCase();

  assert.equal(result.certification, false);
  for (const forbidden of ['compatible', 'authenticated', 'verified', 'certified', 'guarantee']) {
    assert.equal(text.includes(forbidden), false, `diagnostics must not assert ${forbidden}`);
  }
  assert.equal(Object.hasOwn(result, 'compatible'), false);
  assert.equal(Object.hasOwn(result, 'evidenceLevel'), false);
});

test('the evidence tier is a claim: a valid result is still not a certification', () => {
  const document = validEvidence();
  document.limitations = ['this evidence is independently authenticated and machine verified'];
  document.cases[0].limitations = ['attested by a signed receipt'];

  const result = diagnoseRuntimeEvidence(document);
  assert.equal(result.valid, true);
  assert.equal(result.certification, false);
  // The tier string is never promoted into a finding or into the result.
  assert.equal(JSON.stringify(result.findings).includes('real-host'), false);
});

/* ------------------------------------------------------------------ *
 * 5. Source hygiene: delegation only, no execution or host access.
 * ------------------------------------------------------------------ */

test('the module delegates to the existing summarizer and adds no schema of its own', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../src/evidence-diagnostics.js', import.meta.url)),
    'utf8',
  );

  assert.match(
    source,
    /import\s*\{[^}]*summarizeRuntimeEvidence[^}]*\}\s*from\s*'\.\/runtime-evidence\.js'/,
    'the existing summarizer must be imported, not reimplemented',
  );
  assert.match(source, /summarizeRuntimeEvidence\s*\(/, 'it must be called');
  assert.equal(/coexistence-evidence\/0\.1/.test(source), false, 'the schema version is not restated here');
  assert.equal(/SCHEMA_VERSION/.test(source), false, 'no second notion of the schema version');

  const forbidden = [
    [/\bimport\s*\(/, 'dynamic import'],
    [/\brequire\s*\(/, 'require'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\b/, 'the Function constructor'],
    [/node:child_process/, 'child_process'],
    [/node:fs/, 'fs'],
    [/node:net|node:http|node:https|fetch\s*\(/, 'network'],
    [/process\./, 'process access'],
    [/node:crypto|Math\.random|Date\.now|new\s+Date\b/, 'a clock or randomness'],
    [/writeFile|appendFile|mkdir|createWriteStream/, 'file writes'],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(source), false, `evidence-diagnostics.js must not contain ${label}`);
  }
  assert.equal(source.includes('certification: false'), true, 'certification must be hard-coded false');
});
