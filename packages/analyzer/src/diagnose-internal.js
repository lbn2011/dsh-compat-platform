/**
 * diagnose-internal — the assembler behind `diagnose.js` and `diagnose-cli.js`.
 *
 * NOT A PUBLIC SURFACE. This module is not reachable through `package.json`
 * `exports`; it exists so that two callers with different privileges can share
 * one assembler:
 *
 *   - `diagnose.js` (public, `./diagnose`) accepts only real payloads and is the
 *     only builder a library user can reach.
 *   - `diagnose-cli.js` also has to carry *the outcome of its own I/O* — a
 *     bounded-read refusal, a JSON parse failure, a validator that would not load
 *     — into the envelope. Only this module offers that, through
 *     `buildDiagnoseReportFromOutcomes`, and only the CLI imports it.
 *
 * Keeping the two apart means a public caller has no way to hand the library a
 * failure string and have it treated as evidence. The failure vocabulary below is
 * an *output* type everywhere else.
 *
 * WHAT THIS MODULE DOES: assemble one frozen envelope from already-normalized
 * entries. No I/O, no `import()` of caller code, no writes, no execution. The
 * documents it receives are handed to the unmodified `buildCombinedReport`; the
 * profile text is handed to the unmodified `summarizeProfileDumpText`.
 *
 * PRESENCE IS OWN-KEY PRESENCE. A source is named when its own data property is
 * present. An own property holding `null` or `undefined` is NOT silently read as
 * "absent": it is a malformed entry and is refused with fixed text, because a
 * caller who wrote the key down asked for something and must not be answered with
 * silence. Absence is only ever the absence of the key.
 *
 * NO BRAND ASSUMPTION. `buildCombinedReport` freezes its outer object and keeps
 * each lane's `result` by reference; it does not brand the report and performs no
 * hidden provenance check. Nothing here assumes otherwise.
 *
 * @internal
 * @packageDocumentation
 */

import {
  LIMITATION_CODES,
  REPORT_VERSION as COMBINED_REPORT_VERSION,
  buildCombinedReport,
} from './combined-report.js';
import { summarizeProfileDumpText } from './profile-dump.js';

/** The envelope format this module emits. */
export const DIAGNOSE_VERSION = 'dsh-compat-diagnose/0.2-draft.1';

/** Every source, in the fixed order used everywhere in this module. */
export const DIAGNOSE_SOURCES = Object.freeze(['profile', 'static', 'runtime', 'admission']);

/** The three lane names, in the fixed order the combined report uses. */
export const LANE_NAMES = Object.freeze(['static', 'runtime', 'admission']);

/**
 * Fixed slot labels. These are slots, not paths and not provenance: the CLI never
 * substitutes a file path for one.
 */
export const SOURCE_BY_NAME = Object.freeze({
  profile: 'profile-input',
  static: 'static-input',
  runtime: 'runtime-input',
  admission: 'admission-input',
});

/** Exit codes for this envelope. Closed. */
export const DIAGNOSE_EXIT_CODES = Object.freeze({
  /** Every requested source is clear. */
  OK: 0,
  /** At least one requested source needs attention. */
  ATTENTION: 1,
  /** At least one requested source produced no usable result. */
  INVALID: 2,
  /** Usage problem, or a validator module could not be loaded or used. */
  USAGE: 3,
  /** A requested source produced no verdict after a usable document was accepted. */
  LANE_ERROR: 4,
  /** Internal, serialization or output failure. Never returned by the assembler. */
  INTERNAL: 5,
});

/**
 * The closed failure vocabulary. On the public side this is an **output** type:
 * it may appear in `issues[].code`, and it is never an input.
 */
export const DIAGNOSE_ENTRY_FAILURES = Object.freeze({
  /** The named file could not be read through the bounded reader. */
  INPUT_READ_FAILED: 'INPUT_READ_FAILED',
  /** The named file was read but is not one JSON document. */
  INPUT_JSON_INVALID: 'INPUT_JSON_INVALID',
  /** The named file parsed but its fixed-name validator could not be used. */
  VALIDATOR_LOAD_FAILED: 'VALIDATOR_LOAD_FAILED',
});

