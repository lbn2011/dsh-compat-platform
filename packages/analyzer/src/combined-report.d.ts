/**
 * Type surface for `combined-report.js`.
 *
 * Kept as a hand-written sibling declaration because the module itself is plain
 * ESM JavaScript with JSDoc. The literals below are the contract, not a copy of
 * the implementation's internals: a consumer may rely on
 * `COMBINED_REPORT_VERSION` and on the fixed limitation codes, and on nothing
 * about how a lane decided its outcome.
 */

/** The three evidence lanes. */
export type LaneId = 'static' | 'runtime' | 'admission';

/** Whether a lane was present in the input at all. */
export type ChannelState = 'absent' | 'provided';

/**
 * What the wrapper could establish for one lane.
 *
 * - `unknown` — the lane was absent; this is the only value `absent` carries.
 * - `clear` — the lane was provided and nothing it reported needs attention.
 * - `attention` — the lane reported something not established (a failed or
 *   not-run case, unknown coverage, a static error finding).
 * - `invalid` — the lane's document could not be accepted.
 * - `error` — no verdict was produced (missing/broken validator, or an
 *   unclassified throw).
 */
export type ChannelOutcome = 'unknown' | 'clear' | 'attention' | 'invalid' | 'error';

/** Every outcome a *provided* channel can carry. */
export type ProvidedChannelOutcome = Exclude<ChannelOutcome, 'unknown'>;

/** One lane entry exactly as the caller must supply it. */
export interface LaneEntry {
  /** Caller-chosen public alias: non-empty, already trimmed, at most 128 chars. */
  readonly source: string;
  /** Parsed JSON data. Never inspected as an identity and never a join key. */
  readonly document: unknown;
}

/**
 * The envelope. Presence — not truthiness — decides whether a lane was provided:
 * an own key whose value is `null` is provided-but-invalid, a missing key is
 * absent.
 */
export interface CombinedReportInput {
  readonly static?: LaneEntry | null;
  readonly runtime?: LaneEntry | null;
  readonly admission?: LaneEntry | null;
}

/**
 * Injected validators. Each is required when its lane is provided: a missing or
 * non-function value makes that lane `error` / `VALIDATOR_MISSING` and does not
 * affect the others.
 */
export interface CombinedReportOptions {
  readonly validateDeclaration?: (declaration: unknown) => unknown;
  readonly validateAdmissionEvidence?: (document: unknown) => unknown;
}

/** A lane issue carries a code and nothing else. */
export interface ChannelIssue {
  readonly code: string;
}

/** A lane the input did not mention. Never a pass. */
export interface AbsentChannel {
  readonly state: 'absent';
  readonly source: null;
  readonly outcome: 'unknown';
  readonly result: null;
  readonly issues: readonly [];
}

/**
 * A lane the input mentioned.
 *
 * `source` is `null` when the entry itself was unusable (for example `null`);
 * `result` is the lane's own full result object, passed through by reference,
 * or `null` when no result was produced.
 */
export interface ProvidedChannel {
  readonly state: 'provided';
  readonly source: string | null;
  readonly outcome: ProvidedChannelOutcome;
  readonly result: unknown | null;
  readonly issues: readonly ChannelIssue[];
}

export type Channel = AbsentChannel | ProvidedChannel;

/** The frozen report this module produces. */
export interface CombinedReport {
  readonly reportVersion: 'combined-report/0.1-draft.1';
  readonly certification: false;
  readonly correlation: 'not-established';
  readonly channels: Readonly<Record<LaneId, Channel>>;
  readonly limitations: readonly string[];
}

/** Fixed envelope version, single source of the literal. */
export declare const COMBINED_REPORT_VERSION: 'combined-report/0.1-draft.1';
/** Alias of {@link COMBINED_REPORT_VERSION}. */
export declare const REPORT_VERSION: 'combined-report/0.1-draft.1';
export declare const LANE_IDS: readonly LaneId[];
export declare const CHANNEL_STATES: readonly ChannelState[];
export declare const CHANNEL_OUTCOMES: readonly ChannelOutcome[];
export declare const CHANNEL_ISSUE_CODES: {
  readonly VALIDATOR_MISSING: 'VALIDATOR_MISSING';
  readonly INPUT_INVALID: 'INPUT_INVALID';
  readonly VALIDATOR_FAILED: 'VALIDATOR_FAILED';
  readonly LANE_FAILED: 'LANE_FAILED';
};
/** Fixed limitation codes, identical for every report. */
export declare const COMBINED_REPORT_LIMITATIONS: readonly string[];
/** Alias of {@link COMBINED_REPORT_LIMITATIONS}; the same frozen array. */
export declare const LIMITATION_CODES: readonly string[];
export declare const MAX_SOURCE_LENGTH: 128;

/**
 * Build one report over one or more lanes.
 *
 * @throws {TypeError} when `input` or `options` are not the closed shape.
 */
export declare function buildCombinedReport(
  input: CombinedReportInput,
  options?: CombinedReportOptions,
): CombinedReport;

/**
 * Map a report to a *processing* exit code: `4` for `error`, else `2` for
 * `invalid`, else `1` for `attention` or absent, else `0`. Not a verdict and not
 * a certification.
 *
 * @throws {TypeError} when `report` is not a value this module produced.
 */
export declare function combinedReportExitCode(report: CombinedReport): 0 | 1 | 2 | 4;
