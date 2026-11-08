#!/usr/bin/env node
/**
 * dsh-compat-platform — admission-cli: diagnose ONE reported admission-evidence
 * document.
 *
 * TRUST BOUNDARY, stated once and enforced by construction:
 *
 *   1. This CLI reads exactly one explicitly named UTF-8 JSON file. It never
 *      scans a directory, never globs, never reads a default path, never consults
 *      an environment variable and never reads standard input. The reader is the
 *      bounded `readEvidenceFile` exported by `./evidence-cli.js` (regular file
 *      only, `fstat` on the opened descriptor, 1 MiB cap probed one byte beyond,
 *      strict UTF-8) — reused, not re-implemented.
 *   2. It imports NOTHING from the document. The document is data: it is parsed
 *      with `JSON.parse` and handed to `diagnoseAdmissionEvidence`, and no part of
 *      it is ever loaded as code, evaluated, or resolved as a specifier.
 *   3. It loads exactly one module besides Node built-ins and two fixed local
 *      modules: the module named by `--validator`, which is the ONLY code this CLI
 *      executes beyond its own. There is no plugin import, no host boot, no
 *      driver package root import, no experiment-runner import, no subprocess, no
 *      network and no model.
 *   4. It writes no file. Its only output is one JSON document on stdout and, on
 *      a non-zero outcome, one fixed diagnostic line on stderr.
 *
 * NOT A SANDBOX
 * -------------
 * `--validator` is an explicit code-execution argument: the named module and its
 * whole dependency graph run in this process, with this process's privileges.
 * Point it at code you trust. The requirement not to import a plugin, a host or a
 * driver package root is a discipline of THIS entry point, not a sandbox that
 * contains a validator you chose badly.
 *
 * THREE LANES, DELIBERATELY NOT MERGED
 * ------------------------------------
 * `src/analyze.js` answers "what do these *declarations* claim"; `src/
 * evidence-cli.js` answers "what did a process *report* about a real host"; this
 * CLI answers "what does a validated admission document *observe*". It therefore
 * does not print `evidenceLevel`, `findings` or `analysisComplete`, does not
 * reuse another lane's exit table, and never lets an admission document upgrade
 * or contradict static analysis. `certification` stays `false` because metadata
 * consistency does not authenticate evidence.
 *
 * EXIT CODES (0–5 — a closed table for THIS command only)
 * ------------------------------------------------------
 *   0  the validator accepted the document and no finding reports a `failed` or
 *      `not-run` case and no optional case is missing (`coverage.unknown` empty).
 *      A `refused` case is the EXPECTED outcome of its own case and is therefore
 *      informational here: it produces a finding and still exits 0.
 *   1  the validator accepted the document, but at least one finding reports a
 *      `failed` case, a `not-run` case or an unknown-coverage optional case. The
 *      document is well formed and is printed in full; it just does not cover
 *      what it was asked to cover.
 *   2  the validator REJECTED the document (protocol issue codes). The document is
 *      wrong; nothing about a plugin was established.
 *   3  usage error, document unreadable / not UTF-8 / over the cap / not JSON, or
 *      the `--validator` module could not be loaded or did not export a function.
 *   4  the injected validator broke the §6.6 contract — it threw, returned a
 *      thenable, or returned a malformed/inconsistent result. This is "the
 *      validator did not answer", which is not a statement about the document.
 *   5  unexpected internal failure, including a failure to serialize or write the
 *      result.
 *
 * 2 and 4 are non-zero for different reasons and are told apart by the issue
 * vocabulary the diagnostics layer already returns: a wrapper refusal carries a
 * code from `WRAPPER_ISSUE_CODES`, a protocol refusal carries the protocol's own
 * codes (which never include a `VALIDATOR_*` string). Both are fail-closed; a
 * spoofed `VALIDATOR_*` code from a trusted validator could at worst move a
 * non-zero outcome to another non-zero outcome.
 *
 * This module is importable and side-effect free: it auto-runs only when it is
 * the process entry point (see {@link isDirectInvocation}), so tests can drive
 * `main(argv, io)` with an injected reader, loader and sinks.
 *
 * Usage: node src/admission-cli.js --validator <module> [--export <name>] <document.json>
 *
 * @packageDocumentation
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DIAGNOSTIC_CODES,
  WRAPPER_ISSUE_CODES,
  diagnoseAdmissionEvidence,
} from './admission-diagnostics.js';
import { readEvidenceFile } from './evidence-cli.js';

/**
 * Exit codes for this command only.
 *
 * A separate, closed object rather than a reuse of `EXIT_CODES` (static lane) or
 * `EVIDENCE_EXIT_CODES` (runtime-evidence lane): each lane must be readable on its
 * own, and importing another lane's constants is exactly the conflation this
 * module avoids. The numbers coincide with the static lane's by habit, not by
 * reference — the meanings below are this command's own.
 */
