#!/usr/bin/env node
/**
 * dsh-compat-pre-check — predict what installing one plugin would add to the conflict table.
 *
 * What this command is:
 *   a reader plus a comparison. It reads the candidate `package.json`, optionally the occupancy a
 *   running A1 service exported, optionally protocol declarations, the platform and the host
 *   version; then it builds the claims the candidate would occupy and prints the C1–C11
 *   conflicts that would involve it.
 *
 * What this command is NOT:
 *   it does not install, download, resolve, build or load anything, does not read the plugin's
 *   code or patches, does not decide that the plugin will load, and certifies nothing.
 *   `completeness` is always `"unknown"`, `runtimeValidation` always `"not-performed"`,
 *   `certification` always `false`.
 *
 * Two flags change what a clean answer MEANS, so they are explicit rather than assumed:
 *   --complete-providers  the occupancy file lists every provider, so `inject` requirements may be
 *                         compared (C1). Without it, C1 is skipped and stated as a limitation:
 *                         a host service table has no reverse provider attribution, so "nobody
 *                         provides X" would describe the collector, not the plugin.
 *   --host-version        the running version to compare `engines.dsh`/peer ranges against (C7).
 *                         Without it C7 cannot fire, and the detector says so.
 *
 * Output discipline:
 *   stdout carries exactly ONE JSON document — on success, refusal, usage error and internal
 *   failure alike. Usage text goes to stderr. The one case that cannot deliver a document is a
 *   failed write to stdout itself, which exits 5 rather than retrying.
 *
 * Reading:
 *   `readEvidenceFile()` from ./evidence-cli.js is reused unchanged: non-blocking open, `fstat` on
 *   the open descriptor, regular files only, 1048576-byte cap with a one-byte probe, strict UTF-8.
 *   Its failures are matched by EXACT message equality against a closed list, so an unfamiliar
 *   message becomes INTERNAL (fail closed) instead of a mislabelled refusal.
 */

import { realpathSync } from 'node:fs';

import { readEvidenceFile } from './evidence-cli.js';
import {
  PRE_CHECK_CODES,
  PRE_CHECK_EXIT,
  PRE_CHECK_SCHEMA,
  preCheckExitCode,
  preCheckFailure,
  staticPreCheck,
} from './pre-check.js';

const USAGE_TEXT = `dsh-compat-pre-check — predict the conflicts one plugin would add

Usage:
  dsh-compat-pre-check --manifest <package.json> [options]

  --manifest <path>          candidate plugin manifest (required)
  --occupancy <path>         JSON array of existing claims, as an A1 service's claims() exports it
  --declaration <path>       JSON protocol declaration (repeatable); either {"declaration": {...}}
                             or a bare declaration object
  --host-version <version>   running DSH version, compared against engines.dsh / dsh peer ranges
  --platform <platform>      running platform, compared against an entry's platform
  --complete-providers       state that --occupancy lists every provider; only then are
                             inject requirements compared (C1)

  Every file is read once, as a regular file of at most 1 MiB of strict UTF-8. There is no stdin,
  no glob, no default and no network access. Flags take a separate value token; an option-shaped
  argument that is not listed above is a usage error.

Exit codes:
  0   the candidate would add no conflict to this table
  1   the candidate would add at least one C1–C11 conflict
  2   the input is unusable: unreadable/oversized/non-UTF-8 file, manifest that is not a JSON
      object, occupancy or declaration that is not a JSON array
  5   internal failure, including a failed stdout write
  64  usage error
`;

