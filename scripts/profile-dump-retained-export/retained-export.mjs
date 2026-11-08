#!/usr/bin/env node
/**
 * profile-dump-retained-export — one finite, read-only end-to-end check of the
 * committed profile-dump CLI against THREE RETAINED historical stdout captures.
 *
 * STATUS: PREPARED, NEVER EXECUTED. This file has never been run. The CLI it
 * drives is already covered by its own suite (65/65 passing); what is unproven
 * is this verifier and the three pinned comparisons it performs, not the CLI.
 *
 * WHAT THIS PROGRAM DOES, IN ORDER
 *   1. Reads exactly three named `.bin` files under an explicit artifact root.
 *      Each must match a pinned byte length AND a pinned sha256. A missing or
 *      differing file is a FAILURE, never a skip: "no sample" is not "pass".
 *   2. Only after all three verify, runs the committed CLI once per sample as a
 *      child process, each inside its own bwrap sandbox (read-only root, private
 *      pid/net/ipc/uts, private tmpfs /tmp), with a minimal `env -i`, a 192 MiB
 *      old-space cap, a 5000 ms timeout, a 256 KiB output cap and SIGKILL.
 *   3. Judges the CLI's single JSON summary against a fixed expectation table
 *      derived from the CLI's own source and from the fixture sources.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - It never writes into the artifact root, never re-exports a profile, never
 *     reads /root/.dsh or any host profile, never loads a plugin and never
 *     evaluates an expression. The only writes are under --out.
 *   - It does not echo the child's stdout, the child's stderr, or a parser's
 *     message into any log line. Child bytes are stored only as private files
 *     under --out; the human-readable log carries fixed codes and counts.
 *   - It does not assert `entryDiagnostics`: that is a property of the module's
 *     return value, not a field of the CLI's JSON. The closed key set below
 *     would reject it if it ever appeared.
 *   - It does not demand completeness, health, plugin loadability, admission or
 *     compatibility. Those stay unproven here and are reported as unproven.
 *
 * EXIT CODES
 *    0  all three samples matched every pinned expectation
 *   60  a pinned sample file is missing
 *   61  a pinned sample differs in size or sha256
 *   62  the sandbox or the node binary is unusable (nothing was judged)
 *   63  a child failed normally-detected: unusable (2) or internal (5) exit,
 *       output limit, killed by a signal, or non-empty stderr
 *   64  a child's stdout was not exactly one JSON document
 *   65  the summary left the closed key set / closed string vocabulary
 *   66  the summary parsed and was legal, but did not match the expectation
 *       (this includes exit 1 — parsed, but with an entry-level diagnostic — and
 *        exit 64 — usage — both of which are wrong results, not crashed children)
 *   73  an evidence write under --out failed
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ constants */

const DEFAULT_ARTIFACT_ROOT =
  '/data/dsh-ecosystem-test-artifacts/experiments/acceptance/runs/20261107T062654Z-profile-export-real-512194-18141';

const PKG = '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer';
const NODE = '/www/server/nodejs/v24.21.0/bin/node';
const BWRAP = '/usr/bin/bwrap';
const CLI = join(PKG, 'src', 'profile-dump-cli.js');

const CHILD_TIMEOUT_MS = 5000;
const CHILD_MAX_BUFFER = 262144;
const CHILD_HEAP_MB = 192;

/**
 * The one schema string this CLI emits.
 *
 * Pinned to `0.2-draft.1`, the shape that carries `rows`, `rowsTruncated`,
 * `notDerived` and `limitations`. The 2026-11-08 runs recorded earlier in
 * `docs/testing/2026-11-08-profile-dump-retained-export.md` used the `0.1-draft.1`
 * bytes; those numbers stay as they were. This script follows the published
 * shape it verifies, so a `0.1` document is now refused by the same check that
 * refuses an unknown shape — the two are distinguishable by the version string
 * alone, which is the reason the version was bumped.
 */
const SUMMARY_SCHEMA = 'profile-dump-summary/0.2-draft.1';

/**
 * The three retained samples, each pinned by bytes and digest.
 *
 * `sourceStderrBytes` records what the ORIGINAL export run produced on stderr.
 * It is source background only: the new CLI's stderr expectation is 0 for every
 * sample, and the denied sample's 383 bytes are never compared against it.
 */
