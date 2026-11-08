/**
 * Tests for profile-dump: the pure summariser and the CLI wrapper.
 *
 * Two things are asserted throughout, and they are deliberately separate:
 *
 *   1. SHAPE — what the summary says about a document (counts, codes, exit code).
 *   2. SILENCE — what it must never say. Every fixture carries recognisable identifiers,
 *      paths, values and expression text; the assertions check that none of them reach the
 *      serialized output. A parser that echoed an error message, a config value or a `# ==`
 *      label would fail these tests even while returning the right counts.
 *
 * Nothing here loads a plugin, evaluates a `!!js` expression, or reaches the network.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROFILE_DUMP_CODES,
  PROFILE_DUMP_EXIT,
  PROFILE_DUMP_LIMITATIONS,
  PROFILE_DUMP_LIMITS,
  PROFILE_DUMP_NOT_DERIVED,
  PROFILE_DUMP_SCHEMA,
  profileDumpExitCode,
  summarizeProfileDumpText,
} from '../src/profile-dump.js';
import { main } from '../src/profile-dump-cli.js';

/** The CLI file itself, for the one test that runs it as a process instead of a function. */
const CLI_PATH = fileURLToPath(new URL('../src/profile-dump-cli.js', import.meta.url));

/** Run the summariser and return both halves, so tests can assert on each. */
function summarize(text) {
  const result = summarizeProfileDumpText(text);
  return { ...result, exit: profileDumpExitCode(result), json: JSON.stringify(result.summary) };
}

/** Assert that a serialized summary contains none of the given substrings. */
function assertSilent(json, secrets) {
  for (const secret of secrets) {
    assert.equal(
      json.includes(secret),
      false,
      `summary leaked ${JSON.stringify(secret)}: ${json.slice(0, 400)}`,
    );
  }
}

/** Codes present in a summary, in order. */
function codes(summary) {
  return summary.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('profile-dump — a well-formed export', () => {
  const dump = [
    '# == @fixture/dsh-bundle-probe',
    '- id: alpha',
    '  name: ./plugins/alpha.js',
    '  config:',
    '    marker: sentinel-value-alpha',
    '- id: beta',
    '  name: ./plugins/beta.js',
    '  disabled: true',
    '',
  ].join('\n');

  test('counts rows and emits no identifiers', () => {
    const { ok, summary, exit, json } = summarize(dump);
    assert.equal(ok, true);
    assert.equal(exit, PROFILE_DUMP_EXIT.OK);
    assert.equal(summary.profileDumpSummary, PROFILE_DUMP_SCHEMA);
    assert.equal(summary.inventory, 'present');
    assert.equal(summary.root, 'sequence');
    assert.equal(summary.documents, 1);
    assert.equal(summary.counts.entries, 2);
    assert.equal(summary.counts.entriesWithId, 2);
    assert.equal(summary.counts.entriesWithName, 2);
    assert.equal(summary.counts.entriesWithConfig, 1);
    assert.equal(summary.counts.entriesDisabled, 1);
    assert.equal(summary.counts.entryGroups, 0);
    assert.deepEqual(codes(summary), []);
    assertSilent(json, ['alpha', 'beta', 'plugins/', 'sentinel-value-alpha', '@fixture', '# ==']);
  });

  test('never claims completeness, runtime validation or certification', () => {
    const { summary } = summarize(dump);
    assert.equal(summary.completeness, 'unknown');
    assert.equal(summary.runtimeValidation, 'not-performed');
    assert.equal(summary.certification, false);
  });

  test('reports the fixed limits it applied', () => {
    const { summary } = summarize(dump);
    assert.deepEqual(summary.limits, { ...PROFILE_DUMP_LIMITS });
  });

  test('counts distinct explicit tags without listing them', () => {
    const { summary, json } = summarize('- id: a\n  name: b\n  config:\n    n: !!int 3\n');
    assert.equal(summary.counts.distinctTags, 1);
    assertSilent(json, ['tag:yaml.org,2002:int']);
  });
});

describe('profile-dump — !!js stays opaque and informational', () => {
  const dump = [
    '- id: probe',
    '  name: ./plugins/probe.js',
    '  config:',
    "    expression: !!js process.env.SECRET_NAME ?? 'sentinel-default'",
    '',
  ].join('\n');

  test('records the scalar but does not change the exit code', () => {
    const { ok, summary, exit, json } = summarize(dump);
    assert.equal(ok, true);
    assert.equal(exit, PROFILE_DUMP_EXIT.OK, 'a !!js scalar alone must stay exit 0');
    assert.equal(summary.counts.jsScalars, 1);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.JS_EXPRESSION_NOT_EVALUATED]);
    assert.equal(summary.diagnostics[0].line, 4);
  });

  test('never reproduces the expression text', () => {
    const { json } = summarize(dump);
    assertSilent(json, ['process.env', 'SECRET_NAME', 'sentinel-default']);
  });
});

