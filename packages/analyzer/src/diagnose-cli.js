#!/usr/bin/env node
/**
 * diagnose-cli — one read-only envelope over one profile dump and up to three
 * explicitly named lane documents.
 *
 * TRUST BOUNDARY, stated once:
 *
 *   1. Nothing here imports, requires, evaluates or executes a plugin, a host, a
 *      driver root or a profile. It reads the files the operator named and hands
 *      them to the assembler. The profile text is summarized as inert text; the
 *      three lane documents are parsed JSON.
 *   2. The only non-fixed code this entry point adds is a validator module named
 *      by `--declaration-validator` / `--admission-validator`. Those are imported
 *      into THIS process with the caller's privileges. That is an explicit
 *      selection, not a sandbox: only point them at trusted code.
 *   3. No directory scan, no environment lookup, no positional argument, no
 *      standard input and no output directory exist on this surface.
 *
 * ORDERING, stated narrowly: every named file is read first, and a lane's
 * validator is imported only after that lane's document parsed. A mistyped path, an
 * unreadable file or a malformed document therefore never runs the module named on
 * that lane. The profile has no validator at all.
 *
 * FAILURE ISOLATION: one source's failure never discards another's result. A file
 * that cannot be read, a document that is not JSON and a validator that will not
 * load each become a `provided` block with a fixed issue code. If every named lane
 * fails, the envelope still carries a combined report with those lanes present —
 * a report is never replaced by `null` merely because its inputs failed.
 *
 * WHAT A REPORT CANNOT SAY: a `source` is a fixed slot label (`profile-input` and
 * so on), never a file path and never evidence of provenance. Naming sources
 * together establishes no identity, no ordering and no causal link between them.
 *
 * WHAT A REPORT DOES NOT HIDE: the embedded combined report republishes each lane's
 * own result unchanged, and those may embed plugin ids, capability names, resource
 * tuples and paths taken from the input documents. The profile block is a summary
 * only. The envelope as a whole is not a redacted document.
 *
 * WRITE FAILURES: every sink write is awaited, so a synchronous throw, a rejected
 * promise and a stream error reported through the write callback or an `'error'`
 * event all end in exit 5. Not detected: an error a stream emits after its write
 * callback has already succeeded.
 *
 * Usage:
 *   node src/diagnose-cli.js [--profile <dump.yml>]
 *                            [--static <file> --declaration-validator <module>]
 *                            [--runtime <file>]
 *                            [--admission <file> --admission-validator <module>]
 *
 * Exit codes: 0 every requested source clear, 1 attention, 2 invalid or unusable,
 * 3 usage or validator load failure, 4 a source produced no verdict, 5 internal,
 * serialization or output failure. Precedence: 5 > 3 > 4 > 2 > 1 > 0.
 *
 * @packageDocumentation
 */

import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sameEntryPoint, streamSink } from './combined-cli.js';
import {
  DIAGNOSE_ENTRY_FAILURES,
  DIAGNOSE_EXIT_CODES,
  DIAGNOSE_SOURCES,
  LANE_NAMES,
  diagnoseExitCode,
} from './diagnose.js';
import { buildFromOutcomes } from './diagnose-internal.js';
import { readEvidenceFile } from './evidence-cli.js';

export { DIAGNOSE_EXIT_CODES };

/**
 * The one export name each lane's validator module must provide. There is no
 * `--export` flag on this surface: one fixed name per lane keeps the selection
 * reviewable, and a module that does not export it is a load failure.
 *
 * COPIED, NOT IMPORTED. `combined-cli.js` keeps the same table and the same import
 * logic as module-private functions; `loadLaneValidator` there is not exported.
 * Rather than widen that file's public API for a second consumer — or refactor a
 * reviewed 779-line CLI while adding an entry point — this file carries the ~40
 * lines it needs. The reason is recorded here so the duplication is a decision
 * rather than an oversight, and `tests/diagnose.test.js` covers the fixed-export
 * behaviour on this path.
 */
const VALIDATOR_EXPORT_BY_LANE = Object.freeze({
  static: 'validateDeclaration',
  admission: 'validateAdmissionEvidence',
});

/**
 * Lane name → the option name the assembler documents.
 *
 * Two vocabularies, one meeting point. `validators` used to be keyed by lane name,
 * which the assembler refused as an unknown option, turning every successfully
 * loaded validator into an internal failure.
 */
const OPTION_FOR_LANE = Object.freeze({
  static: 'validateDeclaration',
  admission: 'validateAdmissionEvidence',
});