/**
 * Fixed limitation codes this envelope adds on top of the combined report's own
 * list. They state the two things a reader is most likely to over-read.
 */
export const DIAGNOSE_LIMITATION_CODES = Object.freeze([
  'PROFILE_BLOCK_IS_A_SUMMARY_NOT_A_DUMP',
  'NO_CROSS_SOURCE_IDENTITY',
  'BASELINE_IS_READ_FROM_THE_SUMMARY_ONLY',
]);

/**
 * The closed next-step vocabulary: one code per (source, outcome) pair plus one
 * for "nothing was named". A code names a *next* read-only action; it is not a
 * severity, not a finding and not a dependency claim.
 */
export const DIAGNOSE_NEXT_STEP_CODES = Object.freeze([
  'PROFILE_ATTENTION',
  'PROFILE_INVALID',
  'PROFILE_ERROR',
  'PROFILE_UNKNOWN',
  'STATIC_ATTENTION',
  'STATIC_INVALID',
  'STATIC_ERROR',
  'STATIC_UNKNOWN',
  'RUNTIME_ATTENTION',
  'RUNTIME_INVALID',
  'RUNTIME_ERROR',
  'RUNTIME_UNKNOWN',
  'ADMISSION_ATTENTION',
  'ADMISSION_INVALID',
  'ADMISSION_ERROR',
  'ADMISSION_UNKNOWN',
  'SOURCE_NOT_PROVIDED',
]);

/**
 * Fixed text per (outcome, cause). Content-free and path-free: nothing from a
 * document, an error object or the filesystem is interpolated. The issue codes on
 * the block already name the fixed cause; these sentences say what a reader can
 * do next, and they deliberately do not claim the cause is unknown.
 */
const NEXT_STEP_TEXT = Object.freeze({
  PROFILE_UNREADABLE:
    'The profile file could not be read as a regular file of at most 1048576 bytes; check that the named path is a readable regular file.',
  PROFILE_UNUSABLE:
    'The profile text was read but not summarized as one document; the summary block records the fixed refusal diagnostics — re-export rather than editing the dump here.',
  PROFILE_ENTRY_DIAGNOSTICS:
    'The profile summary counted entry-level diagnostics; read its diagnostics list before trusting the row counts, and re-export if the count is unexpected.',
  VALIDATOR_LOAD_FAILED:
    'A validator module named on the command line could not be imported or does not export its fixed name as a function; check that exact module specifier and export name.',
  INPUT_READ_FAILED:
    'A named file could not be read as a regular file of at most 1048576 bytes; check that the path exists, is a regular file and is readable.',
  INPUT_JSON_INVALID:
    'A named file was read but is not one JSON document; check the file format — this tool does not repair or re-serialize inputs.',
  ATTENTION: 'This source reported issues that need review; nothing here repairs or re-checks them.',
  INVALID: 'This source produced no usable result; check the named file rather than editing it here.',
  ERROR:
    'This source produced no verdict; the block’s issue codes name the fixed cause, which is not a statement about the document’s content.',
  UNKNOWN:
    'This source was named but established nothing; treat it as missing evidence, not as agreement.',
  ABSENT: 'No file was named for this source; the envelope says nothing about it.',
});

const INPUT_TYPE_ERROR =
  'diagnose: input must be a plain object whose only fields are "profile", "static", "runtime" and "admission".';
const ENTRY_TYPE_ERROR =
  'diagnose: every entry must be a plain object carrying exactly one of "text" (profile only) or "document".';
const OUTCOME_TYPE_ERROR =
  'diagnose: every outcome must carry exactly one of "text"/"document" or a documented "failure".';
const FAILURE_CODE_ERROR = 'diagnose: "failure" must be one of the documented entry failure codes.';
const OPTIONS_TYPE_ERROR =
  'diagnose: options must be a plain object whose only fields are "validateDeclaration" and "validateAdmissionEvidence", each a function when present.';

const INPUT_KEYS = Object.freeze(['profile', ...LANE_NAMES]);
const LANE_PAYLOAD_KEYS = Object.freeze(['document']);
const PROFILE_PAYLOAD_KEYS = Object.freeze(['text']);
const LANE_OUTCOME_KEYS = Object.freeze(['document', 'failure']);
const PROFILE_OUTCOME_KEYS = Object.freeze(['text', 'failure']);
const OPTION_KEYS = Object.freeze(['validateDeclaration', 'validateAdmissionEvidence']);

