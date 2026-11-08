#!/usr/bin/env node
/**
 * dsh-compat-platform — evidence-cli: summarize ONE reported runtime-evidence
 * receipt file.
 *
 * TRUST BOUNDARY, stated once and enforced by construction:
 *
 *   1. This CLI reads exactly one explicitly named UTF-8 JSON file. It never
 *      scans a directory, never globs, never reads a default path and never
 *      reads standard input.
 *   2. It imports NOTHING from the receipt. A receipt is data: it is parsed with
 *      `JSON.parse` and handed to `summarizeRuntimeEvidence`, and no part of it
 *      is ever loaded as code, evaluated, or resolved as a specifier.
 *   3. The only modules it loads are Node built-ins and one fixed local module,
 *      `./runtime-evidence.js`. There is no dynamic `import()`, no `require`, no
 *      plugin/config/validator import, no subprocess, no network and no model.
 *   4. It writes no file. Its only output is one JSON document on stdout and one
 *      fixed diagnostic line on stderr.
 *
 * TWO LANES, DELIBERATELY NOT MERGED
 * ----------------------------------
 * `src/analyze.js` answers "what do these *declarations* claim". This CLI answers
 * "what did some other process *report* about a real host". It therefore does not
 * import `analyze.js`, `report.js` or `exit-codes.js`, does not print
 * `evidenceLevel`, `findings` or `analysisComplete`, and never lets a receipt
 * upgrade or contradict the static analysis. A summary produced here is a
 * statement about one document, never about plugin compatibility in general.
 *
 * EXIT CODES (0, 1, 2 — documented choice, not the only defensible one)
 * ---------------------------------------------------------------------
 *   0  structurally valid AND complete: all three required cases are "passed".
 *   1  structurally valid but INCOMPLETE: at least one case is "failed" or
 *      "not-run". The summary is still printed in full on stdout.
 *   2  unusable: usage error, IO error, oversize file, non-UTF-8 bytes, JSON
 *      parse failure, schema refusal, or unexpected internal failure.
 *
 * Why 1 for an incomplete-but-valid report: exit 0 is the only code a script
 * reads as "this evidence is finished". A report whose own recorded statuses say
 * "failed" or "not-run" exists and is well formed, but it does not cover the
 * matrix, so it must not be mistaken for a clean result — while still being
 * distinguishable from a receipt that could not be read at all (2). The statuses
 * live in the printed JSON, so a caller that dislikes this mapping can recompute
 * its own from `summary.cases[].status` without re-reading the receipt.
 *
 * This module is importable and side-effect free: it auto-runs only when it is
 * the process entry point (see {@link isDirectInvocation}), so tests can drive
 * `main(argv, io)` with an injected reader and capture streams.
 *
 * NOT A SANDBOX — see the "Not a sandbox" note below and in evidence-cli.md.
 *
 * Usage: node src/evidence-cli.js <receipt.json>
 *
 * @packageDocumentation
 */

import { closeSync, constants as fsConstants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeRuntimeEvidence } from './runtime-evidence.js';

/**
 * The hard read cap: 1 MiB. A larger file is REFUSED, never truncated: a
 * truncated JSON document either fails to parse (indistinguishable from a broken
 * receipt) or, worse, parses as a smaller valid document whose missing tail is
 * invisible. Both are worse than an honest refusal.
 */
export const MAX_EVIDENCE_BYTES = 1024 * 1024;

/**
 * Exit codes for this CLI only. Deliberately a separate, closed object rather
 * than a reuse of the library's `EXIT_CODES`: the static analysis lane and the
 * evidence lane must be readable independently, and importing the other lane's
 * constants is exactly the conflation this module avoids.
 */
export const EVIDENCE_EXIT_CODES = Object.freeze({
  /** Valid and complete: every required case reported "passed". */
  OK: 0,
  /** Valid but incomplete: some case is "failed" or "not-run". */
  INCOMPLETE: 1,
  /** Unusable: usage, IO, encoding, parse, schema refusal or internal failure. */
  UNUSABLE: 2,
});

/**
 * Every diagnostic this CLI can print. All of them are fixed, non-secret text:
 * no OS error message, no parser message, no file path, no receipt content and
 * no stack trace is ever interpolated into them.
 */
