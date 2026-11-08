/**
 * admission-cli — suite for the third lane's local entry point.
 *
 * HISTORICAL NOTE (no longer current): when this file was written, the package
 * test script was `node --test "tests/*.test.js"`, so a `.mjs` file never joined
 * an in-progress run and could not perturb an accepted count. The script now
 * globs `tests/*.test.mjs` as well, so this file is part of the default run.
 * Kept only as history; the assertions below are unchanged.
 *
 *   node --test tests/admission-cli.test.mjs
 *
 * What is asserted is the ENTRY POINT's contract, not the protocol's, and the
 * real `diagnoseAdmissionEvidence` runs in both groups below. No host is booted,
 * no plugin is loaded and nothing is written inside the repository.
 *
 * Two groups.
 *
 *   1. THE SEAM — the validator is a stub injected through `io.loadModule`, and
 *      the real `diagnoseAdmissionEvidence` runs. No trusted module is executed
 *      and nothing is written.
 *   2. THE REAL PATH — `io.loadModule` and `io.readFile` are both omitted, so the
 *      DEFAULT loader and the DEFAULT bounded reader run, and `--validator` is a
 *      `file:` URL. The document and one adapter module are written into a fresh
 *      `mkdtemp()` directory and removed afterwards; nothing is written inside the
 *      repository. The validator is the canonical `validateAdmissionEvidence`,
 *      resolved through `tests/helpers/spec-module.mjs` — the published package
 *      specifier first, the sibling checkout second — so the 0/1/2 outcomes in
 *      that group are produced by the real grammar rather than a stub.
 *      If neither route resolves that group FAILS: this batch requires the real
 *      canonical grammar, so a missing grammar is an error — never a skip, never
 *      a stub. There is no conditional-skip branch in this file.
 *
 * NOT RUN as of writing: written, not executed. See README §11.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ADMISSION_EXIT_CODES, main } from '../src/admission-cli.js';
import { DIAGNOSTIC_CODES, WRAPPER_ISSUE_CODES } from '../src/admission-diagnostics.js';
import { EXIT_CODES, diagnoseAdmissionEvidence } from '../src/index.js';
import { resolveSpecModule } from './helpers/spec-module.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '..', 'src', 'admission-cli.js'), 'utf8');

// ---------------------------------------------------------------------------
// Protocol-derived constants, copied here ON PURPOSE so the tests state the
// protocol's vocabulary rather than reading it back from the module under test.
// ---------------------------------------------------------------------------

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

const DOCUMENT_TEXT = `${JSON.stringify(
  {
    schemaVersion: 'admission-evidence/0.1-draft.1',
    // A baseline the CLI must never echo: metadata consistency authenticates
    // nothing, and this lane prints a diagnosis, not a transcription.
    baseline: { commit: 'a1b2c3d4e5f6a7b8c9d0', node: 'v24.21.0' },
    cases: [],
  },
  null,
  2,
)}\n`;

/** One case entry, always carrying the closed key set the wrapper checks. */
function caseEntry(id, status, overrides = {}) {
  const base = {
    id,
    status,
    assertionCount: 2,
    failedAssertions: [],
    limitations: [],
    ...overrides,
  };
  if (status === 'not-run') {
    // A case that did not run has no assertions and MUST explain itself.
    base.assertionCount = 0;
    base.failedAssertions = [];
    base.limitations = ['not attempted: the coordinator stopped before this case'];
  }
  if (status === 'failed') {
    base.assertionCount = 2;
    base.failedAssertions = [`${id}#assertion-1`];
  }
  return base;
}

/** A §6.6-shaped summary built from the statuses the test wants to exercise. */
function makeSummary({ statuses, unknown = [], limitations = [] }) {
  const cases = Object.entries(statuses).map(([id, status]) => caseEntry(id, status));
  return {
    schemaVersion: 'admission-evidence/0.1-draft.1',
    certification: false,
    coverage: {
      required: [...REQUIRED_CASES],
      present: cases.map((entry) => entry.id),
      unknown: [...unknown],
    },
    cases,
    limitations,
  };
}

/** All four required cases passed: the happy path. */
function acceptedSummary(overrides = {}) {
  return makeSummary({
    statuses: Object.fromEntries(REQUIRED_CASES.map((id) => [id, 'passed'])),
    ...overrides,
  });
}