export const ADMISSION_EXIT_CODES = Object.freeze({
  /** Accepted, and nothing reported a failed/not-run case or unknown coverage. */
  OK: 0,
  /** Accepted, but a finding reports failed / not-run / unknown coverage. */
  FINDINGS: 1,
  /** The validator rejected the document (protocol issue codes). */
  DOCUMENT_REJECTED: 2,
  /** Usage, document read/encoding/parse failure, or validator module load failure. */
  USAGE: 3,
  /** The validator broke the §6.6 contract: threw, was async, or returned garbage. */
  VALIDATOR_CONTRACT: 4,
  /** Unexpected internal or output failure. */
  INTERNAL: 5,
});

/**
 * Every diagnostic this CLI prints on stderr. All are fixed, non-secret text: no
 * OS error message, no parser message, no document path, no document content, no
 * module specifier and no stack trace is ever interpolated into them.
 */
const ERROR_TEXT = Object.freeze({
  USAGE_MISSING_VALIDATOR:
    'admission-cli: --validator <module> is required; the validator is not imported implicitly and there is no bundled fallback.',
  USAGE_MISSING_DOCUMENT:
    'admission-cli: exactly one document path is required.',
  USAGE_EXTRA:
    'admission-cli: exactly one document path is accepted; extra arguments are not understood.',
  USAGE_STDIN:
    'admission-cli: standard input ("-") is not accepted; name an explicit regular file.',
  USAGE_OPTION:
    'admission-cli: unknown option; only --validator, --export, a single document path and --help are understood.',
  USAGE_VALUE_MISSING:
    'admission-cli: --validator and --export each require a value.',
  USAGE_DUPLICATE_OPTION:
    'admission-cli: an option was supplied more than once; the last one would silently win, so the invocation is refused.',
  DOCUMENT_REFUSED:
    'admission-cli: the document file was refused by the bounded reader (open failure, non-regular file, over the 1048576-byte cap, non-UTF-8 bytes, or a read failure); nothing was analyzed.',
  READ_FAILED:
    'admission-cli: the document could not be read by the injected reader; nothing was analyzed.',
  NOT_JSON:
    'admission-cli: the document is not valid JSON; the parser message is suppressed so that no document content is echoed.',
  MODULE_LOAD_FAILED:
    'admission-cli: the module named by --validator could not be loaded; no diagnosis was attempted.',
  MODULE_EXPORT_INVALID:
    'admission-cli: the module named by --validator does not export the requested name as a function; no diagnosis was attempted.',
  DOCUMENT_REJECTED:
    'admission-cli: the validator rejected the document; the issue codes are on stdout and no diagnosis was produced.',
  FINDINGS_PRESENT:
    'admission-cli: the document is valid but reports failed, not-run or unknown-coverage outcomes; the full diagnosis is on stdout.',
  VALIDATOR_CONTRACT:
    'admission-cli: the injected validator did not return a §6.6-shaped result (threw, was asynchronous, or was malformed/inconsistent); this is not a verdict about the document.',
  INTERNAL:
    'admission-cli: internal failure while diagnosing; no diagnosis was produced.',
});