/**
 * A plain record: object, not an array, and with `Object.prototype` or `null` as
 * its prototype. A `Date`, a `Map` or a class instance is therefore refused
 * rather than being read as a bag of lanes.
 */
function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Own keys including non-enumerable ones, with symbols refused.
 *
 * `Object.keys` would miss a non-enumerable own property, which would let a
 * caller write a lane down and have it silently ignored — the exact failure this
 * closed-set reading exists to prevent.
 */
function ownDataKeys(value, message) {
  const keys = Reflect.ownKeys(value);
  const result = [];
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError(message);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) throw new TypeError(message);
    // An accessor would run caller-chosen code before any contract is applied.
    if (descriptor.get !== undefined || descriptor.set !== undefined) throw new TypeError(message);
    result.push({ key, value: descriptor.value });
  }
  return result;
}

/**
 * Read a source map (the public input, or the CLI's outcome map).
 *
 * Every own data property must be a documented source name, and its value must be
 * a non-`null`, non-`undefined` entry. A present key with a nullish value is
 * malformed, not absent.
 */
function readSourceMap(input, message) {
  if (!isPlainRecord(input)) throw new TypeError(message);
  const entries = new Map();
  for (const { key, value } of ownDataKeys(input, message)) {
    if (!INPUT_KEYS.includes(key)) throw new TypeError(message);
    if (value === null || value === undefined) throw new TypeError(message);
    entries.set(key, value);
  }
  return entries;
}

/**
 * Read one entry's single field.
 *
 * `allowFailure` is the whole difference between the two builders: the public one
 * passes `false` and can never be handed a caller-authored failure code, while the
 * CLI path passes `true` so its own I/O outcomes can be recorded.
 *
 * @returns {{ kind: 'payload', value: unknown } | { kind: 'failure', code: string }}
 */
function readEntry(key, entry, { allowFailure }) {
  const message = allowFailure ? OUTCOME_TYPE_ERROR : ENTRY_TYPE_ERROR;
  if (!isPlainRecord(entry)) throw new TypeError(message);
  const allowed = allowFailure
    ? key === 'profile'
      ? PROFILE_OUTCOME_KEYS
      : LANE_OUTCOME_KEYS
    : key === 'profile'
      ? PROFILE_PAYLOAD_KEYS
      : LANE_PAYLOAD_KEYS;

  const fields = ownDataKeys(entry, message);
  if (fields.length !== 1 || !allowed.includes(fields[0].key)) throw new TypeError(message);

  const field = fields[0];
  if (field.key === 'failure') {
    const codes = Object.values(DIAGNOSE_ENTRY_FAILURES);
    if (typeof field.value !== 'string' || !codes.includes(field.value)) {
      throw new TypeError(FAILURE_CODE_ERROR);
    }
    return { kind: 'failure', code: field.value };
  }
  return { kind: 'payload', value: field.value };
}

/**
 * Validate `options` once, independently of which lanes were named.
 *
 * The old builder only reads options when it is called, so a profile-only
 * invocation could pass arbitrary options unnoticed while a mixed one failed —
 * the same argument producing different verdicts. Diagnose validates the closed
 * key set and the function types up front, always.
 */
function readOptions(options) {
  if (options === undefined) return {};
  if (!isPlainRecord(options)) throw new TypeError(OPTIONS_TYPE_ERROR);
  const settings = {};
  for (const { key, value } of ownDataKeys(options, OPTIONS_TYPE_ERROR)) {
    if (!OPTION_KEYS.includes(key)) throw new TypeError(OPTIONS_TYPE_ERROR);
    if (typeof value !== 'function') throw new TypeError(OPTIONS_TYPE_ERROR);
    settings[key] = value;
  }
  return settings;
}

/** The absent block; identical in shape to a provided one, so readers branch once. */
function absentBlock() {
  return {
    state: 'absent',
    source: null,
    outcome: 'unknown',
    issues: [],
    summary: null,
    entryDiagnostics: 0,
  };
}

