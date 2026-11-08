/**
 * Tests for compare-cli.
 *
 * Two kinds of case live here.
 *
 * 1. Control flow, driven through `io`: flag parsing, read-before-parse-before-
 *    compare ordering, fixed error payloads, exit mapping, and every sink
 *    failure shape. `compare` is stubbed, so these cases say nothing about what
 *    a real diff contains.
 * 2. Real dependencies, not stubbed: the bounded reader against real temp files
 *    (size, encoding, missing path), and one end-to-end case that builds two
 *    snapshots with the real report builder and runs the CLI with the default
 *    library compare. That last case is written against the library's own
 *    contract and must not be skipped; if the library is absent the file fails
 *    to import, which is the honest outcome.
 *
 * No case asserts that a comparison is a verdict, a health result, a
 * certification, a resolution or an improvement: compare-cli produces none.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMPARE_EXIT_CODES, main, sameEntryPoint, streamSink } from '../src/compare-cli.js';
import { buildCombinedReport } from '../src/combined-report.js';
import { compareCombinedReports, snapshotDiffExitCode } from '../src/snapshot-diff.js';

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

function makeIo(overrides = {}) {
  const stdout = [];
  const stderr = [];
  const io = {
    stdout: async (text) => {
      stdout.push(text);
    },
    stderr: async (text) => {
      stderr.push(text);
    },
    readFile: async () => {
      throw new Error('readFile was not configured for this case');
    },
    compare: async () => {
      throw new Error('compare was not configured for this case');
    },
  };
  Object.assign(io, overrides);
  return { io, stdout, stderr };
}

function jsonOf(stdout) {
  assert.equal(stdout.length, 1, 'exactly one payload is written');
  assert.ok(stdout[0].endsWith('\n'), 'the payload is one line');
  return JSON.parse(stdout[0]);
}

/**
 * One channel in the frozen diff shape: `comparison`, `changedFields`, and the
 * two sides as `{ state, outcome }` summaries. `source` is deliberately absent
 * from every side — the diff records that the field took part, not its value.
 */
function fakeChannel(comparison = 'unchanged', changedFields = []) {
  return {
    comparison,
    changedFields,
    before: { state: 'provided', outcome: 'clear' },
    after: { state: 'provided', outcome: 'clear' },
  };
}

/** A diff-shaped object, used only where the library is deliberately stubbed. */
function fakeDiff(overrides = {}) {
  return {
    diffVersion: 'combined-report-diff/0.1-draft.1',
    valid: true,
    certification: false,
    correlation: 'not-established',
    issues: [],
    channels: {
      static: fakeChannel(),
      runtime: fakeChannel(),
      admission: fakeChannel(),
    },
    limitationsChanged: false,
    limitations: ['CORRELATION_NOT_ESTABLISHED'],
    ...overrides,
  };
}

/** A diff in the same shape where one channel changed. */
function changedDiff() {
  return fakeDiff({
    channels: {
      static: fakeChannel('changed', ['outcome']),
      runtime: fakeChannel(),
      admission: fakeChannel(),
    },
  });
}

/**
 * The real builder requires at least one lane, so the real-data cases supply a
 * legal static lane: the closed `{ source, document }` entry plus a declaration
 * validator that accepts it. The document carries an empty declaration list and
 * an empty capability list, which is what the static lane's own shape asks for.
 */
const STATIC_LANE = Object.freeze({
  source: 'example',
  document: Object.freeze({ declarations: [], availableCapabilities: [] }),
});
const DECLARATION_VALIDATOR = Object.freeze({
  validateDeclaration: () => ({ valid: true, issues: [] }),
});