const USAGE = `admission-cli — diagnose one reported admission-evidence document

Usage:
  node src/admission-cli.js --validator <module> [--export <name>] <document.json>

Input:
  --validator <module>  Required. Module exporting the canonical admission
                        validator. './', '../', an absolute path or a 'file:' URL
                        is loaded as a file; any other specifier is resolved by
                        Node's normal bare-specifier resolution. The module and
                        its dependencies RUN IN THIS PROCESS with your
                        privileges: this is not a sandbox, and it is not an
                        invitation to import a plugin, a host or a driver root.
  --export <name>       Which exported binding to use; dotted paths allowed.
                        Default: validateAdmissionEvidence.
  <document.json>       Exactly one explicit path to a regular UTF-8 JSON file of
                        at most 1048576 bytes (1 MiB). Standard input ("-"),
                        directories and special files are refused.

Output:
  stdout                The canonical diagnoseAdmissionEvidence result, unchanged:
                          { "valid", "certification", "issues", "findings", ["summary"] }
                        Issue paths are structural locations only; no document
                        value and no validator message text is republished. The
                        document's own baseline is NOT reflected here — a summary
                        does not carry one, and this CLI authenticates nothing.
  stderr                One fixed diagnostic line; usage text on a usage error.

Exit codes:
  0  accepted; no failed/not-run case and no unknown coverage ("refused" is expected)
  1  accepted; some finding reports failed, not-run or unknown coverage
  2  the validator rejected the document (protocol issue codes)
  3  usage, document read/encoding/parse failure, or validator module load failure
  4  the validator threw, was asynchronous, or returned a malformed result
  5  internal or output failure
`;

/**
 * The closed kind of a refusal this module raises itself. Anything else that
 * escapes a dependency is reported as {@link ERROR_TEXT.INTERNAL}, so an
 * arbitrary thrown value can never carry its own text to a terminal.
 */
class AdmissionCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdmissionCliError';
  }
}

function refuse(message) {
  return new AdmissionCliError(message);
}

/** The default export name: the canonical validator of the admission lane. */
const DEFAULT_EXPORT_NAME = 'validateAdmissionEvidence';

/** Codes that mean "the answer was not obtained", never "the document is wrong". */
const WRAPPER_CODE_SET = new Set(Object.values(WRAPPER_ISSUE_CODES));

/**
 * The three findings that make an accepted document incomplete.
 *
 * `ADMISSION_CASE_REFUSED` is deliberately absent: a refusal is the expected
 * outcome of the case that asks for one, so it is reported and still exits 0.
 */
const BLOCKING_FINDING_SET = new Set([
  DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED,
  DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN,
  DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN,
]);

/**
 * Resolve a `--validator` specifier to something `import()` accepts.
 *
 * Parity with `src/cli.js` (its `loadValidator`, lines 118-131) is intentional:
 * two entry points of one package must not disagree about what `--validator`
 * means. That helper is module-private there, so the rule is restated here rather
 * than shared; if the rule changes, both must change together. `process.cwd()` is
 * Node's own base for relative specifiers and is the only ambient input used —
 * no environment variable is consulted.
 *
 * ONE DELIBERATE DIFFERENCE: a `file:` URL is returned unchanged. `src/cli.js`
 * routes it through `resolve(process.cwd(), ...)`, which corrupts it into a path
 * like `<cwd>/file:/tmp/v.mjs`; that is a defect in the older entry point, not a
 * behaviour to copy, and it is not fixed here because this change may not alter
 * the static CLI. A URL that is already absolute needs no base.
 *
 * @param {string} specifier The value given to `--validator`.
 * @returns {string} A `file:` URL for a path-like specifier, else the specifier.
 */
function resolveModuleTarget(specifier) {
  if (specifier.startsWith('file:')) return specifier;

  const isPathLike =
    isAbsolute(specifier) ||
    specifier.startsWith('./') ||
    specifier.startsWith('../');

  if (!isPathLike) return specifier;
  const absolute = isAbsolute(specifier) ? specifier : resolve(process.cwd(), specifier);
  return pathToFileURL(absolute).href;
}

