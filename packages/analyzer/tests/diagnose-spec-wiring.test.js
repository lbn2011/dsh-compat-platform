/**
 * `dsh-compat-diagnose` wired to the **real** `dsh-compat-spec` validators.
 *
 * The other suites in this directory inject validators: one that accepts
 * everything, one that throws, one written into a temporary directory. They
 * prove this CLI's control flow. These tests prove something different and
 * narrower: that the two lanes which take an injected validator behave as
 * documented when the injected function is the reference grammar from the
 * sibling spec checkout, deciding on real files read by the real reader.
 *
 * What is real here:
 *   - documents are read from disk by the CLI's own bounded reader, not from a
 *     fake `readFile` map;
 *   - the validators are the real `dsh-compat-spec` grammar, resolved through
 *     `tests/helpers/spec-module.mjs` (package specifier first, the sibling
 *     checkout second), so the actual grammar decides validity — a stub would
 *     make these tests vacuous;
 *   - the report is assembled by the real assembler and the real combined-report
 *     builder, with no injected `build`.
 *
 * What is NOT real, and must not be read into a green result:
 *   - no child process: `main()` runs in this process, so process-level exit
 *     codes and stdout/stderr plumbing belong to the acceptance runner, not here;
 *   - no host: nothing is loaded, admitted or activated;
 *   - the input documents are fixtures plus two synthetic examples authored to
 *     their grammars — not records of a real DSH run;
 *   - the `--runtime` lane is not exercised in this file.
 *
 * A missing or unusable sibling checkout is a **failure**, never a skip: the
 * point of the suite is that the canonical grammar decided the outcome, and a
 * silent skip would report that as a pass. `admission-cli.test.mjs` states the
 * same rule for the admission lane.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DIAGNOSE_EXIT_CODES } from '../src/diagnose.js';
import { main } from '../src/diagnose-cli.js';
import { resolveSpecModule } from './helpers/spec-module.mjs';

/* ------------------------------------------------------------------ *
 * Canonical grammar, resolved from this file rather than from cwd.
 * ------------------------------------------------------------------ */

const DECLARATION_VALIDATOR_URL = resolveSpecModule('.');
const ADMISSION_VALIDATOR_URL = resolveSpecModule('./admission-evidence');

/**
 * Import the canonical declaration grammar.
 *
 * @returns {Promise<Function>} The reference `validateDeclaration`.
 * @throws {Error} When the sibling checkout is missing or exports no validator.
 */
async function loadDeclarationValidator() {
  const namespace = await import(DECLARATION_VALIDATOR_URL.href);
  const validate = namespace?.validateDeclaration;
  if (typeof validate !== 'function') {
    throw new Error(
      `canonical validator is unavailable: ${DECLARATION_VALIDATOR_URL.label} exports no validateDeclaration. ` +
        'Install dsh-compat-spec, or place its checkout next to this repository; this suite never skips.',
    );
  }
  return validate;
}

/**
 * Import the canonical admission grammar.
 *
 * @returns {Promise<Function>} The reference `validateAdmissionEvidence`.
 * @throws {Error} When the sibling checkout is missing or exports no validator.
 */
async function loadAdmissionValidator() {
  const namespace = await import(ADMISSION_VALIDATOR_URL.href);
  const validate = namespace?.validateAdmissionEvidence;
  if (typeof validate !== 'function') {
    throw new Error(
      `canonical validator is unavailable: ${ADMISSION_VALIDATOR_URL.label} exports no validateAdmissionEvidence. ` +
        'Install dsh-compat-spec, or place its checkout next to this repository; this suite never skips.',
    );
  }
  return validate;
}

/* ------------------------------------------------------------------ *
 * Document paths are FILESYSTEM paths; validator specifiers are `file:` URLs.
 *
 * The two are not interchangeable and this suite pins the difference. A lane
 * document goes through the shared bounded reader (`readEvidenceFile`), which
 * takes a filesystem path — handing it a `file:` URL string is a read failure,
 * and a read failure is a whole-lane `invalid`, not a harness detail. A
 * validator goes through `resolveModuleTarget`, which accepts a `file:` URL
 * verbatim. Both URL bases below are computed from this file, so neither depends
 * on the working directory.
 * ------------------------------------------------------------------ */