/** Records the order of dependency calls so ordering can be asserted. */
function recordingIo({ readFailure = null, compareResult = fakeDiff() } = {}) {
  const order = [];
  const compared = [];
  const { io, stdout, stderr } = makeIo({
    readFile: async (path) => {
      order.push(`read:${path}`);
      if (readFailure !== null && readFailure.path === path) throw new Error('read failed');
      return JSON.stringify({ path });
    },
    compare: async (before, after) => {
      order.push('compare');
      compared.push({ before, after });
      return compareResult;
    },
  });
  return { io, stdout, stderr, order, compared };
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compare-cli-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/* ------------------------------------------------------------------ *
 * Usage.
 * ------------------------------------------------------------------ */

test('a complete invocation with unchanged channels exits 0', async () => {
  const { io, stdout, stderr } = recordingIo();
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.UNCHANGED);
  const diff = jsonOf(stdout);
  assert.equal(diff.diffVersion, 'combined-report-diff/0.1-draft.1');
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /^compare-cli: unchanged/);
});

test('--help on its own prints usage on stdout and exits 0', async () => {
  const { io, stdout, stderr } = makeIo();
  const code = await main(['--help'], io);

  assert.equal(code, COMPARE_EXIT_CODES.UNCHANGED);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0], /^compare-cli — compare two combined-report snapshots/);
  assert.equal(stderr.length, 0);
});

test('--help together with input flags is a usage failure, not help', async () => {
  const { io, stdout, stderr } = makeIo();
  const code = await main(['--help', '--before', 'a.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'USAGE' } });
  assert.match(stderr[0], /--help is understood on its own/);
});

test('missing either flag is a usage failure with the fixed payload', async () => {
  for (const argv of [[], ['--before', 'a.json'], ['--after', 'b.json']]) {
    const { io, stdout } = makeIo();
    const code = await main(argv, io);
    assert.equal(code, COMPARE_EXIT_CODES.USAGE, `argv=${JSON.stringify(argv)}`);
    assert.deepEqual(jsonOf(stdout), { error: { code: 'USAGE' } });
  }
});

test('a repeated flag, a positional and stdin are each refused', async () => {
  const cases = [
    ['--before', 'a.json', '--before', 'b.json'],
    ['--before', 'a.json', '--after', 'b.json', 'extra.json'],
    ['--before', 'a.json', '--after', '-'],
    ['--before', '-', '--after', 'b.json'],
    ['--before', 'a.json', '--after', 'b.json', '--verbose'],
    ['--before', 'a.json', '--after', 'b.json', '--help'],
  ];
  for (const argv of cases) {
    const { io, stdout } = makeIo();
    const code = await main(argv, io);
    assert.equal(code, COMPARE_EXIT_CODES.USAGE, `argv=${JSON.stringify(argv)}`);
    assert.deepEqual(jsonOf(stdout), { error: { code: 'USAGE' } }, `argv=${JSON.stringify(argv)}`);
  }
});

test('an empty or dash-leading value is refused before anything is read', async () => {
  for (const argv of [
    ['--before', '', '--after', 'b.json'],
    ['--before', '--after', 'b.json'],
    ['--before', 'a.json', '--after'],
  ]) {
    let reads = 0;
    const { io, stdout } = makeIo({
      readFile: async () => {
        reads += 1;
        return '{}';
      },
    });
    const code = await main(argv, io);
    assert.equal(code, COMPARE_EXIT_CODES.USAGE, `argv=${JSON.stringify(argv)}`);
    assert.deepEqual(jsonOf(stdout), { error: { code: 'USAGE' } });
    assert.equal(reads, 0, 'a usage failure opens no file');
  }
});

/* ------------------------------------------------------------------ *
 * Ordering and input failures.
 * ------------------------------------------------------------------ */

test('both files are read before the comparison runs, and both parses precede it', async () => {
  const { io, order, compared } = recordingIo();
  await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.deepEqual(order, ['read:a.json', 'read:b.json', 'compare']);
  // The library receives parsed documents, not text.
  assert.deepEqual(compared[0].before, { path: 'a.json' });
  assert.deepEqual(compared[0].after, { path: 'b.json' });
});

test('when the first read fails the second is still attempted and nothing is compared', async () => {
  const { io, order, compared } = recordingIo({ readFailure: { path: 'a.json' } });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(order, ['read:a.json', 'read:b.json']);
  assert.equal(compared.length, 0, 'a failed read must not reach the comparison');
});

test('a read failure outranks a JSON failure on the other side', async () => {
  const { io, stdout, stderr } = makeIo({
    readFile: async (path) => {
      if (path === 'a.json') throw new Error('unreadable');
      return 'not json at all';
    },
  });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });
  // The stdout marker alone is not the contract: the phase is also named once on
  // stderr, in fixed text.
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /^compare-cli: at least one input is not a readable regular file/);
});

