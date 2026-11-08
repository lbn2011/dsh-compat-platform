#!/usr/bin/env node
/**
 * `dsh-compat-compare` — compare two `combined-report/0.1-draft.1` snapshots.
 *
 * WHAT THIS IS. A reader for two explicit report files. It reads both, parses
 * both, hands the two parsed documents to `compareCombinedReports` exactly once,
 * prints the diff object that comes back, and maps it to an exit code with
 * `snapshotDiffExitCode`. That is the whole program.
 *
 * WHAT IT IS NOT.
 * - It does not import a validator, does not load a plugin and does not analyse
 *   anything: the documents were produced elsewhere, by a report builder that
 *   already ran.
 * - It does not decide compatibility. Neither exit 0 nor exit 1 is a verdict,
 *   a health evaluation or a certification.
 * - It does not resolve, improve or close anything. A lane that disappeared is
 *   reported as incomparable, never as a fix; absence is not evidence of repair.
 * - It does not echo, interpret or identify any `source` value. A source string
 *   is an alias the producing tool chose; the diff records only that the field
 *   took part in the comparison, never its content and never which entity it
 *   denoted.
 *
 * INPUTS. Exactly two named regular files, in the fixed order
 * `--before FILE --after FILE`. No stdin, no positional arguments, no
 * environment, no directory scan and no output file. Both reads are attempted
 * before either parse, and both parses complete before the comparison, so a
 * failure on one side never leaves a half-comparison on stdout.
 *
 * OUTPUT. One JSON line on stdout, then one fixed line on stderr. Every failure
 * diagnostic is fixed text: no path, no OS message, no parser message and no
 * document content is ever interpolated. A write failure (synchronous throw,
 * rejected promise, or a stream `'error'`) is exit 5 and no complete payload is
 * claimed.
 *
 * EXIT CODES. `0` both snapshots comparable on all three lanes with no change
 * and an unchanged top-level limitations list; `1` something changed, or a lane
 * was not comparable at all (an absent lane is incomparable, not a change that
 * happens to be equal); `2` at least one document is not a usable snapshot
 * (decided by the library, not here); `3` usage, read, size, encoding or JSON
 * failure; `5` internal failure, serialization failure or any stdout/stderr
 * write failure. Priority `5 > 3 > 2 > 1 > 0`.
 *
 * @module compare-cli
 */

import { realpathSync } from 'node:fs';
import { compareCombinedReports, snapshotDiffExitCode } from './snapshot-diff.js';
import { readEvidenceFile } from './evidence-cli.js';

/** Exit codes for this CLI only; a separate closed object, not a shared enum. */
export const COMPARE_EXIT_CODES = Object.freeze({
  /** Every lane structurally comparable, nothing changed. Not a health result. */
  UNCHANGED: 0,
  /** Something changed, or a lane could not be compared. Not a verdict. */
  CHANGED: 1,
  /** A document is not a usable snapshot. Chosen by the library. */
  UNUSABLE: 2,
  /** Usage, read, size, encoding or JSON failure. */
  USAGE: 3,
  /** Internal, serialization, or output failure. */
  INTERNAL: 5,
});

/** Fixed text for every diagnostic. None of it is derived from the inputs. */
const ERROR_TEXT = Object.freeze({
  USAGE_NO_INPUT: 'compare-cli: name both --before FILE and --after FILE; both are required.',
  USAGE_VALUE_MISSING: 'compare-cli: --before and --after each take exactly one non-empty file path.',
  USAGE_DUPLICATE: 'compare-cli: --before and --after may each be given at most once.',
  USAGE_STDIN: 'compare-cli: standard input ("-") is not accepted; name an explicit regular file.',
  USAGE_OPTION: 'compare-cli: unknown option; only --before, --after and --help are understood.',
  USAGE_POSITIONAL: 'compare-cli: positional arguments are not accepted; use --before and --after.',
  USAGE_HELP_WITH_INPUT: 'compare-cli: --help is understood on its own, without input files.',
  INPUT_READ_FAILED:
    'compare-cli: at least one input is not a readable regular file within the size and encoding limits; nothing was compared.',
  INPUT_JSON_INVALID:
    'compare-cli: at least one input is not valid JSON; nothing was compared.',
  COMPARE_FAILED: 'compare-cli: the comparison could not be completed.',
  SERIALIZATION_FAILED: 'compare-cli: the comparison result could not be serialized.',
  OUTPUT_FAILED:
    'compare-cli: writing the result failed; completeness of the written bytes is not claimed.',
  SUMMARY_UNCHANGED: 'compare-cli: unchanged across all three channels.',
  SUMMARY_CHANGED: 'compare-cli: differences reported; this is not a verdict.',
  SUMMARY_UNUSABLE: 'compare-cli: at least one input is not a usable snapshot.',
  SUMMARY_USAGE: 'compare-cli: the invocation or an input could not be used.',
});