/** A validator stub that answers with `result`, ignoring the document. */
function fixedValidator(result) {
  const calls = [];
  const validate = (value) => {
    calls.push(value);
    return result;
  };
  validate.calls = calls;
  return validate;
}

/** Sinks that record instead of printing; `out()`/`err()` read what was written. */
function makeSinks(extra = {}) {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      ...extra,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/**
 * A complete invocation with every dependency injected: the document text, the
 * module loader and the sinks. No filesystem read, no real module load.
 */
async function runCli({
  argv = ['--validator', './tests/helpers/canonical-admission.mjs', 'document.json'],
  document = DOCUMENT_TEXT,
  moduleNamespace,
  extra = {},
} = {}) {
  const sinks = makeSinks({
    readFile: (path) => {
      assert.equal(path, 'document.json', 'the reader receives exactly the one document path');
      return document;
    },
    loadModule: async (target) => {
      assert.equal(typeof target, 'string');
      return moduleNamespace;
    },
    ...extra,
  });
  const code = await main(argv, sinks.io);
  return { code, ...sinks };
}

/** The module namespace a `--validator <path>` load would produce. */
function namespaceWith(validate) {
  return { validateAdmissionEvidence: validate };
}

// ---------------------------------------------------------------------------
// Exit code table
// ---------------------------------------------------------------------------

test('the exit table is this command\'s own, and is frozen', () => {
  assert.deepEqual(
    { ...ADMISSION_EXIT_CODES },
    { OK: 0, FINDINGS: 1, DOCUMENT_REJECTED: 2, USAGE: 3, VALIDATOR_CONTRACT: 4, INTERNAL: 5 },
  );
  assert.ok(Object.isFrozen(ADMISSION_EXIT_CODES));

  // The static lane's table is a different object with different KEY NAMES: the
  // numbers coincide by habit, the meanings do not.
  assert.notEqual(ADMISSION_EXIT_CODES, EXIT_CODES);
  assert.notDeepEqual(Object.keys(ADMISSION_EXIT_CODES).sort(), Object.keys(EXIT_CODES).sort());
  assert.equal(EXIT_CODES.MANIFEST_INVALID, 2);
  assert.equal(EXIT_CODES.VALIDATOR_FAILED, 4);
  assert.equal(ADMISSION_EXIT_CODES.DOCUMENT_REJECTED, 2);
  assert.equal(ADMISSION_EXIT_CODES.VALIDATOR_CONTRACT, 4);
});

test('main is asynchronous and returns a code instead of exiting', async () => {
  assert.equal(typeof main, 'function');
  assert.ok(main.constructor.name === 'AsyncFunction');

  const before = process.exitCode;
  const { code } = await runCli({ moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })) });
  assert.equal(code, 0);
  assert.equal(process.exitCode, before, 'main must never set process.exitCode');
});

// ---------------------------------------------------------------------------
// Lane 1: the accepted document
// ---------------------------------------------------------------------------

test('0 — accepted, every required case passed, nothing unknown', async () => {
  const { code, out, err } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })),
  });

  assert.equal(code, 0);
  assert.equal(err(), '', 'a clean diagnosis says nothing on stderr');

  const printed = JSON.parse(out());
  assert.equal(printed.valid, true);
  assert.equal(printed.certification, false, 'certification is never computed here');
  assert.deepEqual(printed.issues, []);
  assert.deepEqual(printed.findings, []);
  assert.deepEqual(
    Object.keys(printed),
    ['valid', 'certification', 'issues', 'findings', 'summary'],
    'field order is fixed',
  );
});

test('0 — a refused case is the EXPECTED outcome and stays informational', async () => {
  const summary = makeSummary({
    statuses: {
      'admission-admitted': 'passed',
      'admission-refused-conflict': 'refused',
      'admission-activation-throw': 'passed',
      'admission-cleanup-failure': 'passed',
    },
  });

  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary })),
  });

  assert.equal(code, 0, 'a refusal is a coordinator success, not an incomplete document');
  const printed = JSON.parse(out());
  assert.equal(printed.findings.length, 1);
  assert.equal(printed.findings[0].code, DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED);
  assert.equal(printed.findings[0].caseId, 'admission-refused-conflict');
  assert.equal(printed.findings[0].status, 'refused');
});

