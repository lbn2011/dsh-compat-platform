/**
 * Tests for `dependency-shape.js` and its CLI.
 *
 * Two properties matter beyond the obvious ones and are asserted directly:
 *   - no document text reaches the summary (sentinel identifiers are written into fixtures and
 *     then looked for in the serialised output);
 *   - the refusal vocabulary agrees with `profile-dump.js`, which walks the same documents. The
 *     two modules each carry a copy of the parse prologue and the safety walk on purpose; this
 *     corpus is what stops the copies from drifting.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEPENDENCY_SHAPE_CODES,
  DEPENDENCY_SHAPE_EXIT,
  DEPENDENCY_SHAPE_LIMITATIONS,
  DEPENDENCY_SHAPE_LIMITS,
  DEPENDENCY_SHAPE_NOT_DERIVED,
  DEPENDENCY_SHAPE_SCHEMA,
  dependencyShapeExitCode,
  summarizeDependencyShapeText,
} from '../src/dependency-shape.js';
import { main } from '../src/dependency-shape-cli.js';
import { PROFILE_DUMP_REFUSAL_CODES, summarizeProfileDumpText } from '../src/profile-dump.js';

const CLI = fileURLToPath(new URL('../src/dependency-shape-cli.js', import.meta.url));

/** Summarise and also report the exit code the CLI would use. */
function summarize(text) {
  const result = summarizeDependencyShapeText(text);
  return { ...result, exit: dependencyShapeExitCode(result), json: JSON.stringify(result.summary) };
}

/** Diagnostic codes, in order. */
function codes(result) {
  return result.summary.diagnostics.map((diagnostic) => diagnostic.code);
}

/**
 * Sentinel text: every fixture below is written with these words in it, and no output may
 * contain any of them.
 */
const SECRETS = ['secret-plugin', 'Secret Plugin', 'svc-hidden', 'infra', 'intercept-key', 'top-secret'];

function assertSilent(json) {
  for (const secret of SECRETS) {
    assert.equal(json.includes(secret), false, `the summary must not contain "${secret}"`);
  }
}

/** A dump with two rows: one with a name list, one with an intercept mapping. */
const TWO_ROWS = `- id: secret-plugin
  name: Secret Plugin
  config:
    greeting: hello
  inject:
    - svc-hidden
    - infra
- id: second-row
  name: second
  inject:
    intercept-key:
      top-secret: true
`;

test('the summary is a closed document with fixed literals', () => {
  const result = summarize(TWO_ROWS);
  assert.equal(result.ok, true);
  assert.equal(result.exit, 0);
  const summary = result.summary;

  assert.deepEqual(Object.keys(summary), [
    'dependencyShapeSummary',
    'input',
    'documents',
    'inventory',
    'root',
    'counts',
    'limits',
    'diagnostics',
    'diagnosticsTruncated',
    'completeness',
    'runtimeValidation',
    'certification',
    'notDerived',
    'limitations',
  ]);
  assert.equal(summary.dependencyShapeSummary, DEPENDENCY_SHAPE_SCHEMA);
  assert.equal(summary.inventory, 'present');
  assert.equal(summary.root, 'sequence');
  assert.equal(summary.completeness, 'unknown');
  assert.equal(summary.runtimeValidation, 'not-performed');
  assert.equal(summary.certification, false);
  assert.deepEqual(summary.limits, { ...DEPENDENCY_SHAPE_LIMITS });
  assert.equal(summary.notDerived.length, 6);
  assert.deepEqual([...summary.notDerived], [...DEPENDENCY_SHAPE_NOT_DERIVED]);
  assert.deepEqual([...summary.limitations], [...DEPENDENCY_SHAPE_LIMITATIONS]);
  assertSilent(result.json);
});

test('the two invariants hold on the counters', () => {
  const result = summarize(TWO_ROWS);
  const counts = result.summary.counts;
  assert.equal(
    counts.rowsWithInject,
    counts.injectNull + counts.injectSequence + counts.injectMapping + counts.injectOther,
  );
  assert.equal(
    counts.injectSequenceItems,
    counts.injectNames + counts.injectTaggedItems + counts.injectNonScalarItems,
  );
  assert.equal(counts.rows, 2);
  assert.equal(counts.rowsWithInject, 2);
  assert.equal(counts.injectSequence, 1);
  assert.equal(counts.injectNames, 2);
  assert.equal(counts.injectMapping, 1);
  assert.equal(counts.injectMappingKeys, 1);
});