describe('profile-dump — empty inputs are empty, not healthy', () => {
  test('zero bytes reports EMPTY_INPUT and an empty inventory', () => {
    const { ok, summary, exit } = summarize('');
    assert.equal(ok, true);
    assert.equal(exit, PROFILE_DUMP_EXIT.OK);
    assert.equal(summary.inventory, 'empty');
    assert.equal(summary.input.lines, 0);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.EMPTY_INPUT]);
  });

  test('comments only (what an empty export really is) is an empty inventory', () => {
    const { ok, summary } = summarize('# nothing here\n');
    assert.equal(ok, true);
    assert.equal(summary.inventory, 'empty');
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.EMPTY_INVENTORY]);
  });

  test('an empty sequence is an empty inventory', () => {
    const { ok, summary } = summarize('[]\n');
    assert.equal(ok, true);
    assert.equal(summary.inventory, 'empty');
    assert.equal(summary.counts.entries, 0);
  });

  test('whitespace only is an empty inventory', () => {
    const { summary } = summarize('   \n\n');
    assert.equal(summary.inventory, 'empty');
  });

  test('the group header comment is never echoed', () => {
    // `# == <origin>` is the line `groupedDump` writes before each group; an export with no rows
    // is that line alone. It is a comment, so the stream is empty — and its text is not output.
    const { ok, summary, json } = summarize('# == SECRET_ORIGIN\n');
    assert.equal(ok, true);
    assert.equal(summary.inventory, 'empty');
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.EMPTY_INVENTORY]);
    assertSilent(json, ['SECRET_ORIGIN']);
  });
});

describe('profile-dump — refusal paths', () => {
  test('two documents are refused by count, not by a library error', () => {
    const { ok, exit, summary } = summarize('- id: a\n  name: b\n---\n- id: c\n  name: d\n');
    assert.equal(ok, false);
    assert.equal(exit, PROFILE_DUMP_EXIT.UNUSABLE);
    assert.equal(summary.documents, 2);
    assert.equal(summary.inventory, 'none');
    assert.equal(summary.counts, null);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.MULTI_DOCUMENT));
  });

  test('a mapping root is refused', () => {
    const { ok, summary } = summarize('id: a\nname: b\n');
    assert.equal(ok, false);
    assert.equal(summary.counts, null);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.ROOT_NOT_SEQUENCE));
  });

  test('a scalar root is refused', () => {
    const { ok } = summarize('just-a-string\n');
    assert.equal(ok, false);
  });

  test('a row that is not a mapping is refused', () => {
    const { ok, summary } = summarize('- 3\n- id: a\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.ENTRY_NOT_MAPPING));
    assert.equal(summary.diagnostics[0].ordinal, 1);
  });

  test('a duplicate mapping key is a parse error with the library code only', () => {
    const dump = '- id: a\n  id: b\n  name: c\n  config: sentinel-dup\n';
    const { ok, summary, json } = summarize(dump);
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.PARSE_ERROR));
    const detail = summary.diagnostics.find((d) => d.code === PROFILE_DUMP_CODES.PARSE_ERROR).detail;
    assert.equal(detail, 'DUPLICATE_KEY');
    assertSilent(json, ['sentinel-dup', 'Map keys must be unique']);
  });

  test('a syntax error is refused without echoing parser text', () => {
    const { ok, summary, json } = summarize('- id: [unclosed\n  name: sentinel-syntax\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.PARSE_ERROR));
    assertSilent(json, ['sentinel-syntax']);
  });

  test('an unsupported directive on an otherwise empty stream is refused', () => {
    // The stream has no content and carries a `%YAML 1.3` directive. Whether the library reports
    // that as a stream error or a stream warning, this reader must not call the result "empty and
    // fine": both paths lead to `ok: false`, and the test accepts either code rather than pinning
    // a library behaviour it has not measured.
    const { ok, summary, json } = summarize('%YAML 1.3\n');
    assert.equal(ok, false);
    const reported = codes(summary);
    assert.ok(
      reported.includes(PROFILE_DUMP_CODES.PARSE_ERROR) ||
        reported.includes(PROFILE_DUMP_CODES.UNEXPECTED_WARNING),
      `expected a refusal code, got ${JSON.stringify(reported)}`,
    );
    assert.equal(summary.inventory, 'none');
    assertSilent(json, ['1.3']);
  });
});

