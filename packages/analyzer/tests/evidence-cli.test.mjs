/**
 * Tests for `src/evidence-cli.js` — the one-receipt runtime-evidence CLI.
 *
 * Written as `.mjs` on purpose: the package's configured test script globs
 * `tests/*.test.js`, so this suite never joins a run that is already in progress.
 * Run it explicitly with:
 *
 *   node --test tests/evidence-cli.test.mjs
 *
 * NOT RUN as of this change: nothing here is a claim that these assertions pass
 * today; it is a description of the behaviour the CLI is specified to have.
 *
 * Two kinds of test live here, and the split is deliberate:
 *   - unit tests drive the exported `main(argv, io)` with an injected reader and
 *     captured streams, so they touch no filesystem and no real stream;
 *   - end-to-end tests spawn `node src/evidence-cli.js` against a temporary
 *     directory to prove the bounded reader, the fstat type check and the entry
 *     point guard against the real platform.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  EVIDENCE_EXIT_CODES,
  MAX_EVIDENCE_BYTES,
  main,
  readEvidenceFile,
} from '../src/evidence-cli.js';
import { ISSUE_CODES, SCHEMA_VERSION } from '../src/runtime-evidence.js';

/* ------------------------------------------------------------------ *
 * Test data
 * ------------------------------------------------------------------ */

const COMMIT = '9f2c4a7b1d0e3f5a6b8c9d0e1f2a3b4c5d6e7f80';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/evidence-cli.js', import.meta.url));

const assertion = (id, passed) => ({ id, passed });

const caseRecord = ({
  id,
  status = 'passed',
  evidenceTier = 'real-host',
  assertions = [assertion('observed', true)],
  limitations = [],
}) => ({ id, status, evidenceTier, assertions, limitations });

/** A complete, fully passing receipt: every required case recorded a pass. */
function completeReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    baseline: { commit: COMMIT, node: 'v24.21.0' },
    cases: [
      caseRecord({
        id: 'same-name-conflict',
        assertions: [assertion('second-registration-rejected', true)],
        limitations: ['only two host builds were exercised'],
      }),
      caseRecord({
        id: 'dependency-unload',
        assertions: [assertion('capability-released-after-unload', true)],
      }),
      caseRecord({ id: 'stale-cleanup', assertions: [assertion('directory-empty', true)] }),
    ],
    limitations: ['evidence came from one operator machine'],
  };
}

/** Same shape, but the unload case recorded a genuine failure. */
function receiptWithFailure() {
  const receipt = completeReceipt();
  receipt.cases[1] = caseRecord({
    id: 'dependency-unload',
    status: 'failed',
    assertions: [
      assertion('capability-released-after-unload', false),
      assertion('no-residual-registration', false),
    ],
    limitations: ['unload was observed once'],
  });
  return receipt;
}

/** Same shape, but one case was never attempted. */
function receiptWithNotRun() {
  const receipt = completeReceipt();
  receipt.cases[2] = caseRecord({ id: 'stale-cleanup', status: 'not-run', assertions: [] });
  return receipt;
}

const asJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/* ------------------------------------------------------------------ *
 * Harnesses
 * ------------------------------------------------------------------ */

/**
 * Drive `main` with an injected reader and captured streams. Returns the exit
 * code plus everything the CLI wrote, so a test can assert on all three at once.
 */
function runInjected(argv, { readFile = () => asJson(completeReceipt()), calls = [] } = {}) {
  const out = [];
  const err = [];
  const code = main(argv, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readFile: (path) => {
      calls.push(path);
      return readFile(path);
    },
  });
  return { code, stdout: out.join(''), stderr: err.join(''), calls };
}

function spawnCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Create a scratch directory that is removed when the test ends. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeReceipt(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, typeof value === 'string' ? value : asJson(value));
  return path;
}