const SAMPLES = Object.freeze([
  Object.freeze({
    id: 'probe',
    rel: '1-probe/out/run-root/out/stdout.bin',
    bytes: 333,
    sha256: '222a50d077c792cbdc1d5f248d3cc8888b8330b9fa2c089cd2915379f0f810cc',
    sourceStderrBytes: 0,
    expect: Object.freeze({ bytes: 333, lines: 7, entries: 1, jsScalars: 0, jsDiagnostics: 0 }),
  }),
  Object.freeze({
    id: 'denied',
    rel: '2-denied/out/run-root/out/stdout.bin',
    bytes: 162,
    sha256: '34ea1fbc81ccc7d9c4c7ba575e34ff8d0c2049287835efdfda20d9c564b9a0f0',
    sourceStderrBytes: 383,
    expect: Object.freeze({ bytes: 162, lines: 7, entries: 1, jsScalars: 0, jsDiagnostics: 0 }),
  }),
  Object.freeze({
    id: 'script-probe',
    rel: '3-script-probe/out/run-root/out/stdout.bin',
    bytes: 568,
    sha256: '3af2218cf02f2aae97d9ec37255df5a98fb6d0752d72beb71774a38fd636b44b',
    sourceStderrBytes: 0,
    expect: Object.freeze({ bytes: 568, lines: 13, entries: 2, jsScalars: 2, jsDiagnostics: 2 }),
  }),
]);

/** Closed key sets. Anything outside these is a vocabulary violation (65). */
const SUMMARY_KEYS = Object.freeze([
  'profileDumpSummary',
  'input',
  'documents',
  'inventory',
  'root',
  'counts',
  'rows',
  'rowsTruncated',
  'limits',
  'diagnostics',
  'diagnosticsTruncated',
  'completeness',
  'runtimeValidation',
  'certification',
  'notDerived',
  'limitations',
]);

/**
 * The closed shape of one row. A row carries counts and closed words only; if a
 * row ever grew a `id`, `name` or `config` key holding document text, this list
 * refuses it — the vocabulary check is what keeps rows from becoming a carrier
 * for operator content.
 */
const ROW_KEYS = Object.freeze([
  'index',
  'line',
  'keyCount',
  'idKind',
  'nameKind',
  'group',
  'disabled',
  'config',
  'configKeyCount',
  'unmodelledKeyCount',
]);
const ROW_TEXT_KINDS = Object.freeze(['absent', 'string', 'non-string']);
const ROW_FLAG_KINDS = Object.freeze(['absent', 'true', 'false', 'null', 'other']);
const ROW_CONFIG_KINDS = Object.freeze(['absent', 'mapping', 'not-mapping']);

/** `NOT_DERIVED`, copied verbatim from the accepted observation record. */
const NOT_DERIVED_EXPECTED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
]);

/** `PROFILE_DUMP_LIMITATIONS`, pinned exactly: a new code is a shape change. */
const LIMITATIONS_EXPECTED = Object.freeze([
  'ROW_IS_NOT_A_DECLARATION',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
  'NO_LOADABILITY_OR_ACTIVATION_OBSERVED',
  'ROW_SKIPS_UNMODELLED_KEYS',
  'CONFIG_VALUES_NOT_INSPECTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
]);
const INPUT_KEYS = Object.freeze(['bytes', 'lines']);
const COUNTS_KEYS = Object.freeze([
  'entries',
  'entryGroups',
  'entriesWithId',
  'entriesWithName',
  'entriesWithConfig',
  'entriesDisabled',
  'jsScalars',
  'distinctTags',
  'nodes',
  'scalars',
  'maxDepth',
]);
const LIMITS_KEYS = Object.freeze([
  'maxBytes',
  'maxLines',
  'maxDepth',
  'maxNodes',
  'maxEntries',
  'maxDiagnostics',
  'maxRows',
]);
/**
 * The module's own limit constants, copied from `PROFILE_DUMP_LIMITS`
 * (`packages/analyzer/src/profile-dump.js:38-45`). These are contract values, not
 * measurements, so they are compared exactly rather than merely checked for being
 * integral: a silently different cap would change what "too large" means.
 */
const LIMITS_EXPECTED = Object.freeze({
  maxBytes: 1048576,
  maxLines: 20000,
  maxDepth: 32,
  maxNodes: 20000,
  maxEntries: 5000,
  maxDiagnostics: 64,
  maxRows: 64,
});
const DIAGNOSTIC_KEYS = Object.freeze(['ordinal', 'code', 'line', 'detail']);

/** Closed string vocabularies. */
const INVENTORY_VALUES = Object.freeze(['present', 'empty', 'none']);
const ROOT_VALUES = Object.freeze([
  'sequence',
  'mapping',
  'scalar',
  'alias',
  'other',
  'null',
  'unknown',
]);
const COMPLETENESS_VALUES = Object.freeze(['unknown']);
const RUNTIME_VALIDATION_VALUES = Object.freeze(['not-performed']);