describe('profile-dump — structure policy', () => {
  test('an anchor is refused', () => {
    const { ok, summary, json } = summarize('- id: &a x\n  name: b\n- id: y\n  name: *a\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.ANCHOR_PRESENT));
    assertSilent(json, ['&a']);
  });

  test('an alias is refused', () => {
    const { ok, summary } = summarize('- id: &x 1\n- id: 2\n  name: *x\n');
    assert.equal(ok, false);
    const found = codes(summary);
    assert.ok(
      found.includes(PROFILE_DUMP_CODES.ALIAS_PRESENT) ||
        found.includes(PROFILE_DUMP_CODES.ANCHOR_PRESENT),
      `expected alias/anchor refusal, got ${found.join(',')}`,
    );
  });

  test('a merge key is refused', () => {
    const dump = '- &base\n  id: a\n- <<: *base\n  id: b\n';
    const { ok, summary } = summarize(dump);
    assert.equal(ok, false);
    const found = codes(summary);
    assert.ok(found.includes(PROFILE_DUMP_CODES.MERGE_KEY), `expected MERGE_KEY, got ${found.join(',')}`);
  });

  test('an unknown tag is refused', () => {
    const { ok, summary, json } = summarize('- id: a\n  name: b\n  config:\n    at: !!timestamp 2020-01-01\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.UNSUPPORTED_TAG));
    assertSilent(json, ['2020-01-01']);
  });

  test('a tag in the yaml.org namespace but outside the whitelist is refused as CORE_NOT_ALLOWED', () => {
    // `!!` is the standard tag *handle*, not a vendor classification: it expands to
    // `tag:yaml.org,2002:`, so `!!python/object:foo.Bar` becomes
    // `tag:yaml.org,2002:python/object:foo.Bar` — a non-whitelisted tag in the core namespace.
    // `tagClass` classifies by the expanded-URI prefix, so it reports `CORE_NOT_ALLOWED`. That
    // means "not one of the types this command accepts", not "the core schema supports it".
    const { ok, summary, json } = summarize('- id: a\n  name: !!python/object:foo.Bar baz\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.UNSUPPORTED_TAG));
    // The tag is operator text in the document; the summary says a fixed class, never the tag.
    assertSilent(json, ['python', 'foo.Bar', 'SECRET_TAG']);
    const unsupported = summary.diagnostics.find(
      (diagnostic) => diagnostic.code === PROFILE_DUMP_CODES.UNSUPPORTED_TAG,
    );
    assert.equal(unsupported.detail, 'CORE_NOT_ALLOWED');
  });

  test('a local tag name is never echoed', () => {
    const { json } = summarize('- id: a\n  name: !SECRET_TAG ./a.js\n');
    assertSilent(json, ['SECRET_TAG', 'SECRET']);
  });

  test('a verbatim tag is reduced to a class, never to its URI', () => {
    // A verbatim `!<...>` whose URI is outside the yaml.org namespace is the genuinely *external*
    // case: `tagClass` reports `EXTERNAL`, the summary carries none of the URI text.
    const { ok, summary, json } = summarize(
      '- id: a\n  name: !<https://internal.example.invalid/key> ./a.js\n',
    );
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.UNSUPPORTED_TAG));
    const unsupported = summary.diagnostics.find(
      (diagnostic) => diagnostic.code === PROFILE_DUMP_CODES.UNSUPPORTED_TAG,
    );
    assert.equal(unsupported.detail, 'EXTERNAL');
    assertSilent(json, ['internal.example.invalid', 'https://', 'key']);
  });

  test('a core tag outside the whitelist is reported as a class', () => {
    const { summary, json } = summarize('- id: a\n  name: !!timestamp 2020-01-01\n');
    const unsupported = summary.diagnostics.find(
      (diagnostic) => diagnostic.code === PROFILE_DUMP_CODES.UNSUPPORTED_TAG,
    );
    assert.equal(unsupported.detail, 'CORE_NOT_ALLOWED');
    assertSilent(json, ['tag:yaml.org,2002:timestamp']);
  });

  test('a tagged key is refused without echoing the tag', () => {
    const { ok, summary, json } = summarize(
      '- id: a\n  name: b\n  config:\n    ? !!SECRET_KEY key\n    : value\n',
    );
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.TAG_KEY_PRESENT));
    assertSilent(json, ['SECRET_KEY']);
  });

  test('the expression tag on a collection is refused', () => {
    const { ok, summary } = summarize('- id: a\n  name: b\n  config: !!js {x: 1}\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.UNSUPPORTED_TAG));
  });

  test('a tagged key is refused', () => {
    const { ok, summary } = summarize('- id: a\n  name: b\n  config:\n    ? !!str key\n    : value\n');
    assert.equal(ok, false);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.TAG_KEY_PRESENT));
  });

  test('an explicit !!str key tag is refused too (exit 2, no leak)', () => {
    // Any explicitly tagged key is refused — `!!str` included. The tag resolves to core `str`,
    // which the old code tolerated; it must now be a hard refusal with no value echoed.
    const { ok, exit, summary, json } = summarize('- !!str id: SECRET\n');
    assert.equal(ok, false);
    assert.equal(exit, PROFILE_DUMP_EXIT.UNUSABLE);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.TAG_KEY_PRESENT));
    assertSilent(json, ['SECRET']);
  });

  test('nesting past the depth limit is refused, not truncated', () => {
    const deep = `${'['.repeat(PROFILE_DUMP_LIMITS.maxDepth + 4)}${']'.repeat(
      PROFILE_DUMP_LIMITS.maxDepth + 4,
    )}\n`;
    const { ok, summary } = summarize(deep);
    assert.equal(ok, false);
    assert.equal(summary.counts, null);
    assert.ok(codes(summary).includes(PROFILE_DUMP_CODES.DEPTH_LIMIT));
  });

  test('the diagnostics cap sets rather than hides truncation', () => {
    const rows = [];
    for (let index = 0; index < PROFILE_DUMP_LIMITS.maxDiagnostics + 5; index += 1) {
      rows.push(`- id: e${index}`, '  config:', '    x: !!js 1');
    }
    const { ok, summary } = summarize(`${rows.join('\n')}\n`);
    assert.equal(ok, true);
    assert.equal(summary.diagnosticsTruncated, true);
    assert.equal(summary.diagnostics.length, PROFILE_DUMP_LIMITS.maxDiagnostics);
  });

  test('entry diagnostics behind the cap still decide the exit code', () => {
    // 70 entry-level problems. The diagnostics list stops at 64, but the counter does not: it
    // reports the true total, 70. (With this fixture the first 64 are themselves entry problems,
    // so an implementation that inferred the exit code from the list would still say 1 — the
    // counter's independence from the list is proven directly by the next test.)
    const rows = [];
    for (let index = 0; index < 70; index += 1) rows.push(`- id: ${index}`);
    const { exit, summary, entryDiagnostics } = summarize(`${rows.join('\n')}\n`);
    assert.equal(exit, PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
    assert.equal(summary.diagnosticsTruncated, true);
    assert.equal(summary.diagnostics.length, PROFILE_DUMP_LIMITS.maxDiagnostics);
    assert.equal(entryDiagnostics, 70);
  });

  test('profileDumpExitCode reads entryDiagnostics, not the diagnostics list', () => {
    // A direct unit proof: a result whose `diagnostics` list is empty but whose counter is 1 must
    // still exit 1. This is the case a list-derived exit code would get wrong (it would say 0).
    const result = {
      ok: true,
      entryDiagnostics: 1,
      summary: { diagnostics: [], diagnosticsTruncated: false },
    };
    assert.equal(profileDumpExitCode(result), PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
  });

  test('every count is a finite integer, never NaN or null', () => {
    const { summary } = summarize('- id: a\n  name: b\n  config:\n    x: !!int 3\n');
    for (const [name, value] of Object.entries(summary.counts)) {
      assert.equal(Number.isFinite(value), true, `${name} is not finite: ${String(value)}`);
      assert.equal(Number.isInteger(value), true, `${name} is not an integer: ${String(value)}`);
    }
    assert.equal(Object.hasOwn(summary.counts, 'scalars'), true);
    assert.equal(JSON.stringify(summary.counts).includes('null'), false);
  });
});

