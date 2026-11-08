/**
 * Tests for `src/diagnose.js`, `src/diagnose-cli.js` and the package-internal
 * assembler `src/diagnose-internal.js`.
 *
 * These are decision tests, not a smoke run: the CLI cases drive `main(argv, io)`
 * with injected sinks and dependencies, so no real host, plugin, driver root or
 * profile is involved. Where a property under test belongs to another module — the
 * lane document schemas, the profile summarizer, the fixed limitation list — the
 * real module is used, because a stub there would only re-assert the stub.
 *
 * `buildDiagnoseReport` is a documented test seam on `io` (production always uses
 * the internal assembler). It isolates *this CLI's own control flow* — partial
 * failure, absence, validator-load ordering, output failure — from the assembler's
 * behaviour. The envelope shape itself is covered by the pure-API tests below,
 * which never touch the seam.
 *
 * Written, not run.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DIAGNOSE_ENTRY_FAILURES,
  DIAGNOSE_EXIT_CODES,
  DIAGNOSE_LIMITATION_CODES,
  DIAGNOSE_NEXT_STEP_CODES,
  DIAGNOSE_SOURCES,
  DIAGNOSE_VERSION,
  LANE_NAMES,
  SOURCE_BY_NAME,
  buildDiagnoseReport,
  diagnoseExitCode,
} from '../src/diagnose.js';
import * as diagnoseModule from '../src/diagnose.js';
import { buildCombinedReport } from '../src/combined-report.js';
import { PROFILE_DUMP_SCHEMA } from '../src/profile-dump.js';
import { main } from '../src/diagnose-cli.js';
// The runtime lane's case catalog is the contract, not a test-local literal: a
// fixture is complete only when it carries exactly these three ids.
import { CASE_IDS as RUNTIME_CASE_IDS } from '../src/runtime-evidence.js';

/* ------------------------------------------------------------------ *
 * Fixtures and helpers.
 * ------------------------------------------------------------------ */

const SCHEMA_VERSION = '0.1.0-draft.1';
const COMMIT = 'b'.repeat(40);

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

/**
 * A complete `coexistence-evidence/0.1` document.
 *
 * `runtime-evidence.js` requires all three `CASE_IDS` to be present exactly once;
 * a document carrying fewer (or other ids) is refused as `invalid`, not read as a
 * poorer summary. `statusById` names the cases reported as `failed`; every other
 * case is `passed`, so a "mixed" fixture is one failed case beside two passes.
 *
 * @param {Record<string, 'failed'>} [statusById]
 */
function runtimeDocument(statusById = {}) {
  return {
    schemaVersion: 'coexistence-evidence/0.1',
    baseline: { commit: COMMIT, node: 'v24.9.0' },
    cases: RUNTIME_CASE_IDS.map((id) =>
      statusById[id] === 'failed' ? failingCase(id) : passingCase(id),
    ),
    limitations: [],
  };
}

function passingCase(id) {
  return {
    id,
    status: 'passed',
    evidenceTier: 'real-host',
    assertions: [{ id: `${id}-observed`, passed: true }],
    limitations: [],
  };
}

function failingCase(id) {
  return {
    id,
    status: 'failed',
    evidenceTier: 'real-host',
    // `assertions` is a closed `{ id, passed }` shape; a `message` field here
    // would make the whole document invalid instead of a failed case.
    assertions: [{ id: `${id}-observed`, passed: false }],
    limitations: [],
  };
}

const acceptAll = () => ({ valid: true, issues: [] });

/**
 * Admission evidence document accepted by `diagnoseAdmissionEvidence`.
 *
 * One `refused` case and fully known coverage: no attention code, so the lane is
 * clear. `refused` is deliberate — it is the status the protocol documents as
 * "not a pass, not a failure", which is exactly what an accepted run looks like.
 */
function admissionEvidence() {
  return {
    schemaVersion: SCHEMA_VERSION,
    certification: false,
    coverage: { required: ['catalog-model'], present: ['catalog-model'], unknown: [] },
    cases: [
      { id: 'catalog-model', status: 'refused', assertionCount: 1, failedAssertions: [], limitations: [] },
    ],
    limitations: [],
  };
}

/** The admission validator shape §6.6 requires: `valid` implies `summary`. */
const acceptAdmission = () => ({
  valid: true,
  issues: [],
  summary: {
    schemaVersion: SCHEMA_VERSION,
    certification: false,
    coverage: { required: ['catalog-model'], present: ['catalog-model'], unknown: [] },
    cases: [
      { id: 'catalog-model', status: 'refused', assertionCount: 1, failedAssertions: [], limitations: [] },
    ],
    limitations: [],
  },
});

/**
 * One exported profile dump with a single user-layer entry.
 *
 * The summarizer accepts only a sequence root (`ROOT_NOT_SEQUENCE` otherwise), so
 * the fixture is a one-row sequence, not a mapping.
 */
const ONE_ENTRY_DUMP = ['- id: alpha', '  name: alpha', ''].join('\n');

/**
 * A minimal *successful* export: a sequence root whose rows are mappings with only
 * literal fields. No tags, no duplicates, no unknown keys — so the summarizer
 * refuses nothing and reports zero entry diagnostics.
 */
const PROFILE_CLEAR_DUMP = ['- id: alpha', '  name: alpha', '- id: beta', '  name: beta', ''].join('\n');

/** A mapping root, which the summarizer refuses with `ROOT_NOT_SEQUENCE`. */
const PROFILE_MAPPING_DUMP = ['a: 1', ''].join('\n');

/** Two documents in one file: the summarizer refuses this as multi-document. */
const MULTI_DOCUMENT_DUMP = 'a: 1\n---\nb: 2\n';

/**
 * A sequence whose row carries a `!!js` value.
 *
 * `JS_EXPRESSION_NOT_EVALUATED` is an informational diagnostic: the value is
 * counted and reported, never evaluated, and the code is not in `ENTRY_CODES`, so
 * it does not raise the entry-diagnostic counter or the outcome.
 */
const JS_ENTRY_DUMP = ['- id: alpha', '  name: alpha', '  config: !!js process.env.HOME', ''].join('\n');

/**
 * A sequence whose single row has a non-string `id`.
 *
 * This is a real entry-level defect (`ENTRY_ID_NOT_STRING`), so it is the fixture
 * that keeps the attention path covered.
 */
const NON_STRING_ID_DUMP = ['- id: 42', '  name: alpha', ''].join('\n');

