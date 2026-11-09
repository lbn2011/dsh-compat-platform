#!/usr/bin/env node
/**
 * dsh-compat-correspondence — verify a caller's profile-to-declaration assertion.
 *
 * What this command is:
 *   a verifier. It takes three explicit files — a correspondence artifact, a profile dump and an
 *   analyzer input document — recomputes the sha256 of the two bound documents, applies the
 *   profile-dump safety decision, and checks that every asserted entry id resolves to exactly one
 *   profile row. It reports findings; it never derives a correspondence of its own.
 *
 * What this command is NOT:
 *   it does not load plugins, does not evaluate `!!js`, does not parse YAML itself, does not
 *   compare versions or config values, does not check capability satisfaction and produces no
 *   compatibility, provenance or certification verdict. `identitySource` is always
 *   `"caller-asserted"`, `correlation` always `"not-established"`, `identityDisclosed` always
 *   `false`, `certification` always `false`.
 *
 * Output discipline:
 *   stdout carries exactly ONE JSON document — on success, on refusal, and on usage errors.
 *   The one exception is a failed write to stdout itself: when that write fails, this process
 *   cannot deliver a document at all, and it exits 5 rather than trying a second time. No entry
 *   id, plugin id, note, path, key or value is ever copied out.
 *
 * Reading:
 *   `readEvidenceFile()` from ./evidence-cli.js is reused unchanged for all three files, so the
 *   rules are the ones that module already enforces: non-blocking open, `fstat` on the open
 *   descriptor, regular files only, 1048576-byte cap with a one-byte probe, strict UTF-8.
 */

import { realpathSync } from 'node:fs';

import {
  CORRESPONDENCE_CODES,
  CORRESPONDENCE_EXIT,
  CORRESPONDENCE_LIMITATIONS,
  CORRESPONDENCE_SUMMARY,
  checkCorrespondence,
} from './correspondence.js';
import { readEvidenceFile } from './evidence-cli.js';
import { PROFILE_DUMP_CODES } from './profile-dump.js';

const USAGE_TEXT = `dsh-compat-correspondence — verify a profile-to-declaration correspondence

Usage:
  dsh-compat-correspondence <correspondence.json> --profile <dump.yml> --declaration <manifest.json>

  Reads exactly three explicitly named regular files (no stdin, no globs, no defaults) and
  prints one JSON summary on stdout. Usage text goes to stderr.

Exit codes:
  0   every asserted pair resolved and no finding
  1   at least one finding
  2   refused: stale bindings, malformed correspondence, unreadable profile, entry not found
      or ambiguous
  5   internal failure, including a failed stdout write
  64  usage error
`;

/**
 * The reader's fixed messages, copied as literals.
 *
 * `evidence-cli.js` does not export them, and this module must not read them out of thrown
 * messages by substring: `includes('opened')` would also match a message this module has never
 * seen. Matching is by exact equality against this closed list, so anything else falls through
 * to INTERNAL (exit 5) rather than being mislabelled as a clean refusal.
 */
const READER_TEXT = Object.freeze({
  OPEN_FAILED: 'evidence-cli: the receipt file could not be opened for reading.',
  STAT_FAILED: 'evidence-cli: the opened receipt could not be examined for its file type.',
  NOT_REGULAR:
    'evidence-cli: the receipt path is not a regular file (a directory, device, socket or pipe was given); only a regular file is read.',
  TOO_LARGE:
    'evidence-cli: the receipt file exceeds the 1048576-byte (1 MiB) read cap; it is refused, never truncated.',
  READ_FAILED: 'evidence-cli: the receipt file could not be read after it was opened.',
  NOT_UTF8: 'evidence-cli: the receipt file is not valid UTF-8 text; the document is refused.',
});

const READER_CODES = new Map([
  [READER_TEXT.OPEN_FAILED, PROFILE_DUMP_CODES.INPUT_OPEN_FAILED],
  [READER_TEXT.STAT_FAILED, PROFILE_DUMP_CODES.INPUT_STAT_FAILED],
  [READER_TEXT.NOT_REGULAR, PROFILE_DUMP_CODES.INPUT_NOT_REGULAR],
  [READER_TEXT.TOO_LARGE, PROFILE_DUMP_CODES.INPUT_TOO_LARGE],
  [READER_TEXT.READ_FAILED, PROFILE_DUMP_CODES.INPUT_READ_FAILED],
  [READER_TEXT.NOT_UTF8, PROFILE_DUMP_CODES.INPUT_NOT_UTF8],
]);

