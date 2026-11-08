#!/usr/bin/env node
/**
 * combined-cli — one report over up to three explicitly named lane documents.
 *
 * TRUST BOUNDARY, stated once:
 *
 *   1. Nothing here imports, requires, evaluates or executes a plugin, a host,
 *      a driver root or a profile. It reads the three paths the operator named
 *      and hands the already-parsed JSON to the report builder.
 *   2. The only non-fixed code this entry point adds is the validator module
 *      named by `--declaration-validator` / `--admission-validator`. Those are
 *      imported into THIS process with the caller's privileges. This is an
 *      explicit selection, not a sandbox: only point them at trusted code.
 *   3. No directory scan, no environment lookup, no positional argument, no
 *      standard input and no output directory exist on this surface.
 *
 * ORDERING, stated narrowly: all named files are read and parsed first, and
 * only then is a validator imported. A mistyped path, an unreadable file or a
 * malformed document therefore never runs the module named on that lane. This
 * is not "before any code runs": this file's own static imports — Node
 * built-ins plus `./combined-report.js` and `./evidence-cli.js` — were already
 * evaluated when the module was loaded, as for any ES module.
 *
 * WHAT A REPORT CANNOT SAY: a `source` is a fixed slot label (`static-input`
 * and so on), never a file path and never evidence of provenance. Lanes are
 * correlated only in the sense that one operator named them together; no
 * identity, no ordering and no causal link between documents is established.
 *
 * WHAT A REPORT DOES NOT HIDE: the fixed slot labels and the fixed refusal
 * codes below are about THIS FILE's own diagnostics. The report body carries
 * each lane's own result and issues unchanged, and those may embed values taken
 * from the input documents — plugin ids, capability names, resource tuples,
 * issue paths. A combined report is therefore not a redacted or secret-free
 * document, and nothing here should be read as one.
 *
 * WHAT IS NOT A SANDBOX: a validator named with `--declaration-validator` or
 * `--admission-validator` runs in this process with the caller's privileges. It
 * may write to stdout, stderr or the filesystem, replace globals or never
 * return. "One JSON document on stdout" describes what this CLI writes when it
 * runs to completion; it is not a guarantee about a hostile or buggy module,
 * and it does not make the output trustworthy merely because it is selected
 * explicitly.
 *
 * WRITE FAILURES: every sink write is awaited, so a synchronous throw, a rejected
 * promise and a stream error reported through the write callback or an `'error'`
 * event all end in exit 5. Not detected: an error the stream emits after its
 * write callback has already succeeded, and a custom sink that fails later on
 * its own. A host that must know the report was delivered has to pass a sink
 * that awaits its own flush.
 *
 * Usage:
 *   node src/combined-cli.js --static <file> [--declaration-validator <module>]
 *                            [--runtime <file>]
 *                            [--admission <file>] [--admission-validator <module>]
 *
 * Exit codes: 0 all three channels clear, 1 attention or absent, 2 invalid, 3 usage
 * or validator module load failure, 4 lane error, 5 internal, serialization or
 * output failure. Precedence: 5 > 3 > 4 > 2 > 1 > 0.
 *
 * @packageDocumentation
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LIMITATION_CODES, REPORT_VERSION as LIBRARY_REPORT_VERSION, buildCombinedReport } from './combined-report.js';
import { readEvidenceFile } from './evidence-cli.js';

/**
 * The report format this CLI emits. Taken from the report library rather than
 * repeated here, so the two cannot drift apart.
 */
export const REPORT_VERSION = LIBRARY_REPORT_VERSION;

/** Lane order everywhere in this file: fixed, so output is deterministic. */
export const LANE_NAMES = Object.freeze(['static', 'runtime', 'admission']);

/**
 * The fixed slot label reported for each channel. These labels are slots, not
 * paths: this file never substitutes a path for one. They do not make the report
 * path-free — a lane's own result is republished unchanged and may contain
 * paths, ids or other values taken from that lane's document.
 */