/** Fixed machine-readable codes for the two fixed error payloads. */
const ERROR_CODES = Object.freeze({
  USAGE: 'USAGE',
  INPUT_READ_FAILED: 'INPUT_READ_FAILED',
  INPUT_JSON_INVALID: 'INPUT_JSON_INVALID',
  INTERNAL: 'INTERNAL',
});

const USAGE = `compare-cli — compare two combined-report snapshots

Usage:
  compare-cli --before FILE --after FILE
  compare-cli --help

Both files are required and each may be given once. Each must be a regular file
of at most 1 MiB that decodes as strict UTF-8 and parses as JSON. The bodies are
compared as structural snapshots; no validator is imported, nothing is loaded
and no compatibility verdict is produced.

Exit codes:
  0  all three channels comparable and unchanged
  1  differences, or a channel that could not be compared
  2  an input is not a usable snapshot
  3  usage, read, size, encoding or JSON failure
  5  internal or output failure
`;

class CompareCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompareCliError';
  }
}

function refuse(message) {
  return new CompareCliError(message);
}

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/**
 * Parse the closed flag set. Nothing is read here: a wrong invocation never
 * opens a file.
 *
 * `--help` is only accepted on its own; combined with input flags it is a usage
 * failure rather than a silent request for help.
 */
function parseArguments(args) {
  const options = { before: null, after: null, help: false };

  let index = 0;
  const takesValue = () => {
    if (index + 1 >= args.length) throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    const value = args[index + 1];
    if (value === '') throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    if (value.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    index += 1;
    return value;
  };

  for (; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help') {
      if (options.help) throw refuse(ERROR_TEXT.USAGE_OPTION);
      options.help = true;
      continue;
    }
    if (argument === '--before' || argument === '--after') {
      const key = argument.slice(2);
      if (options[key] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE);
      options[key] = takesValue();
      continue;
    }
    if (argument === '-') throw refuse(ERROR_TEXT.USAGE_STDIN);
    if (argument.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_OPTION);
    throw refuse(ERROR_TEXT.USAGE_POSITIONAL);
  }

  if (options.help) {
    if (options.before !== null || options.after !== null) {
      throw refuse(ERROR_TEXT.USAGE_HELP_WITH_INPUT);
    }
    return options;
  }
  if (options.before === null || options.after === null) throw refuse(ERROR_TEXT.USAGE_NO_INPUT);

  return options;
}

/* ------------------------------------------------------------------ *
 * Sinks.
 * ------------------------------------------------------------------ */

const streamWriteStates = new WeakMap();

function writeStateFor(stream) {
  let state = streamWriteStates.get(stream);
  if (state !== undefined) return state;
  state = { pending: null, failed: null };
  streamWriteStates.set(stream, state);
  if (typeof stream.on === 'function') {
    stream.on('error', (error) => {
      if (state.failed === null) state.failed = error ?? new Error('compare-cli: stream error');
      const pending = state.pending;
      if (pending === null) return;
      state.pending = null;
      pending.reject(state.failed);
    });
  }
  return state;
}

/**
 * Wrap a writable stream as an awaitable sink.
 *
 * Each write carries its own token and only the token still pending may settle,
 * so a completion belonging to an earlier write cannot resolve or reject a later
 * one. At most one write may be in flight: while one is pending, a further call
 * is refused immediately with a fixed error, without calling `stream.write`,
 * without disturbing the pending write and without marking the stream failed —
 * the write already in flight can still complete normally. Once a stream has
 * failed — through `'error'`, a callback error, or a throw — every later write is
 * refused without touching the stream.
 *
 * @param {{ write: Function, on?: Function }} stream
 * @returns {(text: string) => Promise<void>}
 */