const FIXTURES = new URL('../fixtures/', import.meta.url);
const EXAMPLES = new URL('../../../examples/diagnose/', import.meta.url);

const fixture = (name) => fileURLToPath(new URL(name, FIXTURES));
const example = (name) => fileURLToPath(new URL(name, EXAMPLES));

/* ------------------------------------------------------------------ *
 * Sinks only: the real reader, the real dynamic import and the real report
 * builder are the defaults.
 * ------------------------------------------------------------------ */

/**
 * Capture stdout and stderr, leaving every other dependency at its default.
 *
 * @returns {{io: object, stdout: string[], stderr: string[]}} Capture harness.
 */
function realIo() {
  const stdout = [];
  const stderr = [];
  return {
    io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    stdout,
    stderr,
  };
}

/**
 * Parse the single JSON document the CLI writes to stdout.
 *
 * @param {string[]} chunks Captured stdout chunks.
 * @returns {object} The parsed report.
 */
function reportOf(chunks) {
  const lines = chunks.join('').trimEnd().split('\n');
  assert.equal(lines.length, 1, `stdout must carry exactly one JSON document, got ${lines.length} lines`);
  return JSON.parse(lines[0]);
}

/**
 * The codes a block carries, whatever the block records them as.
 *
 * A block-level `issues` entry is always `{code}`; a static lane's grammar
 * findings live in `result.findings`, so both are read here without conflating
 * "this lane broke" with "this document was refused".
 *
 * @param {object} block One source block.
 * @returns {string[]} Codes, in order.
 */
function blockCodes(block) {
  const issues = Array.isArray(block?.issues) ? block.issues : [];
  return issues.map((issue) => (issue && typeof issue.code === 'string' ? issue.code : ''));
}

/**
 * One lane's block, from where the envelope actually keeps it.
 *
 * The profile block sits at the top level (`profile`); the three lane documents
 * sit under `combinedReport.channels`. There is no top-level `static`, `runtime`
 * or `admission` key — reading one would be reading `undefined` and asserting
 * happily against nothing.
 *
 * @param {object} report The parsed envelope.
 * @param {string} lane Lane name.
 * @returns {object|undefined} That lane's block, when present.
 */
function channelOf(report, lane) {
  const channels = report?.combinedReport?.channels;
  if (channels === null || typeof channels !== 'object') return undefined;
  return channels[lane];
}

/** A profile export shaped like `app-boot`'s `groupedDump` output. */
const PROFILE_DUMP = [
  '# == base',
  '- id: wiring.example',
  '  name: Wiring Example',
  '  config:',
  '    mode: demo',
  '',
].join('\n');

/**
 * Create a scratch directory for one test.
 *
 * @param {object} t Node test context.
 * @returns {string} Absolute directory path.
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-diagnose-wiring-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Write the profile export into a scratch directory.
 *
 * @param {object} t Node test context.
 * @returns {string} Path to the written file.
 */
function profileFixture(t) {
  const path = join(tempDir(t), 'profile.yml');
  writeFileSync(path, PROFILE_DUMP);
  return path;
}

/* ------------------------------------------------------------------ *
 * Declaration lane.
 * ------------------------------------------------------------------ */