/** Every diagnostic this CLI prints to stderr. Fixed, path-free and content-free. */
const ERROR_TEXT = Object.freeze({
  USAGE_OPTION: 'diagnose-cli: unknown option; only the documented flags are understood.',
  USAGE_VALUE_MISSING: 'diagnose-cli: a flag that takes a value was given without one.',
  USAGE_DUPLICATE_SOURCE: 'diagnose-cli: each of --profile, --static, --runtime and --admission may be given at most once.',
  USAGE_DUPLICATE_VALIDATOR: 'diagnose-cli: each validator flag may be given at most once.',
  USAGE_POSITIONAL: 'diagnose-cli: no positional argument is accepted; name documents with the documented flags.',
  USAGE_STDIN: 'diagnose-cli: standard input ("-") is not accepted; name explicit regular files.',
  USAGE_NO_INPUT: 'diagnose-cli: at least one of --profile, --static, --runtime or --admission is required.',
  USAGE_VALIDATOR_WITHOUT_LANE: 'diagnose-cli: a validator flag was given without its lane.',
  USAGE_MISSING_DECLARATION_VALIDATOR: 'diagnose-cli: --static requires --declaration-validator.',
  USAGE_MISSING_ADMISSION_VALIDATOR: 'diagnose-cli: --admission requires --admission-validator.',
  INTERNAL: 'diagnose-cli: internal failure; no report was produced.',
  SERIALIZATION_FAILED: 'diagnose-cli: the report could not be serialized; no report was written.',
  OUTPUT_FAILED: 'diagnose-cli: writing the report failed; completeness of the written bytes is not claimed.',
});

const USAGE = `diagnose-cli — one read-only envelope over one profile dump and up to three lane documents

Usage:
  node src/diagnose-cli.js [--profile <dump.yml>] [--static <file>] [--runtime <file>]
                           [--admission <file>] [--declaration-validator <module>]
                           [--admission-validator <module>]

Input (at least one; each may be given at most once):
  --profile <file>      One exported profile dump, summarized — never echoed.
  --static <file>       One analyzer input document (JSON): {"declarations": [...],
                        "availableCapabilities": [...]}. A single bare declaration
                        is not this shape and fails the static lane.
  --runtime <file>      One runtime-evidence document (JSON).
  --admission <file>    One admission-evidence document (JSON).
                        No positional argument, no "-", no directory scan.

Validators (executed in this process with your privileges — trusted code only):
  --declaration-validator <module>  Required with --static. Must export
                                    validateDeclaration.
  --admission-validator <module>    Required with --admission. Must export
                                    validateAdmissionEvidence.
  A lane's validator is imported only after that lane's document parsed.

Reading: each named file goes through the shared bounded reader — a regular file of
at most 1048576 bytes, decoded as strict UTF-8. A failure on one source never
discards another source's result.

Output:
  stdout   One JSON document: the diagnose envelope.
  stderr   One fixed summary line; usage text on a usage problem.

Exit codes:
  0 every requested source clear    3 usage, or a validator that would not load
  1 attention                       4 a source produced no verdict
  2 invalid or unusable             5 internal, serialization or output failure
`;

/** The closed refusal type of this module; nothing else may reach stderr. */
class DiagnoseCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiagnoseCliError';
  }
}

function refuse(message) {
  return new DiagnoseCliError(message);
}

/**
 * Resolve a validator specifier the same way `combined-cli.js` does.
 *
 * Three rules in this order: an explicit `file:` URL is already a URL and is passed
 * through with URL semantics; an absolute or `./`/`../` path becomes a file URL
 * resolved against the current working directory now; anything else is a bare
 * specifier left to Node's resolution.
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
 * Every flag that takes a value refuses a value beginning with '-', so a forgotten
 * value cannot silently consume the next flag. That applies to validator
 * specifiers too: a module path or bare specifier never needs a leading dash.
 */
function parseArguments(args) {
  const options = {
    sources: { profile: null, static: null, runtime: null, admission: null },
    declarationValidator: null,
    admissionValidator: null,
  };

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

    if (argument === '--profile' || argument === '--static' || argument === '--runtime' || argument === '--admission') {
      const source = argument.slice(2);
      if (options.sources[source] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE_SOURCE);
      options.sources[source] = takesValue();
      continue;
    }
    if (argument === '--declaration-validator' || argument === '--admission-validator') {
      const key = argument === '--declaration-validator' ? 'declarationValidator' : 'admissionValidator';
      if (options[key] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE_VALIDATOR);
      options[key] = takesValue();
      continue;
    }
    if (argument === '-') throw refuse(ERROR_TEXT.USAGE_STDIN);
    if (argument.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_OPTION);
    throw refuse(ERROR_TEXT.USAGE_POSITIONAL);
  }

  return options;
}

/**
 * Structural checks that are about flag combinations, not about files. Decided
 * before anything is read, so a wrong invocation never opens a document and never
 * imports a module.
 */