test('a row without the key is absent, not null', () => {
  const result = summarize('- id: only\n  name: n\n');
  assert.equal(result.exit, 0);
  const counts = result.summary.counts;
  assert.deepEqual(
    {
      rows: counts.rows,
      rowsWithInject: counts.rowsWithInject,
      injectAbsent: counts.injectAbsent,
      injectNull: counts.injectNull,
    },
    { rows: 1, rowsWithInject: 0, injectAbsent: 1, injectNull: 0 },
  );
});

test('an explicit null is its own word and stays exit 0', () => {
  const result = summarize('- id: a\n  name: a\n  inject: null\n');
  assert.equal(result.exit, 0);
  assert.equal(result.summary.counts.injectNull, 1);
  assert.equal(result.summary.counts.injectAbsent, 0);
  assert.deepEqual(codes(result), []);
});

test('an empty mapping and an empty sequence are counted, and stay exit 0', () => {
  const sequence = summarize('- id: a\n  name: a\n  inject: []\n');
  assert.equal(sequence.exit, 0);
  assert.equal(sequence.summary.counts.injectSequence, 1);
  assert.equal(sequence.summary.counts.injectSequenceItems, 0);

  const mapping = summarize('- id: a\n  name: a\n  inject: {}\n');
  assert.equal(mapping.exit, 0);
  assert.equal(mapping.summary.counts.injectMapping, 1);
  assert.equal(mapping.summary.counts.injectEmptyMappings, 1);
  assert.equal(mapping.summary.counts.injectMappingKeys, 0);
});

test('a scalar inject is not modelled: counted as other and reported once', () => {
  const result = summarize('- id: a\n  name: a\n  inject: svc-hidden\n');
  assert.equal(result.ok, true);
  assert.equal(result.exit, DEPENDENCY_SHAPE_EXIT.ENTRY_DIAGNOSTICS);
  assert.equal(result.summary.counts.injectOther, 1);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.INJECT_SHAPE_NOT_MODELLED]);
  assert.equal(result.summary.diagnostics[0].ordinal, 1);
  assert.equal(result.summary.diagnostics[0].line, 3);
  assert.equal(result.summary.diagnostics[0].detail, null);
  assertSilent(result.json);
});

test('a nested collection inside a name list is counted but not read', () => {
  const text = `- id: a
  name: a
  inject:
    - svc-hidden
    - intercept-key: true
`;
  const result = summarize(text);
  assert.equal(result.exit, DEPENDENCY_SHAPE_EXIT.ENTRY_DIAGNOSTICS);
  const counts = result.summary.counts;
  assert.equal(counts.injectSequenceItems, 2);
  assert.equal(counts.injectNames, 1);
  assert.equal(counts.injectNonScalarItems, 1);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.INJECT_ITEM_NOT_A_NAME]);
  assert.equal(result.summary.diagnostics[0].ordinal, 1);
  assertSilent(result.json);
});

test('a tagged name is counted as tagged, and the expression is never evaluated', () => {
  const text = '- id: a\n  name: a\n  inject:\n    - !!js process.env.SECRET_LIST\n';
  const result = summarize(text);
  const counts = result.summary.counts;
  assert.equal(counts.injectSequenceItems, 1);
  assert.equal(counts.injectTaggedItems, 1);
  assert.equal(counts.injectNames, 0);
  assert.equal(counts.jsScalars, 1);
  // Informational only: an expression where a name stands is not an entry-level problem.
  assert.equal(result.exit, DEPENDENCY_SHAPE_EXIT.OK);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.JS_EXPRESSION_NOT_EVALUATED]);
  assert.equal(result.json.includes('process.env.SECRET_LIST'), false);
});

test('an empty export is empty, not healthy', () => {
  const result = summarize('\n');
  assert.equal(result.ok, true);
  assert.equal(result.summary.inventory, 'empty');
  assert.equal(result.summary.root, 'null');
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.EMPTY_INVENTORY]);
  assert.equal(result.summary.counts.rows, 0);
});

test('empty input is empty, not an error', () => {
  const result = summarize('');
  assert.equal(result.ok, true);
  assert.equal(result.exit, 0);
  assert.equal(result.summary.inventory, 'empty');
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.EMPTY_INPUT]);
  assert.deepEqual(result.summary.input, { bytes: 0, lines: 0 });
});