/**
 * The reader's fixed messages, copied as literals.
 *
 * `evidence-cli.js` does not export them, and this module must not classify by substring:
 * `includes('opened')` would also match a message this module has never seen. Matching is by exact
 * equality against this closed list; anything else becomes INTERNAL.
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
  [READER_TEXT.OPEN_FAILED, PRE_CHECK_CODES.INPUT_OPEN_FAILED],
  [READER_TEXT.STAT_FAILED, PRE_CHECK_CODES.INPUT_STAT_FAILED],
  [READER_TEXT.NOT_REGULAR, PRE_CHECK_CODES.INPUT_NOT_REGULAR],
  [READER_TEXT.TOO_LARGE, PRE_CHECK_CODES.INPUT_TOO_LARGE],
  [READER_TEXT.READ_FAILED, PRE_CHECK_CODES.INPUT_READ_FAILED],
  [READER_TEXT.NOT_UTF8, PRE_CHECK_CODES.INPUT_NOT_UTF8],
]);

/** Flags that take a value. */
const VALUE_FLAGS = Object.freeze({
  '--manifest': 'manifest',
  '--occupancy': 'occupancy',
  '--declaration': 'declaration',
  '--host-version': 'hostVersion',
  '--platform': 'platform',
});

/** Flags that take no value. */
const SWITCH_FLAGS = Object.freeze({ '--complete-providers': 'completeProviders' });

/** Flags that may appear more than once. */
const REPEATABLE = Object.freeze(new Set(['declaration']));

/**
 * Parse the argument list into named inputs.
 *
 * A caller passing an unknown flag, a duplicate, or a value-taking flag at the end of the list
 * gets `null`: a usage error, never a default silently substituted for what they meant.
 *
 * @param {string[]} args Arguments after the script path.
 * @returns {{values: Map<string, (string|string[])>, switches: Set<string>}|null} Parsed form.
 */
function parseArgs(args) {
  const values = new Map();
  const switches = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (typeof token !== 'string' || token === '' || token.startsWith('-') === false) {
      // A bare positional has no meaning here: every input is named by a flag.
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(SWITCH_FLAGS, token)) {
      if (switches.has(token)) return null;
      switches.add(token);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(VALUE_FLAGS, token)) return null;
    const key = VALUE_FLAGS[token];
    const value = args[index + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) return null;
    index += 1;
    if (REPEATABLE.has(key)) {
      const previous = values.get(key);
      values.set(key, Array.isArray(previous) ? [...previous, value] : [value]);
    } else {
      if (values.has(key)) return null;
      values.set(key, value);
    }
  }
  return { values, switches };
}

/**
 * Map a fixed reader failure onto a fixed code.
 *
 * The thrown message is compared against the closed list above and is never echoed, logged or
 * copied into the output.
 *
 * @param {unknown} error Error thrown by `readEvidenceFile`.
 * @returns {string} A code from `PRE_CHECK_CODES`.
 */
function classifyReadError(error) {
  if (!(error instanceof Error)) return PRE_CHECK_CODES.INTERNAL;
  return READER_CODES.get(error.message) ?? PRE_CHECK_CODES.INTERNAL;
}

/**
 * Attempt to write `text` once, and report whether it landed.
 *
 * Covers the three ways a CLI loses its output while exiting 0: a synchronous throw from `write`,
 * an error passed to the write callback, and an `error`/`close` event on the stream. On a callback
 * error the listener stays attached, because Node emits `error` after invoking the failing
 * callback; detaching there would turn a clean exit 5 into an uncaught exception. There is no
 * retry and no second chunk.
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
      if (detachNow) detach();
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    function onStreamError() {
      settle(false, true);
    }
    function onClose() {
      settle(false, true);
    }

    try {
      if (typeof stream.once === 'function') stream.once('close', onClose);
      if (typeof stream.once === 'function') stream.once('error', onStreamError);
      stream.write(text, (error) => {
        if (error) settle(false, false);
        else settle(true, true);
      });
    } catch {
      settle(false, true);
    }
  });
}

/**
 * Read one file and decode it as JSON.
 *
 * @param {string} target Path to read.
 * @returns {{ok: true, value: unknown}|{ok: false, code: string}} Decoded value or a code.
 */
function readJson(target) {
  let text;
  try {
    text = readEvidenceFile(target);
  } catch (error) {
    return { ok: false, code: classifyReadError(error) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: PRE_CHECK_CODES.INPUT_NOT_JSON };
  }
}