function blockOf(report, source) {
  return source === 'profile' ? report.profile : report.combinedReport?.channels?.[source] ?? null;
}

/* ------------------------------------------------------------------ *
 * Pure API — the payload-only contract.
 * ------------------------------------------------------------------ */

test('a payload is the only thing the public builder accepts', () => {
  // The failure vocabulary is an output type here. There is no path by which a
  // caller supplies a failure code, and no exported failure constructor.
  assert.equal(diagnoseModule.buildFromOutcomes, undefined);
  assert.throws(() => buildDiagnoseReport({ static: { failure: 'INPUT_READ_FAILED' } }), TypeError);
  assert.throws(() => buildDiagnoseReport({ profile: { failure: 'INPUT_READ_FAILED' } }), TypeError);
  assert.throws(() => buildDiagnoseReport({ static: { document: {}, failure: 'INPUT_READ_FAILED' } }), TypeError);
});

test('an own key holding null or undefined is malformed, never absent', () => {
  assert.throws(() => buildDiagnoseReport({ static: null }), TypeError);
  assert.throws(() => buildDiagnoseReport({ runtime: undefined }), TypeError);
  assert.throws(() => buildDiagnoseReport({ profile: null }), TypeError);
});

test('a non-plain object is refused rather than read as a bag of lanes', () => {
  class Lanes {
    static = { document: staticDocument(declaration('a')) };
  }
  assert.throws(() => buildDiagnoseReport(new Lanes()), TypeError);
  assert.throws(() => buildDiagnoseReport(new Date()), TypeError);
  assert.throws(() => buildDiagnoseReport([]), TypeError);
  assert.throws(() => buildDiagnoseReport(null), TypeError);
});

test('an undocumented key is refused', () => {
  assert.throws(() => buildDiagnoseReport({ profile: { text: 'a: 1' }, host: {} }), TypeError);
  assert.throws(() => buildDiagnoseReport({ static: { document: {}, extra: 1 } }), TypeError);
});

test('a non-enumerable own lane is still seen, and an accessor is refused', () => {
  const input = {};
  Object.defineProperty(input, 'static', {
    value: { document: staticDocument(declaration('a')) },
    enumerable: false,
  });
  const report = buildDiagnoseReport(input, { validateDeclaration: acceptAll });
  assert.equal(report.combinedReport.channels.static.state, 'provided');

  const withAccessor = {};
  Object.defineProperty(withAccessor, 'static', {
    get: () => ({ document: staticDocument(declaration('a')) }),
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => buildDiagnoseReport(withAccessor, { validateDeclaration: acceptAll }), TypeError);
});

test('options are validated whatever sources were named', () => {
  // A profile-only call must not accept options a mixed call would refuse.
  assert.throws(() => buildDiagnoseReport({ profile: { text: ONE_ENTRY_DUMP } }, { nope: true }), TypeError);
  assert.throws(() => buildDiagnoseReport({ profile: { text: ONE_ENTRY_DUMP } }, { validateDeclaration: 1 }), TypeError);
  assert.throws(() => buildDiagnoseReport({}, { validateDeclaration: 'x' }), TypeError);
});

test('an invalid profile payload is refused with fixed text, not summarized', () => {
  assert.throws(() => buildDiagnoseReport({ profile: { text: 42 } }), TypeError);
});

/* ------------------------------------------------------------------ *
 * Pure API — profile block.
 * ------------------------------------------------------------------ */

test('profile-only: one document, no entry diagnostics, clear', () => {
  const report = buildDiagnoseReport({ profile: { text: ONE_ENTRY_DUMP } });

  assert.equal(report.diagnoseVersion, DIAGNOSE_VERSION);
  assert.equal(report.certification, false);
  assert.equal(report.correlation, 'not-established');
  assert.equal(report.combinedReport, null, 'no lane was named, so there is no report');

  assert.equal(report.profile.state, 'provided');
  assert.equal(report.profile.source, SOURCE_BY_NAME.profile);
  assert.equal(report.profile.outcome, 'clear');
  assert.equal(report.profile.entryDiagnostics, 0);
  assert.deepEqual(report.profile.issues, []);

  const summary = report.profile.summary;
  assert.notEqual(summary, null, 'a read summary is present even though nothing is wrong');
  assert.equal(summary.documents, 1);
  assert.equal(summary.root, 'sequence');
  assert.equal(summary.completeness, 'unknown');
  assert.equal(summary.runtimeValidation, 'not-performed');
  assert.equal(summary.certification, false);
  assert.deepEqual(summary.input, { bytes: ONE_ENTRY_DUMP.length, lines: 3 });
  // One row, so the counters are exact rather than merely non-zero.
  assert.equal(summary.counts.entries, 1);
  assert.equal(summary.counts.entriesWithId, 1);
  assert.equal(summary.counts.entriesWithName, 1);
  assert.equal(summary.counts.jsScalars, 0);
  assert.deepEqual(summary.diagnostics, []);

  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.OK);
});

test('a JS value is informational, so it leaves the profile clear', () => {
  const report = buildDiagnoseReport({ profile: { text: JS_ENTRY_DUMP } });

  // `!!js` is counted and reported, never evaluated — and it is not an entry
  // diagnostic, so it moves neither the counter nor the outcome.
  assert.equal(report.profile.outcome, 'clear');
  assert.equal(report.profile.entryDiagnostics, 0);
  assert.deepEqual(report.profile.issues, []);

  const summary = report.profile.summary;
  assert.equal(summary.counts.jsScalars, 1);
  assert.deepEqual(summary.diagnostics.map((diag) => diag.code), ['JS_EXPRESSION_NOT_EVALUATED']);
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.OK);
});

test('a non-string entry id is an entry diagnostic: attention, and the counter decides it', () => {
  const report = buildDiagnoseReport({ profile: { text: NON_STRING_ID_DUMP } });

  assert.equal(report.profile.outcome, 'attention');
  assert.equal(report.profile.entryDiagnostics, 1);
  assert.deepEqual(report.profile.issues.map((i) => i.code), ['PROFILE_ENTRY_DIAGNOSTICS']);
  // The summary keeps its own fixed diagnostics unchanged.
  assert.deepEqual(report.profile.summary.diagnostics.map((diag) => diag.code), ['ENTRY_ID_NOT_STRING']);
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.ATTENTION);
});

