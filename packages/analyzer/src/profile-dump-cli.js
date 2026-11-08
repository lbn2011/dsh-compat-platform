#!/usr/bin/env node
/**
 * dsh-compat-profile-dump — summarize ONE `dsh --profile <n> --dump-config` export.
 *
 * What this command is:
 *   a reader that applies bounds to its INPUT (1 MiB, 20000 lines) and to its own traversal
 *   (depth, node and entry counts), and reports whether the export parses and how it is shaped.
 *   It says nothing about what the document would cost a parser in memory or CPU.
 *
 * What this command is NOT:
 *   it does not load plugins, does not validate a `config` block against any plugin schema,
 *   does not evaluate `!!js`, does not resolve aliases or merge keys, does not re-emit any
 *   content from the document, and produces no compatibility, provenance or certification
 *   verdict. `completeness` is always `"unknown"`, `runtimeValidation` always
 *   `"not-performed"`, `certification` always `false`.
 *
 * Output discipline:
 *   stdout carries exactly ONE JSON document — on success, on refusal, and on usage errors.
 *   The one exception is a failed write to stdout itself: when that write fails, this process
 *   cannot deliver a document at all, and it exits 5 rather than trying a second time.
 *   Diagnostics are fixed codes, ordinals, line numbers and counts; no id, name, origin label,
 *   key, value, expression text, path or parser message is copied out, and the parser's own
 *   `message` (which embeds a source excerpt) is never read.
 *
 * Reading:
 *   `readEvidenceFile()` from ./evidence-cli.js is reused unchanged, so the rules are the
 *   ones that module already enforces: non-blocking open, `fstat` on the open descriptor,
 *   regular files only, 1048576-byte cap with a one-byte probe, strict UTF-8.
 */

import { realpathSync } from 'node:fs';

import { readEvidenceFile } from './evidence-cli.js';
import {
  PROFILE_DUMP_CODES,
  PROFILE_DUMP_EXIT,
  PROFILE_DUMP_LIMITS,
  PROFILE_DUMP_SCHEMA,
  profileDumpExitCode,
  summarizeProfileDumpText,
} from './profile-dump.js';

const USAGE_TEXT = `dsh-compat-profile-dump — summarize one dsh --dump-config export

Usage:
  dsh-compat-profile-dump <dump.yml>

  Reads exactly one explicitly named regular file (no stdin, no globs, no defaults) and
  prints one JSON summary on stdout. Usage text goes to stderr.

Exit codes:
  0   parsed; no entry-level diagnostics (the presence of !!js alone stays 0)
  1   parsed, but at least one entry-level diagnostic
  2   unusable: read failure, not UTF-8, over limits, parse error, unexpected tag,
      anchor/alias, merge key, tagged key, multiple documents, empty stream, wrong root shape
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
 *
 * If those literals ever change, the mapping stops matching and failures move to 5 — closed,
 * and visible — instead of silently describing the wrong thing.
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

/** The smallest well-formed envelope, used before (or instead of) a parse. */
function envelope(diagnostics) {
  return {
    profileDumpSummary: PROFILE_DUMP_SCHEMA,
    // null, not zero: nothing was read, and "0 bytes" would be a measurement this run did not make.
    input: null,
    documents: 0,
    inventory: 'none',
    root: 'unknown',
    counts: null,
    limits: { ...PROFILE_DUMP_LIMITS },
    diagnostics,
    diagnosticsTruncated: false,
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
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
 * @returns {string} One of {@link PROFILE_DUMP_CODES}.
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
 *     reported none, so nothing is left to wait for. Detaching here is what keeps a long-lived,
 *     never-closing stdout from accumulating one `error`/`close` pair per call across many runs.
 *   - CALLBACK ERROR. Detach only on the following `error` (or `close`) event, never inside the
 *     callback: Node's `Writable` invokes the failing callback and *then* emits `error`, so
 *     removing the listener in the callback would leave that event unhandled and turn a clean
 *     exit 5 into an uncaught exception. The pending `error` fires `onStreamError`, which detaches.
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
      // was already settled. A callback error settles(false, false) and leaves `settled = true`;
      // the later `error`/`close` handler then calls settle(false, true) — if the early return
      // came first, detach would never run and the `close` listener would leak. `detach()` is
      // idempotent, so calling it more than once is safe.
      if (detachNow) detach();
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    // The `error` event arrives after a failing callback; only now is it safe to detach.
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
          // `error` event would crash the process instead of exiting 5. onStreamError detaches.
          settle(false, false);
        } else {
          // No error follows a successful write; detach now so nothing accumulates.
          settle(true, true);
        }
      });
    } catch {
      settle(false, true);
    }
  });
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

  if (args.length !== 1 || args[0] === '-' || args[0].startsWith('-')) {
    // No stdin, no flags: an option-shaped argument is a usage error, not a filename.
    const usageWritten = await writeOnce(stderr, USAGE_TEXT);
    const jsonWritten = await emit(
      envelope([{ ordinal: null, code: PROFILE_DUMP_CODES.USAGE, line: null, detail: null }]),
    );
    if (!jsonWritten) return PROFILE_DUMP_EXIT.INTERNAL;
    // A usage message that could not be delivered is an internal failure, not a usage error:
    // the caller asked for help and got none. The JSON above is still the only write attempted.
    return usageWritten ? PROFILE_DUMP_EXIT.USAGE : PROFILE_DUMP_EXIT.INTERNAL;
  }

  const target = args[0];

  let text;
  try {
    text = readEvidenceFile(target);
  } catch (error) {
    const code = classifyReadError(error);
    const exit =
      code === PROFILE_DUMP_CODES.INTERNAL ? PROFILE_DUMP_EXIT.INTERNAL : PROFILE_DUMP_EXIT.UNUSABLE;
    const written = await emit(envelope([{ ordinal: null, code, line: null, detail: null }]));
    // A lost stdout write is exit 5, never the code the summary would have earned: a caller
    // that received no document must not be told the document was fine.
    return written ? exit : PROFILE_DUMP_EXIT.INTERNAL;
  }

  let result;
  try {
    result = summarizeProfileDumpText(text);
  } catch {
    // Includes an escaping RangeError from the parser's own recursion.
    const written = await emit(
      envelope([{ ordinal: null, code: PROFILE_DUMP_CODES.INTERNAL, line: null, detail: null }]),
    );
    // Both outcomes are 5: the parser failed, and a failed write cannot report anything else.
    return written ? PROFILE_DUMP_EXIT.INTERNAL : PROFILE_DUMP_EXIT.INTERNAL;
  }

  const written = await emit(result.summary);
  return written ? profileDumpExitCode(result) : PROFILE_DUMP_EXIT.INTERNAL;
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
      process.exitCode = PROFILE_DUMP_EXIT.INTERNAL;
    },
  );
}