/**
 * The profile block.
 *
 * It mirrors the channel shape because that is what a reader of the embedded
 * combined report already knows, plus the two fields only a profile summary has.
 *
 * A REFUSAL KEEPS ITS SUMMARY. `summarizeProfileDumpText` returns a summary even
 * when `ok` is false — the refusal diagnostics, the measured byte and line counts
 * and the fixed `inventory`/`root` values. Dropping it in favour of a bare
 * `PROFILE_UNUSABLE` would throw away the only explanation the reader can check.
 * `summary` is `null` only when nothing was read at all.
 */
function profileBlock(entry) {
  if (entry === undefined) return absentBlock();
  const label = SOURCE_BY_NAME.profile;

  if (entry.kind === 'failure') {
    return {
      state: 'provided',
      source: label,
      outcome: 'invalid',
      issues: [{ code: entry.code }],
      summary: null,
      entryDiagnostics: 0,
    };
  }

  let result;
  try {
    result = summarizeProfileDumpText(entry.value);
  } catch {
    // The summarizer refuses a non-string with a fixed TypeError; a caller who
    // got here passed something the CLI would never pass.
    throw new TypeError(ENTRY_TYPE_ERROR);
  }

  const summary = result.summary === undefined ? null : result.summary;
  const entryDiagnostics = Number.isInteger(result.entryDiagnostics) ? result.entryDiagnostics : 0;

  if (result.ok !== true) {
    return {
      state: 'provided',
      source: label,
      outcome: 'invalid',
      issues: [{ code: 'PROFILE_UNUSABLE' }],
      summary,
      entryDiagnostics,
    };
  }

  if (entryDiagnostics > 0) {
    return {
      state: 'provided',
      source: label,
      outcome: 'attention',
      issues: [{ code: 'PROFILE_ENTRY_DIAGNOSTICS' }],
      summary,
      entryDiagnostics,
    };
  }

  return {
    state: 'provided',
    source: label,
    outcome: 'clear',
    issues: [],
    summary,
    entryDiagnostics: 0,
  };
}

/** The provided-but-degraded lane shape; `source` is the fixed slot, never a path. */
function failedLane(lane, code) {
  return {
    state: 'provided',
    source: SOURCE_BY_NAME[lane],
    outcome: code === DIAGNOSE_ENTRY_FAILURES.VALIDATOR_LOAD_FAILED ? 'error' : 'invalid',
    result: null,
    issues: [{ code }],
  };
}

function absentLane() {
  return { state: 'absent', source: null, outcome: 'unknown', result: null, issues: [] };
}

/**
 * Build the combined report over the lanes that survived, or — when every named
 * lane failed before the builder — the fixed skeleton with each named lane kept as
 * a `provided` failure and each unnamed lane absent.
 *
 * The skeleton branch exists so a report is never lost merely because all of its
 * inputs failed: "three lanes were named and all three were unreadable" is a
 * result, and it differs from "no lane was named". It has the same schema as a
 * builder-produced report, but it is assembled here, not by the builder; the
 * `limitations` list is the builder's own fixed list, unchanged.
 *
 * A lane whose payload is `undefined` is NOT skipped: it is a named lane with an
 * unusable document, so it goes to the builder and comes back `invalid`. Skipping
 * it would make it absent, which would read as "nobody asked".
 */
function combinedReportFor(normalized, options) {
  const usable = new Map();
  const failed = new Map();
  let named = 0;

  for (const lane of LANE_NAMES) {
    if (!normalized.has(lane)) continue;
    named += 1;
    const entry = normalized.get(lane);
    if (entry.kind === 'failure') failed.set(lane, entry.code);
    else usable.set(lane, entry.value);
  }

  if (named === 0) return null;

  let report;
  if (usable.size === 0) {
    const channels = {};
    for (const lane of LANE_NAMES) {
      channels[lane] = failed.has(lane) ? failedLane(lane, failed.get(lane)) : absentLane();
    }
    report = {
      reportVersion: COMBINED_REPORT_VERSION,
      certification: false,
      correlation: 'not-established',
      channels,
      // The same fixed list every built report carries; an empty array would drop
      // the envelope's own declarations.
      limitations: [...LIMITATION_CODES],
    };
  } else {
    const builderInput = {};
    for (const lane of LANE_NAMES) {
      if (!usable.has(lane)) continue;
      builderInput[lane] = { source: SOURCE_BY_NAME[lane], document: usable.get(lane) };
    }
    const built = buildCombinedReport(builderInput, options);
    const channels = { ...built.channels };
    for (const lane of LANE_NAMES) {
      if (failed.has(lane)) channels[lane] = failedLane(lane, failed.get(lane));
      else if (channels[lane] === undefined) channels[lane] = absentLane();
    }
    report = { ...built, channels };
  }

  return report;
}