const SOURCE_BY_LANE = Object.freeze({
  static: 'static-input',
  runtime: 'runtime-input',
  admission: 'admission-input',
});

/**
 * The one export name each lane's validator module must provide. There is no
 * `--export` flag on this surface: a single fixed name per lane keeps the
 * selection reviewable, and a module that does not export it is a load failure.
 */
const VALIDATOR_EXPORT_BY_LANE = Object.freeze({
  static: 'validateDeclaration',
  admission: 'validateAdmissionEvidence',
});

/** Exit codes for this CLI. Closed and independent of every other lane's codes. */
export const COMBINED_EXIT_CODES = Object.freeze({
  /** Every present channel is clear. */
  OK: 0,
  /** At least one channel needs attention, or a lane was not provided. */
  ATTENTION: 1,
  /** At least one channel's document is invalid. */
  INVALID: 2,
  /** Usage problem, or a validator module could not be loaded or used. */
  USAGE: 3,
  /** A lane failed after a usable document was accepted. */
  LANE_ERROR: 4,
  /** Internal failure, serialization failure or a failing output sink. */
  INTERNAL: 5,
});

/**
 * Every diagnostic this CLI prints to stderr. Fixed, path-free and
 * content-free: no OS error message, no parser message, no file path, no
 * document text and no stack trace is ever interpolated into one.
 *
 * SCOPE: this holds for these strings only. It is not a statement about the
 * report written to stdout, which republishes each lane's own result, and it is
 * not a statement about what an explicitly selected validator module may print.
 */
const ERROR_TEXT = Object.freeze({
  USAGE_OPTION: 'combined-cli: unknown option; only the documented flags are understood.',
  USAGE_VALUE_MISSING: 'combined-cli: a flag that takes a value was given without one.',
  USAGE_DUPLICATE_LANE: 'combined-cli: each of --static, --runtime and --admission may be given at most once.',
  USAGE_DUPLICATE_VALIDATOR: 'combined-cli: each validator flag may be given at most once.',
  USAGE_POSITIONAL: 'combined-cli: no positional argument is accepted; name documents with the documented flags.',
  USAGE_STDIN: 'combined-cli: standard input ("-") is not accepted; name explicit regular files.',
  USAGE_NO_INPUT: 'combined-cli: at least one of --static, --runtime or --admission is required.',
  USAGE_VALIDATOR_WITHOUT_LANE: 'combined-cli: a validator flag was given without its lane.',
  USAGE_MISSING_DECLARATION_VALIDATOR: 'combined-cli: --static requires --declaration-validator.',
  USAGE_MISSING_ADMISSION_VALIDATOR: 'combined-cli: --admission requires --admission-validator.',
  VALIDATOR_LOAD_FAILED: 'combined-cli: the named validator module could not be loaded or does not export the fixed name as a function.',
  INTERNAL: 'combined-cli: internal failure; no report was produced.',
  SERIALIZATION_FAILED: 'combined-cli: the report could not be serialized; no report was written.',
  OUTPUT_FAILED: 'combined-cli: writing the report failed; completeness of the written bytes is not claimed.',
});

