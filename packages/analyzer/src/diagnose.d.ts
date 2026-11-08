/**
 * Types for `diagnose.js`.
 *
 * This entry point is deliberately narrower than the modules it wraps: one
 * builder, one exit-code mapper and the fixed vocabularies they use. It never
 * re-declares the combined report or the profile summary — those types are
 * imported from their own declaration files so the two cannot drift.
 *
 * There is no failure input on this surface. A caller that holds no document for a
 * source leaves the key out; the failure vocabulary below is an output type only.
 */

import type { CombinedReport } from './combined-report.js';
import type { ProfileDumpSummary } from './profile-dump.js';

/** The envelope format version this module emits. */
export declare const DIAGNOSE_VERSION: 'dsh-compat-diagnose/0.2-draft.1';

/** Every source, in the fixed order used by this envelope. */
export declare const DIAGNOSE_SOURCES: readonly ['profile', 'static', 'runtime', 'admission'];
export type DiagnoseSource = (typeof DIAGNOSE_SOURCES)[number];

/** The three lane names, in the fixed order the combined report uses. */
export declare const LANE_NAMES: readonly ['static', 'runtime', 'admission'];
export type DiagnoseLane = (typeof LANE_NAMES)[number];

/**
 * Fixed slot labels. A reported value is always one of these; a file path is never
 * substituted for one.
 */
export declare const SOURCE_BY_NAME: Readonly<Record<DiagnoseSource, string>>;

/** Closed exit-code set for this envelope. */
export declare const DIAGNOSE_EXIT_CODES: Readonly<{
  OK: 0;
  ATTENTION: 1;
  INVALID: 2;
  USAGE: 3;
  LANE_ERROR: 4;
  INTERNAL: 5;
}>;

/**
 * The closed failure vocabulary, re-exported as an **output** type: these codes
 * appear in `issues[].code`. They are not accepted as builder input — only the
 * CLI, through the package-internal module, records an input-side outcome.
 */
export declare const DIAGNOSE_ENTRY_FAILURES: Readonly<{
  INPUT_READ_FAILED: 'INPUT_READ_FAILED';
  INPUT_JSON_INVALID: 'INPUT_JSON_INVALID';
  VALIDATOR_LOAD_FAILED: 'VALIDATOR_LOAD_FAILED';
}>;
export type DiagnoseEntryFailure = (typeof DIAGNOSE_ENTRY_FAILURES)[keyof typeof DIAGNOSE_ENTRY_FAILURES];

/** Limitation codes this envelope adds on top of the combined report's own list. */
export declare const DIAGNOSE_LIMITATION_CODES: readonly [
  'PROFILE_BLOCK_IS_A_SUMMARY_NOT_A_DUMP',
  'NO_CROSS_SOURCE_IDENTITY',
  'BASELINE_IS_READ_FROM_THE_SUMMARY_ONLY',
];

/**
 * The closed baseline vocabulary of the provenance projection.
 *
 * `recorded` — the lane summary carries a baseline this envelope copies verbatim.
 * `not-reflected` — the lane was summarised, but that summary has no baseline field.
 * `not-provided` — no document was named.
 * `not-readable` — named, but no usable result, so a baseline it carried is unavailable.
 *
 * There is no `unknown` word: an unreadable baseline is `not-readable`, and a fifth word
 * meaning the same thing invites a reader to treat one of the two as "probably fine".
 */
export declare const PROVENANCE_BASELINE_STATES: Readonly<{
  RECORDED: 'recorded';
  NOT_REFLECTED: 'not-reflected';
  NOT_PROVIDED: 'not-provided';
  NOT_READABLE: 'not-readable';
}>;

/** The fixed key order of one provenance entry. */
export declare const PROVENANCE_KEYS: readonly ['source', 'baselineState', 'commit', 'node'];

/** The closed baseline word set. */
export type ProvenanceBaselineState =
  | 'recorded'
  | 'not-reflected'
  | 'not-provided'
  | 'not-readable';

/**
 * What the envelope could read about one source own baseline.
 *
 * `commit` and `node` are non-null exactly when `baselineState` is `recorded`; every
 * other word carries two nulls, because half a baseline is a contradiction rather than
 * extra information. `source` is the fixed slot label, never a path.
 */
export interface DiagnoseProvenanceEntry {
  readonly source: string;
  readonly baselineState: ProvenanceBaselineState;
  readonly commit: string | null;
  readonly node: string | null;
}

/** The closed next-step vocabulary. */
export declare const DIAGNOSE_NEXT_STEP_CODES: readonly [
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
];
export type DiagnoseNextStepCode = (typeof DIAGNOSE_NEXT_STEP_CODES)[number];

/** Outcome vocabulary, identical to the combined report's channel outcomes. */
export type DiagnoseOutcome = 'unknown' | 'clear' | 'attention' | 'invalid' | 'error';

/** Any code this envelope may put in an `issues` array. */
export type DiagnoseIssueCode = DiagnoseEntryFailure | 'PROFILE_UNUSABLE' | 'PROFILE_ENTRY_DIAGNOSTICS';

export interface DiagnoseIssue {
  readonly code: DiagnoseIssueCode;
}

/**
 * One block per source. The profile block has the channel shape plus the two
 * fields only a profile summary has; it is not a combined-report channel and is
 * never placed in `combinedReport.channels`.
 */