describe('profile-dump — line and size limits', () => {
  test('more lines than the cap is refused before parsing', () => {
    const padding = '\n'.repeat(PROFILE_DUMP_LIMITS.maxLines + 10);
    const { ok, summary } = summarize(padding);
    assert.equal(ok, false);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.INPUT_TOO_MANY_LINES]);
  });

  test('bytes are measured from the text, so a caller cannot claim a smaller document', () => {
    // The summariser takes one argument. An earlier signature accepted `{ bytes }`, which let a
    // caller report 0 for an oversized document and walk past the input cap; there is now no
    // parameter to lie in.
    const big = `${'- id: a\n'.repeat(1)}${'#'.repeat(PROFILE_DUMP_LIMITS.maxBytes)}\n`;
    const { ok, summary } = summarize(big);
    assert.equal(ok, false);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.INPUT_TOO_LARGE]);
    assert.equal(summarizeProfileDumpText.length, 1, 'exactly one declared parameter');
  });

  test('a non-string document is a fixed TypeError that does not echo the argument', () => {
    assert.throws(
      () => summarizeProfileDumpText({ toString: () => 'sentinel-argument' }),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'profile-dump: the document must be a string');
        assert.equal(error.message.includes('sentinel-argument'), false);
        return true;
      },
    );
  });
});