const USAGE = `combined-cli — one report over up to three explicitly named lane documents

Usage:
  node src/combined-cli.js [--static <file>] [--runtime <file>] [--admission <file>]
                           [--declaration-validator <module>] [--admission-validator <module>]

Input:
  --static <file>       Explicit path to one declaration document.
  --runtime <file>      Explicit path to one runtime-evidence document.
  --admission <file>    Explicit path to one admission-evidence document.
                        At least one of the three is required; each may be given
                        at most once. There is no positional argument, no "-"
                        and no directory scan.

Validators (executed in this process with your privileges — trusted code only):
  --declaration-validator <module>  Required with --static. Must export
                                    validateDeclaration.
  --admission-validator <module>    Required with --admission. Must export
                                    validateAdmissionEvidence.
  './', '../', an absolute path or a 'file:' URL is loaded as a file; any other
  specifier is resolved by Node's normal bare-specifier resolution. That module
  runs with this process's privileges: it can write to stdout, stderr or the
  filesystem. This is an explicit selection, not a sandbox.

Reading: each named file is read through the shared bounded reader — a regular
file of at most 1048576 bytes (1 MiB) decoded as strict UTF-8. Standard input,
directories and special files are refused.

Output:
  stdout   One JSON document: the combined report. For a usage problem,
           {"error":{"code":"USAGE"}} instead.
  stderr   One fixed summary line; usage text on a usage problem.

Exit codes:
  0 all three channels clear         3 usage, or validator load/use failure
  1 attention, or a lane absent      4 a lane failed
  2 a document is invalid            5 internal, serialization or output failure
`;

/** The closed refusal type of this module; nothing else may reach stderr. */
class CombinedCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CombinedCliError';
  }
}

function refuse(message) {
  return new CombinedCliError(message);
}

/**
 * Resolve a validator specifier the same way for every lane.
 *
 * Three rules, applied in this order and kept separate on purpose:
 *
 *  1. An explicit `file:` URL is already a URL. It is parsed as one and passed
 *     through with its URL semantics: the import target is the parsed href, not
 *     a filesystem path, so the scheme is never re-read as a directory name and
 *     a percent-escape is not decoded once and re-encoded again by
 *     `pathToFileURL`. Characters that URL parsing normalizes are normalized;
 *     the claim here is only that path machinery is not applied to a URL.
 *  2. Absolute and `./`/`../` paths become file URLs, resolved against the
 *     current working directory now rather than at import time.
 *  3. Anything else is a bare specifier and is left to Node's resolution.
 */
function resolveModuleTarget(specifier) {
  if (/^file:/i.test(specifier)) {
    let parsed;
    try {
      parsed = new URL(specifier);
    } catch {
      throw refuse('A validator specifier that starts with "file:" must be a valid file URL.');
    }
    return { target: parsed.href, isFile: true };
  }

  const isPathLike =
    isAbsolute(specifier) || specifier.startsWith('./') || specifier.startsWith('../');

  if (!isPathLike) return { target: specifier, isFile: false };
  return {
    target: pathToFileURL(isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier)).href,
    isFile: true,
  };
}

/**
 * Parse the fixed flag set.
 *
 * A value that begins with '-' is accepted only for validator specifiers, where
 * a leading dash is not a plausible spelling anyway; for lane paths it is
 * refused so that a forgotten value cannot silently consume the next flag.
 */
function parseArguments(args) {
  const options = {
    lanes: { static: null, runtime: null, admission: null },
    declarationValidator: null,
    admissionValidator: null,
  };

  const takesValue = (flag) => {
    if (index + 1 >= args.length) throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    const value = args[index + 1];
    if (value === '') throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    if (value.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
    index += 1;
    return value;
  };

  let index = 0;
  for (; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--static' || argument === '--runtime' || argument === '--admission') {
      const lane = argument.slice(2);
      if (options.lanes[lane] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE_LANE);
      options.lanes[lane] = takesValue(argument);
      continue;
    }
    if (argument === '--declaration-validator' || argument === '--admission-validator') {
      const key = argument === '--declaration-validator' ? 'declarationValidator' : 'admissionValidator';
      if (options[key] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE_VALIDATOR);
      options[key] = takesValue(argument);
      continue;
    }
    if (argument === '-') throw refuse(ERROR_TEXT.USAGE_STDIN);
    if (argument.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_OPTION);
    throw refuse(ERROR_TEXT.USAGE_POSITIONAL);
  }

  return options;
}

/**
 * Structural usage checks that are about flag combinations, not about files.
 * They are decided before anything is read, so a wrong invocation never opens
 * a document and never imports a module.
 */