/** Every diagnostic code the module can emit (profile-dump.js PROFILE_DUMP_CODES). */
const CODE_VALUES = Object.freeze([
  'EMPTY_INPUT',
  'EMPTY_INVENTORY',
  'JS_EXPRESSION_NOT_EVALUATED',
  'ENTRY_ID_NOT_STRING',
  'ENTRY_NAME_NOT_STRING',
  'DUPLICATE_ID',
  'INPUT_OPEN_FAILED',
  'INPUT_STAT_FAILED',
  'INPUT_READ_FAILED',
  'INPUT_NOT_REGULAR',
  'INPUT_NOT_UTF8',
  'INPUT_TOO_LARGE',
  'INPUT_TOO_MANY_LINES',
  'MULTI_DOCUMENT',
  'PARSE_ERROR',
  'UNEXPECTED_WARNING',
  'RESOURCE_EXHAUSTION_UNCAUGHT',
  'ROOT_NOT_SEQUENCE',
  'ENTRY_NOT_MAPPING',
  'UNSUPPORTED_TAG',
  'TAG_KEY_PRESENT',
  'ALIAS_PRESENT',
  'ANCHOR_PRESENT',
  'MERGE_KEY',
  'DEPTH_LIMIT',
  'NODE_LIMIT',
  'ENTRY_LIMIT',
  'USAGE',
  'INTERNAL',
]);

/** Every `detail` word the module can emit, plus null. */
const DETAIL_VALUES = Object.freeze([
  'DUPLICATE_KEY',
  'PARSE_FAILURE',
  'JS_COLLECTION',
  'CORE_NOT_ALLOWED',
  'EXTERNAL',
  'UNRESOLVED_TAG',
  'OTHER_WARNING',
]);

const JS_CODE = 'JS_EXPRESSION_NOT_EVALUATED';

/* -------------------------------------------------------------------- evidence */

let writeFail = 0;
let outDir = null;

/** Write one evidence file under --out. Never throws; records the failure. */
function ev(name, text) {
  if (outDir === null) {
    writeFail += 1;
    return false;
  }
  try {
    writeFileSync(join(outDir, name), text);
    return true;
  } catch {
    writeFail += 1;
    return false;
  }
}

function evBytes(name, buffer) {
  if (outDir === null) {
    writeFail += 1;
    return false;
  }
  try {
    writeFileSync(join(outDir, name), buffer);
    return true;
  } catch {
    writeFail += 1;
    return false;
  }
}

const logLines = [];
/** Record a fixed-code line. Never carries sample text, child output or a parser message. */
function log(line) {
  logLines.push(line);
  process.stdout.write(`${line}\n`);
}

/* ---------------------------------------------------------------- small helpers */

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Key sets must match exactly: no missing key, no extra key. */
function keysViolate(object, allowed) {
  if (!isPlainObject(object)) return true;
  const own = Object.keys(object).sort();
  const want = [...allowed].sort();
  if (own.length !== want.length) return true;
  for (let index = 0; index < own.length; index += 1) {
    if (own[index] !== want[index]) return true;
  }
  return false;
}

function stringOutside(value, allowed) {
  return typeof value !== 'string' || !allowed.includes(value);
}

/* --------------------------------------------------------------- argument parsing */

function parseArgs(argv) {
  const options = { out: null, artifactRoot: process.env.RETAINED_EXPORT_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out' && index + 1 < argv.length) {
      options.out = argv[index + 1];
      index += 1;
    } else if (arg === '--artifact-root' && index + 1 < argv.length) {
      options.artifactRoot = argv[index + 1];
      index += 1;
    } else {
      return { error: `unrecognised argument at position ${index}` };
    }
  }
  if (options.out === null) return { error: '--out is required' };
  // Path hygiene only. An absolute, `..`-free path is easier to reason about,
  // but it proves nothing about where the bytes came from: a symlink at the
  // pinned path is followed, so the content identity of a sample rests entirely
  // on its pinned length and sha256 below, not on the shape of this path.
  if (!options.artifactRoot.startsWith('/')) return { error: 'artifact root must be absolute' };
  if (options.artifactRoot.split('/').includes('..')) return { error: 'artifact root must not contain ..' };
  return { options };
}

/* --------------------------------------------------------------- phase 1: samples */

/**
 * Verify one sample against its pin.
 * @returns {{ok: true, buffer: Buffer, actualBytes: number, actualSha256: string} | {ok: false, code: number, reason: string}}
 */
function verifySample(root, sample) {
  const path = join(root, sample.rel);
  let fd = -1;
  try {
    // O_NONBLOCK so a FIFO planted at the pinned path cannot stall us; the
    // regular-file check below then rejects anything that is not a plain file.
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch (error) {
    // A file that is not there and a file that cannot be read are different
    // failures: neither may be reported as the other, and neither is a skip.
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: false, code: 60, reason: 'missing' };
    }
    return { ok: false, code: 61, reason: 'unreadable' };
  }
  try {
    const stat = fstatSync(fd);
    if ((stat.mode & fsConstants.S_IFMT) !== fsConstants.S_IFREG) {
      return { ok: false, code: 61, reason: 'not-regular' };
    }
    // The pinned length is checked BEFORE any byte is read: a large or growing
    // file is refused rather than slurped, and only one byte beyond the pin is
    // ever read.
    if (stat.size !== sample.bytes) return { ok: false, code: 61, reason: 'size' };
    const buffer = Buffer.alloc(sample.bytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const step = readSync(fd, buffer, total, buffer.length - total, null);
      if (step === 0) break;
      total += step;
    }
    if (total > sample.bytes) return { ok: false, code: 61, reason: 'size' };
    if (total < sample.bytes) return { ok: false, code: 61, reason: 'short-read' };
    const content = buffer.subarray(0, sample.bytes);
    const actualSha256 = sha256(content);
    if (actualSha256 !== sample.sha256) {
      return { ok: false, code: 61, reason: 'sha256' };
    }
    return { ok: true, buffer: content, actualBytes: sample.bytes, actualSha256 };
  } catch {
    return { ok: false, code: 61, reason: 'unreadable' };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // A failed close changes nothing about what was read; it is not a sample
      // result and must not masquerade as one.
    }
  }
}