test('1 — a failed case makes the accepted document incomplete', async () => {
  const summary = makeSummary({
    statuses: {
      'admission-admitted': 'passed',
      'admission-refused-conflict': 'passed',
      'admission-activation-throw': 'failed',
      'admission-cleanup-failure': 'passed',
    },
  });

  const { code, out, err } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary })),
  });

  assert.equal(code, 1);
  assert.match(err(), /admission-cli:/);
  const printed = JSON.parse(out());
  assert.deepEqual(
    printed.findings.map((finding) => finding.code),
    [DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED],
  );
  // The whole document is still printed: it is well formed, just incomplete.
  assert.deepEqual(printed.summary.coverage.present.slice(0, 4), [...REQUIRED_CASES]);
});

test('1 — a not-run case is incomplete, never silently acceptable', async () => {
  const summary = makeSummary({
    statuses: {
      'admission-admitted': 'passed',
      'admission-refused-conflict': 'passed',
      'admission-activation-throw': 'not-run',
      'admission-cleanup-failure': 'passed',
    },
  });

  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary })),
  });

  assert.equal(code, 1);
  const printed = JSON.parse(out());
  assert.equal(printed.findings[0].code, DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN);
  assert.equal(printed.findings[0].status, 'not-run');
  assert.notDeepEqual(printed.summary.cases[2].limitations, [], 'a not-run case must explain itself');
});

test('1 — unknown coverage of an optional case is incomplete', async () => {
  const summary = makeSummary({
    statuses: Object.fromEntries(REQUIRED_CASES.map((id) => [id, 'passed'])),
    unknown: [OPTIONAL_CASES[0]],
  });

  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary })),
  });

  assert.equal(code, 1);
  const printed = JSON.parse(out());
  assert.equal(printed.findings[0].code, DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN);
  assert.equal(printed.findings[0].caseId, OPTIONAL_CASES[0]);
  assert.equal(printed.findings[0].status, null, 'a missing case has no case status');
});

// ---------------------------------------------------------------------------
// Lane 2: the validator rejected the document (2) — a statement about the
// document, phrased in the protocol's own vocabulary.
// ---------------------------------------------------------------------------

test('2 — a protocol rejection is a document verdict, not a validator failure', async () => {
  const validate = fixedValidator({
    valid: false,
    issues: [{ code: 'MISSING_FIELD', path: 'baseline' }],
  });

  const { code, out, err } = await runCli({ moduleNamespace: namespaceWith(validate) });

  assert.equal(code, 2);
  assert.equal(validate.calls.length, 1, 'the validator is asked exactly once');

  const printed = JSON.parse(out());
  assert.equal(printed.valid, false);
  assert.equal(printed.certification, false);
  assert.deepEqual(printed.issues, [{ code: 'MISSING_FIELD', path: 'baseline' }]);
  assert.deepEqual(
    Object.keys(printed),
    ['valid', 'certification', 'issues', 'findings'],
    'a rejected document has no summary',
  );
  assert.match(err(), /admission-cli:/);
  assert.ok(
    !printed.issues.some((issue) => Object.values(WRAPPER_ISSUE_CODES).includes(issue.code)),
    'a protocol rejection must not borrow the wrapper vocabulary',
  );
});

// ---------------------------------------------------------------------------
// Lane 3: the validator did not answer (4) — never a verdict about the document.
// ---------------------------------------------------------------------------

test('4 — a throwing validator cannot leak its own message', async () => {
  const secret = '/root/.dsh/private/validator-crash.txt';
  const validate = () => {
    throw new Error(`boom at ${secret}`);
  };

  const { code, out, err } = await runCli({ moduleNamespace: namespaceWith(validate) });

  assert.equal(code, 4);
  const printed = JSON.parse(out());
  assert.equal(printed.valid, false);
  assert.equal(printed.issues[0].code, WRAPPER_ISSUE_CODES.VALIDATOR_THREW);
  assert.ok(!out().includes(secret), 'no thrown text reaches stdout');
  assert.ok(!err().includes(secret), 'no thrown text reaches stderr');
  assert.ok(!out().includes('boom'));
});