function checkCombinations(options) {
  const { static: staticPath, runtime: runtimePath, admission: admissionPath } = options.lanes;
  if (staticPath === null && runtimePath === null && admissionPath === null) {
    throw refuse(ERROR_TEXT.USAGE_NO_INPUT);
  }
  if (options.declarationValidator !== null && staticPath === null) {
    throw refuse(ERROR_TEXT.USAGE_VALIDATOR_WITHOUT_LANE);
  }
  if (options.admissionValidator !== null && admissionPath === null) {
    throw refuse(ERROR_TEXT.USAGE_VALIDATOR_WITHOUT_LANE);
  }
  if (staticPath !== null && options.declarationValidator === null) {
    throw refuse(ERROR_TEXT.USAGE_MISSING_DECLARATION_VALIDATOR);
  }
  if (admissionPath !== null && options.admissionValidator === null) {
    throw refuse(ERROR_TEXT.USAGE_MISSING_ADMISSION_VALIDATOR);
  }
}

/** The absent-lane shape. Fixed, and identical to what the builder emits. */
function absentLane() {
  return { state: 'absent', source: null, outcome: 'unknown', result: null, issues: [] };
}

/**
 * A lane the operator named but which never reached the builder. `state` stays
 * "provided" because a path *was* given; only the outcome is degraded. The
 * source label is the fixed slot, never the path.
 */
function failedLane(lane, code) {
  return {
    state: 'provided',
    source: SOURCE_BY_LANE[lane],
    outcome: code === 'VALIDATOR_LOAD_FAILED' ? 'error' : 'invalid',
    result: null,
    issues: [{ code }],
  };
}

/** Read one lane through the shared bounded reader and parse it. */
function readLane(io, lane, path) {
  let text;
  try {
    text = io.readFile(path);
  } catch {
    // The reader raises only its own fixed-message refusals; the reason is not
    // republished, and neither is the path.
    return { code: 'INPUT_READ_FAILED' };
  }
  try {
    return { document: JSON.parse(text) };
  } catch {
    return { code: 'INPUT_JSON_INVALID' };
  }
}

/** Import one lane's validator and pick the fixed export. */
async function loadLaneValidator(io, lane, specifier) {
  const exportName = VALIDATOR_EXPORT_BY_LANE[lane];
  try {
    const { target } = resolveModuleTarget(specifier);
    const namespace = await io.loadModule(target);
    const candidate = namespace === null || namespace === undefined ? undefined : namespace[exportName];
    if (typeof candidate !== 'function') return { ok: false };
    return { ok: true, validate: candidate };
  } catch {
    return { ok: false };
  }
}

/** Count outcomes for the stderr summary. Counts only, never labels or paths. */
function summarizeOutcomes(channels) {
  const counts = { clear: 0, attention: 0, invalid: 0, absent: 0, error: 0 };
  for (const lane of LANE_NAMES) {
    const entry = channels[lane];
    const outcome = entry && typeof entry.outcome === 'string' ? entry.outcome : 'unknown';
    if (outcome === 'unknown') counts.absent += 1;
    else if (Object.hasOwn(counts, outcome)) counts[outcome] += 1;
    else counts.invalid += 1;
  }
  return counts;
}

/**
 * Exit code for a finished report, plus the CLI-only load failure flag.
 *
 * Precedence is fixed by the CLI contract: 5 > 3 > 4 > 2 > 1 > 0. The report
 * API's own mapping cannot know about usage or module-load failures, so this
 * function decides them here rather than being inferred from a channel outcome.
 */