describe('profile-dump — entry-level diagnostics', () => {
  test('a non-string id is an entry diagnostic, not a refusal', () => {
    const { ok, exit, summary } = summarize('- id: 42\n  name: b\n');
    assert.equal(ok, true, 'parsed documents stay parsed');
    assert.equal(exit, PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.ENTRY_ID_NOT_STRING]);
    assert.equal(summary.diagnostics[0].ordinal, 1);
  });

  test('a non-string name is an entry diagnostic', () => {
    const { exit, summary } = summarize('- id: a\n  name: [x]\n');
    assert.equal(exit, PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.ENTRY_NAME_NOT_STRING]);
  });

  test('a duplicate non-empty id is reported on the later row', () => {
    const { exit, summary, json } = summarize('- id: same\n  name: a\n- id: same\n  name: b\n');
    assert.equal(exit, PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
    assert.deepEqual(codes(summary), [PROFILE_DUMP_CODES.DUPLICATE_ID]);
    assert.equal(summary.diagnostics[0].ordinal, 2);
    assertSilent(json, ['same']);
  });

  test('duplicate empty ids are not reported', () => {
    const { summary } = summarize("- id: ''\n  name: a\n- id: ''\n  name: b\n");
    assert.deepEqual(codes(summary), []);
  });

  test('a missing id or name is accepted — the loader assigns ids', () => {
    const { ok, exit, summary } = summarize('- name: ./a.js\n- id: b\n');
    assert.equal(ok, true);
    assert.equal(exit, PROFILE_DUMP_EXIT.OK);
    assert.deepEqual(codes(summary), []);
    assert.equal(summary.counts.entries, 2);
    assert.equal(summary.counts.entriesWithId, 1);
    assert.equal(summary.counts.entriesWithName, 1);
  });

  test('a group row is counted and its config is not descended as entries', () => {
    const dump = ['- id: g', '  group: true', '  config:', '    - id: inner', '      name: ./inner.js', ''].join(
      '\n',
    );
    const { ok, summary } = summarize(dump);
    assert.equal(ok, true);
    assert.equal(summary.counts.entryGroups, 1);
    assert.equal(summary.counts.entries, 1, 'nested entries are not analysed');
    assert.deepEqual(codes(summary), []);
  });

  test('an id inside a config block is not treated as a plugin id', () => {
    const dump = '- id: a\n  name: ./a.js\n  config:\n    id: b\n';
    const { exit, summary } = summarize(dump);
    assert.equal(exit, PROFILE_DUMP_EXIT.OK);
    assert.deepEqual(codes(summary), []);
  });
});

describe('profile-dump — the untagged dumper output shape', () => {
  test('a real-looking two-group export is one flat sequence', () => {
    const dump = [
      '# == /root/x/home/profiles/web/cordis.patch.yml',
      '- id: a',
      '  name: ./a.js',
      '# == /root/x/home/profiles/web/cordis.patch.yml, patched by /root/x/patch.yml',
      '- id: b',
      '  name: ./b.js',
      '',
    ].join('\n');
    const { summary, json } = summarize(dump);
    assert.equal(summary.counts.entries, 2, 'comment lines do not split the sequence');
    assertSilent(json, ['/root/x', 'cordis.patch.yml', 'patched by']);
  });
});

/**
 * A sink that records writes and can be told to fail in each of the three ways a stream can.
 *
 * The failures are distinct on purpose: a synchronous throw from `write`, an error passed to the
 * write callback, and an `error` event on the stream. A CLI that handles only the first reports
 * success after losing its output in the other two.
 */
function fakeSink(options = {}) {
  const listeners = new Map();
  const sink = {
    chunks: [],
    writes: 0,
    once(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    removeListener(event, handler) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((existing) => existing !== handler),
      );
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
    emit(event, payload) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
    },
    write(chunk, callback) {
      sink.writes += 1;
      if (options.throwSync === true) throw new Error('sink refused: synchronous');
      sink.chunks.push(String(chunk));
      if (options.errorEvent === true) {
        sink.emit('error', new Error('sink refused: event'));
        return true;
      }
      if (options.callbackError === true) {
        callback?.(new Error('sink refused: callback'));
        return true;
      }
      callback?.();
      return true;
    },
  };
  return sink;
}