/* ---------------------------------------------------------------- phase 2: child */

/** The sandboxed, minimal-environment invocation. One child, one sample. */
function childArgv(samplePath) {
  return [
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
    '--unshare-pid',
    '--unshare-net',
    '--unshare-ipc',
    '--unshare-uts',
    '--die-with-parent',
    '--chdir',
    PKG,
    '--',
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin',
    'HOME=/tmp',
    'TMPDIR=/tmp',
    `NODE_OPTIONS=--max-old-space-size=${CHILD_HEAP_MB}`,
    NODE,
    CLI,
    samplePath,
  ];
}

/**
 * Run the committed CLI once, inside bwrap, and return only byte buffers plus a
 * fixed outcome word. Never surfaces the child's text.
 *
 * Outcomes, in the order they are decided:
 *   'exited'       a numeric exit status was observed (0 or not)
 *   'output-limit' stdout/stderr crossed maxBuffer (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)
 *   'terminated'   the child was killed by a signal; the signal is recorded,
 *                  but this program does NOT claim the kill was a timeout
 *   'spawn-failed' no exit status and no signal: the child never really ran
 * Elapsed time is recorded for the record only; it never decides the outcome.
 * @returns {Promise<{outcome: string, exitCode: number|null, signal: string|null, stdout: Buffer, stderr: Buffer, elapsedMs: number}>}
 */
function runChild(samplePath) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      BWRAP,
      childArgv(samplePath),
      {
        cwd: PKG,
        timeout: CHILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: CHILD_MAX_BUFFER,
        encoding: 'buffer',
        env: { PATH: '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp' },
      },
      (error, stdout, stderr) => {
        const elapsedMs = Date.now() - started;
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
        const err = Buffer.isBuffer(stderr) ? stderr : Buffer.alloc(0);
        if (error === null || error === undefined) {
          return resolve({ outcome: 'exited', exitCode: 0, signal: null, stdout: out, stderr: err, elapsedMs });
        }
        // A numeric `code` is the child's own exit status: record it as a normal
        // exit first, whatever the number, instead of rewriting it as a crash.
        if (typeof error.code === 'number') {
          const signal = typeof error.signal === 'string' ? error.signal : null;
          return resolve({ outcome: 'exited', exitCode: error.code, signal, stdout: out, stderr: err, elapsedMs });
        }
        // A maxBuffer breach is an output-limit failure, not a timeout.
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return resolve({ outcome: 'output-limit', exitCode: null, signal: null, stdout: out, stderr: err, elapsedMs });
        }
        // Killed by a signal: report the signal. Whether it was the timeout
        // timer or something else is not observable from here, so it is not
        // asserted.
        if (error.killed === true || typeof error.signal === 'string') {
          const signal = typeof error.signal === 'string' ? error.signal : null;
          return resolve({ outcome: 'terminated', exitCode: null, signal, stdout: out, stderr: err, elapsedMs });
        }
        return resolve({ outcome: 'spawn-failed', exitCode: null, signal: null, stdout: out, stderr: err, elapsedMs });
      },
    );
  });
}

/* ------------------------------------------------------------- phase 3: judgement */

/** Decode strictly and parse; returns {ok, doc} or {ok:false}. */
function parseSingleJson(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, code: 64, reason: 'not-utf8' };
  }
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, code: 64, reason: 'empty' };
  // Trailing content would also throw here, so "exactly one document" is
  // enforced by parsing the whole trimmed text in one call.
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return { ok: false, code: 64, reason: 'not-one-json-document' };
  }
  try {
    return { ok: true, doc: JSON.parse(trimmed) };
  } catch {
    return { ok: false, code: 64, reason: 'json-parse' };
  }
}

/**
 * Validate the summary against the closed shape, then against the expectation.
 * @returns {{ok: true} | {ok: false, code: number, reason: string}}
 */