test('the canonical declaration grammar accepts the clean fixture and the run is clear', async (t) => {
  // First prove the fixture and the reference grammar agree, independently of
  // the CLI: if they did not, a clear CLI verdict would mean nothing.
  const validateDeclaration = await loadDeclarationValidator();
  const envelope = JSON.parse(readFileSync(new URL('clean.json', FIXTURES), 'utf8'));
  assert.equal(Array.isArray(envelope.declarations), true);
  assert.ok(envelope.declarations.length > 0);
  for (const declaration of envelope.declarations) {
    const verdict = validateDeclaration(declaration);
    assert.equal(verdict.valid, true, `clean.json must satisfy the grammar: ${JSON.stringify(verdict.issues)}`);
    assert.deepEqual(verdict.issues, []);
  }

  const { io, stdout } = realIo();
  const code = await main(
    [
      '--profile', profileFixture(t),
      '--static', fixture('clean.json'),
      '--declaration-validator', DECLARATION_VALIDATOR_URL.href,
    ],
    io,
  );

  const out = reportOf(stdout);
  const staticBlock = channelOf(out, 'static');
  assert.equal(staticBlock.state, 'provided');
  assert.equal(staticBlock.outcome, 'clear');
  assert.deepEqual(blockCodes(staticBlock), []);

  // The lane result is the analyzer's own report, passed through by reference.
  assert.equal(staticBlock.result.summary.analysisComplete, true);
  assert.equal(staticBlock.result.summary.declarations.invalid, 0);
  assert.equal(staticBlock.result.summary.declarations.total, envelope.declarations.length);
  assert.deepEqual(
    staticBlock.result.findings.filter((finding) => finding.severity === 'error'),
    [],
  );

  // The profile lane is independent of it and also clear.
  assert.equal(out.profile.state, 'provided');
  assert.equal(out.profile.outcome, 'clear');

  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);
});

test('the canonical declaration grammar refuses an invalid declaration, and the profile survives', async (t) => {
  const { io, stdout } = realIo();
  const code = await main(
    [
      '--profile', profileFixture(t),
      '--static', fixture('invalid-declaration.json'),
      '--declaration-validator', DECLARATION_VALIDATOR_URL.href,
    ],
    io,
  );

  const out = reportOf(stdout);
  // A refused declaration is `invalid`, not `attention`: the analyzer sets
  // analysisComplete false when a blocking finding is present.
  const staticBlock = channelOf(out, 'static');
  assert.equal(staticBlock.state, 'provided');
  assert.equal(staticBlock.outcome, 'invalid');
  assert.equal(staticBlock.result.summary.analysisComplete, false);
  assert.ok(
    staticBlock.result.summary.declarations.invalid > 0,
    'at least one declaration must be counted invalid by the analyzer',
  );
  const errorCodes = staticBlock.result.findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
  assert.ok(errorCodes.includes('INVALID_DECLARATION'), `expected INVALID_DECLARATION, got ${errorCodes.join(',')}`);

  // Lane isolation: the other requested source keeps its own verdict.
  assert.equal(out.profile.state, 'provided');
  assert.equal(out.profile.outcome, 'clear');

  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});

/* ------------------------------------------------------------------ *
 * Runtime lane. It takes no injected validator — the grammar is this
 * package's own `summarizeRuntimeEvidence` — so what is proven here is that
 * the shipped example is a document that grammar actually accepts.
 * ------------------------------------------------------------------ */

test('the runtime example is summarizable and all three canonical cases pass', async () => {
  const { CASE_IDS } = await import('../src/runtime-evidence.js');
  const document = JSON.parse(readFileSync(new URL('runtime-evidence.json', EXAMPLES), 'utf8'));
  // The example must announce itself as synthetic, or a reader could mistake a
  // placeholder baseline for a recorded host run.
  assert.equal(
    document.cases.every((entry) => entry.evidenceTier === 'real-host'),
    true,
    'the runtime grammar only accepts the documented evidence tier',
  );
  assert.ok(
    document.limitations.some((line) => typeof line === 'string' && line.includes('synthetic')),
    'the example must carry a limitation saying it was not produced by a host run',
  );

  const { io, stdout } = realIo();
  const code = await main(['--runtime', example('runtime-evidence.json')], io);

  const out = reportOf(stdout);
  const runtimeBlock = channelOf(out, 'runtime');
  assert.equal(runtimeBlock.state, 'provided');
  assert.equal(runtimeBlock.outcome, 'clear');
  assert.deepEqual(blockCodes(runtimeBlock), []);
  assert.equal(runtimeBlock.result.valid, true);
  assert.deepEqual(
    runtimeBlock.result.summary.cases.map((entry) => entry.id),
    [...CASE_IDS],
    'cases are summarised in canonical order, not document order',
  );
  assert.equal(
    runtimeBlock.result.summary.cases.every((entry) => entry.status === 'passed'),
    true,
  );

  assert.equal(code, DIAGNOSE_EXIT_CODES.OK);
});