export function streamSink(stream) {
  return (text) =>
    new Promise((resolve, reject) => {
      const state = writeStateFor(stream);
      if (state.failed !== null) {
        reject(state.failed);
        return;
      }
      if (state.pending !== null) {
        // A second concurrent write would overwrite the pending token and leave
        // the earlier promise unsettled forever. Refuse it before touching the
        // stream: the caller sees an immediate, fixed failure.
        reject(
          new Error(
            'compare-cli: another write is already in flight on this stream; at most one write is allowed at a time',
          ),
        );
        return;
      }
      const token = { reject };
      state.pending = token;

      const settleOnce = (action, value) => {
        if (state.pending !== token) return;
        state.pending = null;
        action(value);
      };

      try {
        stream.write(text, (error) => {
          if (state.pending !== token) return;
          if (error) {
            state.failed = error;
            state.pending = null;
            reject(error);
            return;
          }
          settleOnce(resolve, undefined);
        });
      } catch (thrown) {
        if (state.pending !== token) return;
        // A thrown `null`/`undefined` would leave `state.failed` null and let a
        // later write reach a stream that already failed. The marker and the
        // rejection therefore use one normalized value: a fixed Error for those
        // two, and the thrown value itself for everything else (`throw 0` is
        // preserved, because `0 === null` is false).
        const reason =
          thrown === undefined || thrown === null
            ? new Error('compare-cli: the stream write threw a non-Error value')
            : thrown;
        state.failed = reason;
        state.pending = null;
        reject(reason);
      }
    });
}