test('4 — an asynchronous validator is refused, not awaited', async () => {
  const validate = async () => ({ valid: true, issues: [], summary: acceptedSummary() });

  const { code, out } = await runCli({ moduleNamespace: namespaceWith(validate) });

  assert.equal(code, 4);
  assert.equal(JSON.parse(out()).issues[0].code, WRAPPER_ISSUE_CODES.VALIDATOR_ASYNC);
});

test('4 — a malformed result is a contract breach', async () => {
  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: 'yes' })),
  });

  assert.equal(code, 4);
  const printed = JSON.parse(out());
  assert.equal(printed.valid, false);
  assert.ok(
    [WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT].includes(
      printed.issues[0].code,
    ),
  );
});

test('4 — an inconsistent result (refused with failed assertions) is refused too', async () => {
  const summary = makeSummary({
    statuses: {
      'admission-admitted': 'passed',
      'admission-refused-conflict': 'refused',
      'admission-activation-throw': 'passed',
      'admission-cleanup-failure': 'passed',
    },
  });
  // `refused` and `failedAssertions` cannot both hold: the wrapper must close it.
  summary.cases[1].failedAssertions = ['admission-refused-conflict#assertion-1'];

  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary })),
  });

  assert.equal(code, 4);
  assert.equal(JSON.parse(out()).issues[0].code, WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT);
});

// ---------------------------------------------------------------------------
// Usage and input refusals (3) — decided before anything is read or loaded
// ---------------------------------------------------------------------------

test('3 — every usage refusal is decided before a byte is read', async () => {
  const cases = [
    { argv: [], fragment: /not imported implicitly/ },
    { argv: ['document.json'], fragment: /not imported implicitly/ },
    { argv: ['--validator'], fragment: /require a value/ },
    { argv: ['--validator', ''], fragment: /require a value/ },
    { argv: ['--validator', './v.mjs'], fragment: /exactly one document path is required/ },
    { argv: ['--validator', './v.mjs', 'a.json', 'b.json'], fragment: /extra arguments/ },
    { argv: ['--validator', './v.mjs', '-'], fragment: /standard input/ },
    { argv: ['--validator', './v.mjs', '--capability', 'tools'], fragment: /unknown option/ },
    { argv: ['--validator', './v.mjs', '--validator', './w.mjs', 'd.json'], fragment: /more than once/ },
  ];

  for (const { argv, fragment } of cases) {
    let readCount = 0;
    let loadCount = 0;
    const sinks = makeSinks({
      readFile: () => {
        readCount += 1;
        return DOCUMENT_TEXT;
      },
      loadModule: async () => {
        loadCount += 1;
        return {};
      },
    });

    const code = await main(argv, sinks.io);

    assert.equal(code, 3, `expected 3 for ${JSON.stringify(argv)}`);
    assert.equal(readCount, 0, 'a usage error never reads the document');
    assert.equal(loadCount, 0, 'a usage error never loads a module');
    assert.equal(sinks.out(), '', 'a usage error prints nothing on stdout');
    assert.match(sinks.err(), fragment);
  }
});

test('3 — --help prints usage on stderr and nothing on stdout', async () => {
  const sinks = makeSinks({
    readFile: () => {
      throw new Error('must not be called');
    },
    loadModule: async () => {
      throw new Error('must not be called');
    },
  });

  const code = await main(['--help'], sinks.io);

  assert.equal(code, 0, '--help is the only path that exits 0 without evidence');
  assert.equal(sinks.out(), '');
  assert.match(sinks.err(), /admission-cli/);
  assert.match(sinks.err(), /Exit codes:/);
});

test('3 — a foreign reader error is reported without its message', async () => {
  const secret = '/root/.dsh/private/document.json';
  const sinks = makeSinks({
    readFile: () => {
      throw new Error(`EACCES: permission denied, open '${secret}'`);
    },
    loadModule: async () => {
      throw new Error('must not be called');
    },
  });

  const code = await main(['--validator', './v.mjs', secret], sinks.io);

  assert.equal(code, 3);
  assert.equal(sinks.out(), '');
  assert.match(sinks.err(), /could not be read by the injected reader/);
  assert.ok(!sinks.err().includes(secret), 'the path is never echoed');
  assert.ok(!sinks.err().includes('EACCES'), 'the OS message is never echoed');
});