test('a JSON failure names its phase on stderr as well', async () => {
  const { io, stdout, stderr } = makeIo({ readFile: async () => '{ "broken": ' });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_JSON_INVALID' } });
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /^compare-cli: at least one input is not valid JSON/);
});

test('an error payload whose stderr write fails exits 5', async () => {
  const { io } = makeIo({ readFile: async () => 'not json' });
  io.stderr = async () => {
    throw new Error('async EPIPE');
  };

  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);
  assert.equal(code, COMPARE_EXIT_CODES.INTERNAL);
});

test('invalid JSON is reported as such and never compared', async () => {
  const comparedCalls = [];
  const { io, stdout } = makeIo({
    readFile: async () => '{ "broken": ',
    compare: async (...args) => {
      comparedCalls.push(args);
      return fakeDiff();
    },
  });

  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_JSON_INVALID' } });
  assert.equal(comparedCalls.length, 0, 'a parse failure must not reach the comparison');
});

test('the fixed error payload carries no path and no OS message', async () => {
  const { io, stdout, stderr } = makeIo({
    readFile: async () => {
      throw new Error('ENOENT: no such file or directory, open /secret/place.json');
    },
  });
  const code = await main(['--before', '/secret/place.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  const printed = stdout.join('') + stderr.join('');
  assert.doesNotMatch(printed, /secret/);
  assert.doesNotMatch(printed, /ENOENT/);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });
});

/* ------------------------------------------------------------------ *
 * Exit mapping.
 * ------------------------------------------------------------------ */

test('a changed diff exits 1 and is passed through verbatim', async () => {
  const diff = changedDiff();
  const { io, stdout } = makeIo({
    readFile: async () => '{}',
    compare: async () => diff,
  });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.CHANGED);
  assert.deepEqual(jsonOf(stdout), diff);
});

test('an unusable snapshot exits 2 with the library payload untouched', async () => {
  // The invalid fixture is produced by the real library from a real bad input,
  // so its issue codes and paths are the library's own and nothing here guesses
  // them. The CLI case is then about pass-through and exit mapping only.
  const usable = buildCombinedReport({ static: STATIC_LANE }, DECLARATION_VALIDATOR);
  const diff = compareCombinedReports({ nope: true }, usable);
  assert.equal(diff.valid, false);

  const { io, stdout } = makeIo({
    readFile: async () => '{}',
    compare: async () => diff,
  });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.UNUSABLE);
  const printed = jsonOf(stdout);
  assert.deepEqual(printed, diff, 'the library object is emitted unchanged');
  assert.equal(printed.valid, false);
  assert.equal(printed.channels, null);
  assert.equal(printed.limitationsChanged, null);
  assert.ok(Array.isArray(printed.issues) && printed.issues.length > 0);
  assert.ok(Array.isArray(printed.limitations), 'the fixed limitations list is kept');
});

test('the exit code comes from the library, not from a shape guess here', async () => {
  const diff = changedDiff();
  assert.equal(snapshotDiffExitCode(diff), COMPARE_EXIT_CODES.CHANGED);

  const { io } = makeIo({ readFile: async () => '{}', compare: async () => diff });
  assert.equal(await main(['--before', 'a.json', '--after', 'b.json'], io), snapshotDiffExitCode(diff));
});