test('a refused profile keeps its summary instead of collapsing to a code', () => {
  const report = buildDiagnoseReport({ profile: { text: MULTI_DOCUMENT_DUMP } });

  assert.equal(report.profile.state, 'provided');
  assert.equal(report.profile.outcome, 'invalid');
  assert.deepEqual(report.profile.issues.map((i) => i.code), ['PROFILE_UNUSABLE']);

  // The explanation survives: this is the whole point of not discarding it.
  const summary = report.profile.summary;
  assert.notEqual(summary, null);
  assert.equal(summary.inventory, 'none');
  assert.equal(summary.root, 'unknown');
  assert.equal(summary.counts, null);
  assert.ok(summary.diagnostics.length > 0, 'the refusal diagnostics are kept');
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.INVALID);
});

test('next steps name each cause specifically, and absence changes no exit code', () => {
  const report = buildDiagnoseReport({ profile: { text: MULTI_DOCUMENT_DUMP } });

  const bySource = new Map(report.nextSteps.map((step) => [step.source, step]));
  // One step per source, in the fixed order.
  assert.deepEqual(report.nextSteps.map((step) => step.source), [...DIAGNOSE_SOURCES]);

  assert.equal(bySource.get('profile').code, 'PROFILE_INVALID');
  for (const source of ['static', 'runtime', 'admission']) {
    assert.equal(bySource.get(source).code, 'SOURCE_NOT_PROVIDED');
  }
  for (const step of report.nextSteps) assert.ok(DIAGNOSE_NEXT_STEP_CODES.includes(step.code));

  // Each message is this cause's fixed text. Absence shares one phrase across
  // sources — that is legal — but it must not be the profile's reason.
  assert.match(bySource.get('profile').message, /re-export rather than editing the dump/);
  for (const source of ['static', 'runtime', 'admission']) {
    assert.match(
      bySource.get(source).message,
      /No file was named for this source; the envelope says nothing about it\./,
    );
  }
  assert.notEqual(
    bySource.get('profile').message,
    bySource.get('static').message,
    'a refusal must not be explained by the absence text',
  );

  // The absent sources did not move the code.
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.INVALID);
});

test('nothing named: an all-absent envelope that is still well formed', () => {
  const report = buildDiagnoseReport({});

  assert.equal(report.combinedReport, null);
  assert.equal(report.profile.state, 'absent');
  assert.equal(report.profile.outcome, 'unknown');
  assert.equal(report.profile.summary, null, 'nothing was read, so there is no summary');
  for (const source of LANE_NAMES) assert.equal(blockOf(report, source), null);

  assert.equal(report.nextSteps.length, DIAGNOSE_SOURCES.length);
  for (const step of report.nextSteps) assert.equal(step.code, 'SOURCE_NOT_PROVIDED');

  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.OK, 'absent never yields attention');
});

/* ------------------------------------------------------------------ *
 * Pure API — the embedded combined report.
 * ------------------------------------------------------------------ */

test('one lane: the report is the library output, and only named lanes count', () => {
  const document = staticDocument(declaration('plugin-a'));
  const report = buildDiagnoseReport({ static: { document } }, { validateDeclaration: acceptAll });

  assert.notEqual(report.combinedReport, null);
  assert.equal(report.combinedReport.channels.static.state, 'provided');
  assert.equal(report.combinedReport.channels.static.outcome, 'clear');
  assert.equal(report.combinedReport.channels.runtime.state, 'absent');
  assert.equal(report.combinedReport.channels.admission.state, 'absent');

  // Nothing named for the profile either.
  assert.equal(report.profile.state, 'absent');

  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.OK, 'absent lanes are not attention');
});

test('the lane result is preserved verbatim, and so is the library limitation list', () => {
  const document = staticDocument(declaration('plugin-a'));
  const report = buildDiagnoseReport({ static: { document } }, { validateDeclaration: acceptAll });

  const direct = buildCombinedReport(
    { static: { source: SOURCE_BY_NAME.static, document } },
    { validateDeclaration: acceptAll },
  );

  assert.deepEqual(report.combinedReport.channels.static.result, direct.channels.static.result);
  assert.deepEqual(report.limitations.slice(0, direct.limitations.length), direct.limitations);
  assert.deepEqual(report.limitations.slice(direct.limitations.length), [...DIAGNOSE_LIMITATION_CODES]);
});

test('mixed: attention on one lane outranks clear on another', () => {
  const report = buildDiagnoseReport(
    {
      profile: { text: ONE_ENTRY_DUMP },
      static: { document: staticDocument(declaration('plugin-a')) },
      runtime: { document: runtimeDocument({ 'dependency-unload': 'failed' }) },
    },
    { validateDeclaration: acceptAll },
  );

  assert.equal(report.profile.outcome, 'clear');
  assert.equal(blockOf(report, 'static').outcome, 'clear');
  assert.equal(blockOf(report, 'runtime').outcome, 'attention');

  // The mixed document carries all three contract cases: exactly one failed.
  const cases = blockOf(report, 'runtime').result.summary.cases;
  assert.deepEqual(cases.map((entry) => entry.id), [...RUNTIME_CASE_IDS]);
  assert.deepEqual(cases.map((entry) => entry.status), ['passed', 'failed', 'passed']);

  const bySource = new Map(report.nextSteps.map((step) => [step.source, step]));
  assert.equal(bySource.get('runtime').code, 'RUNTIME_ATTENTION');
  assert.equal(bySource.has('profile'), false, 'a clear source gets no step');
  assert.equal(bySource.has('static'), false);
  assert.equal(bySource.get('admission').code, 'SOURCE_NOT_PROVIDED');

  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.ATTENTION);
});

test('a named lane holding undefined is provided-invalid, not absent', () => {
  const report = buildDiagnoseReport({ static: { document: undefined } }, { validateDeclaration: acceptAll });

  const channel = report.combinedReport.channels.static;
  assert.equal(channel.state, 'provided', 'the lane was named, so it is not absent');
  assert.equal(channel.outcome, 'invalid');
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.INVALID);
});

test('a lane document the validator rejects makes the channel invalid', () => {
  const report = buildDiagnoseReport(
    { static: { document: staticDocument(declaration('plugin-a')) } },
    { validateDeclaration: () => ({ valid: false, issues: [{ code: 'NOT_A_DECLARATION', message: 'x' }] }) },
  );

  const channel = blockOf(report, 'static');
  assert.equal(channel.outcome, 'invalid');
  // The rejection is reported under the lane's own fixed code, and the analysis is
  // explicitly incomplete rather than silently downgraded.
  assert.deepEqual(channel.issues.map((issue) => issue.code), ['INVALID_DECLARATION']);
  assert.equal(channel.result.summary.analysisComplete, false);
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.INVALID);
});