/** Strip comments so source-level scans only look at executable code. */
function stripComments(source) {
  let out = '';
  let state = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 1;
      } else if (char === '/' && next === '*') {
        state = 'block';
        index += 1;
      } else {
        out += char;
        if (char === "'" || char === '"' || char === '`') state = char;
      }
    } else if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
    } else if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
    } else if (char === '\\') {
      out += char + (next ?? '');
      index += 1;
    } else if (char === state) {
      state = 'code';
      out += char;
    } else {
      out += char;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Exported constants
 * ------------------------------------------------------------------ */

test('the exit-code table is closed, frozen and 0/1/2', () => {
  assert.deepEqual(
    { ...EVIDENCE_EXIT_CODES },
    { OK: 0, INCOMPLETE: 1, UNUSABLE: 2 },
  );
  assert.equal(Object.isFrozen(EVIDENCE_EXIT_CODES), true);
});

test('the read cap is exactly 1 MiB', () => {
  assert.equal(MAX_EVIDENCE_BYTES, 1024 * 1024);
});

/* ------------------------------------------------------------------ *
 * The valid path, and the certification that must survive it
 * ------------------------------------------------------------------ */

test('a complete receipt exits 0 and prints the summary as JSON', () => {
  const result = runInjected(['receipt.json']);
  assert.equal(result.code, EVIDENCE_EXIT_CODES.OK);
  assert.equal(result.stderr, '');

  assert.equal(result.stdout.endsWith('\n'), true, 'output must end with a newline');
  const document = JSON.parse(result.stdout);

  assert.deepEqual(Object.keys(document), ['valid', 'issues', 'summary']);
  assert.equal(document.valid, true);
  assert.deepEqual(document.issues, []);
  assert.deepEqual(
    document.summary.cases.map((entry) => entry.id),
    ['same-name-conflict', 'dependency-unload', 'stale-cleanup'],
  );
  assert.ok(document.summary.cases.every((entry) => entry.status === 'passed'));
  assert.equal(document.summary.baseline.commit, COMMIT);
  assert.equal(document.summary.baseline.node, 'v24.21.0');
});

test('certification is printed and is false, never true and never omitted', () => {
  const stdout = runInjected(['receipt.json']).stdout;
  const document = JSON.parse(stdout);

  assert.equal(Object.hasOwn(document.summary, 'certification'), true);
  assert.equal(document.summary.certification, false);
  assert.deepEqual(Object.keys(document.summary), [
    'cases',
    'baseline',
    'limitations',
    'certification',
  ]);
  // Exactly one certification field, and the CLI adds no second claim of its own.
  assert.equal((stdout.match(/certification/g) ?? []).length, 1);
});

test('a structurally valid receipt is still printed when a case failed (exit 1)', () => {
  const result = runInjected(['receipt.json'], { readFile: () => asJson(receiptWithFailure()) });
  assert.equal(result.code, EVIDENCE_EXIT_CODES.INCOMPLETE);
  assert.equal(result.stderr, '');

  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, true);
  assert.equal(document.summary.certification, false);
  const failed = document.summary.cases.find((entry) => entry.id === 'dependency-unload');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.assertionCount, 2);
  assert.equal(failed.failedAssertionCount, 2);
});

test('a structurally valid receipt with a not-run case exits 1', () => {
  const result = runInjected(['receipt.json'], { readFile: () => asJson(receiptWithNotRun()) });
  assert.equal(result.code, EVIDENCE_EXIT_CODES.INCOMPLETE);
  const document = JSON.parse(result.stdout);
  assert.equal(document.summary.cases.find((entry) => entry.id === 'stale-cleanup').status, 'not-run');
});

test('the exit code is a pure function of the printed statuses', () => {
  const statusesOf = (receipt) => {
    const result = runInjected(['receipt.json'], { readFile: () => asJson(receipt) });
    return {
      code: result.code,
      statuses: JSON.parse(result.stdout).summary.cases.map((entry) => entry.status),
    };
  };

  const complete = statusesOf(completeReceipt());
  assert.equal(complete.code, 0);
  assert.ok(complete.statuses.every((status) => status === 'passed'));

  const failed = statusesOf(receiptWithFailure());
  assert.equal(failed.code, 1);
  assert.ok(failed.statuses.includes('failed'));

  const notRun = statusesOf(receiptWithNotRun());
  assert.equal(notRun.code, 1);
  assert.ok(notRun.statuses.includes('not-run'));
});

test('the same bytes produce byte-identical output', () => {
  const first = runInjected(['receipt.json'], { readFile: () => asJson(completeReceipt()) });
  const second = runInjected(['receipt.json'], { readFile: () => asJson(completeReceipt()) });
  assert.equal(second.stdout, first.stdout);
});

test('exactly one injected read happens, with exactly the named path', () => {
  const result = runInjected(['some/receipt.json']);
  assert.deepEqual(result.calls, ['some/receipt.json']);
});

