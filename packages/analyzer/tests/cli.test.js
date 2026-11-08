import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const validator = './tests/helpers/fake-validator.js';

function run(args, { input, cwd = packageRoot } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    input: input === undefined ? '' : input,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseReport(stdout) {
  const report = JSON.parse(stdout);
  assert.equal(stdout.endsWith('\n'), true, 'the report must end with a newline');
  assert.deepEqual(Object.keys(report), ['evidenceLevel', 'findings', 'limitations', 'summary']);
  assert.equal(report.evidenceLevel, 'static-declaration');
  return report;
}

test('clean fixture exits 0 and produces an empty finding list', () => {
  const result = run(['--validator', validator, 'fixtures/clean.json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = parseReport(result.stdout);
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.availableCapabilities, 1);
  assert.equal(report.summary.analysisComplete, true);
});

test('conflicting fixture exits 1 with every documented finding code', () => {
  const result = run(['--validator', validator, 'fixtures/with-conflict.json']);
  assert.equal(result.code, 1, result.stderr);
  const report = parseReport(result.stdout);
  const byCode = new Map(report.findings.map((finding) => [finding.code, finding]));

  assert.deepEqual([...byCode.keys()], [
    'DUPLICATE_PLUGIN_ID',
    'MISSING_CAPABILITY',
    'RESOURCE_CONFLICT',
  ]);
  assert.equal(byCode.get('RESOURCE_CONFLICT').severity, 'warning');
  assert.deepEqual(byCode.get('RESOURCE_CONFLICT').pluginIds, ['store-a', 'store-b']);
  assert.deepEqual(byCode.get('RESOURCE_CONFLICT').resource, {
    kind: 'service',
    name: 'store',
    scope: 'shared',
  });
  assert.deepEqual(byCode.get('MISSING_CAPABILITY').pluginIds, ['store-a', 'store-b']);
});

test('the reordered fixture produces a byte-identical report', () => {
  const ordered = run(['--validator', validator, 'fixtures/with-conflict.json']);
  const reordered = run(['--validator', validator, 'fixtures/with-conflict-reordered.json']);
  assert.equal(ordered.code, 1, ordered.stderr);
  assert.equal(reordered.code, 1, reordered.stderr);
  assert.equal(reordered.stdout, ordered.stdout);
});

test('the same kind and name under different scopes exits 0 (no conflict)', () => {
  const result = run(['--validator', validator, 'fixtures/scope-labels.json']);
  assert.equal(result.code, 0, result.stderr);
  const report = parseReport(result.stdout);
  assert.deepEqual(report.findings, []);
});

test('optional requirements shared by several plugins produce no finding at all', () => {
  const result = run(['--validator', validator, 'fixtures/duplicate-optional.json']);
  assert.equal(result.code, 0, result.stderr);
  const report = parseReport(result.stdout);
  assert.deepEqual(report.findings, []);
});

test('an invalid declaration fails closed and never yields dependency conclusions', () => {
  const result = run(['--validator', validator, 'fixtures/invalid-declaration.json']);
  assert.equal(result.code, 1, result.stderr);
  const report = parseReport(result.stdout);
  assert.deepEqual([...new Set(report.findings.map((finding) => finding.code))], ['INVALID_DECLARATION']);
  assert.equal(report.summary.analysisComplete, false);
  assert.ok(report.limitations.some((entry) => entry.code === 'PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS'));
});

test('omitting availableCapabilities is refused: there is no "unknown" availability state', () => {
  const manifest = JSON.stringify({
    declarations: [
      {
        schemaVersion: '0.1.0-draft.1',
        plugin: { id: 'needs-redis', version: '1.0.0' },
        capabilities: { required: ['svc:redis'], optional: [] },
        resources: [],
      },
    ],
  });

  const result = run(['--validator', validator, '-'], { input: manifest });
  assert.equal(result.code, 2, `expected a manifest-contract failure, got ${result.code}: ${result.stderr}`);
  assert.equal(result.stdout, '', 'no report may be printed for a malformed envelope');
  assert.match(result.stderr, /availableCapabilities is required/);
  assert.match(result.stderr, /pass \[\]/);
});

test('an explicit empty availableCapabilities is the empty set, not "unknown"', () => {
  const manifest = JSON.stringify({
    declarations: [
      {
        schemaVersion: '0.1.0-draft.1',
        plugin: { id: 'needs-redis', version: '1.0.0' },
        capabilities: { required: ['svc:redis'], optional: [] },
        resources: [],
      },
    ],
    availableCapabilities: [],
  });

  const result = run(['--validator', validator, '-'], { input: manifest });
  assert.equal(result.code, 1, result.stderr);
  const report = parseReport(result.stdout);
  assert.equal(report.summary.availableCapabilities, 0);
  assert.deepEqual(report.findings.map((finding) => finding.pluginIds), [['needs-redis']]);
});

test('the manifest passes its declarations through verbatim: a {value:...} wrapper is not unwrapped', () => {
  const manifest = JSON.stringify({
    declarations: [
      {
        value: {
          schemaVersion: '0.1.0-draft.1',
          plugin: { id: 'x', version: '1.0.0' },
          capabilities: { required: [], optional: [] },
          resources: [],
        },
      },
    ],
    availableCapabilities: [],
  });

  const result = run(['--validator', validator, '-'], { input: manifest });
  assert.equal(result.code, 1, result.stderr);
  const report = parseReport(result.stdout);
  assert.deepEqual(report.findings.map((finding) => finding.code), ['INVALID_DECLARATION']);
  assert.match(report.findings[0].message, /schemaVersion/);
});

test('an unreadable manifest exits 2 without printing a report', () => {
  const result = run(['--validator', validator, 'fixtures/does-not-exist.json']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /cannot read manifest/);
});

test('malformed JSON exits 2 and no code from the document runs', () => {
  const result = run(['--validator', validator, 'fixtures/malformed.json']);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /manifest is not valid JSON/);
});

test('a JSON document containing executable-looking text is still only data', () => {
  const hostile = JSON.stringify({
    declarations: [
      {
        schemaVersion: '0.1.0-draft.1',
        plugin: { id: 'x', version: '1.0.0' },
        capabilities: { required: [], optional: [] },
        resources: [],
        // The analyzer must not evaluate, import or resolve any of these.
        exports: { apply: 'process.exit(99)' },
        runtime: '!!js/patch.js',
        schema: { $ref: 'file:///etc/passwd' },
      },
    ],
    availableCapabilities: [],
  });

  const result = run(['--validator', validator, '-'], { input: hostile });
  assert.notEqual(result.code, 99);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(parseReport(result.stdout).findings, []);
});

test('manifest on stdin ("-") behaves exactly like a file', () => {
  const text = readFileSync(`${packageRoot}fixtures/clean.json`, 'utf8');
  const fromStdin = run(['--validator', validator, '-'], { input: text });
  const fromFile = run(['--validator', validator, 'fixtures/clean.json']);
  assert.equal(fromStdin.code, 0, fromStdin.stderr);
  assert.equal(fromStdin.stdout, fromFile.stdout);
});

test('a missing --validator is a usage error: nothing is imported implicitly', () => {
  const result = run(['fixtures/clean.json']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--validator <path> is required/);
  assert.match(result.stderr, /not imported implicitly/);
});

test('a missing manifest argument is a usage error', () => {
  const result = run(['--validator', validator]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /manifest path/);
});

test('unknown options are rejected instead of ignored', () => {
  const result = run(['--validator', validator, '--fix', 'fixtures/clean.json']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unknown option "--fix"/);
});

test('a validator path that does not exist exits 3 with the trust boundary spelled out', () => {
  const result = run(['--validator', './tests/helpers/nope.js', 'fixtures/clean.json']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /cannot load validator/);
  assert.match(result.stderr, /only point it at trusted code/);
});

test('a module without the requested export is rejected, not silently skipped', () => {
  const result = run(['--validator', validator, '--export', 'assertValidDeclaration', 'fixtures/clean.json']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /does not export "assertValidDeclaration" as a function/);
});

test('a throwing validator exits 4 and analysis fails closed', () => {
  const result = run(['--validator', './tests/helpers/exploding-validator.mjs', 'fixtures/clean.json']);
  assert.equal(result.code, 4);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /analysis failed closed/);
});