export interface DiagnoseProfileBlock {
  readonly state: 'absent' | 'provided';
  /** Fixed slot label; `null` when absent. Never a path. */
  readonly source: string | null;
  readonly outcome: DiagnoseOutcome;
  readonly issues: readonly DiagnoseIssue[];
  /**
   * The profile summary unchanged.
   *
   * It is present whenever text was read — including a **refusal**: the summarizer
   * returns a summary carrying the fixed refusal diagnostics and the measured byte
   * and line counts, and that explanation is kept rather than replaced by a bare
   * code. It is `null` only when nothing was read at all (absent, or a failed read
   * before any bytes were decoded).
   */
  readonly summary: ProfileDumpSummary | null;
  /**
   * Entry-level diagnostic counter from the summarizer, read from the counter and
   * not from the (capped) diagnostics list. Decides exit 1 for this source.
   */
  readonly entryDiagnostics: number;
}

export interface DiagnoseNextStep {
  readonly code: DiagnoseNextStepCode;
  readonly source: DiagnoseSource;
  /** Fixed text for this cause. Never document content and never a path. */
  readonly message: string;
}

export interface DiagnoseReport {
  readonly diagnoseVersion: 'dsh-compat-diagnose/0.2-draft.1';
  readonly certification: false;
  readonly correlation: 'not-established';
  readonly profile: DiagnoseProfileBlock;
  /**
   * The combined report.
   *
   * Usually this is the unmodified library's output, built from the lane documents
   * given here. One case is not: when lanes were named and **every** one of them
   * failed to read, parse or load its validator, no builder input survives, so this
   * module assembles the same schema itself — the fixed version, `certification`,
   * `correlation`, the builder's own fixed `limitations` list, each named lane as
   * `state: 'provided'` with a degraded outcome and a fixed issue code, and each
   * unnamed lane as `absent`. A report is never dropped merely because all of its
   * inputs failed.
   *
   * `null` **only** when no lane was named at all.
   */
  readonly combinedReport: CombinedReport | null;
  /**
   * One entry per source, always four, always in `DIAGNOSE_SOURCES` order.
   *
   * It reports what this envelope could read about a baseline and nothing else: no entry is
   * compared with another, no commit is checked against a checkout, and no entry is filled in
   * from a neighbour. A reader who wants an answer to "were these two sources the same tree"
   * has no field here, by design.
   */
  readonly provenance: readonly DiagnoseProvenanceEntry[];
  /** At most one step per source, in `DIAGNOSE_SOURCES` order. */
  readonly nextSteps: readonly DiagnoseNextStep[];
  /** The combined report's fixed list, followed by this envelope's two codes. */
  readonly limitations: readonly string[];
}

/** An entry that supplies a profile dump's raw text, summarized here. */
export interface DiagnoseProfileEntry {
  /** Raw dump text. Never echoed into the envelope; only its summary is. */
  readonly text: string;
}

/** An entry that supplies an already-parsed lane document. */
export interface DiagnoseLaneEntry {
  /** Parsed by the caller. This module never parses text for a lane. */
  readonly document: unknown;
}

/**
 * The input's own keys are the request: a present key names a source, an absent key
 * does not. There is no separate `requested` list, so the two cannot disagree.
 *
 * A key that is present must carry a real payload. `null` and `undefined` are
 * refused as malformed rather than read as absence — writing the key down is a
 * request, and answering it with silence is what this contract forbids.
 */
export interface DiagnoseInput {
  readonly profile?: DiagnoseProfileEntry;
  readonly static?: DiagnoseLaneEntry;
  readonly runtime?: DiagnoseLaneEntry;
  readonly admission?: DiagnoseLaneEntry;
}

export interface DiagnoseBuildOptions {
  /** Same contract as `buildCombinedReport`'s option of the same name. */
  readonly validateDeclaration?: (declaration: unknown) => unknown;
  /** Same contract as `buildCombinedReport`'s option of the same name. */
  readonly validateAdmissionEvidence?: (evidence: unknown) => unknown;
}

/**
 * Build one frozen envelope. Synchronous: no I/O, nothing awaited.
 *
 * Validated up front and independently of which sources were named: a profile-only
 * call and a mixed call reject the same malformed options.
 *
 * @throws {TypeError} With fixed text when the input is not a plain object with
 *   only the four documented keys, when a present key holds `null`/`undefined`,
 *   when an entry does not carry exactly its one documented field, or when an
 *   option is not a function.
 */
export declare function buildDiagnoseReport(
  input: DiagnoseInput,
  options?: DiagnoseBuildOptions,
): DiagnoseReport;

/**
 * Map an envelope to a processing exit code, precedence `3 > 4 > 2 > 1 > 0`.
 *
 * Only `provided` blocks count: a source nobody named never moves the code. A
 * `provided` block carrying `VALIDATOR_LOAD_FAILED` returns 3. `INTERNAL` (5) is
 * never returned here — the CLI adds it for serialization and output failures.
 *
 * The envelope is re-checked here rather than assumed: `diagnoseVersion`,
 * `certification`, `correlation`, `nextSteps`, the four-entry `provenance` projection and
 * the presence of `profile` must all
 * be the documented ones. When `combinedReport` is not `null`, `channels` must be a
 * plain object holding all three lane blocks as own properties — a missing or `null`
 * channel is an error, never a silent `absent`. Only `combinedReport === null`
 * (the documented "no lane was named") lets the three lanes be treated as absent.
 * An `absent` block must carry exactly `outcome: 'unknown'`.
 *
 * @throws {TypeError} With fixed text when the argument does not have the
 *   documented shape — a wrong version or flag, a missing `profile`, a missing or
 *   `null` channel next to a non-null `combinedReport`, or a block whose `state` or
 *   `outcome` is outside its closed set. This is a shape check, not a provenance
 *   check; it exists so a typo or a truncated report cannot be skipped into a clear
 *   result. There is no separate "bad report" exit code: a violation throws, and
 *   the CLI reports it as its own internal failure.
 */
export declare function diagnoseExitCode(report: DiagnoseReport): 0 | 1 | 2 | 3 | 4;