test('a comparison that throws is an internal failure, not an input failure', async () => {
  const { io, stdout, stderr } = makeIo({
    readFile: async () => '{}',
    compare: async () => {
      throw new Error('boom');
    },
  });
  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.INTERNAL);
  assert.equal(stdout.length, 0);
  assert.match(stderr.join(''), /the comparison could not be completed/);
});

test('a comparison that is not an object is an internal failure', async () => {
  const { io } = makeIo({ readFile: async () => '{}', compare: async () => null });
  assert.equal(await main(['--before', 'a.json', '--after', 'b.json'], io), COMPARE_EXIT_CODES.INTERNAL);
});

/* ------------------------------------------------------------------ *
 * Output failures.
 * ------------------------------------------------------------------ */

test('a stdout sink that rejects exits 5 and claims no complete payload', async () => {
  const { io, stderr } = makeIo({
    readFile: async () => '{}',
    compare: async () => fakeDiff(),
  });
  io.stdout = async () => {
    throw new Error('async EPIPE');
  };

  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.INTERNAL);
  assert.match(
    stderr.join(''),
    /compare-cli: writing the result failed; completeness of the written bytes is not claimed\./,
  );
});

test('a stderr sink that rejects after a good stdout write still exits 5', async () => {
  const { io, stdout } = makeIo({
    readFile: async () => '{}',
    compare: async () => fakeDiff(),
  });
  io.stderr = async () => {
    throw new Error('async EPIPE');
  };

  const code = await main(['--before', 'a.json', '--after', 'b.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.INTERNAL);
  assert.equal(stdout.length, 1, 'the payload was written before the summary failed');
});

/* ------------------------------------------------------------------ *
 * Stream sink: event/callback interleaving, without real streams.
 * ------------------------------------------------------------------ */

/* The sink is exercised through `io` in the tests above; the shapes below cover
 * the failure modes a promise-returning sink cannot express: a synchronous
 * throw, a callback error, and an `'error'` event on an EventEmitter-based fake
 * stream. No socket, no process stream and no real write is involved. */

function fakeWritable({ mode }) {
  const stream = new EventEmitter();
  const calls = { write: 0 };
  stream.write = (text, callback) => {
    calls.write += 1;
    if (mode === 'throw-undefined') throw undefined;
    if (mode === 'throw-null') throw null;
    if (mode === 'throw-zero') throw 0;
    if (mode === 'throw-error') throw new Error('sync boom');
    if (mode === 'emit-error') {
      stream.emit('error', new Error('event boom'));
      return true;
    }
    if (mode === 'callback-error') {
      callback(new Error('callback boom'));
      return true;
    }
    callback(null);
    return true;
  };
  return { stream, calls };
}

test('a stream that throws undefined rejects with a fixed message', async () => {
  const { io } = makeIo({ readFile: async () => '{}', compare: async () => fakeDiff() });
  const { stream } = fakeWritable({ mode: 'throw-undefined' });
  io.stdout = streamSink(stream);

  assert.equal(await main(['--before', 'a.json', '--after', 'b.json'], io), COMPARE_EXIT_CODES.INTERNAL);
});

test('a stream that throws null is not read as success', async () => {
  const { io } = makeIo({ readFile: async () => '{}', compare: async () => fakeDiff() });
  const { stream } = fakeWritable({ mode: 'throw-null' });
  io.stdout = streamSink(stream);

  assert.equal(await main(['--before', 'a.json', '--after', 'b.json'], io), COMPARE_EXIT_CODES.INTERNAL);
});

test('a stream that throws 0 rejects with that value rather than skipping it', async () => {
  const { stream } = fakeWritable({ mode: 'throw-zero' });
  const sink = streamSink(stream);

  const outcome = await sink('x').then(
    () => ({ resolved: true }),
    (reason) => ({ resolved: false, reason }),
  );

  assert.equal(outcome.resolved, false);
  assert.equal(outcome.reason, 0);
});

test('a write callback error is surfaced, not treated as a completed write', async () => {
  const { stream } = fakeWritable({ mode: 'callback-error' });
  await assert.rejects(sinkWrite(streamSink(stream)), /callback boom/);
});

test("a stream 'error' event fails the waiting write", async () => {
  const { stream } = fakeWritable({ mode: 'emit-error' });
  await assert.rejects(sinkWrite(streamSink(stream)), /event boom/);
});

test('a stream that has failed refuses later writes without touching it', async () => {
  const stream = new EventEmitter();
  const boom = new Error('event boom');
  const writes = [];
  stream.write = (text) => {
    writes.push(text);
    return true;
  };
  const sink = streamSink(stream);

  // The first write is waiting when the stream fails: it rejects with exactly
  // the error object the stream emitted, not with a copy or a summary.
  const waiting = sink('first');
  stream.emit('error', boom);
  await assert.rejects(waiting, (reason) => reason === boom);

  const writesAfterFailure = writes.length;
  await assert.rejects(sinkWrite(sink), (reason) => reason === boom);
  assert.equal(writes.length, writesAfterFailure, 'the failed stream is not written again');
  assert.equal(writes.length, 1, 'only the first write reached the stream');
});

test('a late callback from a completed write cannot settle a later write', async () => {
  const stream = new EventEmitter();
  const callbacks = [];
  stream.write = (text, callback) => {
    callbacks.push(callback);
    return true;
  };
  const sink = streamSink(stream);

  const first = sink('one');
  callbacks[0](null);
  assert.equal(await first, undefined, 'the first write completes normally');

  // The second write starts after the first settled; the first write's callback
  // is then invoked a second time. Only the second write's own completion may
  // settle the second promise.
  const second = { settled: false, status: null, value: undefined, reason: undefined };
  sink('two').then(
    (value) => {
      second.settled = true;
      second.status = 'fulfilled';
      second.value = value;
    },
    (reason) => {
      second.settled = true;
      second.status = 'rejected';
      second.reason = reason;
    },
  );

  try {
    callbacks[0](null);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(second.settled, false, 'the stale callback of write one settles nothing');
  } finally {
    // Every captured write is completed here, whatever the assertion above
    // decided, and the microtask queue is drained before the final check.
    for (const callback of callbacks) callback(null);
    await Promise.resolve();
    await Promise.resolve();
  }

  assert.equal(second.settled, true, 'the second write is settled by its own callback');
  assert.equal(second.status, 'fulfilled', 'and fulfils rather than being refused');
  assert.equal(second.value, undefined);
  assert.equal(callbacks.length, 2, 'two writes reached the stream');
});

test('a concurrent write is refused while one write is still in flight', async () => {
  const stream = new EventEmitter();
  const callbacks = [];
  stream.write = (text, callback) => {
    callbacks.push(callback);
    return true;
  };
  const sink = streamSink(stream);

  // Both outcomes are recorded through handlers attached immediately: nothing is
  // awaited before the observation, and no promise is awaited unconditionally.
  // If the first write were ever left unsettled by a token overwrite, the flag
  // assertion below fails instead of hanging the run.
  const first = { settled: false, status: null, value: undefined };
  sink('one').then(
    (value) => {
      first.settled = true;
      first.status = 'fulfilled';
      first.value = value;
    },
    () => {
      first.settled = true;
      first.status = 'rejected';
    },
  );

  const second = { settled: false, status: null, reason: undefined };
  sink('two').then(
    () => {
      second.settled = true;
      second.status = 'fulfilled';
    },
    (reason) => {
      second.settled = true;
      second.status = 'rejected';
      second.reason = reason;
    },
  );

  try {
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(second.settled, true, 'the concurrent write settles immediately');
    assert.equal(second.status, 'rejected', 'and is refused rather than accepted');
    assert.ok(second.reason instanceof Error, 'the refusal is an Error');
    assert.match(second.reason.message, /already in flight/);
    assert.equal(callbacks.length, 1, 'the refused write never reached the stream');
  } finally {
    // Only the write that was already in flight reached the stream; completing
    // it must still settle that write normally.
    for (const callback of callbacks) callback(null);
    await Promise.resolve();
    await Promise.resolve();
  }

  assert.equal(first.settled, true, 'the write already in flight still settles');
  assert.equal(first.status, 'fulfilled', 'and completes successfully');
  assert.equal(first.value, undefined);
});

async function sinkWrite(sink) {
  return sink('x');
}

/* ------------------------------------------------------------------ *
 * Real reader: size, encoding and missing paths.
 * ------------------------------------------------------------------ */

/**
 * An `io` whose reads go through the module's own bounded reader: the helper's
 * throwing `readFile` stub is removed, so `withDefaults` supplies
 * `readEvidenceFile`. Without this the cases below would fail on the stub and
 * prove nothing about the real reader.
 */
function makeRealReaderIo(overrides = {}) {
  const made = makeIo(overrides);
  delete made.io.readFile;
  return made;
}

test('a missing file is a read failure with the fixed payload', async (t) => {
  const dir = tempDir(t);
  const { io, stdout } = makeRealReaderIo();
  const code = await main(
    ['--before', join(dir, 'absent.json'), '--after', join(dir, 'absent2.json')],
    io,
  );

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });
});