/**
 * The smallest well-formed refusal envelope.
 *
 * `code` is null for a usage error: `CORRESPONDENCE_CODES` is closed and carries no USAGE code, so
 * inventing one would make the envelope lie about its own vocabulary.
 *
 * @param {string|null} code Refusal code, or null for usage.
 * @returns {object} Refusal document.
 */
function refusalEnvelope(code) {
  return {
    correspondenceSummary: CORRESPONDENCE_SUMMARY,
    refused: true,
    code,
    certification: false,
    // Empty for usage: no document was read, so no statement about its envelope was earned.
    limitations: code === null ? [] : [...CORRESPONDENCE_LIMITATIONS],
  };
}

/**
 * Map a fixed reader failure onto a fixed code.
 *
 * The thrown message is read here — but only to compare it against the closed list above. It is
 * never echoed, logged or copied into the output, and a message that is not one of those literals
 * produces INTERNAL: fail closed, not open.
 *
 * @param {unknown} error Error thrown by `readEvidenceFile`.
 * @returns {string} A reader code, or `INTERNAL`.
 */
function classifyReadError(error) {
  if (!(error instanceof Error)) return PROFILE_DUMP_CODES.INTERNAL;
  return READER_CODES.get(error.message) ?? PROFILE_DUMP_CODES.INTERNAL;
}

/**
 * Attempt to write `text` once, and report whether it landed.
 *
 * Three failure shapes are covered, because a CLI that handles only one of them exits 0 after
 * losing its output: a synchronous throw from `write`, an error passed to the write callback
 * (EPIPE, ENOSPC, a closed descriptor), and an `error` event on the stream.
 *
 * Listener lifetime is the point of this function, and it differs per outcome:
 *
 *   - SUCCESS. Detach immediately: a `Writable` does not emit `error` for a write whose callback
 *     reported none, so nothing is left to wait for.
 *   - CALLBACK ERROR. Detach only on the following `error` (or `close`) event, never inside the
 *     callback: Node's `Writable` invokes the failing callback and *then* emits `error`, so
 *     removing the listener in the callback would leave that event unhandled and turn a clean
 *     exit 5 into an uncaught exception.
 *   - SYNCHRONOUS THROW / `close` before flush. Detach at once: no write is outstanding.
 *
 * Backpressure (`write` returning false) is not a failure: the callback still fires when the
 * chunk is finally flushed. There is no retry and no second chunk.
 *
 * @param {{write: Function, once?: Function, removeListener?: Function}} stream Target stream.
 * @param {string} text Text to write.
 * @returns {Promise<boolean>} True when the write completed without an error.
 */
function writeOnce(stream, text) {
  return new Promise((resolve) => {
    let settled = false;
    let detached = false;

    const detach = () => {
      if (detached) return;
      detached = true;
      if (typeof stream.removeListener !== 'function') return;
      try {
        stream.removeListener('error', onStreamError);
      } catch {
        // Removing a listener cannot change whether the write succeeded.
      }
      try {
        stream.removeListener('close', onClose);
      } catch {
        // Same.
      }
    };
    const settle = (ok, detachNow) => {
      // Detach BEFORE the settled check: cleanup must not be skipped just because the promise
      // was already settled. `detach()` is idempotent.
      if (detachNow) detach();
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    function onStreamError() {
      settle(false, true);
    }
    function onClose() {
      // A stream that closes before finishing never delivered the chunk.
      settle(false, true);
    }

    try {
      if (typeof stream.once === 'function') stream.once('close', onClose);
      if (typeof stream.once === 'function') stream.once('error', onStreamError);
      stream.write(text, (error) => {
        if (error) {
          // Keep the `error` listener attached: Node will emit `error` next, and an unhandled
          // `error` event would crash the process instead of exiting 5.
          settle(false, false);
        } else {
          settle(true, true);
        }
      });
    } catch {
      settle(false, true);
    }
  });
}

/**
 * Parse the command line.
 *
 * Exactly one positional, `--profile <file>` and `--declaration <file>` each exactly once.
 * Unknown flag, missing value, repeated flag or extra positional — all usage errors.
 *
 * @param {string[]} args Arguments after the script path.
 * @returns {{correspondencePath: string, profilePath: string, declarationPath: string}|null}
 *   Paths, or null on any usage error.
 */
function parseArgs(args) {
  const positional = [];
  const seen = new Set();
  let profilePath = null;
  let declarationPath = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile' || arg === '--declaration') {
      if (seen.has(arg)) return null;
      seen.add(arg);
      const value = args[index + 1];
      // A following flag is a missing value, not a filename: no argument here may look like one.
      if (value === undefined || value === '' || value.startsWith('-')) return null;
      index += 1;
      if (arg === '--profile') profilePath = value;
      else declarationPath = value;
      continue;
    }
    if (arg === '-' || arg.startsWith('-')) return null;
    positional.push(arg);
  }

  if (positional.length !== 1) return null;
  if (profilePath === null || declarationPath === null) return null;
  return { correspondencePath: positional[0], profilePath, declarationPath };
}