test('3 — document not JSON: the parser message is suppressed', async () => {
  const { code, out, err } = await runCli({
    document: '{"schemaVersion": "admission-evidence/0.1-draft.1",,}',
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })),
  });

  assert.equal(code, 3);
  assert.equal(out(), '');
  assert.match(err(), /not valid JSON/);
  assert.ok(!err().includes('admission-evidence/0.1-draft.1'), 'no document content is echoed');
});

test('3 — the real bounded reader is reused, not re-implemented', async () => {
  // `readFile` is deliberately omitted, so the real `readEvidenceFile` runs. A
  // path that certainly does not exist must be refused by THAT reader, and the
  // refusal is reported in this lane's own words. Nothing is written.
  const sinks = makeSinks();
  const code = await main(['--validator', './v.mjs', 'tests/fixtures/__does-not-exist__.json'], sinks.io);

  assert.equal(code, 3);
  assert.equal(sinks.out(), '');
  assert.match(sinks.err(), /refused by the bounded reader/);
  assert.ok(!sinks.err().includes('evidence-cli:'), 'another entry point\'s label is not reused');
});

test('3 — a module that does not export a function is refused', async () => {
  const { code, err } = await runCli({ moduleNamespace: { validateAdmissionEvidence: 42 } });
  assert.equal(code, 3);
  assert.match(err(), /does not export the requested name as a function/);
});

test('3 — a module that fails to load is reported without its error', async () => {
  const sinks = makeSinks({
    readFile: () => DOCUMENT_TEXT,
    loadModule: async (target) => {
      throw new Error(`Cannot find module '${target}' imported from /root/.dsh/x.mjs`);
    },
  });

  const code = await main(['--validator', './missing.mjs', 'document.json'], sinks.io);

  assert.equal(code, 3);
  assert.match(sinks.err(), /could not be loaded/);
  assert.ok(!sinks.err().includes('/root/.dsh'));
  assert.equal(sinks.out(), '');
});

// ---------------------------------------------------------------------------
// The module seam: one explicit load, resolved the way the static CLI resolves it
// ---------------------------------------------------------------------------

test('the validator module is loaded exactly once, and the document is never loaded', async () => {
  const targets = [];
  const sinks = makeSinks({
    readFile: () => DOCUMENT_TEXT,
    loadModule: async (target) => {
      targets.push(target);
      return namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() }));
    },
  });

  const code = await main(['--validator', './tests/helpers/validator.mjs', 'document.json'], sinks.io);

  assert.equal(code, 0);
  assert.equal(targets.length, 1, 'no implicit import beyond the one named module');
  assert.equal(targets[0], pathToFileURL(resolve(process.cwd(), './tests/helpers/validator.mjs')).href);
});

test('a bare specifier is passed through for Node to resolve; a file: URL is accepted', async () => {
  const targets = [];
  const loader = async (target) => {
    targets.push(target);
    return namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() }));
  };

  await main(['--validator', 'dsh-compat-spec', 'document.json'], makeSinks({ readFile: () => DOCUMENT_TEXT, loadModule: loader }).io);
  await main(['--validator', 'file:///tmp/validator.mjs', 'document.json'], makeSinks({ readFile: () => DOCUMENT_TEXT, loadModule: loader }).io);
  await main(['--validator', '/tmp/validator.mjs', 'document.json'], makeSinks({ readFile: () => DOCUMENT_TEXT, loadModule: loader }).io);

  // The `file:` URL arrives UNCHANGED. `src/cli.js` would push it through
  // `resolve(process.cwd(), ...)` and corrupt it into `<cwd>/file:/tmp/...`; that
  // defect is recorded in README §10 and deliberately not reproduced here.
  assert.deepEqual(targets, [
    'dsh-compat-spec',
    'file:///tmp/validator.mjs',
    pathToFileURL('/tmp/validator.mjs').href,
  ]);
});

test('--export selects a dotted binding, and the default is the canonical name', async () => {
  const namespace = { ns: { validateAdmissionEvidence: fixedValidator({ valid: true, issues: [], summary: acceptedSummary() }) } };

  const explicit = await runCli({ argv: ['--validator', './v.mjs', '--export', 'ns.validateAdmissionEvidence', 'document.json'], moduleNamespace: namespace });
  assert.equal(explicit.code, 0);
  assert.equal(Object.keys(namespace).length, 1, 'nothing else in the namespace is touched');
});