/**
 * Turn one declaration file's value into a `declarations` item.
 *
 * Two shapes are accepted, and both are documented in the usage text: `{declaration: {...}}`
 * with an optional `owner`/`extra`, and a bare declaration object. Anything else is a refused
 * input rather than an empty declaration.
 *
 * @param {unknown} value Decoded JSON.
 * @returns {{owner?: string, declaration: object, extra?: object}|null} Item, or null.
 */
function toDeclarationItem(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'declaration')) {
    const inner = value.declaration;
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return null;
    const item = { declaration: inner };
    if (typeof value.owner === 'string' && value.owner !== '') item.owner = value.owner;
    if (typeof value.extra === 'object' && value.extra !== null && !Array.isArray(value.extra)) {
      item.extra = value.extra;
    }
    return item;
  }
  return { declaration: value };
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
    const jsonWritten = await emit(preCheckFailure(PRE_CHECK_CODES.USAGE));
    if (!jsonWritten) return PRE_CHECK_EXIT.INTERNAL;
    // A usage message that could not be delivered is an internal failure, not a usage error.
    return usageWritten ? PRE_CHECK_EXIT.USAGE : PRE_CHECK_EXIT.INTERNAL;
  }

  const { values, switches } = parsed;
  const manifestPath = values.get('manifest');
  if (typeof manifestPath !== 'string') {
    const usageWritten = await writeOnce(stderr, USAGE_TEXT);
    const jsonWritten = await emit(preCheckFailure(PRE_CHECK_CODES.USAGE));
    if (!jsonWritten) return PRE_CHECK_EXIT.INTERNAL;
    return usageWritten ? PRE_CHECK_EXIT.USAGE : PRE_CHECK_EXIT.INTERNAL;
  }

  /** Emit a refusal and return the exit code that belongs to it. */
  const refuse = async (code) => {
    const exit = code === PRE_CHECK_CODES.INTERNAL ? PRE_CHECK_EXIT.INTERNAL : PRE_CHECK_EXIT.UNUSABLE;
    const written = await emit(preCheckFailure(code));
    return written ? exit : PRE_CHECK_EXIT.INTERNAL;
  };

  const manifest = readJson(manifestPath);
  if (!manifest.ok) return refuse(manifest.code);

  let occupancy;
  const occupancyPath = values.get('occupancy');
  if (typeof occupancyPath === 'string') {
    const read = readJson(occupancyPath);
    if (!read.ok) return refuse(read.code);
    if (!Array.isArray(read.value)) return refuse(PRE_CHECK_CODES.INPUT_NOT_ARRAY);
    occupancy = read.value;
  }

  let declarations;
  const declarationPaths = values.get('declaration');
  if (Array.isArray(declarationPaths)) {
    declarations = [];
    for (const path of declarationPaths) {
      const read = readJson(path);
      if (!read.ok) return refuse(read.code);
      const item = toDeclarationItem(read.value);
      if (item === null) return refuse(PRE_CHECK_CODES.INPUT_NOT_ARRAY);
      declarations.push(item);
    }
  }

  const hostVersion = values.get('hostVersion');
  const platform = values.get('platform');

  let result;
  try {
    result = staticPreCheck({
      manifest: manifest.value,
      occupancy,
      declarations,
      hostVersion: typeof hostVersion === 'string' ? hostVersion : undefined,
      platform: typeof platform === 'string' ? platform : undefined,
      providerSetComplete: switches.has('--complete-providers'),
    });
  } catch {
    // Includes a TypeError from the comparison itself: this process composed that input, so a
    // rejected input is this command's failure, not the caller's document.
    return refuse(PRE_CHECK_CODES.INTERNAL);
  }

  const written = await emit(result.summary);
  return written ? preCheckExitCode(result) : PRE_CHECK_EXIT.INTERNAL;
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
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = PRE_CHECK_EXIT.INTERNAL;
    },
  );
}