/* ------------------------------------------------------------------ *
 * Exit-code mapper — shape validation.
 * ------------------------------------------------------------------ */

test('the mapper refuses a block whose state or outcome is outside its closed set', () => {
  const report = buildDiagnoseReport({ profile: { text: ONE_ENTRY_DUMP } });

  const typoState = { ...report, profile: { ...report.profile, state: 'present' } };
  assert.throws(() => diagnoseExitCode(typoState), TypeError);

  const typoOutcome = { ...report, profile: { ...report.profile, outcome: 'cleer' } };
  assert.throws(() => diagnoseExitCode(typoOutcome), TypeError);

  // An absent block claiming an outcome other than `unknown` is malformed too.
  const badAbsent = { ...report, profile: { state: 'absent', source: null, outcome: 'clear', issues: [] } };
  assert.throws(() => diagnoseExitCode(badAbsent), TypeError);

  assert.throws(() => diagnoseExitCode({}), TypeError);
  assert.throws(() => diagnoseExitCode(null), TypeError);
});

test('a provided block that established nothing is never clear', () => {
  const report = buildDiagnoseReport({ profile: { text: ONE_ENTRY_DUMP } });
  const nothingKnown = { ...report, profile: { ...report.profile, outcome: 'unknown' } };
  assert.equal(diagnoseExitCode(nothingKnown), DIAGNOSE_EXIT_CODES.INVALID);
});

/** A real envelope with all four sources provided and clear. */
function fullReport() {
  return buildDiagnoseReport(
    {
      profile: { text: PROFILE_CLEAR_DUMP },
      static: { document: staticDocument(declaration('plugin-a')) },
      runtime: { document: runtimeDocument() },
      admission: { document: admissionEvidence() },
    },
    { validateDeclaration: acceptAll, validateAdmissionEvidence: acceptAdmission },
  );
}

test('the mapper never fills in a missing or null channel', () => {
  const report = fullReport();
  assert.equal(diagnoseExitCode(report), DIAGNOSE_EXIT_CODES.OK, 'the intact envelope is clear');

  // A non-null combined report must carry all three lanes as own properties. The
  // assembler's own `blockFor` substitutes an absent block here; the exit entry
  // must not, or a truncated report would read as "nothing was asked".
  const missing = structuredClone(report);
  delete missing.combinedReport.channels.static;
  assert.throws(() => diagnoseExitCode(missing), TypeError);

  const nulled = structuredClone(report);
  nulled.combinedReport.channels.runtime = null;
  assert.throws(() => diagnoseExitCode(nulled), TypeError);

  const undefinedChannel = structuredClone(report);
  undefinedChannel.combinedReport.channels.admission = undefined;
  assert.throws(() => diagnoseExitCode(undefinedChannel), TypeError);

  const notARecord = structuredClone(report);
  notARecord.combinedReport.channels = [];
  assert.throws(() => diagnoseExitCode(notARecord), TypeError);

  const noChannels = structuredClone(report);
  delete noChannels.combinedReport.channels;
  assert.throws(() => diagnoseExitCode(noChannels), TypeError);
});

test('an absent block must carry exactly outcome "unknown"', () => {
  const report = buildDiagnoseReport({ profile: { text: PROFILE_CLEAR_DUMP } });
  assert.equal(report.combinedReport, null);

  const missingOutcome = { ...report, profile: { state: 'absent', source: null, issues: [] } };
  assert.throws(() => diagnoseExitCode(missingOutcome), TypeError);

  const undefinedOutcome = { ...report, profile: { state: 'absent', source: null, outcome: undefined, issues: [] } };
  assert.throws(() => diagnoseExitCode(undefinedOutcome), TypeError);

  const claimedOutcome = { ...report, profile: { state: 'absent', source: null, outcome: 'clear', issues: [] } };
  assert.throws(() => diagnoseExitCode(claimedOutcome), TypeError);
});

test('the mapper checks the envelope itself, not just the blocks', () => {
  const report = fullReport();

  for (const tamper of [
    (copy) => { copy.diagnoseVersion = 'dsh-compat-diagnose/9.9'; },
    (copy) => { copy.certification = true; },
    (copy) => { copy.correlation = 'established'; },
    (copy) => { delete copy.profile; },
    (copy) => { copy.nextSteps = null; },
    (copy) => { copy.combinedReport = undefined; },
    (copy) => { copy.combinedReport = { channels: {} }; },
    (copy) => { copy.profile = null; },
    (copy) => { copy.profile = { state: 'provided' }; },
  ]) {
    const damaged = structuredClone(report);
    tamper(damaged);
    assert.throws(() => diagnoseExitCode(damaged), TypeError);
  }
});

test('a state typo on a combined channel is refused, not skipped into 0', () => {
  const report = fullReport();

  const typo = structuredClone(report);
  typo.combinedReport.channels.runtime.state = 'provide';
  assert.throws(() => diagnoseExitCode(typo), TypeError);

  const typoOutcome = structuredClone(report);
  typoOutcome.combinedReport.channels.static.outcome = 'cleer';
  assert.throws(() => diagnoseExitCode(typoOutcome), TypeError);
});

/* ------------------------------------------------------------------ *
 * CLI harness.
 * ------------------------------------------------------------------ */

