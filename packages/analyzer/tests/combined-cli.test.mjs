/**
 * Tests for `src/combined-cli.js`.
 *
 * These are decision tests, not a smoke run: every case drives `main(argv, io)`
 * with injected sinks and dependencies, so no real host, listener, plugin or
 * build-checkout is involved. The one exception is the bounded reader: the
 * oversize and non-UTF-8 cases deliberately use the REAL `readEvidenceFile` on
 * real temporary files, because the cap and the strict decode are the properties
 * under test and a stub would only re-assert the stub.
 *
 * `buildReport` is a documented test seam on `io` (production always uses the
 * real builder). It is here to isolate *this CLI's own control flow* — degraded
 * lanes, absence, load ordering, output failure — from the report library's
 * behaviour, so a change in the builder is not reported as a CLI regression.
 * The lane document schemas are already frozen; this is separation of concerns,
 * not a workaround for missing types.
 *
 * Written, not run.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { COMBINED_EXIT_CODES, LANE_NAMES, REPORT_VERSION, main, sameEntryPoint, streamSink } from '../src/combined-cli.js';
import { LIMITATION_CODES } from '../src/combined-report.js';

const SOURCE = {
  static: 'static-input',
  runtime: 'runtime-input',
  admission: 'admission-input',
};

/** Fixed lane shape the real builder is specified to emit. */
function lane(source, outcome, { result = null, issues = [] } = {}) {
  return { state: 'provided', source, outcome, result, issues };
}

function absent() {
  return { state: 'absent', source: null, outcome: 'unknown', result: null, issues: [] };
}

/**
 * A stub builder: returns the fixed report shape with the given outcomes for the
 * lanes it receives, and records how it was called.
 */
function stubBuilder(outcomes) {
  const calls = [];
  const build = async (input, options) => {
    calls.push({ input: { ...input }, options: { ...options } });
    const channels = {};
    for (const name of LANE_NAMES) {
      const provided = input[name] !== undefined;
      channels[name] = provided
        ? lane(SOURCE[name], outcomes[name] ?? 'clear')
        : absent();
    }
    return {
      reportVersion: REPORT_VERSION,
      certification: false,
      correlation: 'not-established',
      channels,
      limitations: [],
    };
  };
  return { build, calls };
}

/**
 * Build a fake `io`. `files` maps path -> text; a path absent from it refuses
 * like the real bounded reader does (a fixed-message error, no path echoed).
 */
function makeIo({ files = {}, modules = {}, build, sequence = [] } = {}) {
  const stdout = [];
  const stderr = [];
  const loads = [];
  const reads = [];

  const io = {
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    readFile: (path) => {
      reads.push(path);
      sequence.push(`read:${path}`);
      if (!Object.hasOwn(files, path)) {
        const error = new Error('reader refused');
        error.name = 'EvidenceCliError';
        throw error;
      }
      return files[path];
    },
    loadModule: async (target) => {
      loads.push(target);
      sequence.push(`load:${target}`);
      // `modules` is either a map keyed by exact target or a resolver function.
      // The CLI resolves path-like specifiers to absolute file URLs, so a map
      // keyed by the literal argument would silently miss.
      const resolved = typeof modules === 'function' ? modules(target) : modules[target];
      if (resolved === undefined) throw new Error('module not found');
      return resolved;
    },
  };
  if (typeof build === 'function') io.buildReport = build;

  return { io, stdout, stderr, loads, reads, sequence };
}

function validatorModule(exportName) {
  return { [exportName]: () => ({ valid: true, issues: [] }) };
}

/** Parse the single JSON document written to stdout. */
function jsonOf(stdout) {
  assert.equal(stdout.length, 1, `expected exactly one stdout write, got ${stdout.length}`);
  return JSON.parse(stdout[0]);
}

