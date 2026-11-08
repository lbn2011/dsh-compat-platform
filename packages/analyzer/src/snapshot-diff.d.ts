/**
 * Type surface for `snapshot-diff.js`.
 *
 * Kept as a hand-written sibling declaration because the module itself is plain
 * ESM JavaScript with JSDoc. The literals below are the contract: a consumer may
 * rely on `SNAPSHOT_DIFF_VERSION`, on the five fixed `changedFields` and on the
 * three lane comparisons, and on nothing about how a lane reached its outcome.
 */

import type { LaneId } from './combined-report.js';

/** Version of the diff envelope. */
export declare const SNAPSHOT_DIFF_VERSION: 'combined-report-diff/0.1-draft.1';

/**
 * Channel fields compared by the diff, in the order `changedFields` reports.
 *
 * `result` is compared as bounded JSON data; no field inside it is interpreted.
 */
export declare const CHANGED_FIELDS: readonly ['state', 'source', 'outcome', 'issues', 'result'];

/** The three comparison outcomes. */
export type LaneComparison = 'unchanged' | 'changed' | 'incomparable';

export declare const LANE_COMPARISONS: readonly LaneComparison[];

/** Codes the diff itself invents. None is a protocol code. */
export interface DiffIssueCodes {
  readonly SNAPSHOT_UNREADABLE: 'SNAPSHOT_UNREADABLE';
  readonly SNAPSHOT_NOT_RECORD: 'SNAPSHOT_NOT_RECORD';
  readonly SNAPSHOT_KEYS_INVALID: 'SNAPSHOT_KEYS_INVALID';
  readonly SNAPSHOT_VERSION_MISMATCH: 'SNAPSHOT_VERSION_MISMATCH';
  readonly SNAPSHOT_CERTIFICATION_INVALID: 'SNAPSHOT_CERTIFICATION_INVALID';
  readonly SNAPSHOT_CORRELATION_INVALID: 'SNAPSHOT_CORRELATION_INVALID';
  readonly SNAPSHOT_CHANNELS_INVALID: 'SNAPSHOT_CHANNELS_INVALID';
  readonly SNAPSHOT_LIMITATIONS_INVALID: 'SNAPSHOT_LIMITATIONS_INVALID';
  readonly CHANNEL_KEYS_INVALID: 'CHANNEL_KEYS_INVALID';
  readonly CHANNEL_STATE_INVALID: 'CHANNEL_STATE_INVALID';
  readonly CHANNEL_ABSENT_INCONSISTENT: 'CHANNEL_ABSENT_INCONSISTENT';
  readonly CHANNEL_OUTCOME_INVALID: 'CHANNEL_OUTCOME_INVALID';
  readonly CHANNEL_SOURCE_INVALID: 'CHANNEL_SOURCE_INVALID';
  readonly CHANNEL_ISSUES_INVALID: 'CHANNEL_ISSUES_INVALID';
  readonly CHANNEL_RESULT_INVALID: 'CHANNEL_RESULT_INVALID';
  readonly JSON_ACCESSOR: 'JSON_ACCESSOR';
  readonly JSON_SYMBOL_KEY: 'JSON_SYMBOL_KEY';
  readonly JSON_NON_ENUMERABLE: 'JSON_NON_ENUMERABLE';
  readonly JSON_SPARSE_ARRAY: 'JSON_SPARSE_ARRAY';
  readonly JSON_ARRAY_EXTRA_PROPERTY: 'JSON_ARRAY_EXTRA_PROPERTY';
  readonly JSON_NON_PLAIN_OBJECT: 'JSON_NON_PLAIN_OBJECT';
  readonly JSON_CYCLE: 'JSON_CYCLE';
  readonly JSON_NON_FINITE_NUMBER: 'JSON_NON_FINITE_NUMBER';
  readonly JSON_NON_JSON_VALUE: 'JSON_NON_JSON_VALUE';
  readonly JSON_DEPTH_EXCEEDED: 'JSON_DEPTH_EXCEEDED';
  readonly JSON_NODES_EXCEEDED: 'JSON_NODES_EXCEEDED';
  readonly JSON_SIZE_EXCEEDED: 'JSON_SIZE_EXCEEDED';
}

export declare const DIFF_ISSUE_CODES: DiffIssueCodes;