// ---------------------------------------------------------------------------
// Output boundaries
// ---------------------------------------------------------------------------

test('the document\'s baseline is never reflected into the diagnosis', async () => {
  const { code, out } = await runCli({
    moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })),
  });

  assert.equal(code, 0);
  assert.ok(!out().includes('a1b2c3d4e5f6a7b8c9d0'), 'the commit is not republished');
  assert.ok(!out().includes('baseline'), 'no baseline field is invented');
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(out()), 'baseline'));
});

test('the same document and the same deterministic validator print byte-identical output', async () => {
  const run = () =>
    runCli({ moduleNamespace: namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })) });

  const first = await run();
  const second = await run();

  assert.equal(first.code, second.code);
  assert.equal(first.out(), second.out());
  assert.ok(first.out().endsWith('\n'), 'output is one JSON document plus a newline');
});

test('5 — a failing output sink is an internal failure, not a verdict', async () => {
  const sinks = makeSinks({
    stdout: () => {
      throw new Error('EPIPE: broken pipe');
    },
    readFile: () => DOCUMENT_TEXT,
    loadModule: async () => namespaceWith(fixedValidator({ valid: true, issues: [], summary: acceptedSummary() })),
  });

  const code = await main(['--validator', './v.mjs', 'document.json'], sinks.io);

  assert.equal(code, 5);
  assert.match(sinks.err(), /internal failure/);
});

// ---------------------------------------------------------------------------
// This entry point's own discipline, asserted over its source
// ---------------------------------------------------------------------------

test('the source imports only built-ins and two fixed local modules', () => {
  const specifiers = [...SOURCE.matchAll(/from\s+'([^']+)'/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../'));

  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ['./admission-diagnostics.js', './evidence-cli.js', 'node:fs', 'node:path', 'node:url'],
  );
});

test('the source contains no host, driver, runner, subprocess, network or write path', () => {
  const forbidden = [
    'dsh-agent-test-driver',
    'run-loop',
    'collectObservations',
    'HOST_PORTS',
    'child_process',
    'node:net',
    'node:http',
    'node:https',
    'fetch(',
    'process.env',
    'writeFileSync',
    'appendFileSync',
    'createWriteStream',
    'mkdirSync',
    'rmSync',
    'unlinkSync',
    'renameSync',
    'openSync',
    'readFileSync',
  ];

  for (const needle of forbidden) {
    assert.ok(!SOURCE.includes(needle), `source must not mention ${needle}`);
  }

  // Dynamic import is the ONE required escape hatch: it is how `--validator` is
  // loaded. Banning it outright would ban the feature, so its presence is
  // asserted instead, together with the single guard that gates it.
  assert.ok(SOURCE.includes('import(target)'), 'the explicit module load is present');
  assert.ok(!SOURCE.includes('process.exit('), 'the module never terminates the process');
  assert.equal(SOURCE.match(/process\.exitCode =/g).length, 1, 'exactly one guarded auto-run');
  assert.ok(SOURCE.startsWith('#!/usr/bin/env node'), 'the file is a bin entry point');
});