function exitCodeForReport(channels, { validatorLoadFailed }) {
  if (validatorLoadFailed) return COMBINED_EXIT_CODES.USAGE;
  let anyError = false;
  let anyInvalid = false;
  let anyAttention = false;
  let anyAbsent = false;
  let allClear = true;
  for (const lane of LANE_NAMES) {
    const entry = channels[lane];
    const outcome = entry && typeof entry.outcome === 'string' ? entry.outcome : 'unknown';
    if (outcome !== 'clear') allClear = false;
    if (outcome === 'error') anyError = true;
    else if (outcome === 'invalid') anyInvalid = true;
    else if (outcome === 'attention') anyAttention = true;
    else if (outcome === 'unknown') anyAbsent = true;
  }
  if (anyError) return COMBINED_EXIT_CODES.LANE_ERROR;
  if (anyInvalid) return COMBINED_EXIT_CODES.INVALID;
  if (anyAttention || anyAbsent) return COMBINED_EXIT_CODES.ATTENTION;
  return allClear ? COMBINED_EXIT_CODES.OK : COMBINED_EXIT_CODES.ATTENTION;
}

/**
 * Pending-write bookkeeping for a stream, kept per stream so repeated writes do
 * not stack listeners. A guarded `'error'` listener is installed **once**, for
 * the lifetime of the stream, and the first error it sees is remembered.
 *
 * Being precise about that listener, because it is a real trade-off rather than
 * a no-op:
 *
 *  - It is installed only on streams passed to {@link streamSink}, i.e. the CLI's
 *    own sinks. It is not a `process.on('uncaughtException')`-style global hook,
 *    and no other stream in the process gets one.
 *  - With it attached, Node no longer turns a later `'error'` on that stream into
 *    an uncaught exception. That prevents a crash, and it also means a failure
 *    arriving while nothing is pending is *recorded and dropped*, not forwarded.
 *    A host that needs its own policy for this stream must add its own listener:
 *    this module neither removes nor replaces existing ones, and it does not
 *    claim to leave host behaviour unchanged.
 *  - Because `main` may already have returned by then, a late error cannot change
 *    an exit code that was already returned. What it does do is stop future
 *    writes: once a stream has reported an error, further writes are refused
 *    before they reach the stream.
 */
const streamWriteStates = new WeakMap();

function writeStateFor(stream) {
  let state = streamWriteStates.get(stream);
  if (state !== undefined) return state;
  state = { pending: null, failed: null };
  streamWriteStates.set(stream, state);
  if (typeof stream.on === 'function') {
    stream.on('error', (error) => {
      if (state.failed === null) state.failed = error ?? new Error('combined-cli: stream error');
      const pending = state.pending;
      if (pending === null) return; // recorded above; there is no write to reject
      state.pending = null;
      pending.reject(state.failed);
    });
  }
  return state;
}

/**
 * Wrap a Node writable stream as an awaitable sink.
 *
 * `stream.write(text, callback)` is the completion signal, with the guarded
 * `'error'` listener as the other one. Each write carries its own token and only
 * the token that is still `state.pending` may settle: a completion belonging to
 * an earlier write is ignored, so a stale callback cannot resolve or reject a
 * later write even though the stream API does not identify callbacks.
 *
 * Once a stream has reported an error — through its `'error'` event, through a
 * callback error, or by throwing from `write` — that stream is marked failed and
 * every later write is refused without touching it. Refusing rather than
 * retrying is what keeps a late, unattributable error from being blamed on a new
 * write.
 *
 * Exported so the event/callback interleaving can be driven with a fake stream.
 *
 * @param {NodeJS.WritableStream | { write: Function, on?: Function }} stream
 * @returns {(text: string) => Promise<void>}
 */