function checkCombinations(options) {
  const { profile, static: staticPath, runtime, admission } = options.sources;
  if (profile === null && staticPath === null && runtime === null && admission === null) {
    throw refuse(ERROR_TEXT.USAGE_NO_INPUT);
  }
  if (options.declarationValidator !== null && staticPath === null) {
    throw refuse(ERROR_TEXT.USAGE_VALIDATOR_WITHOUT_LANE);
  }
  if (options.admissionValidator !== null && admission === null) {
    throw refuse(ERROR_TEXT.USAGE_VALIDATOR_WITHOUT_LANE);
  }
  if (staticPath !== null && options.declarationValidator === null) {
    throw refuse(ERROR_TEXT.USAGE_MISSING_DECLARATION_VALIDATOR);
  }
  if (admission !== null && options.admissionValidator === null) {
    throw refuse(ERROR_TEXT.USAGE_MISSING_ADMISSION_VALIDATOR);
  }
}

/**
 * Read one lane through the shared bounded reader and parse it.
 *
 * The outcome is one of the internal assembler's documented failures or a parsed
 * document. The reader's own reason is not republished and neither is the path.
 */
function readLane(io, path) {
  let text;
  try {
    text = io.readFile(path);
  } catch {
    return { failure: DIAGNOSE_ENTRY_FAILURES.INPUT_READ_FAILED };
  }
  try {
    return { document: JSON.parse(text) };
  } catch {
    return { failure: DIAGNOSE_ENTRY_FAILURES.INPUT_JSON_INVALID };
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

/**
 * Pending-write bookkeeping comes from `combined-cli.js`'s exported `streamSink`;
 * this file adds no stream listener of its own.
 */
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
 * A failing sink outranks the usage code, because the operator may not have seen
 * the marker at all.
 */
async function usageFailure(io, message) {
  let sinkFailed = false;
  if (!(await trySink(io.stdout, `${JSON.stringify({ error: { code: 'USAGE' } })}\n`))) sinkFailed = true;
  if (!(await trySink(io.stderr, `${message}\n`))) sinkFailed = true;
  if (!(await trySink(io.stderr, USAGE))) sinkFailed = true;
  return sinkFailed ? DIAGNOSE_EXIT_CODES.INTERNAL : DIAGNOSE_EXIT_CODES.USAGE;
}

/** Counts only, never labels or paths. */
function summarize(report) {
  const counts = { provided: 0, absent: 0, clear: 0, attention: 0, invalid: 0, error: 0, unknown: 0 };
  for (const source of DIAGNOSE_SOURCES) {
    const block = source === 'profile' ? report.profile : report.combinedReport?.channels?.[source];
    if (block === undefined || block === null || block.state !== 'provided') {
      counts.absent += 1;
      continue;
    }
    counts.provided += 1;
    const outcome = typeof block.outcome === 'string' ? block.outcome : 'unknown';
    if (Object.hasOwn(counts, outcome) && outcome !== 'provided' && outcome !== 'absent') counts[outcome] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

async function run(rawArgv, io) {
  const args = rawArgv.map((argument) => (typeof argument === 'string' ? argument : String(argument)));

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    // The only path that exits 0 without a report; nothing is written to stdout, so
    // a consumer never parses help text as a report.
    if (!(await trySink(io.stderr, USAGE))) return DIAGNOSE_EXIT_CODES.INTERNAL;
    return DIAGNOSE_EXIT_CODES.OK;
  }

  let options;
  try {
    options = parseArguments(args);
    checkCombinations(options);
  } catch (error) {
    return await usageFailure(io, error instanceof DiagnoseCliError ? error.message : ERROR_TEXT.INTERNAL);
  }

  // Phase 1: read every named file. Nothing is imported yet.
  const outcomes = {};
  if (options.sources.profile !== null) {
    try {
      outcomes.profile = { text: io.readFile(options.sources.profile) };
    } catch {
      outcomes.profile = { failure: DIAGNOSE_ENTRY_FAILURES.INPUT_READ_FAILED };
    }
  }
  for (const lane of LANE_NAMES) {
    const path = options.sources[lane];
    if (path === null) continue;
    outcomes[lane] = readLane(io, path);
  }

  // Phase 2: import a lane's validator only for a lane whose document parsed. A
  // read failure must stay a read failure, not become a usage failure. Presence is
  // decided by the key: a lane entry either carries a parsed document or a failure.
  const validators = {};
  for (const lane of ['static', 'admission']) {
    const outcome = outcomes[lane];
    if (outcome === undefined || !Object.hasOwn(outcome, 'document')) continue;
    const specifier = lane === 'static' ? options.declarationValidator : options.admissionValidator;
    const loaded = await loadLaneValidator(io, lane, specifier);
    if (!loaded.ok) {
      outcomes[lane] = { failure: DIAGNOSE_ENTRY_FAILURES.VALIDATOR_LOAD_FAILED };
      continue;
    }
    // The CLI names lanes; the assembler's options are the library's own option
    // names. This map is the single place the two vocabularies meet — passing
    // `validators[lane]` straight through would have made every loaded validator
    // an unknown option. That is a static-review inference: the earlier build was
    // never actually run, so no failure was observed here.
    validators[OPTION_FOR_LANE[lane]] = loaded.validate;
  }

  // Phase 3: assemble. Failures ride alongside payloads; the assembler keeps every
  // source and never returns a null combined report for named-but-failed lanes.
  let report;
  try {
    report = await io.buildDiagnoseReport(outcomes, validators);
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.INTERNAL}\n`);
    return DIAGNOSE_EXIT_CODES.INTERNAL;
  }

  // Phase 4: serialize, write, summarize. Serialization failure and a failing sink
  // are both output failures: neither may claim a complete report was delivered.
  let payload;
  try {
    payload = `${JSON.stringify(report)}\n`;
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.SERIALIZATION_FAILED}\n`);
    return DIAGNOSE_EXIT_CODES.INTERNAL;
  }

  if (!(await trySink(io.stdout, payload))) {
    await trySink(io.stderr, `${ERROR_TEXT.OUTPUT_FAILED}\n`);
    return DIAGNOSE_EXIT_CODES.INTERNAL;
  }

  let exitCode;
  try {
    exitCode = diagnoseExitCode(report);
  } catch {
    await trySink(io.stderr, `${ERROR_TEXT.INTERNAL}\n`);
    return DIAGNOSE_EXIT_CODES.INTERNAL;
  }

  const counts = summarize(report);
  const summary =
    `diagnose-cli: provided=${counts.provided} absent=${counts.absent} clear=${counts.clear}` +
    ` attention=${counts.attention} invalid=${counts.invalid} error=${counts.error}` +
    ` next_steps=${report.nextSteps.length}\n`;
  if (!(await trySink(io.stderr, summary))) return DIAGNOSE_EXIT_CODES.INTERNAL;
  return exitCode;
}

/** Fill in the real sinks and dependencies for anything the caller omitted. */
function withDefaults(io) {
  const provided = io !== null && typeof io === 'object' ? io : {};
  return {
    stdout: typeof provided.stdout === 'function' ? provided.stdout : streamSink(process.stdout),
    stderr: typeof provided.stderr === 'function' ? provided.stderr : streamSink(process.stderr),
    readFile: typeof provided.readFile === 'function' ? provided.readFile : readEvidenceFile,
    loadModule: typeof provided.loadModule === 'function' ? provided.loadModule : (target) => import(target),
    /**
     * Test seam only. Production always uses the internal assembler; the seam exists
     * so this file's control flow — partial failure, absence, load ordering, output
     * failure — can be exercised without a lane document schema.
     */
    buildDiagnoseReport:
      typeof provided.buildDiagnoseReport === 'function' ? provided.buildDiagnoseReport : buildFromOutcomes,
  };
}

/**
 * Run the CLI once and RETURN its exit code.
 *
 * Nothing here calls `process.exit` or sets `process.exitCode`, and no module
 * global is written: every sink write and every dependency call goes through the
 * injected `io`, so the same argv can be replayed in a test. That is a statement
 * about this function's own effects, not about the process: `import` of the chosen
 * validator module, the bounded reader's `open`/`read`/`close`, and
 * `process.cwd()` used during specifier resolution all happen outside `io`.
 *
 * @param {string[]} argv Arguments after the script path.
 * @param {{
 *   stdout?: (text: string) => void | Promise<void>,
 *   stderr?: (text: string) => void | Promise<void>,
 *   readFile?: (path: string) => string,
 *   loadModule?: (target: string) => Promise<unknown>,
 *   buildDiagnoseReport?: (outcomes: object, options: object) => object | Promise<object>,
 * }} [io]
 * @returns {Promise<number>} 0–5 — see {@link DIAGNOSE_EXIT_CODES}.
 */
export async function main(argv, io) {
  const sink = withDefaults(io);
  try {
    return await run(Array.isArray(argv) ? argv : [], sink);
  } catch {
    // Nothing escaping a dependency may reach the terminal with its own text.
    await trySink(sink.stderr, `${ERROR_TEXT.INTERNAL}\n`);
    return DIAGNOSE_EXIT_CODES.INTERNAL;
  }
}

/**
 * True only when this file is the process entry point.
 *
 * Delegates to `combined-cli.js`'s exported `sameEntryPoint`; an imported module
 * never executes.
 */
function isDirectInvocation() {
  return sameEntryPoint(process.argv[1], import.meta.url);
}

if (isDirectInvocation()) {
  process.exitCode = await main(process.argv.slice(2));
}