/** The channel-like block for one source, whether or not a lane was named. */
export function blockFor(report, source) {
  if (source === 'profile') return report.profile;
  const channels = report.combinedReport === null ? null : report.combinedReport.channels;
  const lane = channels === null ? undefined : channels[source];
  return lane === undefined || lane === null ? absentLane() : lane;
}

/**
 * Next steps: at most one per source, in the fixed source order.
 *
 * A source that is absent still gets a step — "nothing was named here" is useful
 * to read — but such a step never changes the exit code. Each step names the
 * fixed cause the block already recorded, so the advice is specific: a read
 * refusal is not the same advice as a parse failure or a validator that would not
 * load.
 */
function nextStepsFor(report) {
  const steps = [];
  for (const source of DIAGNOSE_SOURCES) {
    const block = blockFor(report, source);
    if (block.state !== 'provided') {
      steps.push({ code: 'SOURCE_NOT_PROVIDED', source, message: NEXT_STEP_TEXT.ABSENT });
      continue;
    }

    const issues = Array.isArray(block.issues) ? block.issues : [];
    const codes = issues.map((issue) => (issue && typeof issue.code === 'string' ? issue.code : ''));
    const code = codes.find((candidate) => NEXT_STEP_TEXT[candidate] !== undefined);
    if (code !== undefined) {
      steps.push({ code: `${source.toUpperCase()}_${outcomeSuffix(block)}`, source, message: NEXT_STEP_TEXT[code] });
      continue;
    }

    const outcome = typeof block.outcome === 'string' ? block.outcome : 'unknown';
    if (outcome === 'clear') continue;
    steps.push({
      code: `${source.toUpperCase()}_${outcomeSuffix(block)}`,
      source,
      message: NEXT_STEP_TEXT[outcome.toUpperCase()] ?? NEXT_STEP_TEXT.UNKNOWN,
    });
  }
  return Object.freeze(steps.map((step) => Object.freeze(step)));
}

/** The fixed suffix for a block's outcome; anything unrecognized reads as unknown. */
function outcomeSuffix(block) {
  const outcome = typeof block.outcome === 'string' ? block.outcome : 'unknown';
  return ['attention', 'invalid', 'error', 'unknown'].includes(outcome)
    ? outcome.toUpperCase()
    : 'UNKNOWN';
}

/**
 * The closed baseline vocabulary for the provenance projection.
 *
 * Four words, and every one of them is reachable from a real document:
 *
 * - `recorded` — the lane's own summary carries a baseline this envelope can read
 *   unchanged: a 40-character commit and a non-empty node version, verbatim.
 * - `not-reflected` — the lane was read and summarised, but that summary carries no
 *   baseline field at all. This is the honest word for the three lanes whose
 *   summaries are counts and diagnostics: it points the reader upstream, and it
 *   never claims a document had no baseline.
 * - `not-provided` — no such input was named, so there is nothing to read.
 * - `not-readable` — the input was named but produced no usable document, so any
 *   baseline it may have carried is unavailable.
 *
 * There is deliberately no `unknown` word: an unreadable baseline is already
 * `not-readable`, and a fifth word that means the same thing invites a reader to
 * treat one of the two as "probably fine".
 */
export const PROVENANCE_BASELINE_STATES = Object.freeze({
  RECORDED: 'recorded',
  NOT_REFLECTED: 'not-reflected',
  NOT_PROVIDED: 'not-provided',
  NOT_READABLE: 'not-readable',
});

/** The fixed key order of one provenance entry. */
export const PROVENANCE_KEYS = Object.freeze(['source', 'baselineState', 'commit', 'node']);