const ERROR_TEXT = Object.freeze({
  USAGE_MISSING: 'evidence-cli: exactly one receipt path is required.',
  USAGE_EXTRA: 'evidence-cli: exactly one receipt path is accepted; extra arguments are not understood.',
  USAGE_STDIN: 'evidence-cli: standard input ("-") is not accepted; name an explicit regular file.',
  USAGE_OPTION: 'evidence-cli: unknown option; only a single receipt path (or --help) is understood.',
  OPEN_FAILED: 'evidence-cli: the receipt file could not be opened for reading.',
  STAT_FAILED: 'evidence-cli: the opened receipt could not be examined for its file type.',
  NOT_REGULAR:
    'evidence-cli: the receipt path is not a regular file (a directory, device, socket or pipe was given); only a regular file is read.',
  TOO_LARGE:
    'evidence-cli: the receipt file exceeds the 1048576-byte (1 MiB) read cap; it is refused, never truncated.',
  READ_FAILED: 'evidence-cli: the receipt file could not be read after it was opened.',
  NOT_UTF8: 'evidence-cli: the receipt file is not valid UTF-8 text; the document is refused.',
  NOT_JSON:
    'evidence-cli: the receipt is not a valid JSON document; the parser message is suppressed so that no receipt content is echoed.',
  INVALID_EVIDENCE:
    'evidence-cli: the receipt parsed as JSON but is not a valid coexistence-evidence document; no summary is produced.',
  INTERNAL: 'evidence-cli: internal failure while summarizing; no summary was produced.',
});

const USAGE = `evidence-cli — summarize one reported runtime-evidence receipt

Usage:
  node src/evidence-cli.js <receipt.json>

Input:
  <receipt.json>   Exactly one explicit path to a regular UTF-8 JSON file of at
                   most 1048576 bytes (1 MiB). Standard input ("-"), directories
                   and special files are refused. Symbolic links are followed:
                   the file type that counts is the opened target's, and the
                   operator chose the path.

Output:
  stdout           One deterministic JSON document:
                     { "valid": true, "issues": [], "summary": {...} }
                   with summary.certification always false, or, for a schema
                   refusal, { "valid": false, "issues": [{"code": ...}],
                   "summary": null }. Issue codes only — validator message text
                   and paths are not republished.
  stderr           One fixed diagnostic line on failure; usage on a usage error.

Exit codes:
  0  valid and complete (all three cases "passed")
  1  valid but incomplete (some case "failed" or "not-run")
  2  unusable: usage, IO, oversize, non-UTF-8, parse failure, schema refusal
`;

/**
 * The closed kind of a refusal this module raises itself. Anything else that
 * escapes a dependency is reported as {@link ERROR_TEXT.INTERNAL}, so an
 * arbitrary thrown value can never carry its text to the terminal.
 */
class EvidenceCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvidenceCliError';
  }
}

function refuse(message) {
  return new EvidenceCliError(message);
}

/** True only for a message this module wrote itself. */
function isOwnText(message) {
  return typeof message === 'string' && Object.values(ERROR_TEXT).includes(message);
}

/**
 * Read one regular file, bounded, as strict UTF-8 text.
 *
 * The order matters and is the point:
 *   1. `open` — the path is resolved once, by the OS, including symlinks;
 *   2. `fstat` on the OPEN DESCRIPTOR — the type checked is the type actually
 *      reachable through that descriptor, not whatever the path resolves to a
 *      moment later. A directory, FIFO, socket or device is refused here, before
 *      a single byte is read;
 *   3. a declared size above the cap is refused without reading;
 *   4. the read loop stops at the cap and then probes one further byte, so a
 *      file that grew past the cap (or lied in `fstat`) is still refused rather
 *      than silently truncated;
 *   5. strict UTF-8 decoding: invalid byte sequences are refused instead of
 *      being replaced by U+FFFD, which would quietly rewrite the document.
 *
 * `O_NONBLOCK` is used so that opening a FIFO with no writer returns instead of
 * blocking forever; on a regular file the flag has no effect. This is a
 * robustness measure, not a sandbox.
 *
 * @param {string} path Explicit path supplied by the caller.
 * @returns {string} The decoded document text (a leading BOM is consumed).
 * @throws {EvidenceCliError} With one of the fixed {@link ERROR_TEXT} messages.
 */