test('a file that is not strict UTF-8 is refused by the real reader', async (t) => {
  const dir = tempDir(t);
  const before = join(dir, 'before.json');
  const after = join(dir, 'after.json');
  writeFileSync(before, Buffer.from([0x7b, 0xff, 0x7d]));
  writeFileSync(after, '{}');

  const { io, stdout } = makeRealReaderIo();
  const code = await main(['--before', before, '--after', after], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });
});

test('a file above the 1 MiB cap is refused, and one at the cap is read', async (t) => {
  const dir = tempDir(t);
  const tooLarge = join(dir, 'large.json');
  writeFileSync(tooLarge, 'a'.repeat(1024 * 1024 + 1));

  const { io: refusedIo, stdout } = makeRealReaderIo();
  const refused = await main(['--before', tooLarge, '--after', tooLarge], refusedIo);
  assert.equal(refused, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });

  // Exactly at the cap the reader accepts; the body is not JSON, so the failure
  // moves to the parse phase rather than the size phase.
  const atCap = join(dir, 'at-cap.json');
  writeFileSync(atCap, ' '.repeat(1024 * 1024));

  const { io: capIo, stdout: capOut } = makeRealReaderIo();
  const atCapCode = await main(['--before', atCap, '--after', atCap], capIo);
  assert.equal(atCapCode, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(capOut), { error: { code: 'INPUT_JSON_INVALID' } });
});