/* ------------------------------------------------------------------ *
 * No conflation with the static analysis lane
 * ------------------------------------------------------------------ */

test('the output uses no static-analysis vocabulary', () => {
  const stdout = runInjected(['receipt.json']).stdout;
  assert.equal(stdout.includes('evidenceLevel'), false);
  assert.equal(stdout.includes('"findings"'), false);
  assert.equal(stdout.includes('analysisComplete'), false);

  const document = JSON.parse(stdout);
  assert.deepEqual(Object.keys(document), ['valid', 'issues', 'summary']);
});

test('the CLI source imports only Node built-ins and the one fixed local module', () => {
  const source = stripComments(readFileSync(cliPath, 'utf8'));

  const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    './runtime-evidence.js',
    'node:fs',
    'node:path',
    'node:url',
  ]);

  // No conflation: the static lane is never loaded from here.
  for (const forbidden of ['./analyze.js', './report.js', './exit-codes.js', './index.js']) {
    assert.equal(specifiers.includes(forbidden), false, `${forbidden} must not be imported`);
  }
});

test('the CLI source contains no dynamic code loading, subprocess, network or file write', () => {
  const source = stripComments(readFileSync(cliPath, 'utf8'));

  for (const needle of [
    'import(',
    'require(',
    'eval(',
    'new Function',
    'node:child_process',
    'node:net',
    'node:http',
    'node:https',
    'node:dgram',
    'node:tls',
    'node:worker_threads',
    'writeFile',
    'appendFile',
    'createWriteStream',
    'mkdir',
    'rename',
    'unlink',
    'rmSync',
  ]) {
    assert.equal(source.includes(needle), false, `source must not contain ${needle}`);
  }

  // The only write it performs is to a stream it was handed.
  assert.equal(/process\.stdout\.write/.test(source), true);
  assert.equal(/process\.stderr\.write/.test(source), true);
});

test('importing the module never runs the CLI', (t) => {
  const dir = scratch(t);
  const probe = join(dir, 'import-probe.mjs');
  writeFileSync(
    probe,
    `import { main, MAX_EVIDENCE_BYTES } from ${JSON.stringify(pathToFileURL(cliPath).href)};\n` +
      'if (typeof main !== "function") { console.error("main is not exported"); process.exit(9); }\n' +
      'if (MAX_EVIDENCE_BYTES !== 1048576) { console.error("cap changed"); process.exit(9); }\n' +
      'process.stdout.write("IMPORTED");\n',
  );

  const result = spawnSync(process.execPath, [probe], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'IMPORTED', 'an imported module must print nothing');
  assert.equal(result.stderr, '');
});

/* ------------------------------------------------------------------ *
 * Usage refusals
 * ------------------------------------------------------------------ */

test('no argument is a usage error: exit 2, usage on stderr, nothing on stdout', () => {
  const result = runInjected([]);
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('exactly one receipt path is required'), true);
  assert.equal(result.stderr.includes('Usage:'), true);
  assert.equal(result.stderr.includes('    at '), false, 'no stack trace is printed');
  assert.deepEqual(result.calls, [], 'nothing is read without a path');
});

test('a second argument is refused rather than guessed at', () => {
  const result = runInjected(['a.json', 'b.json']);
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('exactly one receipt path is accepted'), true);
  assert.deepEqual(result.calls, []);
});

test('standard input is refused: the input must be an explicit file', () => {
  const result = runInjected(['-']);
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stderr.includes('standard input'), true);
  assert.deepEqual(result.calls, []);
});

test('an unknown option is refused instead of being treated as a path', () => {
  const result = runInjected(['--receipt', 'x.json']);
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stderr.includes('unknown option'), true);
  assert.deepEqual(result.calls, []);
});

test('--help exits 0, prints usage on stderr and nothing on stdout', () => {
  for (const flag of ['--help', '-h']) {
    const result = runInjected([flag]);
    assert.equal(result.code, EVIDENCE_EXIT_CODES.OK, flag);
    assert.equal(result.stdout, '', flag);
    assert.equal(result.stderr.includes('Usage:'), true, flag);
    assert.deepEqual(result.calls, [], flag);
  }
});

/* ------------------------------------------------------------------ *
 * IO and encoding refusals (injected reader)
 * ------------------------------------------------------------------ */