test('a refused document has null counters, never zeros', () => {
  const result = summarize('id: not-a-sequence\n');
  assert.equal(result.ok, false);
  assert.equal(result.exit, DEPENDENCY_SHAPE_EXIT.UNUSABLE);
  assert.equal(result.summary.inventory, 'none');
  assert.equal(result.summary.counts, null);
  assert.equal(result.summary.root, 'mapping');
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.ROOT_NOT_SEQUENCE]);
});

test('the byte count is measured, never taken from the caller', () => {
  const text = TWO_ROWS;
  const result = summarize(text);
  assert.equal(result.summary.input.bytes, Buffer.byteLength(text, 'utf8'));
  // `countLines` counts a trailing newline as starting one more (empty) line, and reports 0 for
  // the empty string; both facts are asserted here so the counter cannot drift silently.
  assert.equal(result.summary.input.lines, text.split('\n').length);
  assert.equal(summarize('').summary.input.lines, 0);
});

test('a non-string document is refused by type, with a fixed message', () => {
  for (const value of [null, undefined, 1, {}, [], Buffer.from('a')]) {
    assert.throws(() => summarizeDependencyShapeText(value), {
      name: 'TypeError',
      message: 'dependency-shape: the document must be a string',
    });
  }
});

/**
 * Malformed documents, and the refusal each must produce. Every module that walks a dump has to
 * agree on these; the corpus is shared with the cross-check below.
 */
const REFUSALS = [
  ['root mapping', 'id: a\n', DEPENDENCY_SHAPE_CODES.ROOT_NOT_SEQUENCE],
  ['row not a mapping', '- svc-hidden\n', DEPENDENCY_SHAPE_CODES.ENTRY_NOT_MAPPING],
  ['multi document', '---\n[]\n---\n[]\n', DEPENDENCY_SHAPE_CODES.MULTI_DOCUMENT],
  ['parse error', '- id: [\n', DEPENDENCY_SHAPE_CODES.PARSE_ERROR],
  ['duplicate key', '- id: a\n  id: b\n', DEPENDENCY_SHAPE_CODES.PARSE_ERROR],
  ['unsupported tag', '- id: !SecretTag a\n', DEPENDENCY_SHAPE_CODES.UNSUPPORTED_TAG],
  // A collection carrying the expression tag: the tag is allowed only on a scalar, so this is
  // refused. (`- id: !!js {} 1` would be a parse error, not this case — two nodes for one key.)
  ['js collection tag', '- id: !!js [1]\n', DEPENDENCY_SHAPE_CODES.UNSUPPORTED_TAG],
  ['anchor', '- id: &anchor a\n', DEPENDENCY_SHAPE_CODES.ANCHOR_PRESENT],
  ['alias', '- id: *anchor\n', DEPENDENCY_SHAPE_CODES.ALIAS_PRESENT],
  ['merge key', '- <<: {}\n', DEPENDENCY_SHAPE_CODES.MERGE_KEY],
  ['tagged key', '- !!str id: a\n', DEPENDENCY_SHAPE_CODES.TAG_KEY_PRESENT],
  ['too deep', `- ${'['.repeat(40)}${']'.repeat(40)}\n`, DEPENDENCY_SHAPE_CODES.DEPTH_LIMIT],
];

for (const [name, text, code] of REFUSALS) {
  test(`refuses ${name} with a fixed code`, () => {
    const result = summarize(text);
    assert.equal(result.ok, false, `${name} must be refused`);
    assert.equal(result.exit, DEPENDENCY_SHAPE_EXIT.UNUSABLE);
    assert.ok(codes(result).includes(code), `${name} must report ${code}, got ${codes(result).join(',')}`);
    assert.equal(result.summary.counts, null);
    assertSilent(result.json);
  });
}

test('an oversize document is refused before parsing', () => {
  const result = summarize('x'.repeat(DEPENDENCY_SHAPE_LIMITS.maxBytes + 1));
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.INPUT_TOO_LARGE]);
});

test('a document over the line cap is refused before parsing', () => {
  const result = summarize('\n'.repeat(DEPENDENCY_SHAPE_LIMITS.maxLines + 1));
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.INPUT_TOO_MANY_LINES]);
});

test('more rows than the entry cap is refused, not truncated', () => {
  const rows = '- id: a\n'.repeat(DEPENDENCY_SHAPE_LIMITS.maxEntries + 1);
  const result = summarize(rows);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [DEPENDENCY_SHAPE_CODES.ENTRY_LIMIT]);
});