export function readEvidenceFile(path) {
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch {
    // The OS message can name the path or a transient condition; it is dropped.
    throw refuse(ERROR_TEXT.OPEN_FAILED);
  }

  try {
    let stats;
    try {
      stats = fstatSync(fd);
    } catch {
      throw refuse(ERROR_TEXT.STAT_FAILED);
    }

    if (!stats.isFile()) throw refuse(ERROR_TEXT.NOT_REGULAR);
    if (stats.size > MAX_EVIDENCE_BYTES) throw refuse(ERROR_TEXT.TOO_LARGE);

    const buffer = Buffer.allocUnsafe(MAX_EVIDENCE_BYTES);
    let total = 0;
    while (total < MAX_EVIDENCE_BYTES) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buffer, total, MAX_EVIDENCE_BYTES - total, total);
      } catch {
        throw refuse(ERROR_TEXT.READ_FAILED);
      }
      if (bytesRead === 0) break;
      total += bytesRead;
    }

    if (total === MAX_EVIDENCE_BYTES) {
      // At the cap the file is accepted only if it ends exactly there.
      const probe = Buffer.allocUnsafe(1);
      let extra = 0;
      try {
        extra = readSync(fd, probe, 0, 1, total);
      } catch {
        throw refuse(ERROR_TEXT.READ_FAILED);
      }
      if (extra > 0) throw refuse(ERROR_TEXT.TOO_LARGE);
    }

    try {
      // fatal: true turns an undecodable sequence into a refusal; ignoreBOM
      // defaults to false, which consumes a leading BOM rather than keeping it.
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total));
    } catch {
      throw refuse(ERROR_TEXT.NOT_UTF8);
    }
  } finally {
    // A close failure cannot change the verdict, and reporting it would add a
    // second, less useful diagnostic after a real one.
    try {
      closeSync(fd);
    } catch {
      /* The descriptor is released by process exit at the latest. */
    }
  }
}