/** Fixed envelope shape the assembler is specified to emit, for seam tests only. */
function stubEnvelope(outcomes) {
  const channels = {};
  let named = 0;
  for (const lane of LANE_NAMES) {
    const outcome = outcomes[lane];
    if (outcome === undefined) {
      channels[lane] = { state: 'absent', source: null, outcome: 'unknown', result: null, issues: [] };
      continue;
    }
    named += 1;
    if (outcome.failure !== undefined) {
      channels[lane] = {
        state: 'provided',
        source: SOURCE_BY_NAME[lane],
        outcome: outcome.failure === 'VALIDATOR_LOAD_FAILED' ? 'error' : 'invalid',
        result: null,
        issues: [{ code: outcome.failure }],
      };
      continue;
    }
    channels[lane] = { state: 'provided', source: SOURCE_BY_NAME[lane], outcome: 'clear', result: {}, issues: [] };
  }

  const profileOutcome = outcomes.profile;
  const profile =
    profileOutcome === undefined
      ? { state: 'absent', source: null, outcome: 'unknown', issues: [], summary: null, entryDiagnostics: 0 }
      : {
          state: 'provided',
          source: SOURCE_BY_NAME.profile,
          outcome: profileOutcome.failure === undefined ? 'clear' : 'invalid',
          issues: profileOutcome.failure === undefined ? [] : [{ code: profileOutcome.failure }],
          summary: null,
          entryDiagnostics: 0,
        };

  // The seam stub stands in for the assembler, so it must carry the projection the
  // assembler emits; otherwise every seam test would fail on a missing field rather
  // than on the behaviour it is testing. Words are derived the same way the
  // assembler derives them: nothing is recorded but a real runtime receipt.
  const provenance = DIAGNOSE_SOURCES.map((slot) => {
    const block = slot === "profile" ? profile : (channels[slot] === undefined ? null : channels[slot]);
    if (block === null || block.state !== "provided") {
      return { source: SOURCE_BY_NAME[slot], baselineState: "not-provided", commit: null, node: null };
    }
    if (block.outcome === "invalid" || block.outcome === "error") {
      return { source: SOURCE_BY_NAME[slot], baselineState: "not-readable", commit: null, node: null };
    }
    return { source: SOURCE_BY_NAME[slot], baselineState: "not-reflected", commit: null, node: null };
  });

  return {
    diagnoseVersion: DIAGNOSE_VERSION,
    certification: false,
    correlation: 'not-established',
    profile,
    combinedReport:
      named === 0
        ? null
        : {
            reportVersion: 'combined-report/0.1-draft.1',
            certification: false,
            correlation: 'not-established',
            channels,
            limitations: [],
          },
    provenance,
    nextSteps: [],
    limitations: [],
  };
}

/**
 * A fake `io`.
 *
 * `files` maps path -> text; a path missing from it refuses the way the bounded
 * reader does. `modules` maps a *suffix* of the resolved specifier -> namespace,
 * because the CLI resolves `./v.js` to an absolute `file:` URL before loading it.
 * `build: 'real'` omits the seam so the real internal assembler runs.
 */
function makeIo({ files = {}, modules = {}, build, failStdout = false, failStderr = false } = {}) {
  const stdout = [];
  const stderr = [];
  const loads = [];
  const reads = [];

  const io = {
    stdout: (text) => {
      if (failStdout) throw new Error('stdout is gone');
      stdout.push(text);
    },
    stderr: (text) => {
      if (failStderr) throw new Error('stderr is gone');
      stderr.push(text);
    },
    readFile: (path) => {
      reads.push(path);
      if (!Object.hasOwn(files, path)) {
        const error = new Error('Unable to read the named file.');
        error.code = 'ENOENT';
        throw error;
      }
      return files[path];
    },
    loadModule: async (target) => {
      loads.push(target);
      const key = Object.keys(modules).find((candidate) => target === candidate || target.endsWith(candidate));
      if (key === undefined) throw new Error('Unable to load module.');
      const value = modules[key];
      if (value === 'throw') throw new Error('Unable to load module.');
      return value;
    },
  };

  if (build !== 'real') {
    const builder = build ?? stubEnvelope;
    io.buildDiagnoseReport = async (outcomes, validators) => builder(outcomes, validators);
  }

  return { io, stdout, stderr, loads, reads };
}

function jsonLines(text) {
  return text.trimEnd().split('\n');
}

/* ------------------------------------------------------------------ *
 * CLI — usage.
 * ------------------------------------------------------------------ */

test('usage: no input is a usage refusal, not an empty report', async () => {
  const { io, stdout, stderr } = makeIo();

  const code = await main([], io);

  assert.equal(code, DIAGNOSE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonLines(stdout.join('')), ['{"error":{"code":"USAGE"}}']);
  assert.match(stderr[0], /diagnose-cli: at least one of/);
  assert.match(stderr.join(''), /Usage:/);
});

test('usage: an unknown flag, a positional argument and "-" are each refused', async () => {
  for (const argv of [['--host', 'x'], ['dump.yml'], ['--profile', '-'], ['--profile']]) {
    const { io, stdout } = makeIo();
    const code = await main(argv, io);
    assert.equal(code, DIAGNOSE_EXIT_CODES.USAGE, `argv ${JSON.stringify(argv)}`);
    assert.deepEqual(jsonLines(stdout.join('')), ['{"error":{"code":"USAGE"}}']);
  }
});

test('usage: each source at most once', async () => {
  const { io } = makeIo({ files: { 'a.yml': ONE_ENTRY_DUMP, 'b.yml': ONE_ENTRY_DUMP } });

  assert.equal(
    await main(['--profile', 'a.yml', '--profile', 'b.yml'], io),
    DIAGNOSE_EXIT_CODES.USAGE,
  );
});

test('usage: a validator flag needs its lane, and a lane needs its validator', async () => {
  const first = makeIo();
  assert.equal(
    await main(['--profile', 'a.yml', '--declaration-validator', './v.js'], first.io),
    DIAGNOSE_EXIT_CODES.USAGE,
  );

  const second = makeIo({ files: { 's.json': '{}' } });
  assert.equal(await main(['--static', 's.json'], second.io), DIAGNOSE_EXIT_CODES.USAGE);
  assert.equal(second.reads.length, 0, 'a usage error must not open a document');
});

test('a usage run whose sinks both fail is exit 5, with nothing claimed on stderr', async () => {
  const { io, stderr } = makeIo({ failStdout: true, failStderr: true });
  assert.equal(await main([], io), DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.equal(stderr.length, 0);
});

test('--help writes help to stderr and no report to stdout', async () => {
  const { io, stdout, stderr } = makeIo();

  const code = await main(['--help'], io);

  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(''), /Exit codes:/);
});

/* ------------------------------------------------------------------ *
 * CLI — reading, isolation, validator ordering.
 * ------------------------------------------------------------------ */

test('a successful run writes exactly one JSON document and a fixed summary', async () => {
  const { io, stdout, stderr } = makeIo({
    files: { 'p.yml': ONE_ENTRY_DUMP, 's.json': '{}', 'r.json': '{}' },
    modules: { 'v.js': { validateDeclaration: acceptAll } },
  });

  const code = await main(
    ['--profile', 'p.yml', '--static', 's.json', '--declaration-validator', './v.js', '--runtime', 'r.json'],
    io,
  );

  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);
  const lines = jsonLines(stdout.join(''));
  assert.equal(lines.length, 1, 'exactly one line, exactly one document');
  assert.equal(JSON.parse(lines[0]).diagnoseVersion, DIAGNOSE_VERSION);

  const summary = stderr.join('');
  assert.match(summary, /^diagnose-cli: provided=3 absent=1 clear=3 attention=0 invalid=0 error=0 next_steps=0$/m);
  // No path and no document text reaches stderr.
  assert.equal(summary.includes('p.yml'), false);
  assert.equal(summary.includes('a: 1'), false);
});