/** A full git object name. Abbreviations are refused, as they are in the runtime receipt. */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * One provenance entry: what this envelope could, and could not, read about one
 * source's baseline.
 *
 * NOTHING IS DERIVED. The commit and node strings are copied from the lane's own
 * summary when, and only when, they are present and well formed; otherwise the
 * entry says which of the three "no baseline here" reasons applies. No source's
 * baseline is compared with another's, and a missing one is never filled in from a
 * neighbour.
 */
function provenanceEntry(source, block) {
  const states = PROVENANCE_BASELINE_STATES;
  const label = SOURCE_BY_NAME[source];

  if (block.state !== 'provided') {
    return { source: label, baselineState: states.NOT_PROVIDED, commit: null, node: null };
  }
  if (block.outcome === 'invalid' || block.outcome === 'error') {
    return { source: label, baselineState: states.NOT_READABLE, commit: null, node: null };
  }

  const summary = source === 'profile'
    ? block.summary
    : (isPlainRecord(block.result) ? block.result.summary : null);
  const baseline = isPlainRecord(summary) ? summary.baseline : undefined;

  if (
    isPlainRecord(baseline)
    && typeof baseline.commit === 'string'
    && COMMIT_PATTERN.test(baseline.commit)
    && typeof baseline.node === 'string'
    && baseline.node !== ''
  ) {
    return { source: label, baselineState: states.RECORDED, commit: baseline.commit, node: baseline.node };
  }
  return { source: label, baselineState: states.NOT_REFLECTED, commit: null, node: null };
}

/**
 * The provenance projection: one frozen entry per source, in the fixed source
 * order, always the same length whether or not anything was named.
 *
 * It is not a provenance *claim*. It says what this envelope read; it does not say
 * the read document is authentic, that the commit names this checkout, or that two
 * sources came from the same tree.
 */
function buildProvenance(report) {
  return Object.freeze(
    DIAGNOSE_SOURCES.map((source) => Object.freeze(provenanceEntry(source, blockFor(report, source)))),
  );
}

/**
 * Assemble the envelope from normalized entries. Shared by both builders.
 *
 * @param {Map<string, {kind: 'payload', value: unknown} | {kind: 'failure', code: string}>} normalized
 * @param {object} options Already validated by {@link readOptions}.
 */
function assemble(normalized, options) {
  const profile = normalized.has('profile') ? profileBlock(normalized.get('profile')) : absentBlock();
  const combinedReport = combinedReportFor(normalized, options);

  const envelope = Object.freeze({
    diagnoseVersion: DIAGNOSE_VERSION,
    certification: false,
    correlation: 'not-established',
    profile,
    combinedReport,
    provenance: Object.freeze([]),
    nextSteps: Object.freeze([]),
    limitations: Object.freeze([...LIMITATION_CODES, ...DIAGNOSE_LIMITATION_CODES]),
  });

  const steps = nextStepsFor(envelope);

  return Object.freeze({
    ...envelope,
    profile: Object.freeze(profile),
    provenance: buildProvenance(envelope),
    nextSteps: steps,
  });
}

/**
 * Public builder path: payloads only. `allowFailure: false` is enforced here, not
 * by the caller, so no failure code can enter through `./diagnose`.
 *
 * @internal Used by `diagnose.js`; not reachable through package exports.
 */
export function buildFromPayloads(input, options) {
  const raw = readSourceMap(input, INPUT_TYPE_ERROR);
  const settings = readOptions(options);
  const normalized = new Map();
  for (const [key, entry] of raw) normalized.set(key, readEntry(key, entry, { allowFailure: false }));
  return assemble(normalized, settings);
}

/**
 * CLI path: payloads *or* one documented failure code per source.
 *
 * @internal Imported only by `diagnose-cli.js`; deliberately absent from
 *   `package.json` exports and from `diagnose.d.ts`'s public types.
 */
export function buildFromOutcomes(outcomes, options) {
  const raw = readSourceMap(outcomes, OUTCOME_TYPE_ERROR);
  const settings = readOptions(options);
  const normalized = new Map();
  for (const [key, entry] of raw) normalized.set(key, readEntry(key, entry, { allowFailure: true }));
  return assemble(normalized, settings);
}