/** Fixed per-snapshot walk ceilings. A work limit, not a memory guarantee. */
export declare const SNAPSHOT_JSON_BUDGET: {
  readonly depth: 64;
  readonly nodes: 100000;
  readonly size: 2097152;
};

/** What every diff result states about itself, valid or not. */
export declare const SNAPSHOT_DIFF_LIMITATIONS: readonly [
  'NO_CERTIFICATION_CLAIMED',
  'CORRELATION_NOT_ESTABLISHED',
  'STRUCTURAL_COMPARISON_ONLY',
  'ABSENCE_IS_NOT_RESOLUTION',
  'NESTED_SEMANTICS_NOT_VERIFIED',
];

/** Which side of the pair a refusal is about. */
export type DiffSide = 'before' | 'after';

/**
 * One refusal. `path` is one of a small fixed set of paths (`snapshot`,
 * `snapshot.<field>`, `snapshot.channels.<lane>`); a key name taken from the
 * input is never echoed.
 */
export interface DiffIssue {
  readonly side: DiffSide;
  readonly code: keyof DiffIssueCodes;
  readonly path: string;
}

/** The two shell fields echoed per lane; no `result` and no `source` content. */
export interface ChannelOutline {
  readonly state: 'absent' | 'provided';
  readonly outcome: 'unknown' | 'clear' | 'attention' | 'invalid' | 'error';
}

/** One lane's comparison. */
export interface ChannelDiff {
  readonly comparison: LaneComparison;
  /** Subset of `CHANGED_FIELDS`, in that fixed order; computed even when `incomparable`. */
  readonly changedFields: readonly ('state' | 'source' | 'outcome' | 'issues' | 'result')[];
  readonly before: ChannelOutline;
  readonly after: ChannelOutline;
}

/** A refused diff: no channel data at all. */
export interface InvalidSnapshotDiff {
  readonly diffVersion: 'combined-report-diff/0.1-draft.1';
  readonly valid: false;
  readonly certification: false;
  readonly correlation: 'not-established';
  /** Never empty on this branch. */
  readonly issues: readonly DiffIssue[];
  readonly channels: null;
  readonly limitationsChanged: null;
  readonly limitations: readonly string[];
}

/** A completed diff. `incomparable` is a normal answer, not an error. */
export interface ValidSnapshotDiff {
  readonly diffVersion: 'combined-report-diff/0.1-draft.1';
  readonly valid: true;
  readonly certification: false;
  readonly correlation: 'not-established';
  readonly issues: readonly [];
  readonly channels: Readonly<Record<LaneId, ChannelDiff>>;
  readonly limitationsChanged: boolean;
  readonly limitations: readonly string[];
}

export type SnapshotDiff = InvalidSnapshotDiff | ValidSnapshotDiff;

/**
 * Compare two reports produced by `buildCombinedReport()`.
 *
 * Both sides are typed `unknown` on purpose: validation *is* the boundary, so a
 * caller holding a `CombinedReport`, a parsed JSON file or an untrusted payload
 * passes the value as it is. The return value separates the two cases instead of
 * throwing.
 *
 * Structural only: a lane is `unchanged`/`changed` only when both sides are
 * `provided`, both outcomes are `clear` or `attention`, and both results are
 * plain JSON objects; every other lane is `incomparable`, with `changedFields`
 * still filled from the shell. Nothing here says a change is a fix.
 *
 * Ordinary parsed JSON (own data properties, no accessors, no cycles, within the
 * fixed budget) never throws for its content: a refused snapshot produces
 * `valid: false`. A hostile `Proxy` is not covered by that promise — a trap that
 * throws is caught and reported as `SNAPSHOT_UNREADABLE`, but traps that run
 * arbitrary code are outside this module's guarantees.
 */
export declare function compareCombinedReports(before: unknown, after: unknown): SnapshotDiff;

/**
 * Map a diff to a processing exit code: `2` refused, `1` any change or
 * incomparable lane, else `0`.
 *
 * Checks only the fields the mapping needs (version, the two fixed literals, and
 * the shape of the branch being mapped); it does not re-walk the snapshots and
 * is not a schema validator.
 *
 * @throws {TypeError} when those discriminating fields are not the ones this
 * module emits.
 */
export declare function snapshotDiffExitCode(result: SnapshotDiff): 0 | 1 | 2;