test('all three channels clear exits 0 and reports the fixed schema', async () => {
  const { build } = stubBuilder({});
  const { io, stdout, stderr } = makeIo({
    files: {
      'static.json': '{"declarations":[]}',
      'runtime.json': '{"cases":[]}',
      'admission.json': '{"cases":[]}',
    },
    modules: (target) =>
      validatorModule(target.endsWith('adm.mjs') ? 'validateAdmissionEvidence' : 'validateDeclaration'),
    build,
  });

  const code = await main(
    ['--static', 'static.json', '--declaration-validator', './dec.mjs', '--runtime', 'runtime.json', '--admission', 'admission.json', '--admission-validator', './adm.mjs'],
    io,
  );

  assert.equal(code, COMBINED_EXIT_CODES.OK);
  const report = jsonOf(stdout);
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.certification, false);
  assert.equal(report.correlation, 'not-established');
  for (const name of LANE_NAMES) assert.equal(report.channels[name].outcome, 'clear');
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /^combined-cli: clear=3 /);
});

test('a missing lane is absent with outcome unknown and exits 1', async () => {
  const { build } = stubBuilder({});
  const { io, stdout } = makeIo({
    files: { 'static.json': '{"declarations":[]}', 'admission.json': '{"cases":[]}' },
    // Both named validators must actually load: a load failure is exit 3 by
    // contract, which would mask the absence rule this test is about.
    modules: (target) =>
      validatorModule(target.endsWith('adm.mjs') ? 'validateAdmissionEvidence' : 'validateDeclaration'),
    build,
  });

  const code = await main(
    ['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--admission', 'admission.json', '--admission-validator', '/v/adm.mjs'],
    io,
  );

  assert.equal(code, COMBINED_EXIT_CODES.ATTENTION);
  const report = jsonOf(stdout);
  assert.deepEqual(report.channels.runtime, {
    state: 'absent',
    source: null,
    outcome: 'unknown',
    result: null,
    issues: [],
  });
  assert.equal(report.channels.static.state, 'provided');
});

test('one unreadable document does not block the other lanes and exits 2', async () => {
  const { build, calls } = stubBuilder({ static: 'clear', admission: 'attention' });
  const { io, stdout } = makeIo({
    files: { 'static.json': '{"declarations":[]}', 'admission.json': '{"cases":[]}' },
    modules: (target) =>
      validatorModule(target.endsWith('adm.mjs') ? 'validateAdmissionEvidence' : 'validateDeclaration'),
    build,
  });

  const code = await main(
    ['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'missing.json', '--admission', 'admission.json', '--admission-validator', '/v/adm.mjs'],
    io,
  );

  assert.equal(code, COMBINED_EXIT_CODES.INVALID);
  const report = jsonOf(stdout);
  assert.deepEqual(report.channels.runtime, {
    state: 'provided',
    source: 'runtime-input',
    outcome: 'invalid',
    result: null,
    issues: [{ code: 'INPUT_READ_FAILED' }],
  });
  assert.equal(report.channels.static.outcome, 'clear');
  assert.equal(report.channels.admission.outcome, 'attention');
  // The builder never saw the failed lane, and never saw a fabricated document.
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].input).sort(), ['admission', 'static']);
});