test('refusals agree with the module that walks the same documents', () => {
  const profileRefusals = new Set(PROFILE_DUMP_REFUSAL_CODES);
  for (const [name, text] of REFUSALS) {
    const mine = summarize(text);
    const theirs = summarizeProfileDumpText(text);
    assert.equal(mine.ok, theirs.ok, `${name}: ok must agree`);
    const mineRefusals = codes(mine).filter((code) => DEPENDENCY_SHAPE_CODES[code] !== undefined && code !== DEPENDENCY_SHAPE_CODES.INJECT_SHAPE_NOT_MODELLED && code !== DEPENDENCY_SHAPE_CODES.INJECT_ITEM_NOT_A_NAME);
    const theirsRefusals = theirs.summary.diagnostics
      .map((diagnostic) => diagnostic.code)
      .filter((code) => profileRefusals.has(code));
    assert.deepEqual(mineRefusals, theirsRefusals, `${name}: refusal codes must agree`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Process-level behaviour of the command.
 * ----------------------------------------------------------------------------------------------*/

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dependency-shape-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the CLI as a process, with a minimal environment. */
function run(args) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=192', CLI, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('the command writes one document and exits 0 on a clean export', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'clean.yml');
  writeFileSync(file, TWO_ROWS);
  const result = run([file]);
  assert.equal(result.status, 0);
  const document = JSON.parse(result.stdout);
  assert.equal(document.dependencyShapeSummary, DEPENDENCY_SHAPE_SCHEMA);
  assert.equal(document.counts.rows, 2);
  assert.equal(result.stderr, '');
  assertSilent(result.stdout);
});

test('the command exits 1 when a row declares a shape the union does not cover', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'scalar.yml');
  writeFileSync(file, '- id: a\n  name: a\n  inject: svc-hidden\n');
  const result = run([file]);
  assert.equal(result.status, 1);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(
    document.diagnostics.map((diagnostic) => diagnostic.code),
    [DEPENDENCY_SHAPE_CODES.INJECT_SHAPE_NOT_MODELLED],
  );
});

test('the command exits 2 on a document it refuses', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'mapping.yml');
  writeFileSync(file, 'id: a\n');
  const result = run([file]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).counts, null);
});

test('the command exits 2 when the path is a directory', (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'sub'));
  const result = run([join(dir, 'sub')]);
  assert.equal(result.status, 2);
  assert.deepEqual(
    JSON.parse(result.stdout).diagnostics.map((diagnostic) => diagnostic.code),
    [DEPENDENCY_SHAPE_CODES.INPUT_NOT_REGULAR],
  );
});

test('the command exits 2 for a file that is not UTF-8', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'binary.yml');
  writeFileSync(file, Buffer.from([0x2d, 0x20, 0xff, 0xfe, 0x0a]));
  const result = run([file]);
  assert.equal(result.status, 2);
  assert.deepEqual(
    JSON.parse(result.stdout).diagnostics.map((diagnostic) => diagnostic.code),
    [DEPENDENCY_SHAPE_CODES.INPUT_NOT_UTF8],
  );
});

test('the command exits 64 with usage on stderr and one document on stdout', () => {
  for (const args of [[], ['-'], ['--help'], ['a.yml', 'b.yml']]) {
    const result = run(args);
    assert.equal(result.status, 64, `args ${JSON.stringify(args)}`);
    assert.match(result.stderr, /Usage:/);
    const document = JSON.parse(result.stdout);
    assert.deepEqual(
      document.diagnostics.map((diagnostic) => diagnostic.code),
      [DEPENDENCY_SHAPE_CODES.USAGE],
    );
    assert.equal(document.input, null);
    assert.equal(document.counts, null);
  }
});

test('a lost stdout write exits 5, never the code the summary earned', async () => {
  const failing = {
    write(_text, callback) {
      callback(new Error('EPIPE'));
    },
    once() {},
    removeListener() {},
  };
  const silent = {
    write(_text, callback) {
      callback(null);
    },
    once() {},
    removeListener() {},
  };
  const code = await main(['/nonexistent/path.yml'], { stdout: failing, stderr: silent });
  assert.equal(code, DEPENDENCY_SHAPE_EXIT.INTERNAL);
});

test('a synchronous throw from the stream also exits 5', async () => {
  const throwing = {
    write() {
      throw new Error('closed');
    },
    once() {},
    removeListener() {},
  };
  const silent = { write(_text, callback) { callback(null); }, once() {}, removeListener() {} };
  const code = await main(['/nonexistent/path.yml'], { stdout: throwing, stderr: silent });
  assert.equal(code, DEPENDENCY_SHAPE_EXIT.INTERNAL);
});