test('a read failure on one source keeps the others', async () => {
  const { io, stdout } = makeIo({
    files: { 's.json': '{}', 'r.json': '{}' },
    modules: { 'v.js': { validateDeclaration: acceptAll } },
  });

  const code = await main(
    ['--profile', 'missing.yml', '--static', 's.json', '--declaration-validator', './v.js', '--runtime', 'r.json'],
    io,
  );

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.profile.outcome, 'invalid');
  assert.deepEqual(report.profile.issues.map((i) => i.code), [DIAGNOSE_ENTRY_FAILURES.INPUT_READ_FAILED]);
  assert.equal(report.combinedReport.channels.static.outcome, 'clear');
  assert.equal(report.combinedReport.channels.runtime.outcome, 'clear');
  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});

test('a validator is imported only after its lane document parsed', async () => {
  const { io, stdout, loads } = makeIo({
    files: { 'bad.json': 'not json at all' },
    modules: { 'v.js': { validateDeclaration: acceptAll } },
  });

  const code = await main(['--static', 'bad.json', '--declaration-validator', './v.js'], io);

  assert.deepEqual(loads, [], 'the module must not be imported for an unparsable document');
  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.deepEqual(report.combinedReport.channels.static.issues.map((i) => i.code), [
    DIAGNOSE_ENTRY_FAILURES.INPUT_JSON_INVALID,
  ]);
  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID, 'a parse failure is not a validator failure');
});

test('a validator that cannot be loaded is a usage-level failure', async () => {
  const { io, stdout } = makeIo({
    files: { 's.json': '{}' },
    modules: { 'v.js': 'throw' },
  });

  const code = await main(['--static', 's.json', '--declaration-validator', './v.js'], io);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.deepEqual(report.combinedReport.channels.static.issues.map((i) => i.code), [
    DIAGNOSE_ENTRY_FAILURES.VALIDATOR_LOAD_FAILED,
  ]);
  assert.equal(report.combinedReport.channels.static.outcome, 'error');
  assert.equal(code, DIAGNOSE_EXIT_CODES.USAGE, 'validator load outranks invalid');
});

test('a module that lacks the fixed export is a load failure, not a silent pass', async () => {
  const { io } = makeIo({
    files: { 's.json': '{}' },
    modules: { 'v.js': { somethingElse: acceptAll } },
  });

  assert.equal(
    await main(['--static', 's.json', '--declaration-validator', './v.js'], io),
    DIAGNOSE_EXIT_CODES.USAGE,
  );
});

test('the loaded validator is the one the assembler receives', async () => {
  const validate = acceptAll;
  const seen = [];
  const { io } = makeIo({
    files: { 's.json': '{}' },
    modules: { 'v.js': { validateDeclaration: validate } },
    build: (outcomes) => stubEnvelope(outcomes),
  });
  io.buildDiagnoseReport = async (outcomes, validators) => {
    seen.push(validators);
    return stubEnvelope(outcomes);
  };

  await main(['--static', 's.json', '--declaration-validator', './v.js'], io);

  assert.equal(seen.length, 1);
  // The CLI keys validators by the lane's option name: `static` is validated by
  // `validateDeclaration`, and no admission validator was loaded.
  assert.equal(seen[0].validateDeclaration, validate);
  assert.equal(seen[0].validateAdmissionEvidence, undefined);
});

test('all named lanes failing still yields a combined report, never null', async () => {
  const { io, stdout } = makeIo({ files: {} });

  const code = await main(
    [
      '--static', 's.json', '--declaration-validator', './v.js',
      '--runtime', 'r.json',
      '--admission', 'a.json', '--admission-validator', './w.js',
    ],
    io,
  );

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.notEqual(report.combinedReport, null, 'a named lane must not be dropped');
  for (const lane of LANE_NAMES) assert.equal(report.combinedReport.channels[lane].state, 'provided');
  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});

/* ------------------------------------------------------------------ *
 * CLI — output failures.
 * ------------------------------------------------------------------ */