function judgeSummary(doc, expect) {
  // ---- shape: closed key sets and closed vocabularies
  if (keysViolate(doc, SUMMARY_KEYS)) return { ok: false, code: 65, reason: 'summary-keys' };
  if (doc.profileDumpSummary !== SUMMARY_SCHEMA) return { ok: false, code: 65, reason: 'schema-string' };
  if (keysViolate(doc.input, INPUT_KEYS)) return { ok: false, code: 65, reason: 'input-keys' };
  if (!isNonNegativeInt(doc.input.bytes)) return { ok: false, code: 65, reason: 'input-bytes-type' };
  if (!isNonNegativeInt(doc.input.lines)) return { ok: false, code: 65, reason: 'input-lines-type' };
  if (!isNonNegativeInt(doc.documents)) return { ok: false, code: 65, reason: 'documents-type' };
  if (stringOutside(doc.inventory, INVENTORY_VALUES)) return { ok: false, code: 65, reason: 'inventory-value' };
  if (stringOutside(doc.root, ROOT_VALUES)) return { ok: false, code: 65, reason: 'root-value' };
  if (doc.counts !== null) {
    if (keysViolate(doc.counts, COUNTS_KEYS)) return { ok: false, code: 65, reason: 'counts-keys' };
    // Only the two documented counters are pinned; every other counter is
    // checked for being a finite non-negative integer, never against a golden.
    for (const key of COUNTS_KEYS) {
      if (!isNonNegativeInt(doc.counts[key])) return { ok: false, code: 65, reason: `counts-type:${key}` };
    }
  }
  if (keysViolate(doc.limits, LIMITS_KEYS)) return { ok: false, code: 65, reason: 'limits-keys' };
  // Contract constants: compared exactly. A different cap means the module is not
  // the one whose limits the expectation table was derived from.
  for (const key of LIMITS_KEYS) {
    if (!isNonNegativeInt(doc.limits[key])) return { ok: false, code: 65, reason: `limits-type:${key}` };
    if (doc.limits[key] !== LIMITS_EXPECTED[key]) return { ok: false, code: 66, reason: `limits-value:${key}` };
  }
  if (!Array.isArray(doc.diagnostics)) return { ok: false, code: 65, reason: 'diagnostics-type' };
  if (doc.diagnosticsTruncated !== false) return { ok: false, code: 65, reason: 'diagnostics-truncated' };
  if (stringOutside(doc.completeness, COMPLETENESS_VALUES)) return { ok: false, code: 65, reason: 'completeness-value' };
  if (stringOutside(doc.runtimeValidation, RUNTIME_VALIDATION_VALUES)) {
    return { ok: false, code: 65, reason: 'runtime-validation-value' };
  }
  if (doc.certification !== false) return { ok: false, code: 65, reason: 'certification-value' };

  // ---- rows: a capped display window over `counts.entries`, never an inventory
  if (!Array.isArray(doc.rows) && doc.rows !== null) return { ok: false, code: 65, reason: 'rows-type' };
  if (doc.rows === null) {
    // Rows are null exactly where the counters are null: a refused document has no inventory
    // to window over, and an empty array there would read as "there are no entries".
    if (doc.counts !== null) return { ok: false, code: 65, reason: 'rows-null-with-counts' };
    if (doc.rowsTruncated !== false) return { ok: false, code: 65, reason: 'rows-truncated-without-rows' };
  } else {
    if (doc.counts === null) return { ok: false, code: 65, reason: 'rows-without-counts' };
    if (typeof doc.rowsTruncated !== 'boolean') return { ok: false, code: 65, reason: 'rows-truncated-type' };
    // The window is truncated exactly when it is shorter than the count it windows over. Both
    // directions matter: a short window without the flag would hide rows silently, and the flag
    // without a short window would claim a loss that did not happen.
    const short = doc.rows.length < doc.counts.entries;
    if (doc.rowsTruncated !== short) return { ok: false, code: 65, reason: 'rows-truncated-mismatch' };
    if (doc.rows.length > doc.limits.maxRows) return { ok: false, code: 65, reason: 'rows-over-limit' };
    for (let position = 0; position < doc.rows.length; position += 1) {
      const row = doc.rows[position];
      if (keysViolate(row, ROW_KEYS)) return { ok: false, code: 65, reason: 'row-keys' };
      // The window is the head of the sequence, in order: a row's index is its 1-based position.
      if (row.index !== position + 1) return { ok: false, code: 65, reason: 'row-index' };
      if (row.line !== null && !isPositiveInt(row.line)) return { ok: false, code: 65, reason: 'row-line' };
      if (!isNonNegativeInt(row.keyCount)) return { ok: false, code: 65, reason: 'row-key-count' };
      if (stringOutside(row.idKind, ROW_TEXT_KINDS)) return { ok: false, code: 65, reason: 'row-id-kind' };
      if (stringOutside(row.nameKind, ROW_TEXT_KINDS)) return { ok: false, code: 65, reason: 'row-name-kind' };
      if (stringOutside(row.group, ROW_FLAG_KINDS)) return { ok: false, code: 65, reason: 'row-group' };
      if (stringOutside(row.disabled, ROW_FLAG_KINDS)) return { ok: false, code: 65, reason: 'row-disabled' };
      if (stringOutside(row.config, ROW_CONFIG_KINDS)) return { ok: false, code: 65, reason: 'row-config' };
      // A key count exists exactly when `config` is a mapping; null everywhere else.
      if (row.config === 'mapping') {
        if (!isNonNegativeInt(row.configKeyCount)) return { ok: false, code: 65, reason: 'row-config-key-count' };
      } else if (row.configKeyCount !== null) {
        return { ok: false, code: 65, reason: 'row-config-key-count-null' };
      }
      if (!isNonNegativeInt(row.unmodelledKeyCount)) {
        return { ok: false, code: 65, reason: 'row-unmodelled-key-count' };
      }
      // A row's keys are counted against the row's size: modelled plus unmodelled cannot
      // exceed it, and cannot be fewer than the five modelled names that are present.
      if (row.unmodelledKeyCount > row.keyCount) return { ok: false, code: 65, reason: 'row-unmodelled-over-key-count' };
    }
  }

  // ---- the two guard lists, compared exactly
  if (!Array.isArray(doc.notDerived)) return { ok: false, code: 65, reason: 'not-derived-type' };
  if (doc.notDerived.length !== NOT_DERIVED_EXPECTED.length) return { ok: false, code: 65, reason: 'not-derived-length' };
  for (let position = 0; position < NOT_DERIVED_EXPECTED.length; position += 1) {
    if (doc.notDerived[position] !== NOT_DERIVED_EXPECTED[position]) {
      return { ok: false, code: 65, reason: 'not-derived-value' };
    }
  }
  if (!Array.isArray(doc.limitations)) return { ok: false, code: 65, reason: 'limitations-type' };
  if (doc.limitations.length !== LIMITATIONS_EXPECTED.length) {
    return { ok: false, code: 65, reason: 'limitations-length' };
  }
  for (let position = 0; position < LIMITATIONS_EXPECTED.length; position += 1) {
    if (doc.limitations[position] !== LIMITATIONS_EXPECTED[position]) {
      return { ok: false, code: 65, reason: 'limitations-value' };
    }
  }

  for (const diagnostic of doc.diagnostics) {
    if (keysViolate(diagnostic, DIAGNOSTIC_KEYS)) return { ok: false, code: 65, reason: 'diagnostic-keys' };
    if (stringOutside(diagnostic.code, CODE_VALUES)) return { ok: false, code: 65, reason: 'diagnostic-code' };
    if (diagnostic.detail !== null && stringOutside(diagnostic.detail, DETAIL_VALUES)) {
      return { ok: false, code: 65, reason: 'diagnostic-detail' };
    }
    if (diagnostic.ordinal !== null && !isPositiveInt(diagnostic.ordinal)) {
      return { ok: false, code: 65, reason: 'diagnostic-ordinal' };
    }
    if (diagnostic.line !== null && !isPositiveInt(diagnostic.line)) {
      return { ok: false, code: 65, reason: 'diagnostic-line' };
    }
  }

  // ---- expectation: fixed, from the CLI contract and the fixture sources
  if (doc.documents !== 1) return { ok: false, code: 66, reason: 'documents' };
  if (doc.root !== 'sequence') return { ok: false, code: 66, reason: 'root' };
  if (doc.inventory !== 'present') return { ok: false, code: 66, reason: 'inventory' };
  if (doc.counts === null) return { ok: false, code: 66, reason: 'counts-null' };
  if (doc.input.bytes !== expect.bytes) return { ok: false, code: 66, reason: 'input-bytes' };
  if (doc.input.lines !== expect.lines) return { ok: false, code: 66, reason: 'input-lines' };
  if (doc.counts.entries !== expect.entries) return { ok: false, code: 66, reason: 'entries' };
  if (doc.counts.jsScalars !== expect.jsScalars) return { ok: false, code: 66, reason: 'js-scalars' };
  // These samples carry a handful of entries, so the window must be complete: if it were not,
  // the cap would have changed and the expectation table's row counts would need revisiting.
  if (!Array.isArray(doc.rows)) return { ok: false, code: 66, reason: 'rows-missing' };
  if (doc.rows.length !== expect.entries) return { ok: false, code: 66, reason: 'rows-length' };
  if (doc.rowsTruncated !== false) return { ok: false, code: 66, reason: 'rows-truncated' };
  // Each expression diagnostic must be exactly the shape the module builds for a
  // JS-tagged scalar: `pushDiagnostic(code, { line })` passes a line only, so
  // `ordinal` stays null and `detail` stays null
  // (`packages/analyzer/src/profile-dump.js:327-342`). A numeric ordinal here
  // would mean a different diagnostic shape, so null is required, not merely
  // permitted. This checks shape, NOT entry attribution: it does not verify which
  // entry a JS tag belongs to.
  for (const diagnostic of doc.diagnostics) {
    if (diagnostic.code !== JS_CODE) continue;
    if (diagnostic.detail !== null) return { ok: false, code: 66, reason: 'js-detail' };
    if (diagnostic.ordinal !== null) return { ok: false, code: 66, reason: 'js-ordinal' };
    if (!isPositiveInt(diagnostic.line) || diagnostic.line > expect.lines) {
      return { ok: false, code: 66, reason: 'js-line' };
    }
  }
  const jsSeen = doc.diagnostics.filter((diagnostic) => diagnostic.code === JS_CODE).length;
  if (doc.diagnostics.length !== expect.jsDiagnostics) {
    return { ok: false, code: 66, reason: 'diagnostics-length' };
  }
  if (jsSeen !== expect.jsDiagnostics) return { ok: false, code: 66, reason: 'diagnostics-codes' };
  return { ok: true };
}