test('--help prints usage to stderr and exits 0 without touching the manifest', () => {
  const result = run(['--help', 'fixtures/clean.json']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /TRUST BOUNDARY/i);
});

test('the report is byte-identical across runs (determinism)', () => {
  const first = run(['--validator', validator, 'fixtures/with-conflict.json']);
  const second = run(['--validator', validator, 'fixtures/with-conflict.json']);
  assert.equal(first.code, 1);
  assert.equal(first.stdout, second.stdout);
});

test('output does not depend on the working directory', () => {
  const fromRoot = run(['--validator', validator, 'fixtures/with-conflict.json']);
  // Relative validator paths resolve against the working directory (documented),
  // so it is respelled here; the manifest content and report are identical.
  const fromTests = run(['--validator', `../${validator}`, '../fixtures/with-conflict.json'], {
    cwd: `${packageRoot}tests`,
  });
  assert.equal(fromTests.code, 1, fromTests.stderr);
  assert.equal(fromTests.stdout, fromRoot.stdout);
});

test('the CLI writes no files and creates no directories', () => {
  const snapshot = (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) return [`${path}/`, ...snapshot(`${path}/`)];
        return [`${path} ${statSync(path).size} ${statSync(path).mtimeMs}`];
      })
      .sort();

  const before = snapshot(packageRoot);
  run(['--validator', validator, 'fixtures/with-conflict.json']);
  run(['--validator', validator, 'fixtures/invalid-declaration.json']);
  run(['--validator', validator, '-'], { input: '{"declarations":[],"availableCapabilities":[]}' });
  const after = snapshot(packageRoot);

  assert.deepEqual(after, before);
  for (const stray of ['report.json', 'out.json', 'dsh-compat-report.json', 'dist', 'node_modules', '.cache']) {
    assert.equal(existsSync(`${packageRoot}${stray}`), false, `CLI must not create ${stray}`);
  }
});