test('importing the module is inert: no output, no exit, no run', async () => {
  const before = process.exitCode;
  const writes = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;

  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  try {
    // A distinct URL keeps this import out of the module registry used above, so
    // the top-level guard is evaluated afresh.
    const imported = await import(new URL('../src/admission-cli.js?inert=1', import.meta.url).href);
    assert.equal(typeof imported.main, 'function');
    assert.equal(typeof imported.ADMISSION_EXIT_CODES, 'object');
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  assert.deepEqual(writes, [], 'importing the entry point executes nothing');
  assert.equal(process.exitCode, before);
});

test('the diagnostics layer is reachable from the package root without the static lane', () => {
  assert.equal(typeof diagnoseAdmissionEvidence, 'function');
  assert.equal(typeof DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED, 'string');
  assert.equal(typeof WRAPPER_ISSUE_CODES.VALIDATOR_THREW, 'string');
});

// ---------------------------------------------------------------------------
// The real path: default loader, default reader, canonical grammar
//
// Everything above injects `loadModule`, so the module resolution and the
// dynamic import are never actually exercised. These tests remove that
// injection: the adapter/document files are created under a temporary directory
// at run time and deleted in `finally`, and the validator is the canonical
// `validateAdmissionEvidence`, resolved through `tests/helpers/spec-module.mjs`
// (package specifier first, the sibling checkout second).
//
// The documents below are AUTHORED TO THE CATALOG, not recorded runs: a shape a
// coordinator could have produced, used to make the real grammar decide. Only the
// spec module's own `CASE_IDS` / `ASSERTION_IDS` / `VERSION` are read, so the data
// cannot silently drift from the grammar it is meant to satisfy.
// ---------------------------------------------------------------------------

const CANONICAL_SPEC_URL = resolveSpecModule('./admission-evidence');

/**
 * The canonical grammar. A missing or unusable checkout is a FAILURE of this
 * suite, never a skip and never a fallback: these four tests exist to prove the
 * real grammar decides the outcome, so substituting a stub would make them
 * vacuous. `tests/helpers/spec-validator.mjs` states the same rule for the static
 * lane, and the analysis must never silently run against a different rule set
 * than the one the caller believed they injected.
 *
 * @returns {Promise<object>} The spec module namespace.
 * @throws {Error} When the canonical module cannot be imported or exports no
 *   `validateAdmissionEvidence`.
 */
async function loadCanonicalSpec() {
  let spec;
  try {
    spec = await import(CANONICAL_SPEC_URL.href);
  } catch (error) {
    const detail = error !== null && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : String(error);
    throw new Error(
      `required canonical grammar could not be imported from ${CANONICAL_SPEC_URL.label}: ${detail}`,
    );
  }
  if (typeof spec.validateAdmissionEvidence !== 'function') {
    throw new Error(
      `required canonical grammar at ${CANONICAL_SPEC_URL.label} exports no validateAdmissionEvidence()`,
    );
  }
  return spec;
}

/**
 * A document with every catalog case present, each carrying its full assertion
 * set observed `true`, and the one case whose expected outcome is a refusal
 * reported as `refused`.
 *
 * `coverage.unknown` in the canonical summary is "catalog cases the document did
 * not report", so omitting any optional case is what makes a document incomplete.
 */
function canonicalDocument(spec, options = {}) {
  const omit = options.omit ?? [];
  const cases = spec.CASE_IDS.filter((id) => !omit.includes(id)).map((id) => ({
    id,
    status: id === 'admission-refused-conflict' ? 'refused' : 'passed',
    assertions: spec.ASSERTION_IDS[id].map((assertionId) => ({ id: assertionId, passed: true })),
    limitations: [],
  }));

  return {
    schemaVersion: spec.VERSION,
    // `not-recorded` is the honest value for a document not tied to a commit.
    baseline: { commit: 'not-recorded', node: process.versions.node },
    coordination: {
      coordinatorIdentity: 'observed-identical',
      provisioning: 'caller-supplied',
      scopeVisibility: 'not-determined',
    },
    cases,
    limitations: ['authored for the CLI suite; not a recorded host run'],
  };
}

/** Run the CLI with ONLY the sinks injected: real reader, real dynamic import. */
async function runRealCli(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    stdout: (chunk) => out.push(String(chunk)),
    stderr: (chunk) => err.push(String(chunk)),
  });
  return { code, out: () => out.join(''), err: () => err.join('') };
}