test('a reader failure becomes one fixed line, never the OS message', () => {
  const result = runInjected(['receipt.json'], {
    readFile: () => {
      throw new Error('ENOENT: no such file or directory, open "/secret/path/receipt.json"');
    },
  });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'evidence-cli: internal failure while summarizing; no summary was produced.\n');
  assert.equal(result.stderr.includes('secret'), false);
  assert.equal(result.stderr.includes('ENOENT'), false);
});

test('a malformed JSON document exits 2 without echoing its content', () => {
  const broken = '{"schemaVersion": "coexistence-evidence/0.1", "cases": [';
  const result = runInjected(['receipt.json'], { readFile: () => broken });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('not a valid JSON document'), true);
  assert.equal(result.stderr.includes('coexistence-evidence'), false, 'no receipt content is echoed');
  assert.equal(result.stderr.includes('    at '), false);
});

test('an empty file is a parse refusal, not an empty summary', () => {
  const result = runInjected(['receipt.json'], { readFile: () => '' });
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('not a valid JSON document'), true);
});

test('parsed JSON that is not an evidence document exits 2 with codes only', () => {
  const result = runInjected(['receipt.json'], { readFile: () => asJson({ hello: 'world' }) });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, false);
  assert.equal(document.summary, null);
  assert.ok(document.issues.length > 0);
  for (const issue of document.issues) {
    assert.deepEqual(Object.keys(issue), ['code'], 'message text and paths are not republished');
    assert.equal(typeof issue.code, 'string');
  }
  assert.equal(document.issues.some((issue) => issue.code === ISSUE_CODES.UNEXPECTED_FIELD), true);
  assert.equal(result.stderr.includes('not a valid coexistence-evidence document'), true);
});

test('a wrong schema version is refused, and the document body never reaches the terminal', () => {
  const receipt = completeReceipt();
  receipt.schemaVersion = 'coexistence-evidence/9.9';
  const result = runInjected(['receipt.json'], { readFile: () => asJson(receipt) });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, false);
  assert.deepEqual(document.issues, [{ code: ISSUE_CODES.INVALID_SCHEMA_VERSION }]);
  assert.equal(result.stdout.includes(receipt.schemaVersion), false);
});

test('an oversized single field cannot inflate the refusal output', () => {
  const huge = `unknown-case-${'x'.repeat(5000)}`;
  const receipt = completeReceipt();
  receipt.cases = [
    caseRecord({ id: huge, assertions: [assertion('observed', true)] }),
  ];
  const result = runInjected(['receipt.json'], { readFile: () => asJson(receipt) });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, false);
  assert.equal(document.issues.some((issue) => issue.code === ISSUE_CODES.UNKNOWN_CASE_ID), true);
  assert.equal(document.issues.some((issue) => issue.code === ISSUE_CODES.MISSING_CASE_ID), true);
  assert.equal(result.stdout.includes('xxxxx'), false);
  assert.ok(result.stdout.length < 2048, 'refusal output stays small');
});

test('a status/assertion mismatch is refused rather than summarized', () => {
  const receipt = completeReceipt();
  receipt.cases[0] = caseRecord({
    id: 'same-name-conflict',
    status: 'passed',
    assertions: [assertion('second-registration-rejected', false)],
  });
  const result = runInjected(['receipt.json'], { readFile: () => asJson(receipt) });

  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  const document = JSON.parse(result.stdout);
  assert.equal(document.summary, null);
  assert.equal(document.issues.some((issue) => issue.code === ISSUE_CODES.STATUS_ASSERTION_MISMATCH), true);
});

/* ------------------------------------------------------------------ *
 * The bounded reader against the real filesystem
 * ------------------------------------------------------------------ */

test('a regular file below the cap is read as text', (t) => {
  const dir = scratch(t);
  const path = writeReceipt(dir, 'receipt.json', completeReceipt());
  assert.equal(JSON.parse(readEvidenceFile(path)).schemaVersion, SCHEMA_VERSION);
});

test('a file of exactly the cap is accepted', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'exactly-cap.bin');
  writeFileSync(path, Buffer.alloc(MAX_EVIDENCE_BYTES, 0x61));
  const text = readEvidenceFile(path);
  assert.equal(text.length, MAX_EVIDENCE_BYTES);
  assert.equal(text, 'a'.repeat(MAX_EVIDENCE_BYTES));
});