test('a malformed document is reported as INPUT_JSON_INVALID, not as a read failure', async () => {
  const { build } = stubBuilder({});
  const { io, stdout } = makeIo({
    files: { 'static.json': '{"declarations":' },
    build,
  });

  const code = await main(['--static', 'static.json', '--declaration-validator', '/v/dec.mjs'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INVALID);
  const report = jsonOf(stdout);
  assert.deepEqual(report.channels.static.issues, [{ code: 'INPUT_JSON_INVALID' }]);
  assert.equal(report.channels.runtime.state, 'absent');
});

test('when every named lane fails the fixed schema is still emitted and the builder is not called', async () => {
  const { build, calls } = stubBuilder({});
  const { io, stdout, stderr } = makeIo({ files: {}, build });

  const code = await main(
    ['--static', 'a.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'b.json'],
    io,
  );

  assert.equal(calls.length, 0, 'the builder must not be called with fabricated input');
  assert.equal(code, COMBINED_EXIT_CODES.INVALID);
  const report = jsonOf(stdout);
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.equal(report.certification, false);
  assert.equal(report.correlation, 'not-established');
  assert.equal(report.channels.static.issues[0].code, 'INPUT_READ_FAILED');
  assert.equal(report.channels.runtime.issues[0].code, 'INPUT_READ_FAILED');
  assert.equal(report.channels.admission.state, 'absent');
  assert.deepEqual(
    report.limitations,
    [...LIMITATION_CODES],
    'the skeleton must declare the same fixed limitations as a built report',
  );
  assert.doesNotMatch(stderr.join(''), /INTERNAL/);
});

test('validators are imported only after every named document has been read', async () => {
  const { build } = stubBuilder({});
  const sequence = [];
  const { io } = makeIo({
    files: {
      'static.json': '{"declarations":[]}',
      'runtime.json': '{"cases":[]}',
      'admission.json': '{"cases":[]}',
    },
    modules: {},
    build,
    sequence,
  });

  await main(
    ['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'runtime.json', '--admission', 'admission.json', '--admission-validator', '/v/adm.mjs'],
    io,
  );

  const firstLoad = sequence.findIndex((entry) => entry.startsWith('load:'));
  const lastRead = sequence.map((entry) => entry.startsWith('read:')).lastIndexOf(true);
  assert.ok(firstLoad > lastRead, `expected loads after reads, got ${JSON.stringify(sequence)}`);
  assert.equal(sequence.filter((entry) => entry.startsWith('load:')).length, 2);
});

test('a lane whose document never parsed does not import its validator', async () => {
  const { build } = stubBuilder({});
  const { io, loads } = makeIo({ files: {}, build });

  const code = await main(['--static', 'missing.json', '--declaration-validator', '/v/dec.mjs'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INVALID);
  assert.deepEqual(loads, []);
});

test('a relative validator specifier reaches the loader as a file URL', async () => {
  const { build } = stubBuilder({});
  const { io, loads } = makeIo({
    files: { 'static.json': '{"declarations":[]}' },
    modules: {},
    build,
  });
  // The loader refuses everything; only the target shape is under test here.
  const original = io.loadModule;
  const seen = [];
  io.loadModule = async (target) => {
    seen.push(target);
    return original(target);
  };

  await main(['--static', 'static.json', '--declaration-validator', './dec.mjs'], io);

  assert.equal(loads.length, 1);
  assert.match(seen[0], /^file:\/\//);
  assert.match(seen[0], /\/dec\.mjs$/);
});

test('an explicit file: URL reaches the loader as that URL, not as a path', async () => {
  const { build } = stubBuilder({});
  const seen = [];
  const { io } = makeIo({ files: { 'static.json': '{"declarations":[]}' }, build });
  io.loadModule = async (target) => {
    seen.push(target);
    return validatorModule('validateDeclaration');
  };

  // A directory name with a space must survive as `%20`: treating this string as
  // a relative path would turn the scheme into a path segment and re-encode the
  // escape.
  const url = 'file:///tmp/validator%20dir/dec.mjs';
  const code = await main(['--static', 'static.json', '--declaration-validator', url], io);

  assert.deepEqual(seen, [url], 'the URL is passed through unchanged');
  assert.equal(code, COMBINED_EXIT_CODES.ATTENTION, 'one named lane leaves the other two absent');
  assert.doesNotMatch(seen[0], /file%3A/, 'the scheme was not read as a path segment');
  assert.match(seen[0], /%20/, 'the percent-escape was not decoded and re-encoded');
});

test('a bare specifier is passed through unchanged', async () => {
  const { build } = stubBuilder({});
  const seen = [];
  const { io } = makeIo({ files: { 'static.json': '{"declarations":[]}' }, modules: {}, build });
  io.loadModule = async (target) => {
    seen.push(target);
    return validatorModule('validateDeclaration');
  };

  const code = await main(['--static', 'static.json', '--declaration-validator', 'dsh-compat-spec'], io);

  // The specifier is passed through, but only one lane is named: the two absent
  // lanes make this ATTENTION by the same rule the dedicated exit-code test
  // covers. Nothing here claims an all-clear for a one-lane invocation.
  assert.equal(code, COMBINED_EXIT_CODES.ATTENTION);
  assert.deepEqual(seen, ['dsh-compat-spec']);
});

test('a validator module that cannot be loaded marks its lane as an error and exits 3', async () => {
  const { build, calls } = stubBuilder({ static: 'clear' });
  const { io, stdout } = makeIo({
    files: { 'static.json': '{"declarations":[]}', 'runtime.json': '{"cases":[]}' },
    modules: {},
    build,
  });

  const code = await main(
    ['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'runtime.json'],
    io,
  );

  // Module load failure outranks a lane error: 3 before 4.
  assert.equal(code, COMBINED_EXIT_CODES.USAGE);
  const report = jsonOf(stdout);
  assert.equal(report.channels.static.outcome, 'error');
  assert.deepEqual(report.channels.static.issues, [{ code: 'VALIDATOR_LOAD_FAILED' }]);
  assert.equal(report.channels.runtime.outcome, 'clear');
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].input), ['runtime']);
});

test('a module that does not export the fixed name is a load failure, not a lane error', async () => {
  const { build } = stubBuilder({});
  const { io, stdout } = makeIo({
    files: { 'static.json': '{"declarations":[]}' },
    modules: () => ({ validateDeclaration: 'not a function' }),
    build,
  });

  const code = await main(['--static', 'static.json', '--declaration-validator', './dec.mjs'], io);

  assert.equal(code, COMBINED_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout).channels.static.issues, [{ code: 'VALIDATOR_LOAD_FAILED' }]);
});

test('attention in one channel exits 1, and lane errors exit 4 when no load failed', async () => {
  const attention = stubBuilder({ static: 'clear', runtime: 'attention', admission: 'clear' });
  const first = makeIo({
    files: {
      'static.json': '{"declarations":[]}',
      'runtime.json': '{"cases":[]}',
      'admission.json': '{"cases":[]}',
    },
    modules: (target) =>
      validatorModule(target.endsWith('adm.mjs') ? 'validateAdmissionEvidence' : 'validateDeclaration'),
    build: attention.build,
  });
  assert.equal(
    await main(
      ['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'runtime.json', '--admission', 'admission.json', '--admission-validator', '/v/adm.mjs'],
      first.io,
    ),
    COMBINED_EXIT_CODES.ATTENTION,
  );

  const errored = stubBuilder({ static: 'clear', runtime: 'error' });
  const second = makeIo({
    files: { 'static.json': '{"declarations":[]}', 'runtime.json': '{"cases":[]}' },
    modules: () => validatorModule('validateDeclaration'),
    build: errored.build,
  });
  assert.equal(
    await main(['--static', 'static.json', '--declaration-validator', '/v/dec.mjs', '--runtime', 'runtime.json'], second.io),
    COMBINED_EXIT_CODES.LANE_ERROR,
  );
});

test('duplicate lane flags are a usage problem whose stdout is the fixed marker', async () => {
  const { build } = stubBuilder({});
  const { io, stdout, stderr } = makeIo({ files: {}, build });

  const code = await main(
    ['--static', 'a.json', '--static', 'b.json', '--declaration-validator', '/v/dec.mjs'],
    io,
  );

  assert.equal(code, COMBINED_EXIT_CODES.USAGE);
  assert.deepEqual(stdout, ['{"error":{"code":"USAGE"}}\n']);
  assert.match(stderr[0], /at most once/);
  assert.match(stderr.join(''), /combined-cli — one report/);
});

test('a validator flag without its lane is a usage problem', async () => {
  const { build } = stubBuilder({});
  const first = makeIo({ files: { 'runtime.json': '{"cases":[]}' }, build });
  assert.equal(await main(['--runtime', 'runtime.json', '--declaration-validator', '/v/dec.mjs'], first.io), COMBINED_EXIT_CODES.USAGE);

  const second = makeIo({ files: { 'static.json': '{"declarations":[]}' }, build });
  assert.equal(await main(['--static', 'static.json', '--admission-validator', '/v/adm.mjs'], second.io), COMBINED_EXIT_CODES.USAGE);
});

test('--static without a declaration validator is a usage problem', async () => {
  const { build } = stubBuilder({});
  const { io } = makeIo({ files: { 'static.json': '{"declarations":[]}' }, build });
  assert.equal(await main(['--static', 'static.json'], io), COMBINED_EXIT_CODES.USAGE);
});

test('no lane at all, a positional argument and "-" are each refused as usage', async () => {
  const { build } = stubBuilder({});
  for (const argv of [[], ['manifest.json'], ['-'], ['--static']]) {
    const { io, stdout } = makeIo({ files: {}, build });
    assert.equal(await main(argv, io), COMBINED_EXIT_CODES.USAGE, `argv=${JSON.stringify(argv)}`);
    assert.deepEqual(stdout, ['{"error":{"code":"USAGE"}}\n']);
  }
});

test('--help writes usage to stderr, nothing to stdout, and exits 0', async () => {
  const { io, stdout, stderr } = makeIo({});
  assert.equal(await main(['--help'], io), COMBINED_EXIT_CODES.OK);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(''), /Exit codes:/);
});

test('the real bounded reader refuses an oversize file without truncating it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'combined-cli-'));
  try {
    const oversize = join(dir, 'oversize.json');
    // One byte past the 1 MiB cap, and valid JSON at the front: a truncating
    // reader would happily parse the prefix and hide the missing tail.
    writeFileSync(oversize, Buffer.alloc(1024 * 1024 + 1, 0x20));
    const { build } = stubBuilder({});
    // No readFile override: the real readEvidenceFile runs.
    const { io, stdout, loads } = makeIo({ build });

    const code = await main(['--static', oversize, '--declaration-validator', '/v/dec.mjs'], io);

    assert.equal(code, COMBINED_EXIT_CODES.INVALID);
    assert.deepEqual(jsonOf(stdout).channels.static.issues, [{ code: 'INPUT_READ_FAILED' }]);
    assert.deepEqual(loads, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real bounded reader refuses invalid UTF-8 instead of replacing bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'combined-cli-'));
  try {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, Buffer.from([0x7b, 0xff, 0x7d]));
    const { build } = stubBuilder({});
    const { io, stdout } = makeIo({ build });

    const code = await main(['--runtime', bad], io);

    assert.equal(code, COMBINED_EXIT_CODES.INVALID);
    assert.deepEqual(jsonOf(stdout).channels.runtime.issues, [{ code: 'INPUT_READ_FAILED' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing stdout sink exits 5 and claims no complete report', async () => {
  const { build } = stubBuilder({});
  const { io, stderr } = makeIo({ files: { 'runtime.json': '{"cases":[]}' }, build });
  io.stdout = () => {
    throw new Error('broken pipe');
  };

  const code = await main(['--runtime', 'runtime.json'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INTERNAL);
  assert.match(stderr.join(''), /writing the report failed/);
});

test('a throwing builder is an internal failure with no report on stdout', async () => {
  const { io, stdout, stderr } = makeIo({
    files: { 'runtime.json': '{"cases":[]}' },
    build: async () => {
      throw new Error('builder exploded');
    },
  });

  const code = await main(['--runtime', 'runtime.json'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INTERNAL);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join(''), /internal failure/);
  assert.doesNotMatch(stderr.join(''), /builder exploded/);
});

test('an unparsable lane never reaches stdout as its own error text', async () => {
  const { build } = stubBuilder({});
  const { io, stdout, stderr } = makeIo({ files: { 'runtime.json': '{"secret":"leak"' }, build });

  const code = await main(['--runtime', 'runtime.json'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INVALID);
  const written = stdout.join('') + stderr.join('');
  assert.doesNotMatch(written, /secret/);
  assert.doesNotMatch(written, /runtime\.json/);
});

test('the report is written before the stderr summary', async () => {
  const { build } = stubBuilder({});
  const order = [];
  const { io } = makeIo({ files: { 'runtime.json': '{"cases":[]}' }, build });
  const stdout = io.stdout;
  const stderr = io.stderr;
  io.stdout = (text) => {
    order.push('stdout');
    stdout(text);
  };
  io.stderr = (text) => {
    order.push('stderr');
    stderr(text);
  };

  await main(['--runtime', 'runtime.json'], io);

  assert.deepEqual(order, ['stdout', 'stderr']);
});

test('a usage problem whose stdout sink throws exits 5, not 3', async () => {
  const { io } = makeIo({ files: {} });
  io.stdout = () => {
    throw new Error('EPIPE');
  };

  const code = await main(['--static', 'a.json', '--declaration-validator', '/v/dec.mjs', '--static', 'b.json'], io);

  assert.equal(
    code,
    COMBINED_EXIT_CODES.INTERNAL,
    'a sink failure outranks a usage refusal: the marker may never have reached the operator',
  );
});

test('a usage problem whose stderr sink throws also exits 5', async () => {
  const { io } = makeIo({ files: {} });
  io.stderr = () => {
    throw new Error('EPIPE');
  };

  const code = await main([], io);

  assert.equal(code, COMBINED_EXIT_CODES.INTERNAL);
});

test('the entry-point comparison follows symlinks and refuses unresolvable paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'combined-cli-entry-'));
  try {
    const real = join(dir, 'combined-cli.js');
    const link = join(dir, 'bin-link.js');
    writeFileSync(real, '// placeholder, never imported\n', 'utf8');
    symlinkSync(real, link);
    const url = pathToFileURL(real).href;

    assert.equal(sameEntryPoint(real, url), true, 'the same path compares equal');
    assert.equal(sameEntryPoint(link, url), true, 'a symlink to the file compares equal');
    assert.equal(sameEntryPoint(join(dir, '..', dir.split('/').pop(), 'combined-cli.js'), url), true, 'a .. segment compares equal');
    assert.equal(sameEntryPoint(join(dir, 'other.js'), url), false, 'a different existing file does not');
    assert.equal(sameEntryPoint(join(dir, 'missing.js'), url), false, 'a missing path is not this file');
    assert.equal(sameEntryPoint('', url), false);
    assert.equal(sameEntryPoint(undefined, url), false);
    assert.equal(sameEntryPoint(real, 'not a url'), false);

    const broken = join(dir, 'broken.js');
    symlinkSync(join(dir, 'gone.js'), broken);
    assert.equal(sameEntryPoint(broken, url), false, 'a broken symlink is not this file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stdout sink that returns a rejected promise exits 5 on the normal path', async () => {
  const { build } = stubBuilder({});
  const { io, stderr } = makeIo({ files: { 'runtime.json': '{"cases":[]}' }, build });
  io.stdout = async () => {
    throw new Error('async EPIPE');
  };

  const code = await main(['--runtime', 'runtime.json'], io);

  assert.equal(code, COMBINED_EXIT_CODES.INTERNAL);
  // The fixed text, not a paraphrase: `ERROR_TEXT.OUTPUT_FAILED`.
  assert.match(
    stderr.join(''),
    /combined-cli: writing the report failed; completeness of the written bytes is not claimed\./,
  );
});

test('a stderr sink that returns a rejected promise exits 5 on the usage path', async () => {
  const { io } = makeIo({ files: {} });
  io.stderr = async () => {
    throw new Error('async EPIPE');
  };

  // No lane at all is a usage problem; the awaited stderr rejection outranks it.
  assert.equal(await main([], io), COMBINED_EXIT_CODES.INTERNAL);
});

test('a rejecting sink on the help path exits 5 instead of claiming success', async () => {
  const { io, stdout } = makeIo({ files: {} });
  io.stderr = async () => {
    throw new Error('async EPIPE');
  };

  assert.equal(await main(['--help'], io), COMBINED_EXIT_CODES.INTERNAL);
  assert.deepEqual(stdout, [], 'help never writes to stdout');
});

/** A minimal writable stand-in: records writes, lets a test settle them by hand. */
function fakeStream() {
  const listeners = [];
  const writes = [];
  return {
    writes,
    on(event, listener) {
      if (event === 'error') listeners.push(listener);
    },
    write(text, callback) {
      writes.push({ text, callback });
      return true;
    },
    emitError(error) {
      for (const listener of listeners) listener(error);
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

test('streamSink resolves from the write callback and installs one error listener', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const first = sink('a');
  assert.equal(stream.listenerCount(), 1, 'listeners are per stream, not per write');
  stream.writes[0].callback();

  await first;

  const second = sink('b');
  assert.equal(stream.listenerCount(), 1);
  stream.writes[1].callback();
  await second;
  assert.deepEqual(stream.writes.map((write) => write.text), ['a', 'b']);
});

test('streamSink rejects when the stream emits an error before the callback', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const pending = sink('a');
  stream.emitError(new Error('EPIPE'));

  await assert.rejects(pending, /EPIPE/);
  // The late callback must not settle the promise a second time or throw.
  stream.writes[0].callback();
});

test('streamSink rejects when the write callback reports an error', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const pending = sink('a');
  stream.writes[0].callback(new Error('ENOSPC'));

  await assert.rejects(pending, /ENOSPC/);
  // An error event after the callback has settled is ignored, not re-raised.
  stream.emitError(new Error('late'));
});

test('streamSink rejects a write that throws synchronously', async () => {
  const stream = {
    write() {
      throw new Error('closed');
    },
  };

  await assert.rejects(streamSink(stream)('a'), /closed/);
});

test('a synchronous throw of undefined is still a failure, not a success', async () => {
  const stream = {
    write() {
      throw undefined; // eslint-disable-line no-throw-literal
    },
  };
  const sink = streamSink(stream);

  const error = await sink('a').then(
    () => null,
    (reason) => reason,
  );
  assert.ok(error instanceof Error, 'a thrown undefined must reject with a usable marker');
  assert.match(error.message, /threw undefined/);
  // The stream is marked failed, so it is not reused as if it had worked.
  await assert.rejects(sink('b'), /already failed/);
});

test('a synchronous throw of 0 rejects with 0 rather than reporting success', async () => {
  const stream = {
    write() {
      throw 0; // eslint-disable-line no-throw-literal
    },
  };
  const sink = streamSink(stream);

  // `0` is falsy, so the rejection cannot be detected by truthiness: track
  // "did it reject" separately from the rejection value, which is passed through
  // unchanged (only undefined/null would be replaced by a synthesized Error).
  let rejected = false;
  let reason;
  try {
    await sink('a');
  } catch (thrown) {
    rejected = true;
    reason = thrown;
  }
  assert.equal(rejected, true, 'a thrown 0 must reject, not resolve');
  assert.equal(reason, 0, 'the thrown value is preserved as the rejection reason');

  // The stream is still marked failed, so it is not reused as if it had worked.
  await assert.rejects(sink('b'), /already failed/);
});

test('streamSink refuses a second write while one is still pending', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const first = sink('a');
  await assert.rejects(sink('b'), /still pending/);
  stream.writes[0].callback();
  await first;
  assert.equal(stream.writes.length, 1, 'the refused write never reached the stream');
});

test('a stale callback from a failed write cannot settle the next write', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const a = sink('a');
  stream.emitError(new Error('EPIPE'));
  await assert.rejects(a, /EPIPE/);

  // The stream is marked failed, so B never reaches it at all.
  await assert.rejects(sink('b'), /already failed/);
  assert.equal(stream.writes.length, 1, 'no write was attempted after the failure');

  // A's callback arriving now must not throw, revive anything or touch a later
  // write.
  stream.writes[0].callback();
  await assert.rejects(sink('c'), /already failed/);
});

test('a duplicate callback from a settled write does not disturb the next one', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const a = sink('a');
  stream.writes[0].callback();
  await a;

  const b = sink('b');
  assert.equal(stream.writes.length, 2);
  // A's callback fires a second time while B is pending: it must be ignored,
  // including when it carries an error that belongs to A.
  stream.writes[0].callback();
  stream.writes[0].callback(new Error('ghost'));

  stream.writes[1].callback();
  await b; // B resolves; the ghost completion changed nothing
  assert.equal(stream.writes.length, 2);
});

test('a callback error after an error event leaves no third state', async () => {
  const stream = fakeStream();
  const sink = streamSink(stream);

  const a = sink('a');
  stream.emitError(new Error('first'));
  await assert.rejects(a, /first/);

  // A late callback carrying its own error is inert: the write is settled and the
  // stream is failed, so it can neither settle nor re-flag anything.
  stream.writes[0].callback(new Error('second'));
  await assert.rejects(sink('b'), /already failed/);
});