export function streamSink(stream) {
  return (text) =>
    new Promise((resolve, reject) => {
      const state = writeStateFor(stream);
      if (state.failed !== null) {
        reject(new Error('combined-cli: this stream has already failed; refusing to write again'));
        return;
      }
      if (state.pending !== null) {
        reject(new Error('combined-cli: a write on this stream is still pending'));
        return;
      }
      const token = { resolve, reject };
      state.pending = token;
      const done = (error) => {
        // A completion from an earlier write cannot be attributed to this one.
        if (state.pending !== token) return;
        state.pending = null;
        if (error) {
          if (state.failed === null) state.failed = error;
          token.reject(error);
          return;
        }
        token.resolve();
      };
      /**
       * The throw path, kept separate from `done` on purpose.
       *
       * `catch (error) { done(error) }` would read a thrown `undefined`, `null`,
       * `0`, `''` or `false` as *success*, because the callback protocol uses
       * truthiness and a synchronous throw carries no such contract. A write that
       * threw is a failure no matter what value was thrown, so this path rejects
       * unconditionally and always stores a non-null marker in `state.failed`.
       * The thrown value is still passed to the caller when it can be rejected
       * with; only the bookkeeping marker is ever synthesized.
       */
      const failedThrow = (thrown) => {
        if (state.pending !== token) return;
        state.pending = null;
        const marker =
          thrown === undefined || thrown === null
            ? new Error(`combined-cli: the stream write threw ${String(thrown)}`)
            : thrown;
        if (state.failed === null) state.failed = marker;
        token.reject(marker);
      };
      try {
        stream.write(text, done);
      } catch (error) {
        failedThrow(error);
      }
    });
}