test('a directory is not read as a document', async (t) => {
  const dir = tempDir(t);
  const { io, stdout } = makeRealReaderIo();
  const code = await main(['--before', dir, '--after', dir], io);

  assert.equal(code, COMPARE_EXIT_CODES.USAGE);
  assert.deepEqual(jsonOf(stdout), { error: { code: 'INPUT_READ_FAILED' } });
});

test('two well-formed JSON files reach the real reader and are compared', async (t) => {
  const dir = tempDir(t);
  const before = join(dir, 'before.json');
  const after = join(dir, 'after.json');
  writeFileSync(before, JSON.stringify({ side: 'before' }));
  writeFileSync(after, JSON.stringify({ side: 'after' }));

  const seen = [];
  // The reader is real here too; only the comparison is stubbed, so the case is
  // about the reader handing both parsed bodies through.
  const { io } = makeRealReaderIo({
    compare: async (a, b) => {
      seen.push({ a, b });
      return fakeDiff();
    },
  });
  const code = await main(['--before', before, '--after', after], io);

  assert.equal(code, COMPARE_EXIT_CODES.UNCHANGED);
  assert.deepEqual(seen[0].a, { side: 'before' });
  assert.deepEqual(seen[0].b, { side: 'after' });
});

/* ------------------------------------------------------------------ *
 * Direct-invocation guard.
 * ------------------------------------------------------------------ */