test('one byte over the cap is refused, not truncated', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'over-cap.bin');
  writeFileSync(path, Buffer.alloc(MAX_EVIDENCE_BYTES + 1, 0x61));
  assert.throws(
    () => readEvidenceFile(path),
    {
      name: 'EvidenceCliError',
      message: 'evidence-cli: the receipt file exceeds the 1048576-byte (1 MiB) read cap; it is refused, never truncated.',
    },
  );
});

test('a directory is refused by fstat, not opened as a document', (t) => {
  const dir = scratch(t);
  assert.throws(
    () => readEvidenceFile(dir),
    { name: 'EvidenceCliError', message: /not a regular file/ },
  );
});

test('a character device is refused as a special file', () => {
  if (!existsSync('/dev/null')) return; // platform without any obvious device node
  assert.throws(
    () => readEvidenceFile('/dev/null'),
    { name: 'EvidenceCliError', message: /not a regular file/ },
  );
});

test('invalid UTF-8 bytes are refused instead of being replaced', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'latin1.json');
  writeFileSync(path, Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
  assert.throws(
    () => readEvidenceFile(path),
    { name: 'EvidenceCliError', message: /not valid UTF-8 text/ },
  );
});

test('a leading BOM is consumed, so a BOM-prefixed receipt still parses', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'bom.json');
  writeFileSync(path, `\ufeff${asJson(completeReceipt())}`, 'utf8');
  const text = readEvidenceFile(path);
  assert.equal(text.charCodeAt(0) === 0xfeff, false);
  assert.equal(JSON.parse(text).schemaVersion, SCHEMA_VERSION);
});

test('a missing file exits 2 with the fixed open message', () => {
  const result = runInjected(['/definitely/not/here/receipt.json'], { readFile: readEvidenceFile });
  assert.equal(result.code, EVIDENCE_EXIT_CODES.UNUSABLE);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'evidence-cli: the receipt file could not be opened for reading.\n');
});

/* ------------------------------------------------------------------ *
 * End-to-end, through the real entry point guard
 * ------------------------------------------------------------------ */

test('end to end: a complete receipt exits 0 with the summary on stdout', (t) => {
  const dir = scratch(t);
  const path = writeReceipt(dir, 'receipt.json', completeReceipt());
  const result = spawnCli([path]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, true);
  assert.equal(document.summary.certification, false);
});

test('end to end: an incomplete receipt exits 1 and still prints the summary', (t) => {
  const dir = scratch(t);
  const path = writeReceipt(dir, 'receipt.json', receiptWithNotRun());
  const result = spawnCli([path]);

  assert.equal(result.code, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test('end to end: no argument exits 2 with usage and no stack', () => {
  const result = spawnCli([]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('Usage:'), true);
  assert.equal(result.stderr.includes('    at '), false);
});

test('end to end: a directory path exits 2 without reading anything', (t) => {
  const dir = scratch(t);
  const result = spawnCli([dir]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('not a regular file'), true);
});

test('end to end: an oversize file exits 2 with the cap message and no truncation', (t) => {
  const dir = scratch(t);
  const path = join(dir, 'over-cap.json');
  writeFileSync(path, Buffer.alloc(MAX_EVIDENCE_BYTES + 1, 0x20));
  const result = spawnCli([path]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '', 'a refused file produces no partial document');
  assert.equal(result.stderr.includes('1 MiB'), true);
});

test('end to end: a malformed file exits 2 and leaks no content', (t) => {
  const dir = scratch(t);
  const path = writeReceipt(dir, 'broken.json', '{"schemaVersion": "coexistence-evidence/0.1", "cases": [');
  const result = spawnCli([path]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes('coexistence-evidence'), false);
});

test('end to end: a schema refusal prints codes on stdout and exits 2', (t) => {
  const dir = scratch(t);
  const receipt = completeReceipt();
  receipt.limitations = [''];
  const path = writeReceipt(dir, 'empty-limitation.json', receipt);
  const result = spawnCli([path]);

  assert.equal(result.code, 2);
  const document = JSON.parse(result.stdout);
  assert.equal(document.valid, false);
  assert.equal(document.summary, null);
  assert.deepEqual(document.issues, [{ code: ISSUE_CODES.EMPTY_STRING }]);
});