/** Write through one sink, reporting failure as a boolean instead of throwing. */
async function trySink(sink, text) {
  try {
    await sink(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fixed, path-free usage output: the JSON marker on stdout, then the help text.
 *
 * A usage problem is normally exit 3, but a failing sink outranks it: the
 * operator may not have seen the marker, so the run cannot be reported as a
 * clean usage refusal. 5 is the highest code and wins here.
 */
async function usageFailure(io, message) {
  let sinkFailed = false;
  if (!(await trySink(io.stdout, `${JSON.stringify({ error: { code: 'USAGE' } })}\n`))) {
    sinkFailed = true;
  }
  if (!(await trySink(io.stderr, `${message}\n`))) sinkFailed = true;
  if (!(await trySink(io.stderr, USAGE))) sinkFailed = true;
  return sinkFailed ? COMBINED_EXIT_CODES.INTERNAL : COMBINED_EXIT_CODES.USAGE;
}

/** Fixed-shape channels used when the builder is never called. */
function skeletonChannels(entries) {
  const channels = {};
  for (const lane of LANE_NAMES) {
    channels[lane] = entries[lane] ? failedLane(lane, entries[lane].code) : absentLane();
  }
  return channels;
}

async function run(rawArgv, io) {
  const args = rawArgv.map((argument) => (typeof argument === 'string' ? argument : String(argument)));

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    // The only path that exits 0 without a report. Nothing is written to
    // stdout, so a consumer never parses help text as a report.
    if (!(await trySink(io.stderr, USAGE))) return COMBINED_EXIT_CODES.INTERNAL;
    return COMBINED_EXIT_CODES.OK;
  }

  let options;
  try {
    options = parseArguments(args);
    checkCombinations(options);
  } catch (error) {
    return await usageFailure(io, error instanceof CombinedCliError ? error.message : ERROR_TEXT.INTERNAL);
  }

  // Phase 1: read and parse every named document. Nothing is imported yet.
  const outcomes = {};
  for (const lane of LANE_NAMES) {
    const path = options.lanes[lane];
    if (path === null) continue;
    outcomes[lane] = readLane(io, lane, path);
  }

  // Phase 2: load a lane's validator only for a lane whose document parsed.
  // A lane that never produced a document cannot use a validator, and loading
  // one would let a read failure be reported as a usage failure instead.
  const validators = {};
  let validatorLoadFailed = false;
  for (const lane of ['static', 'admission']) {
    const outcome = outcomes[lane];
    if (outcome === undefined || outcome.document === undefined) continue;
    const specifier = lane === 'static' ? options.declarationValidator : options.admissionValidator;
    const loaded = await loadLaneValidator(io, lane, specifier);
    if (!loaded.ok) {
      validatorLoadFailed = true;
      outcomes[lane] = { code: 'VALIDATOR_LOAD_FAILED' };
      continue;
    }
    validators[lane] = loaded.validate;
  }

  // Phase 3: build the report over the lanes that survived both phases.
  const builderInput = {};
  const builderOptions = {};
  let usable = 0;
  for (const lane of LANE_NAMES) {
    const outcome = outcomes[lane];
    if (outcome === undefined || outcome.document === undefined) continue;
    builderInput[lane] = { source: SOURCE_BY_LANE[lane], document: outcome.document };
    usable += 1;
  }
  if (validators.static !== undefined) builderOptions.validateDeclaration = validators.static;
  if (validators.admission !== undefined) {
    builderOptions.validateAdmissionEvidence = validators.admission;
  }

  let report;
  if (usable === 0) {
    // Every named lane failed before the builder. No input is fabricated and
    // the builder is not called with a placeholder: the fixed schema is emitted
    // with each failed lane degraded and each unnamed lane absent.
    report = {
      reportVersion: REPORT_VERSION,
      certification: false,
      correlation: 'not-established',
      channels: skeletonChannels(outcomes),
      // The same fixed list every built report carries. An empty array would
      // silently drop the envelope's own declarations.
      limitations: [...LIMITATION_CODES],
    };
  } else {
    let built;
    try {
      built = await io.buildReport(builderInput, builderOptions);
    } catch {
      await trySink(io.stderr, `${ERROR_TEXT.INTERNAL}\n`);
      return COMBINED_EXIT_CODES.INTERNAL;
    }
    // Patch the degraded lanes over the builder's own channel map. A new object
    // is used so a frozen report from the builder is never mutated.
    const channels = { ...(built && built.channels ? built.channels : {}) };
    for (const lane of LANE_NAMES) {
      const outcome = outcomes[lane];
      if (outcome === undefined || outcome.document !== undefined) continue;
      channels[lane] = failedLane(lane, outcome.code);
    }
    for (const lane of LANE_NAMES) {
      if (channels[lane] === undefined) channels[lane] = absentLane();
    }
    report = { ...built, channels };
  }

  // Phase 4: serialize, then write, then summarize. Serialization failure and
  // a failing sink are both output failures: neither may claim a complete
  // report was delivered.
  let payload;
  try {
    payload = `${JSON.stringify(report)}\n`;
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.SERIALIZATION_FAILED}\n`);
    return COMBINED_EXIT_CODES.INTERNAL;
  }

  if (!(await trySink(io.stdout, payload))) {
    await trySink(io.stderr, `${ERROR_TEXT.OUTPUT_FAILED}\n`);
    return COMBINED_EXIT_CODES.INTERNAL;
  }

  const exitCode = exitCodeForReport(report.channels, { validatorLoadFailed });
  const counts = summarizeOutcomes(report.channels);
  const summary =
    `combined-cli: clear=${counts.clear} attention=${counts.attention} invalid=${counts.invalid}` +
    ` absent=${counts.absent} error=${counts.error}\n`;
  if (!(await trySink(io.stderr, summary))) return COMBINED_EXIT_CODES.INTERNAL;
  return exitCode;
}

/** Fill in the real sinks and dependencies for anything the caller omitted. */
function withDefaults(io) {
  const provided = io !== null && typeof io === 'object' ? io : {};
  return {
    stdout:
      typeof provided.stdout === 'function' ? provided.stdout : streamSink(process.stdout),
    stderr:
      typeof provided.stderr === 'function' ? provided.stderr : streamSink(process.stderr),
    readFile: typeof provided.readFile === 'function' ? provided.readFile : readEvidenceFile,
    loadModule:
      typeof provided.loadModule === 'function' ? provided.loadModule : (target) => import(target),
    /**
     * Test seam only. Production always uses the real builder; the seam exists
     * so CLI control flow — partial failure, absence, load ordering, output
     * failure — can be exercised without a lane document schema.
     */
    buildReport: typeof provided.buildReport === 'function' ? provided.buildReport : buildCombinedReport,
  };
}

/**
 * Run the CLI once and RETURN its exit code.
 *
 * Nothing here calls `process.exit` or sets `process.exitCode`, and no module
 * global is written: every sink write (stdout, stderr) and every dependency call
 * (readFile, loadModule, buildReport) goes through the injected `io`, so the
 * same argv can be replayed in a test. That is a statement about this function's
 * own effects, not about the process: `import` of the chosen validator module,
 * the bounded reader's `open`/`read`/`close`, and `process.cwd()` used during
 * specifier resolution all happen outside `io`.
 *
 * OUTPUT FAILURES. Every sink write is awaited, so exit 5 covers a sink that
 * throws synchronously, returns a rejected promise, or is a stream whose write
 * callback reports an error. The default sinks are built by {@link streamSink},
 * which settles a write from either the `write` callback or the stream's
 * `'error'` event, attributes a completion to the write that is still pending,
 * and refuses further writes on a stream that has already failed.
 *
 * What is still not retroactive: an error arriving after `main` has already
 * returned cannot change that caller's exit code, and a custom sink that neither
 * throws nor returns a promise but fails later on its own is the caller's own
 * problem. A caller that needs certainty must pass a sink that awaits its own
 * flush.
 *
 * @param {string[]} argv Arguments after the script path.
 * @param {{
 *   stdout?: (text: string) => void | Promise<void>,
 *   stderr?: (text: string) => void | Promise<void>,
 *   readFile?: (path: string) => string,
 *   loadModule?: (target: string) => Promise<unknown>,
 *   buildReport?: (input: object, options: object) => Promise<object> | object,
 * }} [io]
 * @returns {Promise<number>} 0–5 — see {@link COMBINED_EXIT_CODES}.
 */
export async function main(argv, io) {
  const sink = withDefaults(io);
  try {
    return await run(Array.isArray(argv) ? argv : [], sink);
  } catch {
    // Nothing escaping a dependency may reach the terminal with its own text.
    await trySink(sink.stderr, `${ERROR_TEXT.INTERNAL}\n`);
    return COMBINED_EXIT_CODES.INTERNAL;
  }
}

/**
 * True when `argvEntry` and `moduleUrl` name the same file on disk.
 *
 * Both sides are resolved to real paths before comparison, so a symlink, a
 * relative path, a differently-encoded URL or a `..` segment still compares
 * equal. If either side cannot be resolved — missing file, broken symlink,
 * permission error — the answer is **false**: an entry point that cannot be read
 * is not this file, and guessing "yes" would execute the CLI from an import.
 *
 * Exported so the comparison can be tested without re-entering the module.
 *
 * @param {unknown} argvEntry `process.argv[1]`-shaped value.
 * @param {string} moduleUrl `import.meta.url`-shaped value.
 * @returns {boolean}
 */
export function sameEntryPoint(argvEntry, moduleUrl) {
  if (typeof argvEntry !== 'string' || argvEntry === '') return false;
  if (typeof moduleUrl !== 'string' || moduleUrl === '') return false;
  let selfPath;
  try {
    selfPath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  const canonical = (target) => {
    try {
      return realpathSync(resolve(target));
    } catch {
      return null;
    }
  };
  const entryReal = canonical(argvEntry);
  if (entryReal === null) return false;
  const selfReal = canonical(selfPath);
  if (selfReal === null) return false;
  return entryReal === selfReal;
}

/**
 * True only when this file is the process entry point.
 *
 * Delegates to {@link sameEntryPoint}; an imported module never executes.
 */
function isDirectInvocation() {
  return sameEntryPoint(process.argv[1], import.meta.url);
}

if (isDirectInvocation()) {
  process.exitCode = await main(process.argv.slice(2));
}