/* ------------------------------------------------------------------ *
 * Admission lane.
 * ------------------------------------------------------------------ */

test('an unparseable admission document fails its lane only, never reaching the grammar', async (t) => {
  const { io, stdout } = realIo();
  const code = await main(
    [
      '--static', fixture('clean.json'),
      '--declaration-validator', DECLARATION_VALIDATOR_URL.href,
      '--admission', fixture('malformed.json'),
      '--admission-validator', ADMISSION_VALIDATOR_URL.href,
    ],
    io,
  );

  const out = reportOf(stdout);
  assert.equal(channelOf(out, 'static').outcome, 'clear');

  const admissionBlock = channelOf(out, 'admission');
  assert.equal(admissionBlock.state, 'provided');
  assert.equal(admissionBlock.outcome, 'invalid');
  // Read succeeded, JSON parsing did not: the named validator was never imported
  // for this lane, which is why there is no lane result at all.
  assert.equal(admissionBlock.result, null);
  assert.deepEqual(blockCodes(admissionBlock), ['INPUT_JSON_INVALID']);

  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});

test('the canonical admission grammar accepts the example, and its findings are attention', async () => {
  // Straight at the grammar first, so a broken example is reported as a broken
  // example rather than as a CLI misbehaviour.
  const validateAdmissionEvidence = await loadAdmissionValidator();
  const document = JSON.parse(readFileSync(new URL('admission-evidence.json', EXAMPLES), 'utf8'));
  const verdict = validateAdmissionEvidence(document);
  assert.equal(verdict.valid, true, `the example must satisfy the grammar: ${JSON.stringify(verdict.issues)}`);
  assert.deepEqual(verdict.issues, []);
  assert.equal(verdict.summary.certification, false);

  const { io, stdout } = realIo();
  const code = await main(
    [
      '--static', fixture('clean.json'),
      '--declaration-validator', DECLARATION_VALIDATOR_URL.href,
      '--admission', example('admission-evidence.json'),
      '--admission-validator', ADMISSION_VALIDATOR_URL.href,
    ],
    io,
  );

  const out = reportOf(stdout);
  assert.equal(channelOf(out, 'static').outcome, 'clear');
  const admissionBlock = channelOf(out, 'admission');
  assert.equal(admissionBlock.state, 'provided');
  assert.equal(admissionBlock.outcome, 'attention');
  assert.notEqual(admissionBlock.result, null);

  // Valid grammar, but the document reports a `refused` case and leaves the
  // optional cases unreported. Both are observations; both are attention.
  const findingCodes = (admissionBlock.result.findings ?? []).map((finding) => finding.code);
  assert.ok(
    findingCodes.includes('ADMISSION_CASE_REFUSED'),
    `expected the refused-case finding, got ${findingCodes.join(',')}`,
  );
  assert.ok(
    findingCodes.includes('ADMISSION_COVERAGE_UNKNOWN'),
    `expected an unknown-coverage finding, got ${findingCodes.join(',')}`,
  );
  assert.equal(admissionBlock.result.valid, true);
  assert.equal(admissionBlock.result.certification, false);

  assert.equal(code, DIAGNOSE_EXIT_CODES.ATTENTION);
});

test('the canonical admission grammar refuses a JSON document that is not admission evidence', async () => {
  const { io, stdout } = realIo();
  const code = await main(
    ['--admission', fixture('clean.json'), '--admission-validator', ADMISSION_VALIDATOR_URL.href],
    io,
  );

  const out = reportOf(stdout);
  const admissionBlock = channelOf(out, 'admission');
  assert.equal(admissionBlock.state, 'provided');
  assert.equal(admissionBlock.outcome, 'invalid');
  assert.notEqual(admissionBlock.result, null);
  assert.equal(admissionBlock.result.valid, false);
  // The refusal is the grammar's own: protocol issue codes, passed through.
  const codes = blockCodes(admissionBlock);
  assert.ok(codes.length > 0, 'the grammar refusal must surface at least one issue code');
  assert.ok(
    codes.every((code_) => typeof code_ === 'string' && code_.length > 0),
    'every issue must carry a code',
  );

  assert.equal(code, DIAGNOSE_EXIT_CODES.INVALID);
});