/**
 * Load the named module and walk `exportName` (dotted paths allowed) to a
 * function.
 *
 * Returns `{ ok: true, validate }` when the requested export resolves to a
 * function, else `{ ok: false, message }`. It never throws, so a broken module is
 * always reported in this module's fixed text.
 *
 * That is ALL it guarantees. It is not containment: by the time this function
 * returns, `io.loadModule` has already evaluated the named module and its whole
 * dependency graph in this process, with this process's privileges. Such a module
 * can write to stdout or stderr, touch the filesystem or the network, or exit the
 * process itself, and nothing here can retract that. The narrow promise is only
 * that no error this function CATCHES has its own message, specifier, path or
 * stack interpolated into a diagnostic.
 *
 * @param {{ loadModule: (target: string) => Promise<unknown> }} io
 * @param {string} specifier
 * @param {string} exportName
 */
async function loadValidator(io, specifier, exportName) {
  let module;
  try {
    module = await io.loadModule(resolveModuleTarget(specifier));
  } catch {
    // The dynamic-import error names the specifier and often a filesystem path.
    return { ok: false, message: ERROR_TEXT.MODULE_LOAD_FAILED };
  }

  let candidate = module;
  for (const segment of exportName.split('.')) {
    if (candidate === null || candidate === undefined) break;
    try {
      candidate = candidate[segment];
    } catch {
      // A hostile getter on the module namespace: still just "not a function".
      candidate = undefined;
      break;
    }
  }
  if (typeof candidate !== 'function') {
    return { ok: false, message: ERROR_TEXT.MODULE_EXPORT_INVALID };
  }
  return { ok: true, validate: candidate };
}

/**
 * Serialize the diagnosis, canonically and deterministically.
 *
 * Field order is fixed and the members are exactly the ones the diagnostics layer
 * returns — nothing is added, dropped, renamed or recomputed. In particular the
 * document's `baseline` is not reflected anywhere: this CLI prints the diagnosis,
 * not a transcription of the document.
 *
 * @param {object} result The frozen result of `diagnoseAdmissionEvidence`.
 * @returns {string} One JSON document plus a trailing newline.
 */
function formatResult(result) {
  const document = {
    valid: result.valid === true,
    certification: result.certification,
    issues: (Array.isArray(result.issues) ? result.issues : []).map((issue) => ({
      code: issue.code,
      path: issue.path,
    })),
    findings: (Array.isArray(result.findings) ? result.findings : []).map((finding) => ({
      code: finding.code,
      caseId: finding.caseId,
      status: finding.status,
      message: finding.message,
    })),
  };
  if (Object.prototype.hasOwnProperty.call(result, 'summary')) {
    // Passed through by reference: the diagnostics layer has already checked this
    // value against the closed §6.6 shape, and copying its members field by field
    // would silently pin the protocol's summary vocabulary into a CLI.
    document.summary = result.summary;
  }
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Map a diagnosis to this command's exit code.
 *
 * @param {object} result The frozen result of `diagnoseAdmissionEvidence`.
 * @returns {number} 0, 1, 2 or 4 — see {@link ADMISSION_EXIT_CODES}.
 */
function exitCodeForDiagnosis(result) {
  if (result.valid !== true) {
    const issues = Array.isArray(result.issues) ? result.issues : [];
    // "The validator did not answer" is 4; "the document is wrong" is 2. The two
    // are separated by the code vocabulary, which the wrapper and the protocol
    // each own; neither catalogue is copied here.
    const broke = issues.some((issue) => WRAPPER_CODE_SET.has(issue.code));
    return broke ? ADMISSION_EXIT_CODES.VALIDATOR_CONTRACT : ADMISSION_EXIT_CODES.DOCUMENT_REJECTED;
  }

  const findings = Array.isArray(result.findings) ? result.findings : [];
  const blocking = findings.some((finding) => BLOCKING_FINDING_SET.has(finding.code));
  return blocking ? ADMISSION_EXIT_CODES.FINDINGS : ADMISSION_EXIT_CODES.OK;
}

/** The real sinks and the real dependencies. */
function defaultIo() {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readFile: readEvidenceFile,
    loadModule: (target) => import(target),
  };
}