test('a failing stdout is exit 5, never a claim that the report was delivered', async () => {
  const { io, stderr } = makeIo({
    files: { 'p.yml': ONE_ENTRY_DUMP },
    failStdout: true,
  });

  const code = await main(['--profile', 'p.yml'], io);

  assert.equal(code, DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.match(stderr.join(''), /writing the report failed; completeness of the written bytes is not claimed/);
});

test('a failing stderr on the summary line is exit 5', async () => {
  const { io } = makeIo({ files: { 'p.yml': ONE_ENTRY_DUMP }, failStderr: true });

  assert.equal(await main(['--profile', 'p.yml'], io), DIAGNOSE_EXIT_CODES.INTERNAL);
});

test('an unserializable report is exit 5', async () => {
  const { io, stderr } = makeIo({
    files: { 'p.yml': ONE_ENTRY_DUMP },
    build: () => ({ big: 1n }),
  });

  assert.equal(await main(['--profile', 'p.yml'], io), DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.match(stderr.join(''), /could not be serialized/);
});

test('an assembler throw is exit 5 and leaks no text of its own', async () => {
  const { io, stdout, stderr } = makeIo({
    files: { 'p.yml': ONE_ENTRY_DUMP },
    build: () => {
      throw new Error('SECRET internals: /root/.dsh/profile');
    },
  });

  const code = await main(['--profile', 'p.yml'], io);

  assert.equal(code, DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.deepEqual(stdout, []);
  assert.equal(stderr.join('').includes('SECRET'), false);
});

/* ------------------------------------------------------------------ *
 * CLI — a path is not evidence.
 * ------------------------------------------------------------------ */

test('a fixed slot label is reported, never the path that was read', async () => {
  const { io, stdout } = makeIo({ files: { '/tmp/secret/location.yml': ONE_ENTRY_DUMP } });

  await main(['--profile', '/tmp/secret/location.yml'], io);

  const text = stdout.join('');
  assert.equal(text.includes('/tmp/secret'), false);
  assert.equal(text.includes(SOURCE_BY_NAME.profile), true);
});

test('no refusal echoes the caller path either', async () => {
  const { io, stdout, stderr } = makeIo({ files: {} });
  await main(['--profile', '/tmp/secret/location.yml'], io);
  const text = stdout.join('') + stderr.join('');
  assert.equal(text.includes('/tmp/secret'), false);
});

/* ------------------------------------------------------------------ *
 * CLI — end to end through the real assembler.
 * ------------------------------------------------------------------ */

test('a real-envelope profile-only run of a valid export is clear and exits 0', async () => {
  const { io, stdout } = makeIo({ files: { 'p.yml': PROFILE_CLEAR_DUMP }, build: 'real' });

  const code = await main(['--profile', 'p.yml'], io);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.profile.state, 'provided');
  assert.equal(report.profile.outcome, 'clear');
  assert.equal(report.profile.entryDiagnostics, 0);
  assert.deepEqual(report.profile.issues, []);
  assert.equal(report.combinedReport, null, 'no lane was named');

  const summary = report.profile.summary;
  // The version string is the summary module's own; importing it keeps this pass-through test
  // from silently pinning a shape the module no longer emits.
  assert.equal(summary.profileDumpSummary, PROFILE_DUMP_SCHEMA);
  assert.equal(summary.documents, 1);
  assert.equal(summary.root, 'sequence');
  assert.equal(summary.inventory, 'present');
  assert.equal(summary.counts.entries, 2);
  assert.equal(summary.counts.entriesWithId, 2);
  assert.equal(summary.counts.jsScalars, 0);
  assert.deepEqual(summary.diagnostics, []);
  assert.equal(summary.completeness, 'unknown');
  assert.equal(summary.runtimeValidation, 'not-performed');
  assert.equal(summary.certification, false);
  assert.equal(JSON.stringify(summary).includes('alpha'), false, 'no entry id or name reaches the summary');

  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);
  assert.equal(code, diagnoseExitCode(report));
});

test('a real-envelope profile-only run keeps the summary when the root is not a sequence', async () => {
  const { io, stdout } = makeIo({ files: { 'p.yml': PROFILE_MAPPING_DUMP }, build: 'real' });

  const code = await main(['--profile', 'p.yml'], io);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.profile.state, 'provided');
  assert.equal(report.profile.outcome, 'invalid');
  assert.deepEqual(report.profile.issues, [{ code: 'PROFILE_UNUSABLE' }]);

  const summary = report.profile.summary;
  assert.notEqual(summary, null, 'a refusal still carries the measured summary');
  assert.equal(summary.root, 'mapping');
  assert.equal(summary.inventory, 'none');
  assert.equal(summary.diagnostics[0].code, 'ROOT_NOT_SEQUENCE');
  assert.equal(summary.diagnostics[0].line, 1);

  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
  assert.equal(code, diagnoseExitCode(report));
});

test('a real-envelope mixed run keeps a failed lane beside a successful one', async () => {
  const { io, stdout } = makeIo({
    files: { 's.json': JSON.stringify(staticDocument(declaration('plugin-a'))), 'r.json': JSON.stringify(runtimeDocument()) },
    modules: { 'v.js': { validateDeclaration: acceptAll } },
    build: 'real',
  });

  const code = await main(
    ['--static', 's.json', '--declaration-validator', './v.js', '--runtime', 'r.json', '--profile', 'gone.yml'],
    io,
  );

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.profile.outcome, 'invalid');
  assert.equal(report.combinedReport.channels.static.outcome, 'clear');
  // Pinned, not merely "not degraded": all three required fixture cases have status
  // `passed` and the only supported tier `real-host`, which the summarizer maps to
  // clear. If that rule changes, this test must be revisited deliberately.
  assert.equal(report.combinedReport.channels.runtime.state, 'provided');
  assert.equal(report.combinedReport.channels.runtime.outcome, 'clear');
  assert.equal(report.combinedReport.channels.admission.state, 'absent');
  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});

/* ------------------------------------------------------------------ *
 * CLI — real files, real imports, captured sinks only.
 *
 * The `makeIo` cases above inject `readFile` and `loadModule`: they prove this
 * CLI's control flow, not its wiring to the real bounded reader and the real
 * dynamic import. Here only the two sinks are supplied, so the defaults run.
 * These are still `main()` calls in this process — no child process, no host.
 * ------------------------------------------------------------------ */

/** Sinks only: every other dependency is the real default. */
function realIo() {
  const stdout = [];
  const stderr = [];
  return {
    io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    stdout,
    stderr,
  };
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-diagnose-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('real files and a real import: static plus profile is not an internal failure', async (t) => {
  const dir = tempDir(t);
  const staticPath = join(dir, 'static.json');
  const profilePath = join(dir, 'profile.yml');
  const validatorPath = join(dir, 'validator.mjs');

  writeFileSync(staticPath, JSON.stringify(staticDocument(declaration('plugin-a'))));
  writeFileSync(profilePath, PROFILE_CLEAR_DUMP);
  writeFileSync(
    validatorPath,
    'export const validateDeclaration = () => ({ valid: true, issues: [] });\n',
  );

  const { io, stdout, stderr } = realIo();
  const code = await main(
    ['--static', staticPath, '--declaration-validator', validatorPath, '--profile', profilePath],
    io,
  );

  // The wiring defect this pins: `validators[lane]` was keyed by lane name, so a
  // successfully loaded validator would have reached the assembler as an unknown
  // option. That conclusion is derived from static review, not measured: the old
  // build was never executed, so "every such run came back 5 (INTERNAL)" is an
  // inference about what would have happened, not an observed result.
  assert.notEqual(code, DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.profile.outcome, 'clear');
  assert.equal(report.combinedReport.channels.static.outcome, 'clear');
  assert.equal(report.combinedReport.channels.runtime.state, 'absent');
  assert.equal(report.combinedReport.channels.admission.state, 'absent');
  assert.match(stderr.join(''), /diagnose-cli: provided=2 absent=2/);
});

test('real files and a real import: the admission lane reaches its own option', async (t) => {
  const dir = tempDir(t);
  const admissionPath = join(dir, 'admission.json');
  const validatorPath = join(dir, 'admission-validator.mjs');

  writeFileSync(admissionPath, JSON.stringify(admissionEvidence()));
  writeFileSync(
    validatorPath,
    [
      'const summary = {',
      "  schemaVersion: '0.1.0-draft.1',",
      '  certification: false,',
      "  coverage: { required: ['catalog-model'], present: ['catalog-model'], unknown: [] },",
      "  cases: [{ id: 'catalog-model', status: 'refused', assertionCount: 1, failedAssertions: [], limitations: [] }],",
      '  limitations: [],',
      '};',
      'export const validateAdmissionEvidence = () => ({ valid: true, issues: [], summary });',
      '',
    ].join('\n'),
  );

  const { io, stdout } = realIo();
  const code = await main(
    ['--admission', admissionPath, '--admission-validator', validatorPath],
    io,
  );

  assert.notEqual(code, DIAGNOSE_EXIT_CODES.INTERNAL);
  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.combinedReport.channels.admission.state, 'provided');
  assert.equal(report.combinedReport.channels.admission.outcome, 'clear');
  assert.equal(report.combinedReport.channels.static.state, 'absent');
});