test('sameEntryPoint refuses non-paths and accepts the real entry point', () => {
  assert.equal(sameEntryPoint('', 'file:///x'), false);
  assert.equal(sameEntryPoint(null, 'file:///x'), false);
  assert.equal(sameEntryPoint('/definitely/not/here.js', 'file:///x'), false);
  assert.equal(sameEntryPoint(new URL(import.meta.url).pathname, import.meta.url), true);
});

/* ------------------------------------------------------------------ *
 * Real library, real builder: one end-to-end comparison, never skipped.
 * ------------------------------------------------------------------ */

test('a real one-lane snapshot pair is incomparable on the other lanes, not a verdict', async () => {
  const before = buildCombinedReport({ static: STATIC_LANE }, DECLARATION_VALIDATOR);
  const after = buildCombinedReport({ static: STATIC_LANE }, DECLARATION_VALIDATOR);

  // Two substitutions, both deliberate and both stated here. `readFile` is
  // stubbed to hand over document *text*, so this case is about the library and
  // the CLI's mapping, not about the reader or any file on disk. `compare` is
  // the opposite: the helper's throwing stub is removed rather than left
  // untouched, so `withDefaults` supplies the real library.
  const { io, stdout, stderr } = makeIo({
    readFile: async (path) => (path === 'before.json' ? JSON.stringify(before) : JSON.stringify(after)),
  });
  delete io.compare;

  const code = await main(['--before', 'before.json', '--after', 'after.json'], io);

  const diff = jsonOf(stdout);
  assert.equal(diff.diffVersion, 'combined-report-diff/0.1-draft.1');
  assert.equal(diff.certification, false);
  assert.equal(diff.correlation, 'not-established');
  assert.ok(Array.isArray(diff.issues));
  assert.equal(diff.valid, true);

  // Two of the three lanes are absent in both snapshots, so the pair cannot be
  // cleared: exit 1 is "not comparable", never an all-clear.
  assert.equal(code, COMPARE_EXIT_CODES.CHANGED);

  // The code is the library's own mapping of this very object, not a second
  // opinion computed here.
  assert.equal(code, snapshotDiffExitCode(diff));
  assert.notEqual(code, COMPARE_EXIT_CODES.INTERNAL);
  assert.notEqual(code, COMPARE_EXIT_CODES.USAGE);

  // The provided lane is compared; its sides are summaries, not document bodies.
  assert.equal(diff.channels.static.before.state, 'provided');
  assert.equal(diff.channels.static.after.state, 'provided');

  // Nothing is resolved or improved, and no source text is echoed.
  assert.equal(Object.prototype.hasOwnProperty.call(diff, 'resolved'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(diff, 'improved'), false);
  assert.doesNotMatch(stdout.join(''), /example/);
  assert.equal(stderr.length, 1);
});

test('an unusable snapshot from the real library exits 2 rather than 5', async () => {
  const usable = buildCombinedReport({ static: STATIC_LANE }, DECLARATION_VALIDATOR);
  // Same split as above: document text is supplied by the stub, while `compare`
  // is the real library so the "unusable" decision is its own.
  const { io, stdout } = makeIo({
    readFile: async (path) =>
      path === 'before.json' ? JSON.stringify({ nope: true }) : JSON.stringify(usable),
  });
  delete io.compare;

  const code = await main(['--before', 'before.json', '--after', 'after.json'], io);

  assert.equal(code, COMPARE_EXIT_CODES.UNUSABLE);
  const diff = jsonOf(stdout);
  assert.equal(diff.valid, false);
  assert.equal(diff.channels, null);
  assert.equal(diff.limitationsChanged, null);
});