async function trySink(sink, text) {
  try {
    await sink(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * One fixed error line on stdout, then the matching fixed summary on stderr.
 *
 * Both writes are attempted; either failing makes the result an internal (5)
 * failure, because a payload was not delivered and no complete claim can be
 * made. The stderr line is the same fixed text family the success paths use —
 * it names the phase, never the path, the OS message or the document.
 */
async function errorPayload(io, code, exitCode, summary) {
  const payload = `${JSON.stringify({ error: { code } })}\n`;
  if (!(await trySink(io.stdout, payload))) return COMPARE_EXIT_CODES.INTERNAL;
  if (!(await trySink(io.stderr, `${summary}\n`))) return COMPARE_EXIT_CODES.INTERNAL;
  return exitCode;
}

/**
 * Usage failures: the fixed marker on stdout, then the specific fixed usage
 * message on stderr. The caller's message replaces the generic summary because
 * every usage message is itself fixed text written in this module.
 */
async function usageFailure(io, message) {
  const payload = `${JSON.stringify({ error: { code: ERROR_CODES.USAGE } })}\n`;
  if (!(await trySink(io.stdout, payload))) return COMPARE_EXIT_CODES.INTERNAL;
  if (!(await trySink(io.stderr, `${message}\n`))) return COMPARE_EXIT_CODES.INTERNAL;
  return COMPARE_EXIT_CODES.USAGE;
}

/**
 * Read one input. Returns the text, or `{ ok: false }` — the reason is not kept,
 * because both read failures map to one fixed code and one fixed message.
 */
async function attemptRead(io, path) {
  try {
    const text = await io.readFile(path);
    return { ok: true, text };
  } catch {
    return { ok: false };
  }
}

function attemptParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function summaryFor(exitCode) {
  if (exitCode === COMPARE_EXIT_CODES.UNCHANGED) return ERROR_TEXT.SUMMARY_UNCHANGED;
  if (exitCode === COMPARE_EXIT_CODES.CHANGED) return ERROR_TEXT.SUMMARY_CHANGED;
  if (exitCode === COMPARE_EXIT_CODES.UNUSABLE) return ERROR_TEXT.SUMMARY_UNUSABLE;
  return ERROR_TEXT.SUMMARY_USAGE;
}

/* ------------------------------------------------------------------ *
 * Run.
 * ------------------------------------------------------------------ */

async function run(rawArgv, io) {
  let options;
  try {
    options = parseArguments(rawArgv);
  } catch (error) {
    const message = error instanceof CompareCliError ? error.message : ERROR_TEXT.USAGE_NO_INPUT;
    return usageFailure(io, message);
  }

  if (options.help) {
    if (!(await trySink(io.stdout, USAGE))) return COMPARE_EXIT_CODES.INTERNAL;
    return COMPARE_EXIT_CODES.UNCHANGED;
  }

  // Phase 1: both reads are attempted. A read failure outranks a parse failure,
  // so the decision waits until both have been tried.
  const beforeRead = await attemptRead(io, options.before);
  const afterRead = await attemptRead(io, options.after);
  if (!beforeRead.ok || !afterRead.ok) {
    return errorPayload(
      io,
      ERROR_CODES.INPUT_READ_FAILED,
      COMPARE_EXIT_CODES.USAGE,
      ERROR_TEXT.INPUT_READ_FAILED,
    );
  }

  // Phase 2: both parses complete before anything is compared.
  const beforeParsed = attemptParse(beforeRead.text);
  const afterParsed = attemptParse(afterRead.text);
  if (!beforeParsed.ok || !afterParsed.ok) {
    return errorPayload(
      io,
      ERROR_CODES.INPUT_JSON_INVALID,
      COMPARE_EXIT_CODES.USAGE,
      ERROR_TEXT.INPUT_JSON_INVALID,
    );
  }

  // Phase 3: exactly one call into the library. Its verdict is not re-derived.
  let diff;
  try {
    diff = await io.compare(beforeParsed.value, afterParsed.value);
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.COMPARE_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }
  if (!isPlainRecord(diff)) {
    await trySink(io.stderr, `${ERROR_TEXT.COMPARE_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }

  let exitCode;
  try {
    exitCode = snapshotDiffExitCode(diff);
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.COMPARE_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }

  // Phase 4: serialize, write, then summarize.
  let payload;
  try {
    payload = `${JSON.stringify(diff)}\n`;
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.SERIALIZATION_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }

  if (!(await trySink(io.stdout, payload))) {
    await trySink(io.stderr, `${ERROR_TEXT.OUTPUT_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }
  if (!(await trySink(io.stderr, `${summaryFor(exitCode)}\n`))) {
    return COMPARE_EXIT_CODES.INTERNAL;
  }

  return exitCode;
}

function withDefaults(io) {
  const provided = io !== null && typeof io === 'object' ? io : {};
  return {
    stdout: typeof provided.stdout === 'function' ? provided.stdout : streamSink(process.stdout),
    stderr: typeof provided.stderr === 'function' ? provided.stderr : streamSink(process.stderr),
    readFile: typeof provided.readFile === 'function' ? provided.readFile : readEvidenceFile,
    /**
     * Production always uses the real library. The seam exists so control flow —
     * ordering, read/parse failure, output failure, exit mapping — can be
     * exercised without depending on a snapshot pair.
     */
    compare: typeof provided.compare === 'function' ? provided.compare : compareCombinedReports,
  };
}

/**
 * Run the CLI once and RETURN its exit code.
 *
 * WHAT THIS DOES NOT DO. `main` does not call `process.exit` and does not set
 * `process.exitCode`: the returned number is the whole result, and the caller
 * decides what to do with it. Every sink and every dependency is reachable
 * through `io`, so a test can replay the same argv.
 *
 * WHAT THIS DOES NOT CLAIM. "No process effect" would be wrong, in three ways:
 * - the default sinks are {@link streamSink} wrappers that keep per-stream state
 *   in a `WeakMap` and install a persistent `'error'` listener on `process.stdout`
 *   / `process.stderr` the first time they are used;
 * - an error arriving while no write is pending is recorded and dropped, which
 *   means an idle-time stream error is not re-thrown and could suppress a late
 *   uncaught error on that stream;
 * - the default reader performs `open`/`read`/`close` on the named files, and
 *   `JSON.parse` runs on their contents. Those happen outside `io`.
 *
 * The reader does not consult `process.cwd()`: both paths are taken verbatim
 * from argv, and the only resolution is what the reader itself does.
 *
 * @param {string[]} argv arguments after the executable and script name.
 * @param {{ stdout?: Function, stderr?: Function, readFile?: Function, compare?: Function }} [io]
 * @returns {Promise<number>} 0, 1, 2, 3 or 5.
 */
export async function main(argv, io) {
  const resolved = withDefaults(io);
  try {
    return await run(Array.isArray(argv) ? argv : [], resolved);
  } catch {
    await trySink(resolved.stderr, `${ERROR_TEXT.COMPARE_FAILED}\n`);
    return COMPARE_EXIT_CODES.INTERNAL;
  }
}

/** Compare two resolved entry points without following either one twice. */
export function sameEntryPoint(argvEntry, moduleUrl) {
  if (typeof argvEntry !== 'string' || argvEntry === '') return false;
  let left;
  let right;
  try {
    left = realpathSync(argvEntry);
    right = realpathSync(new URL(moduleUrl));
  } catch {
    return false;
  }
  return left === right;
}

function isDirectInvocation() {
  return sameEntryPoint(process.argv[1], import.meta.url);
}

if (isDirectInvocation()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