describe('profile-dump CLI — real files and injected streams', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'profile-dump-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));

  /** Run the CLI with fake streams and return what each one received. */
  async function run(argv, options = {}) {
    const stdout = options.stdout ?? fakeSink();
    const stderr = options.stderr ?? fakeSink();
    const code = await main(argv, { stdout, stderr });
    return {
      code,
      stdout: stdout.chunks.join(''),
      stderr: stderr.chunks.join(''),
      stdoutWrites: stdout.writes,
      stderrWrites: stderr.writes,
    };
  }

  /** Write a fixture and return its path. */
  function fixture(name, contents) {
    const path = join(scratch, name);
    writeFileSync(path, contents);
    return path;
  }

  test('a valid file exits 0 and writes exactly one JSON document', async () => {
    const path = fixture('ok.yml', '- id: a\n  name: ./a.js\n');
    const { code, stdout, stdoutWrites } = await run([path]);
    assert.equal(code, PROFILE_DUMP_EXIT.OK);
    assert.equal(stdoutWrites, 1, 'one write, one document');
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.inventory, 'present');
    assert.equal(parsed.counts.entries, 1);
    assert.equal(stdout.trimEnd().split('\n').length > 1, true, 'pretty-printed JSON');
    assert.equal(stdout.includes(path), false, 'the input path is never echoed');
  });

  test('an entry-level problem exits 1', async () => {
    const path = fixture('entry.yml', '- id: 7\n  name: ./a.js\n');
    const { code, stdout } = await run([path]);
    assert.equal(code, PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.ENTRY_ID_NOT_STRING);
  });

  test('a missing file exits 2 with a fixed code and no input measurement', async () => {
    const { code, stdout } = await run([join(scratch, 'absent.yml')]);
    assert.equal(code, PROFILE_DUMP_EXIT.UNUSABLE);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.diagnostics[0].code, PROFILE_DUMP_CODES.INPUT_OPEN_FAILED);
    assert.equal(parsed.input, null, 'nothing was read, so nothing is claimed about its size');
  });

  test('a directory exits 2 and is never read', async () => {
    const { code, stdout } = await run([scratch]);
    assert.equal(code, PROFILE_DUMP_EXIT.UNUSABLE);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.INPUT_NOT_REGULAR);
  });

  test('invalid UTF-8 exits 2', async () => {
    const path = join(scratch, 'bad.yml');
    writeFileSync(path, Buffer.from([0x2d, 0x20, 0xff, 0xfe, 0x0a]));
    const { code, stdout } = await run([path]);
    assert.equal(code, PROFILE_DUMP_EXIT.UNUSABLE);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.INPUT_NOT_UTF8);
  });

  test('a file over the cap exits 2 without being truncated', async () => {
    const path = join(scratch, 'big.yml');
    writeFileSync(path, Buffer.alloc(PROFILE_DUMP_LIMITS.maxBytes + 1, 0x2d));
    const { code, stdout } = await run([path]);
    assert.equal(code, PROFILE_DUMP_EXIT.UNUSABLE);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.INPUT_TOO_LARGE);
  });

  test('no argument is a usage error with a JSON body and usage text on stderr', async () => {
    const { code, stdout, stderr } = await run([]);
    assert.equal(code, PROFILE_DUMP_EXIT.USAGE);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.USAGE);
    assert.ok(stderr.includes('Usage:'), 'the usage text did not reach stderr');
    assert.equal(stdout.includes('Usage:'), false, 'usage text must not reach stdout');
  });

  test('two arguments are a usage error', async () => {
    const path = fixture('two.yml', '- id: a\n');
    const { code } = await run([path, path]);
    assert.equal(code, PROFILE_DUMP_EXIT.USAGE);
  });

  test('an option-shaped argument is a usage error, not a filename', async () => {
    const { code, stdout } = await run(['--dump']);
    assert.equal(code, PROFILE_DUMP_EXIT.USAGE);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.USAGE);
  });

  test('stdin is not accepted', async () => {
    const { code } = await run(['-']);
    assert.equal(code, PROFILE_DUMP_EXIT.USAGE);
  });

  test('a synchronous write failure exits 5 and writes nothing further', async () => {
    const path = fixture('ok-sync.yml', '- id: a\n  name: ./a.js\n');
    const stdout = fakeSink({ throwSync: true });
    const { code, stdoutWrites } = await run([path], { stdout });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);
    assert.equal(stdoutWrites, 1, 'one attempt, no retry, no second document');
    assert.equal(stdout.chunks.length, 0, 'no partial document is left behind');
  });

  test('a write callback error exits 5', async () => {
    const path = fixture('ok-callback.yml', '- id: a\n  name: ./a.js\n');
    const stdout = fakeSink({ callbackError: true });
    const { code } = await run([path], { stdout });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);
    assert.equal(stdout.writes, 1);
  });

  test('a write error event exits 5', async () => {
    const path = fixture('ok-event.yml', '- id: a\n  name: ./a.js\n');
    const stdout = fakeSink({ errorEvent: true });
    const { code } = await run([path], { stdout });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);
    assert.equal(stdout.writes, 1);
  });

  test('a failed write does not leak its own error text', async () => {
    const path = fixture('ok-leak.yml', '- id: a\n  name: ./a.js\n');
    const stdout = fakeSink({ errorEvent: true });
    const stderr = fakeSink();
    const { code, stdout: out, stderr: err } = await run([path], { stdout, stderr });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);
    assert.equal(out.includes('sink refused'), false);
    assert.equal(err.includes('sink refused'), false);
  });

  test('a failed stderr write is an internal failure, but the JSON still goes out', async () => {
    // The caller asked for usage text and could not get it: that is exit 5, not 64. The one
    // stdout document is still written — it is the only copy attempted, never retried.
    const { code, stdout, stdoutWrites } = await run([], { stderr: fakeSink({ throwSync: true }) });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);
    assert.equal(stdoutWrites, 1);
    assert.equal(JSON.parse(stdout).diagnostics[0].code, PROFILE_DUMP_CODES.USAGE);
  });

  test('a real Writable receives exactly one JSON document', async () => {
    // Every other test injects a hand-rolled sink; this one uses an actual stream object so the
    // write path is exercised against Node's own semantics (backpressure, 'close', 'error').
    const path = fixture('ok-stream.yml', '- id: a\n  name: ./a.js\n');
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const chunks = [];
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk) => chunks.push(chunk));

    const code = await main([path], { stdout, stderr });
    stdout.end();

    assert.equal(code, PROFILE_DUMP_EXIT.OK);
    const text = chunks.join('');
    assert.equal(text.trimEnd().split('\n\n').length >= 1, true);
    assert.equal(JSON.parse(text).counts.entries, 1);
  });

  test('a real Writable whose _write fails exits 5, without crashing, leaking or leaving listeners', async () => {
    // A genuine `Writable` (not a fake sink) whose `_write` invokes its callback with an error.
    // Node's `Writable` then emits an `error` event *after* the callback, so this pins the one
    // lifecycle rule that matters: the error listener must still be attached when that deferred
    // event fires. If `writeOnce` detached inside the callback, the event would be unhandled and
    // this test process would throw.
    const path = fixture('ok-real-error.yml', '- id: a\n  name: ./a.js\n');
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('SECRET'));
      },
    });
    const stderr = fakeSink();
    // Baseline: a fresh Writable has no user listeners on these events.
    const beforeError = stdout.listenerCount('error');
    const beforeClose = stdout.listenerCount('close');

    // Register the teardown wait BEFORE `main` runs, so the `close` event cannot be missed
    // (`destroyed` can flip true before `close` is emitted, so checking it afterwards is not a
    // real wait). A `close` listener is used deliberately; no `error` listener is added, because
    // an extra one would mask the very bug this test exists to catch — an unhandled deferred
    // `error` from a prematurely detached listener. `once` removes itself on fire.
    const closed = new Promise((resolve) => stdout.once('close', resolve));

    const code = await main([path], { stdout, stderr });
    assert.equal(code, PROFILE_DUMP_EXIT.INTERNAL);

    await closed;

    // If the cleanup in `writeOnce` were skipped when the promise had already settled, a
    // `close` (or `error`) listener would still be attached here.
    assert.equal(stdout.listenerCount('error'), beforeError, 'an error listener was left attached');
    assert.equal(stdout.listenerCount('close'), beforeClose, 'a close listener was left attached');
    assert.equal(stderr.chunks.join('').includes('SECRET'), false);
  });

  test('repeated successful runs do not accumulate listeners on a long-lived sink', async () => {
    // The sink never closes, the way a persistent stdout does not. Each successful write must
    // detach its own `error`/`close` listeners, or a long-lived process grows one pair per run.
    const path = fixture('ok-repeat.yml', '- id: a\n  name: ./a.js\n');
    const stdout = fakeSink();
    const stderr = fakeSink();
    for (let index = 0; index < 5; index += 1) {
      const code = await main([path], { stdout, stderr });
      assert.equal(code, PROFILE_DUMP_EXIT.OK);
    }
    assert.equal(stdout.listenerCount('error'), 0, 'error listeners accumulate across runs');
    assert.equal(stdout.listenerCount('close'), 0, 'close listeners accumulate across runs');
  });

  test('the process entry point runs the CLI and exits with its code', () => {
    // A real child process: this is the entry guard in `profile-dump-cli.js`, not a re-implementation
    // of it. It runs under a bounded heap (192 MiB), a wall-clock timeout, a capped output buffer
    // and a minimal environment with no inherited `NODE_OPTIONS` — the same envelope the future
    // restricted acceptance run will use.
    const path = fixture('ok-process.yml', '- id: a\n  name: ./a.js\n');
    const result = spawnSync(process.execPath, ['--max-old-space-size=192', CLI_PATH, path], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 262144,
      killSignal: 'SIGKILL',
      // A freshly built environment: PATH, HOME and TMPDIR only. Nothing is inherited, so no
      // ambient NODE_OPTIONS (or any other variable) reaches the child.
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: homedir(),
        TMPDIR: tmpdir(),
      },
    });

    assert.equal(result.error, undefined, result.error ? String(result.error) : '');
    assert.equal(result.signal, null, `child was killed by ${String(result.signal)}`);
    assert.equal(result.status, PROFILE_DUMP_EXIT.OK, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.profileDumpSummary, PROFILE_DUMP_SCHEMA);
    assert.equal(parsed.counts.entries, 1);
  });
});