/**
 * Fill in any sink or dependency the caller left out.
 *
 * Partial injection is what makes the real reader load-testable: a test can
 * supply its own sink and let `readFile` stay the real bounded reader.
 */
function withDefaults(io) {
  const base = defaultIo();
  if (io === null || typeof io !== 'object') return base;
  return {
    stdout: typeof io.stdout === 'function' ? io.stdout : base.stdout,
    stderr: typeof io.stderr === 'function' ? io.stderr : base.stderr,
    readFile: typeof io.readFile === 'function' ? io.readFile : base.readFile,
    loadModule: typeof io.loadModule === 'function' ? io.loadModule : base.loadModule,
  };
}

/**
 * Parse the argument vector WITHOUT touching the filesystem or any module.
 *
 * Every refusal here is a usage error, so it is decided before a single byte is
 * read and before any trusted code is executed.
 *
 * @param {string[]} args
 * @returns {{ validator: string | null, exportName: string | null, document: string | null }}
 * @throws {AdmissionCliError} With one of the fixed usage messages.
 */
function parseArguments(args) {
  const options = { validator: null, exportName: null, document: null };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--validator' || argument === '--export') {
      const value = args[index + 1];
      if (value === undefined || value === '') throw refuse(ERROR_TEXT.USAGE_VALUE_MISSING);
      index += 1;
      const key = argument === '--validator' ? 'validator' : 'exportName';
      if (options[key] !== null) throw refuse(ERROR_TEXT.USAGE_DUPLICATE_OPTION);
      options[key] = value;
      continue;
    }

    // `'-'` is checked before the general dash rule: it is the standard-input
    // spelling and earns its own, more specific refusal.
    if (argument === '-') throw refuse(ERROR_TEXT.USAGE_STDIN);
    if (argument.startsWith('-')) throw refuse(ERROR_TEXT.USAGE_OPTION);
    if (options.document !== null) throw refuse(ERROR_TEXT.USAGE_EXTRA);
    options.document = argument;
  }

  return options;
}

/**
 * Run the CLI once and RETURN the exit code. It never calls `process.exit`, never
 * sets `process.exitCode` and never touches a module-global: every side effect
 * goes through the injected `io`.
 *
 * @param {string[]} argv Arguments after the script path.
 * @param {{
 *   stdout?: (text: string) => void,
 *   stderr?: (text: string) => void,
 *   readFile?: (path: string) => string,
 *   loadModule?: (target: string) => Promise<unknown>,
 * }} [io]
 *   Injected sinks and dependencies. `readFile` receives exactly the one document
 *   path and must return text or throw; `loadModule` receives an already-resolved
 *   target and must return a module namespace. Omitted members fall back to the
 *   real ones.
 * @returns {Promise<number>} 0–5 — see {@link ADMISSION_EXIT_CODES}.
 */
export async function main(argv, io) {
  const sink = withDefaults(io);
  try {
    return await run(Array.isArray(argv) ? argv : [], sink);
  } catch {
    // Nothing escaping a dependency may reach the terminal with its own text.
    try {
      sink.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    } catch {
      /* A failing sink leaves nothing to report to. */
    }
    return ADMISSION_EXIT_CODES.INTERNAL;
  }
}

/** Usage text on stderr, then exit 3. */
function usageError(io, message) {
  io.stderr(`${message}\n`);
  io.stderr(USAGE);
  return ADMISSION_EXIT_CODES.USAGE;
}