/** Serialize a valid summary result deterministically, field by field. */
function formatValidResult(summary) {
  const document = {
    valid: true,
    issues: [],
    summary: {
      cases: summary.cases.map((entry) => ({
        id: entry.id,
        status: entry.status,
        evidenceTier: entry.evidenceTier,
        assertionCount: entry.assertionCount,
        failedAssertionCount: entry.failedAssertionCount,
        limitations: [...entry.limitations],
      })),
      baseline: {
        commit: summary.baseline.commit,
        node: summary.baseline.node,
      },
      limitations: [...summary.limitations],
      // Copied, never computed and never flipped: the module sets this to false
      // because an evidence tier is a string copied out of an untrusted receipt
      // and nothing here can authenticate it. The CLI adds no certification of
      // its own.
      certification: summary.certification,
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Serialize a schema refusal. Only issue CODEs are republished: a validator
 * message may quote a field value (and a field NAME can itself be as long as the
 * receipt), so message text and paths are deliberately not echoed to a terminal
 * or a CI log. Codes come from the validator's closed enum.
 */
function formatRefusalResult(issues) {
  const codes = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const raw = typeof issue?.code === 'string' ? issue.code : 'UNKNOWN_ISSUE';
    const code = raw.slice(0, 64);
    if (!codes.includes(code)) codes.push(code);
    if (codes.length === 64) break;
  }
  const document = {
    valid: false,
    issues: codes.map((code) => ({ code })),
    summary: null,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Map a summarizer verdict to this CLI's exit code. */
function exitCodeFor(result) {
  if (result.valid !== true || result.summary === null) return EVIDENCE_EXIT_CODES.UNUSABLE;
  const incomplete = result.summary.cases.some((entry) => entry.status !== 'passed');
  return incomplete ? EVIDENCE_EXIT_CODES.INCOMPLETE : EVIDENCE_EXIT_CODES.OK;
}

function defaultIo() {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readFile: readEvidenceFile,
  };
}

function usageError(io, message) {
  io.stderr(`${message}\n`);
  io.stderr(USAGE);
  return EVIDENCE_EXIT_CODES.UNUSABLE;
}

/**
 * Run the CLI once and RETURN the exit code. It never calls `process.exit`, never
 * sets `process.exitCode` and never touches a module-global: every side effect
 * goes through the injected `io`, which makes the whole surface testable.
 *
 * @param {string[]} argv Arguments after the script path.
 * @param {{ stdout: (text: string) => void, stderr: (text: string) => void, readFile: (path: string) => string }} [io]
 *   Injected sinks and reader. `readFile` receives exactly the one path argument
 *   and must return document text, or throw.
 * @returns {number} 0, 1 or 2 — see {@link EVIDENCE_EXIT_CODES}.
 */
export function main(argv, io) {
  const sink = io ?? defaultIo();
  try {
    return run(Array.isArray(argv) ? argv : [], sink);
  } catch {
    // Nothing escaping a dependency may reach the terminal with its own text.
    try {
      sink.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    } catch {
      /* A failing sink leaves nothing to report to. */
    }
    return EVIDENCE_EXIT_CODES.UNUSABLE;
  }
}

/**
 * True for an argument this CLI does not understand as an option.
 *
 * `'-'` is excluded on purpose: it is the standard-input spelling and has its own,
 * more specific refusal. `--help` and `-h` are excluded too: they ARE understood,
 * they are merely not allowed to accompany anything else, which is an arity
 * problem (USAGE_EXTRA) rather than an unknown-option problem.
 */
function isUnsupportedOption(argument) {
  return argument.startsWith('-') && argument !== '-' && argument !== '--help' && argument !== '-h';
}

function run(argv, io) {
  const args = argv.map((argument) => (typeof argument === 'string' ? argument : String(argument)));

  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    // The only path that exits 0 without evidence: help is not an error, and it
    // deliberately prints nothing on stdout so a consumer never parses it.
    io.stderr(USAGE);
    return EVIDENCE_EXIT_CODES.OK;
  }
  if (args.length === 0) return usageError(io, ERROR_TEXT.USAGE_MISSING);

  // PRECEDENCE, and why it is this way round: an unsupported dash-prefixed option
  // is diagnosed BEFORE the multi-path arity check. `['--receipt', 'x.json']` is a
  // caller reaching for a flag this CLI does not have; answering "extra arguments
  // are not understood" would blame the arity of a form the CLI never offered and
  // would hide the real defect from the operator. Genuine multi-path input
  // (`['a.json', 'b.json']`) carries no unsupported option and still falls through
  // to USAGE_EXTRA. Every refused path returns here, so nothing is read.
  if (args.some(isUnsupportedOption)) return usageError(io, ERROR_TEXT.USAGE_OPTION);
  if (args.length > 1) return usageError(io, ERROR_TEXT.USAGE_EXTRA);

  const target = args[0];
  if (target === '') return usageError(io, ERROR_TEXT.USAGE_MISSING);
  if (target === '-') return usageError(io, ERROR_TEXT.USAGE_STDIN);

  let text;
  try {
    text = io.readFile(target);
  } catch (error) {
    // Only this module's own fixed text is ever printed; a foreign thrown value
    // (an OS error naming the path, a dependency failure) is replaced.
    const message =
      error instanceof EvidenceCliError && isOwnText(error.message) ? error.message : ERROR_TEXT.INTERNAL;
    io.stderr(`${message}\n`);
    return EVIDENCE_EXIT_CODES.UNUSABLE;
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // The JSON parser message can quote the offending fragment; it is dropped.
    io.stderr(`${ERROR_TEXT.NOT_JSON}\n`);
    return EVIDENCE_EXIT_CODES.UNUSABLE;
  }

  let result;
  try {
    result = summarizeRuntimeEvidence(value);
  } catch {
    // Documented as total, but a CLI fails closed even if that promise breaks.
    io.stderr(`${ERROR_TEXT.INTERNAL}\n`);
    return EVIDENCE_EXIT_CODES.UNUSABLE;
  }

  if (result.valid === true && result.summary !== null) {
    io.stdout(formatValidResult(result.summary));
    return exitCodeFor(result);
  }

  io.stdout(formatRefusalResult(result.issues));
  io.stderr(`${ERROR_TEXT.INVALID_EVIDENCE}\n`);
  return EVIDENCE_EXIT_CODES.UNUSABLE;
}

/**
 * True only when this file is the process entry point.
 *
 * `process.argv[1]` is the path Node was asked to run, which may be relative, may
 * be a symlink (a shim on `PATH`, a linked checkout) or may differ from
 * `import.meta.url` by URL encoding. Both sides are therefore resolved to
 * absolute paths and, where the filesystem allows, to real paths before being
 * compared; the plain comparison is the fallback so a missing file never makes an
 * imported module execute.
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
  process.exitCode = main(process.argv.slice(2));
}