test('a lane whose JSON did not parse never imports its validator', async (t) => {
  const dir = tempDir(t);
  const badPath = join(dir, 'broken.json');
  const markerPath = join(dir, 'imported.marker');
  const modulePath = join(dir, 'side-effect.mjs');

  writeFileSync(badPath, '{"declarations": [');
  // The marker is the sentinel: importing this module writes it. If the CLI
  // imported the validator before checking the document, the file would exist.
  writeFileSync(
    modulePath,
    [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(markerPath)}, 'imported');`,
      'export const validateDeclaration = () => ({ valid: true, issues: [] });',
      '',
    ].join('\n'),
  );

  const { io, stdout } = realIo();
  const code = await main(['--static', badPath, '--declaration-validator', modulePath], io);

  assert.equal(existsSync(markerPath), false, 'a document that did not parse must not import a validator');
  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);

  const report = JSON.parse(jsonLines(stdout.join(''))[0]);
  assert.equal(report.combinedReport.channels.static.state, 'provided');
  assert.equal(report.combinedReport.channels.static.outcome, 'invalid');
  assert.deepEqual(report.combinedReport.channels.static.issues, [{ code: 'INPUT_JSON_INVALID' }]);
});

/* ------------------------------------------------------------------ *
 * Provenance projection (`0.2-draft.1`).
 * ------------------------------------------------------------------ */

const runtimeReceipt = () => runtimeDocument();


test('provenance has one entry per source, in the fixed order, with only closed words', () => {
  const report = buildDiagnoseReport({ profile: { text: '- id: a\n  name: b\n' } }, {});

  assert.equal(report.provenance.length, DIAGNOSE_SOURCES.length);
  assert.deepEqual(
    report.provenance.map((entry) => entry.source),
    DIAGNOSE_SOURCES.map((source) => SOURCE_BY_NAME[source]),
  );
  for (const entry of report.provenance) {
    assert.deepEqual(Object.keys(entry), ['source', 'baselineState', 'commit', 'node']);
    assert.equal(entry.commit, null);
    assert.equal(entry.node, null);
  }
  // The profile lane's summary has no baseline field at all: that is
  // `not-reflected`, never "this document had no baseline".
  assert.equal(report.provenance[0].baselineState, 'not-reflected');
  for (const entry of report.provenance.slice(1)) assert.equal(entry.baselineState, 'not-provided');
});

test('a real runtime receipt is reported as recorded, with its two strings copied', () => {
  const document = runtimeReceipt();
  const report = buildDiagnoseReport({ runtime: { document } }, {});

  const entry = report.provenance.find((candidate) => candidate.source === 'runtime-input');
  assert.equal(entry.baselineState, 'recorded');
  assert.equal(entry.commit, document.baseline.commit);
  assert.equal(entry.node, document.baseline.node);
});

test('a summary that carries no baseline field is not-reflected, and the limitation says so', () => {
  const report = buildDiagnoseReport(
    {
      profile: { text: '- id: a\n  name: b\n' },
      static: { document: { declarations: [], availableCapabilities: [] } },
      admission: { document: { schemaVersion: 'admission-evidence/0.1-draft.1' } },
    },
    {
      validateDeclaration: () => ({ valid: true, issues: [] }),
      // Mirrors the real summariser exactly: the wrapper accepts only this closed
      // summary shape, and none of its five keys is a baseline. The admission lane
      // therefore never republishes the document own baseline.
      validateAdmissionEvidence: () => ({
        valid: true,
        issues: [],
        summary: {
          schemaVersion: 'admission-evidence/0.1-draft.1',
          certification: false,
          coverage: { required: [], present: [], unknown: [] },
          cases: [],
          limitations: [],
        },
      }),
    },
  );

  const words = report.provenance.map((entry) => entry.baselineState);
  assert.deepEqual(words, ['not-reflected', 'not-reflected', 'not-provided', 'not-reflected']);
  assert.ok(report.limitations.includes('BASELINE_IS_READ_FROM_THE_SUMMARY_ONLY'));
});

test('a lane that produced no usable document is not-readable, not not-reflected', () => {
  const report = buildDiagnoseReport({ admission: { document: { schemaVersion: 'wrong' } } }, {});

  const entry = report.provenance.find((candidate) => candidate.source === 'admission-input');
  assert.equal(entry.baselineState, 'not-readable');
  assert.equal(entry.commit, null);
  assert.equal(entry.node, null);
});

test('a provenance projection that contradicts the four words is refused', () => {
  const report = buildDiagnoseReport({ runtime: { document: runtimeReceipt() } }, {});
  const runtimeIndex = DIAGNOSE_SOURCES.indexOf('runtime');

  const cases = [
    ['missing field', (copy) => { delete copy.provenance; }],
    ['not an array', (copy) => { copy.provenance = {}; }],
    ['too short', (copy) => { copy.provenance = copy.provenance.slice(0, 3); }],
    ['wrong source label', (copy) => { copy.provenance[0].source = 'profile'; }],
    ['unknown word', (copy) => { copy.provenance[0].baselineState = 'probably-fine'; }],
    ['recorded without a commit', (copy) => { copy.provenance[runtimeIndex].commit = null; }],
    ['recorded with an abbreviation', (copy) => { copy.provenance[runtimeIndex].commit = 'deadbeef'; }],
    ['recorded without a node', (copy) => { copy.provenance[runtimeIndex].node = ''; }],
    ['half a baseline', (copy) => { copy.provenance[0].commit = '0'.repeat(40); }],
    ['an extra key', (copy) => { copy.provenance[0].cache = 'hit'; }],
  ];
  for (const [label, damage] of cases) {
    const copy = structuredClone(report);
    damage(copy);
    assert.throws(
      () => diagnoseExitCode(copy),
      TypeError,
      `a projection damaged by "${label}" must not map to an exit code`,
    );
  }
});