async function run(argv, io) {
  const args = argv.map((argument) => (typeof argument === 'string' ? argument : String(argument)));

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    // The only path that exits 0 without evidence. It prints nothing on stdout,
    // so a consumer never parses help text as a diagnosis.
    io.stderr(USAGE);
    return ADMISSION_EXIT_CODES.OK;
  }

  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    const message = error instanceof AdmissionCliError ? error.message : ERROR_TEXT.INTERNAL;
    return usageError(io, message);
  }

  if (options.validator === null) return usageError(io, ERROR_TEXT.USAGE_MISSING_VALIDATOR);
  if (options.document === null || options.document === '') {
    return usageError(io, ERROR_TEXT.USAGE_MISSING_DOCUMENT);
  }

  // Ordering, stated narrowly: the document is read before the `--validator`
  // module is imported. A mistyped path, a read refusal, a non-JSON file or a
  // usage error therefore never runs the module named on the command line.
  //
  // This is NOT "before any code runs". This file's own static imports — Node
  // built-ins plus the two fixed local modules `./admission-diagnostics.js` and
  // `./evidence-cli.js` — were already evaluated when the CLI was loaded, as they
  // are for any ES module. The guarantee covers the explicitly selected module,
  // which is the only non-fixed code this entry point adds.
  let text;
  try {
    text = io.readFile(options.document);
  } catch (error) {
    // `readEvidenceFile` raises only its own `EvidenceCliError`, whose message is
    // one of that module's frozen, path-free strings; the specific reason is still
    // replaced by this lane's own text so a diagnostic never carries another
    // entry point's label. Anything else is reported generically.
    const refused = error !== null && typeof error === 'object' && error.name === 'EvidenceCliError';
    io.stderr(`${refused ? ERROR_TEXT.DOCUMENT_REFUSED : ERROR_TEXT.READ_FAILED}\n`);
    return ADMISSION_EXIT_CODES.USAGE;
  }

  let document;
  try {
    document = JSON.parse(text);
  } catch {
    // The parser message can quote the offending fragment; it is dropped.
    io.stderr(`${ERROR_TEXT.NOT_JSON}\n`);
    return ADMISSION_EXIT_CODES.USAGE;
  }

  const loaded = await loadValidator(io, options.validator, options.exportName ?? DEFAULT_EXPORT_NAME);
  if (!loaded.ok) {
    io.stderr(`${loaded.message}\n`);
    return ADMISSION_EXIT_CODES.USAGE;
  }

  let result;
  try {
    result = diagnoseAdmissionEvidence(document, { validateAdmissionEvidence: loaded.validate });
  } catch {
    // Documented as total apart from a caller error; a CLI fails closed anyway.
    io.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    return ADMISSION_EXIT_CODES.INTERNAL;
  }

  const exitCode = exitCodeForDiagnosis(result);

  let output;
  try {
    output = formatResult(result);
  } catch {
    io.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    return ADMISSION_EXIT_CODES.INTERNAL;
  }
  if (typeof output !== 'string') {
    io.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    return ADMISSION_EXIT_CODES.INTERNAL;
  }

  io.stdout(output);

  if (exitCode === ADMISSION_EXIT_CODES.DOCUMENT_REJECTED) io.stderr(`${ERROR_TEXT.DOCUMENT_REJECTED}\n`);
  else if (exitCode === ADMISSION_EXIT_CODES.VALIDATOR_CONTRACT) io.stderr(`${ERROR_TEXT.VALIDATOR_CONTRACT}\n`);
  else if (exitCode === ADMISSION_EXIT_CODES.FINDINGS) io.stderr(`${ERROR_TEXT.FINDINGS_PRESENT}\n`);

  return exitCode;
}

/**
 * True only when this file is the process entry point.
 *
 * Same reasoning as `src/evidence-cli.js`: `process.argv[1]` may be relative, may
 * be a symlink and may differ from `import.meta.url` by URL encoding, so both
 * sides are resolved to absolute paths and, where the filesystem allows, to real
 * paths. A missing file never makes an imported module execute.
 */
function isDirectInvocation() {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return false;

  let selfPath;
  try {
    selfPath = fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
  const entryPath = resolve(entry);
  const selfResolved = resolve(selfPath);
  if (entryPath === selfResolved) return true;

  try {
    return realpathSync(entryPath) === realpathSync(selfResolved);
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  process.exitCode = await main(process.argv.slice(2));
}