/* ------------------------------------------------------------------------ main */

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    // The argument text is this program's own; it carries no sample content.
    process.stdout.write(`retained_export_verdict=fail\nfirst_failure=usage\nusage_problem=${parsed.error}\n`);
    return 73;
  }
  const { options } = parsed;

  try {
    mkdirSync(options.out, { recursive: true });
  } catch {
    process.stdout.write('retained_export_verdict=fail\nfirst_failure=out_dir\n');
    return 73;
  }
  outDir = options.out;

  log(`retained_export_schema=profile-dump-retained-export/0.1-draft.1`);
  // A fixed source identifier, never the caller's path: the log is the shareable
  // record and must not leak a filesystem location.
  log('source=retained_export_captures_v1');
  log(`sample_count=${SAMPLES.length}`);
  log(`child_timeout_ms=${CHILD_TIMEOUT_MS}`);
  log(`child_max_buffer=${CHILD_MAX_BUFFER}`);
  log(`child_heap_mb=${CHILD_HEAP_MB}`);

  // ---- phase 1: verify every pinned input BEFORE any child starts
  const verified = [];
  const inputProblems = [];
  for (const sample of SAMPLES) {
    const result = verifySample(options.artifactRoot, sample);
    if (result.ok) {
      verified.push({ sample, path: join(options.artifactRoot, sample.rel), buffer: result.buffer });
      log(`sample_${sample.id}_input=verified`);
    } else {
      inputProblems.push({ sample, code: result.code, reason: result.reason });
      log(`sample_${sample.id}_input=${result.reason}`);
    }
  }
  ev(
    'retained-export-inputs.txt',
    `sample_count=${SAMPLES.length}\nverified=${verified.length}\nproblems=${inputProblems.length}\n`
      + `artifact_root=${options.artifactRoot}\n`
      + SAMPLES.map((sample) => `sample_${sample.id} bytes=${sample.bytes} sha256=${sample.sha256}`).join('\n')
      + '\n',
  );

  if (inputProblems.length > 0) {
    const first = inputProblems[0];
    ev(
      'retained-export-result.txt',
      `verdict=fail\nfirst_failure=input_${first.reason}\nsample=${first.sample.id}\n`
        + `samples_verified=${verified.length}\nchild_runs=0\nworkload_started=no\nwrite_failures=${writeFail}\n`,
    );
    log(`retained_export_verdict=fail`);
    log(`first_failure=input_${first.reason}`);
    log('child_runs=0');
    log(`write_failures=${writeFail}`);
    return writeFail === 0 ? first.code : 73;
  }

  // The sandbox and the interpreter are checked only after the inputs verify, so
  // "no sample" is reported as a sample problem rather than as a tool problem.
  let toolsOk = true;
  try {
    accessSync(BWRAP, fsConstants.X_OK);
  } catch {
    toolsOk = false;
    log('tool_bwrap=unusable');
  }
  try {
    accessSync(NODE, fsConstants.X_OK);
  } catch {
    toolsOk = false;
    log('tool_node=unusable');
  }
  if (!existsSync(CLI)) {
    toolsOk = false;
    log('tool_cli=absent');
  }
  if (!toolsOk) {
    ev(
      'retained-export-result.txt',
      'verdict=fail\nfirst_failure=tooling\nsamples_verified=3\nchild_runs=0\nworkload_started=no\n'
        + `write_failures=${writeFail}\n`,
    );
    log('retained_export_verdict=fail');
    log('first_failure=tooling');
    return writeFail === 0 ? 62 : 73;
  }
  log('tooling=present');

  // Gate: every record describing the inputs must have landed before a child runs.
  if (writeFail !== 0) {
    ev(
      'retained-export-result.txt',
      `verdict=fail\nfirst_failure=evidence_write\nsamples_verified=3\nchild_runs=0\nworkload_started=no\nwrite_failures=${writeFail}\n`,
    );
    log('retained_export_verdict=fail');
    log('first_failure=evidence_write');
    return 73;
  }

  // ---- phase 2 + 3: one child per sample, judged immediately, fail-stop
  const rows = [];
  let firstFailure = null;
  for (const entry of verified) {
    const { sample, path } = entry;
    const child = await runChild(path);
    const stdoutWritten = evBytes(`child-${sample.id}.stdout.bin`, child.stdout);
    const stderrWritten = evBytes(`child-${sample.id}.stderr.bin`, child.stderr);

    let code = 0;
    let reason = 'ok';
    if (child.outcome === 'spawn-failed') {
      code = 62;
      reason = 'spawn-failed';
    } else if (child.outcome === 'output-limit') {
      code = 63;
      reason = 'output-limit';
    } else if (child.outcome === 'terminated') {
      // The signal is reported as observed; a timeout is not claimed.
      code = 63;
      reason = child.signal === null ? 'terminated' : `terminated-${child.signal}`;
    } else if (child.exitCode === null) {
      code = 63;
      reason = 'no-exit-status';
    } else if (child.exitCode === 2 || child.exitCode === 5) {
      // Unusable (2) or internal (5): the CLI could not produce a usable summary.
      // The raw bytes are still kept as private files, but they are not judged as
      // if the document had been readable.
      code = 63;
      reason = child.exitCode === 2 ? 'exit-unusable' : 'exit-internal';
    } else {
      const parsedDoc = parseSingleJson(child.stdout);
      if (!parsedDoc.ok) {
        code = parsedDoc.code;
        reason = parsedDoc.reason;
      } else {
        const verdict = judgeSummary(parsedDoc.doc, sample.expect);
        if (!verdict.ok) {
          code = verdict.code;
          reason = verdict.reason;
        } else if (child.stderr.length !== 0) {
          // The new CLI's expectation is an empty stderr for every sample. The
          // historical denied stderr is source background, not this comparison.
          code = 63;
          reason = 'stderr-nonempty';
        } else if (child.exitCode !== 0) {
          // Exit 1 = parsed with an entry-level diagnostic; 64 = usage error.
          // Both emit a JSON document and both are wrong results, not crashes.
          code = 66;
          reason = `exit-${child.exitCode}`;
        }
      }
    }

    rows.push({
      id: sample.id,
      outcome: child.outcome,
      exitCode: child.exitCode,
      signal: child.signal,
      stdoutBytes: child.stdout.length,
      stderrBytes: child.stderr.length,
      elapsedMs: child.elapsedMs,
      code,
      reason,
    });
    log(`sample_${sample.id}_child=${child.outcome}`);
    log(`sample_${sample.id}_signal=${child.signal === null ? 'none' : child.signal}`);
    log(`sample_${sample.id}_exit=${child.exitCode === null ? 'none' : child.exitCode}`);
    log(`sample_${sample.id}_stdout_bytes=${child.stdout.length}`);
    log(`sample_${sample.id}_stderr_bytes=${child.stderr.length}`);
    log(`sample_${sample.id}_check=${code === 0 ? 'pass' : `fail:${reason}`}`);
    if (code !== 0 && firstFailure === null) firstFailure = { id: sample.id, code, reason };

    // Fail-stop. After the first failed sample nothing further is started, and
    // no later child may run once any evidence write has failed. `rows` is the
    // record of what actually ran, so child_runs can never exceed reality.
    if (code !== 0 || !stdoutWritten || !stderrWritten || writeFail !== 0) break;
  }
  if (rows.length < verified.length) log('batch_stopped=yes');

  const verdict = firstFailure === null && writeFail === 0 ? 'pass' : 'fail';
  const detail = rows
    .map((row) => `sample_${row.id} outcome=${row.outcome} exit=${row.exitCode === null ? 'none' : row.exitCode} signal=${row.signal === null ? 'none' : row.signal} stdout_bytes=${row.stdoutBytes} stderr_bytes=${row.stderrBytes} elapsed_ms=${row.elapsedMs} check=${row.code === 0 ? 'pass' : `fail:${row.reason}`}`)
    .join('\n');

  ev(
    'retained-export-result.txt',
    `verdict=${verdict}\n`
      + `first_failure=${firstFailure === null ? 'none' : `${firstFailure.id}:${firstFailure.reason}`}\n`
      + `samples_verified=${verified.length}\nchild_runs=${rows.length}\n`
      + `write_failures=${writeFail}\n`
      + `detail_begin\n${detail}\ndetail_end\n`,
  );

  log(`retained_export_verdict=${verdict}`);
  log(`first_failure=${firstFailure === null ? 'none' : `${firstFailure.id}:${firstFailure.reason}`}`);
  log(`child_runs=${rows.length}`);
  log(`write_failures=${writeFail}`);

  if (writeFail !== 0) return 73;
  if (firstFailure !== null) return firstFailure.code;
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    // An unexpected throw is reported as a fixed word, never as the error text:
    // a message could carry a path or a fragment of the document.
    process.stdout.write('retained_export_verdict=fail\nfirst_failure=internal\n');
    process.exitCode = 73;
  },
);