/** A fresh temporary directory, plus a `write` helper and a `dispose`. */
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'admission-cli-'));
  return {
    path: join(directory, 'document.json'),
    directory,
    write(name, contents) {
      const target = join(directory, name);
      writeFileSync(target, contents, 'utf8');
      return target;
    },
    dispose() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('the DEFAULT loader really imports the file: URL named on the command line', async () => {
  const spec = await loadCanonicalSpec();

  const temporary = temporaryDirectory();
  try {
    // An adapter written at run time: if the default loader did not really import
    // the file behind this URL, nothing would resolve and the exit code would be 3.
    const adapter = temporary.write(
      'canonical-adapter.mjs',
      `export { validateAdmissionEvidence } from ${JSON.stringify(CANONICAL_SPEC_URL.href)};\n`,
    );
    const document = temporary.write('document.json', `${JSON.stringify(canonicalDocument(spec))}\n`);

    const { code, out, err } = await runRealCli([
      '--validator',
      pathToFileURL(adapter).href,
      document,
    ]);

    assert.equal(code, 0, `expected 0, stderr: ${err()}`);
    assert.equal(err(), '', 'a clean diagnosis says nothing on stderr');
    const printed = JSON.parse(out());
    assert.equal(printed.valid, true);
    assert.equal(printed.certification, false);
    assert.deepEqual(
      printed.findings.map((finding) => finding.code),
      [DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED],
      'the refused case is the only finding, and it is not a failure',
    );
  } finally {
    temporary.dispose();
  }
});

test('the canonical grammar accepts a full-coverage document — exit 0', async () => {
  const spec = await loadCanonicalSpec();

  const temporary = temporaryDirectory();
  try {
    const document = temporary.write('document.json', `${JSON.stringify(canonicalDocument(spec))}\n`);

    const { code, out, err } = await runRealCli([
      '--validator',
      CANONICAL_SPEC_URL.href,
      document,
    ]);

    assert.equal(code, 0, `expected 0, stderr: ${err()}`);
    const printed = JSON.parse(out());
    assert.equal(printed.valid, true);
    assert.deepEqual(printed.issues, []);
    assert.deepEqual(printed.summary.coverage.unknown, [], 'every catalog case was reported');
    assert.equal(printed.summary.coverage.present.length, 8);
    assert.deepEqual(printed.summary.coverage.required, [...REQUIRED_CASES]);
    assert.deepEqual(
      printed.summary.cases.map((entry) => entry.id),
      [...REQUIRED_CASES, ...OPTIONAL_CASES],
      'the summary lists cases in catalog order',
    );
    assert.equal(
      printed.summary.cases.reduce((total, entry) => total + entry.assertionCount, 0),
      37,
      'the full catalog adds up to the 37 assertions',
    );
    assert.deepEqual(
      printed.findings.map((finding) => finding.caseId),
      ['admission-refused-conflict'],
      'only the expected refusal is reported',
    );
  } finally {
    temporary.dispose();
  }
});

test('the canonical grammar calls an unreported optional case unknown coverage — exit 1', async () => {
  const spec = await loadCanonicalSpec();

  const temporary = temporaryDirectory();
  try {
    const document = temporary.write(
      'document.json',
      `${JSON.stringify(canonicalDocument(spec, { omit: ['admission-visibility'] }))}\n`,
    );

    const { code, out } = await runRealCli(['--validator', CANONICAL_SPEC_URL.href, document]);

    assert.equal(code, 1);
    const printed = JSON.parse(out());
    assert.equal(printed.valid, true, 'the document itself is still well formed');
    assert.deepEqual(printed.summary.coverage.unknown, ['admission-visibility']);
    // Findings are emitted reported-case-first and unknown-coverage-last
    // (`findingsFor` in admission-diagnostics.js: case findings in summary order,
    // then one per coverage.unknown id), so the omission is the SECOND finding even
    // though it is what makes the document incomplete. Asserted as one exact array
    // so neither order nor the expected refusal can drift unnoticed.
    assert.deepEqual(
      printed.findings.map((finding) => ({
        code: finding.code,
        caseId: finding.caseId,
        status: finding.status,
      })),
      [
        {
          code: DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED,
          caseId: 'admission-refused-conflict',
          status: 'refused',
        },
        {
          code: DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN,
          caseId: 'admission-visibility',
          status: null,
        },
      ],
    );
  } finally {
    temporary.dispose();
  }
});

test('the canonical grammar rejects a bad baseline — exit 2 with the protocol code', async () => {
  const spec = await loadCanonicalSpec();

  const temporary = temporaryDirectory();
  try {
    const broken = canonicalDocument(spec);
    broken.baseline.commit = 'not-a-commit';
    const document = temporary.write('document.json', `${JSON.stringify(broken)}\n`);

    const { code, out, err } = await runRealCli(['--validator', CANONICAL_SPEC_URL.href, document]);

    assert.equal(code, 2, 'the grammar rejected it: the document is wrong, not the validator');
    assert.match(err(), /rejected the document/);
    const printed = JSON.parse(out());
    assert.equal(printed.valid, false);
    assert.ok(
      printed.issues.some((issue) => issue.code === 'INVALID_COMMIT'),
      'the protocol code is reported, unreworded',
    );
    assert.equal(Object.hasOwn(printed, 'summary'), false);
  } finally {
    temporary.dispose();
  }
});