/**
 * Read one file through the shared reader.
 *
 * @param {string} path Path to read.
 * @returns {{ok: true, text: string} | {ok: false, code: string}} Text, or a fixed code.
 */
function readOne(path) {
  try {
    return { ok: true, text: readEvidenceFile(path) };
  } catch (error) {
    return { ok: false, code: classifyReadError(error) };
  }
}

/**
 * Run the command.
 *
 * @param {string[]} argv Arguments after the script path.
 * @param {{stdout?: object, stderr?: object}} [io] Injected streams (tests supply fakes).
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = Array.isArray(argv) ? argv : [];

  // True when the single JSON document reached stdout. There is never a second attempt.
  const emit = (document) => writeOnce(stdout, `${JSON.stringify(document, null, 2)}\n`);

  const parsed = parseArgs(args);
  if (parsed === null) {
    const usageWritten = await writeOnce(stderr, USAGE_TEXT);
    const jsonWritten = await emit(refusalEnvelope(null));
    if (!jsonWritten) return CORRESPONDENCE_EXIT.INTERNAL;
    // A usage message that could not be delivered is an internal failure, not a usage error:
    // the caller asked for help and got none.
    return usageWritten ? CORRESPONDENCE_EXIT.USAGE : CORRESPONDENCE_EXIT.INTERNAL;
  }

  const correspondenceRead = readOne(parsed.correspondencePath);
  const profileRead = correspondenceRead.ok ? readOne(parsed.profilePath) : null;
  const declarationRead = profileRead !== null && profileRead.ok ? readOne(parsed.declarationPath) : null;

  for (const read of [correspondenceRead, profileRead, declarationRead]) {
    if (read === null || read.ok) continue;
    const internal = read.code === PROFILE_DUMP_CODES.INTERNAL;
    const written = await emit(refusalEnvelope(read.code));
    // A lost stdout write is exit 5, never the code the summary would have earned: a caller that
    // received no document must not be told the document was fine.
    return written ? (internal ? CORRESPONDENCE_EXIT.INTERNAL : CORRESPONDENCE_EXIT.REFUSED) : CORRESPONDENCE_EXIT.INTERNAL;
  }

  // A correspondence file that is not JSON is a malformed correspondence, not an internal error;
  // `null` is the shape validator's first refusal. The parser's message carries an excerpt and is
  // never read.
  let correspondence = null;
  try {
    correspondence = JSON.parse(correspondenceRead.text);
  } catch {
    correspondence = null;
  }

  let result;
  try {
    result = checkCorrespondence({
      correspondence,
      profileText: profileRead.text,
      declarationText: declarationRead.text,
    });
  } catch {
    // Includes an escaping RangeError from the profile summarizer.
    const written = await emit(refusalEnvelope(CORRESPONDENCE_CODES.CORRESPONDENCE_INTERNAL));
    return written ? CORRESPONDENCE_EXIT.INTERNAL : CORRESPONDENCE_EXIT.INTERNAL;
  }

  if (result.refused === true) {
    const written = await emit(refusalEnvelope(result.code));
    return written ? CORRESPONDENCE_EXIT.REFUSED : CORRESPONDENCE_EXIT.INTERNAL;
  }

  const written = await emit(result);
  if (!written) return CORRESPONDENCE_EXIT.INTERNAL;
  return result.counts.findings > 0 ? CORRESPONDENCE_EXIT.FINDINGS : CORRESPONDENCE_EXIT.OK;
}

/**
 * Compare two entry points by real path, so a symlinked bin still counts as the same file.
 *
 * @param {string|undefined} argvEntry `process.argv[1]`.
 * @param {string} moduleUrl `import.meta.url`.
 * @returns {boolean} True when both resolve to the same file.
 */
export function sameEntryPoint(argvEntry, moduleUrl) {
  if (typeof argvEntry !== 'string' || argvEntry === '') return false;
  try {
    return realpathSync(argvEntry) === realpathSync(new URL(moduleUrl));
  } catch {
    return false;
  }
}

/* istanbul ignore next — the process entry point is exercised by CLI tests. */
if (sameEntryPoint(process.argv[1], import.meta.url)) {
  // The rejection path cannot write JSON — that is exactly the failure it reports — so it only
  // sets a non-zero code and lets Node exit after any pending stdout write settles.
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = CORRESPONDENCE_EXIT.INTERNAL;
    },
  );
}