describe('profile-dump — rows are a closed window, not an inventory', () => {
  const dump = [
    '# == @fixture/dsh-bundle-probe',
    '- id: alpha',
    '  name: ./plugins/alpha.js',
    '  config:',
    '    marker: sentinel-value-alpha',
    '- id: beta',
    '  name: ./plugins/beta.js',
    '  disabled: true',
    '',
  ].join('\n');

  test('one row per entry, in order, with position and line', () => {
    const { summary } = summarize(dump);
    assert.equal(summary.rows.length, 2);
    assert.deepEqual(
      summary.rows.map((row) => [row.index, row.line]),
      [
        [1, 2],
        [2, 6],
      ],
    );
  });

  test('a row states shape in closed words and never the values', () => {
    const { summary, json } = summarize(dump);
    assert.deepEqual(summary.rows[0], {
      index: 1,
      line: 2,
      keyCount: 3,
      idKind: 'string',
      nameKind: 'string',
      group: 'absent',
      disabled: 'absent',
      config: 'mapping',
      configKeyCount: 1,
      unmodelledKeyCount: 0,
    });
    assert.equal(summary.rows[1].disabled, 'true');
    assert.equal(summary.rows[1].config, 'absent');
    assert.equal(summary.rows[1].configKeyCount, null);
    assertSilent(json, ['alpha', 'beta', 'plugins/', 'sentinel-value-alpha', 'marker', '@fixture']);
  });

  test('a setting, a null and an unmodelled value are three different observations', () => {
    const { summary, exit } = summarize(
      ['- id: a', '  disabled: false', '- id: b', '  disabled: null', '- id: c', '  disabled: "yes"', '']
        .join('\n'),
    );
    // `false` is a deliberate setting, `null` is the legal "not set" form `EntryOptions` declares
    // (`boolean | null`), and `"yes"` is a value this reader did not model. Reporting `null` as a
    // type error would send a reader hunting a bug that is not there.
    assert.equal(summary.rows[0].disabled, 'false');
    assert.equal(summary.rows[1].disabled, 'null');
    assert.equal(summary.rows[2].disabled, 'other');
    // None of the three is an entry-level diagnostic, so all three stay on an exit-0 summary.
    assert.equal(exit, PROFILE_DUMP_EXIT.OK);
  });

  test('a group marker is read with the same vocabulary as a flag', () => {
    const { summary } = summarize('- id: a\n  group: true\n- id: b\n  group: demo\n');
    assert.equal(summary.rows[0].group, 'true');
    // `group` is declared `boolean | null`, so a string label is `other` — the row is still
    // reported, with the shape it actually has.
    assert.equal(summary.rows[1].group, 'other');
  });

  test('an absent config and a non-mapping config are different observations', () => {
    const { summary } = summarize('- id: a\n- id: b\n  config: not-a-mapping\n');
    assert.equal(summary.rows[0].config, 'absent');
    assert.equal(summary.rows[1].config, 'not-mapping');
    assert.equal(summary.rows[1].configKeyCount, null);
  });

  test('keys this reader does not model are counted, never copied', () => {
    const { summary, json } = summarize(
      '- id: a\n  inject: ["sentinel-service"]\n  disabeld: true\n',
    );
    assert.equal(summary.rows[0].keyCount, 3);
    assert.equal(summary.rows[0].unmodelledKeyCount, 2);
    assertSilent(json, ['inject', 'disabeld', 'sentinel-service']);
  });

  test('a refused document has no rows, and does not pretend to have none', () => {
    // A root mapping is a refusal, not an empty inventory: `rows: []` would read as "no entries".
    const { ok, summary } = summarize('id: not-a-sequence\n');
    assert.equal(ok, false);
    assert.equal(summary.inventory, 'none');
    assert.equal(summary.rows, null);
    assert.equal(summary.rowsTruncated, false);
    assert.equal(summary.counts, null);
  });

  test('an empty inventory windows to an empty row list', () => {
    const { summary } = summarize('[]\n');
    assert.deepEqual(summary.rows, []);
    assert.equal(summary.rowsTruncated, false);
  });

  test('the window is capped and says so, while the counter stays whole', () => {
    const rows = [];
    for (let index = 0; index < PROFILE_DUMP_LIMITS.maxRows + 1; index += 1) {
      rows.push(`- id: row-${index}`);
    }
    const { summary } = summarize(`${rows.join('\n')}\n`);
    assert.equal(summary.counts.entries, PROFILE_DUMP_LIMITS.maxRows + 1);
    assert.equal(summary.rows.length, PROFILE_DUMP_LIMITS.maxRows);
    assert.equal(summary.rowsTruncated, true);
    assert.equal(summary.rows.at(-1).index, PROFILE_DUMP_LIMITS.maxRows);
  });
});

describe('profile-dump — the two guard lists', () => {
  test('notDerived keeps the five names from the observation record, verbatim', () => {
    const { summary } = summarize('- id: a\n');
    assert.deepEqual(summary.notDerived, [
      'declarations',
      'availableCapabilities',
      'resources',
      'activation',
      'loadability',
    ]);
  });

  test('limitations is the fixed list, not a summary of what was seen', () => {
    const { summary } = summarize('- id: a\n');
    assert.deepEqual(summary.limitations, [
      'ROW_IS_NOT_A_DECLARATION',
      'ROW_SET_COMPLETENESS_UNKNOWN',
      'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
      'NO_LOADABILITY_OR_ACTIVATION_OBSERVED',
      'ROW_SKIPS_UNMODELLED_KEYS',
      'CONFIG_VALUES_NOT_INSPECTED',
      'CERTIFICATION_NOT_CLAIMED',
      'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
    ]);
  });

  test('each summary gets its own copy, so adapting it cannot edit the constant', () => {
    const { summary } = summarize('- id: a\n');
    summary.notDerived.push('something-else');
    summary.limitations.length = 0;
    const second = summarize('- id: a\n').summary;
    assert.equal(second.notDerived.length, 5);
    assert.equal(second.limitations.length, 8);
    assert.equal(PROFILE_DUMP_NOT_DERIVED.length, 5);
    assert.equal(PROFILE_DUMP_LIMITATIONS.length, 8);
  });

  test('a refused document still states both lists', () => {
    const { summary } = summarize('id: not-a-sequence\n');
    assert.equal(summary.rows, null);
    assert.equal(summary.notDerived.length, 5);
    assert.equal(summary.limitations.length, 8);
  });
});
