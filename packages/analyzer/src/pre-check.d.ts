/**
 * Types for `pre-check.js` — the A2 static pre-check.
 *
 * The comparison is pure: the caller supplies a manifest (or its text), existing occupancy and
 * the two environment facts, and receives the conflicts that would involve the candidate. Nothing
 * here reads a file, resolves a dependency or loads a module; the command line
 * (`./pre-check-cli`) is the only module that opens files.
 *
 * Two result lists exist on purpose. `predicted` holds the conflicts the candidate takes part in,
 * `preexisting` holds ones the table already had. Merging them would let an old conflict be read
 * as a prediction about the new plugin.
 */

import type {
  ConflictClaimInput,
  ConflictCode,
  ConflictLimitation,
  ConflictRecord,
  OccupancyKind,
  OccupancySnapshot,
} from './conflict-detector.js';

/** Version of this module's contract. */
export declare const PRE_CHECK_VERSION: 'pre-check/0.1-draft.1';

/** Format identifier of the summary this module produces. */
export declare const PRE_CHECK_SCHEMA: 'pre-check-summary/0.1-draft.1';

/**
 * Findings about the inputs themselves. These are not conflict codes: a manifest that is not
 * JSON is not a C-code, and must not appear in a list a caller reads as conflicts.
 */
export declare const PRE_CHECK_CODES: Readonly<{
  MANIFEST_NOT_JSON: 'MANIFEST_NOT_JSON';
  MANIFEST_NOT_OBJECT: 'MANIFEST_NOT_OBJECT';
  MANIFEST_NAME_MISSING: 'MANIFEST_NAME_MISSING';
  MANIFEST_DSH_NOT_OBJECT: 'MANIFEST_DSH_NOT_OBJECT';
  ENTRY_NOT_OBJECT: 'ENTRY_NOT_OBJECT';
  ENTRY_INJECT_NOT_STRING_ARRAY: 'ENTRY_INJECT_NOT_STRING_ARRAY';
  ENTRY_PLATFORM_NOT_STRING: 'ENTRY_PLATFORM_NOT_STRING';
  ENGINES_DSH_NOT_STRING: 'ENGINES_DSH_NOT_STRING';
  PEER_RANGE_NOT_STRING: 'PEER_RANGE_NOT_STRING';
  OCCUPANCY_NOT_ARRAY: 'OCCUPANCY_NOT_ARRAY';
  OCCUPANCY_ENTRY_REJECTED: 'OCCUPANCY_ENTRY_REJECTED';
  DECLARATIONS_NOT_ARRAY: 'DECLARATIONS_NOT_ARRAY';
  HOST_VERSION_INVALID: 'HOST_VERSION_INVALID';
  INPUT_OPEN_FAILED: 'INPUT_OPEN_FAILED';
  INPUT_STAT_FAILED: 'INPUT_STAT_FAILED';
  INPUT_NOT_REGULAR: 'INPUT_NOT_REGULAR';
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE';
  INPUT_READ_FAILED: 'INPUT_READ_FAILED';
  INPUT_NOT_UTF8: 'INPUT_NOT_UTF8';
  INPUT_NOT_JSON: 'INPUT_NOT_JSON';
  INPUT_NOT_ARRAY: 'INPUT_NOT_ARRAY';
  USAGE: 'USAGE';
  INTERNAL: 'INTERNAL';
}>;

export type PreCheckCode = (typeof PRE_CHECK_CODES)[keyof typeof PRE_CHECK_CODES];

/** Limitations a prediction adds to the detector's own eight. */
export declare const PRE_CHECK_LIMITATIONS: readonly [
  'PROVIDER_SET_COMPLETENESS_UNKNOWN',
  'BUNDLE_PATCH_ROWS_NOT_READ',
  'PREDICTION_IS_NOT_AN_INSTALL',
];

export type PreCheckLimitation =
  | (typeof PRE_CHECK_LIMITATIONS)[number]
  | ConflictLimitation
  // Raised in addition to PROVIDER_SET_COMPLETENESS_UNKNOWN when C1 was skipped, because skipping
  // C1 changes what a clean result means.
  | 'INJECT_REQUIREMENTS_NOT_COMPARED';

/** Exit codes for the `dsh-compat-pre-check` command. */
export declare const PRE_CHECK_EXIT: Readonly<{
  OK: 0;
  CONFLICTS: 1;
  UNUSABLE: 2;
  INTERNAL: 5;
  USAGE: 64;
}>;

/** One input finding: a code, and at most one entry name or field name. */
export interface PreCheckFinding {
  code: PreCheckCode;
  entry: string | null;
  field: string | null;
}

/** An existing claim, as an A1 service's `claims()` reports it. */
export interface PreCheckOccupancyClaim extends ConflictClaimInput {
  owner: string;
}

/** The candidate, as it was read from the manifest. */
export interface PreCheckManifestSummary {
  name: string | null;
  /** Plugin entries under `dsh`, excluding the reserved `dsh.bundle` key. */
  entries: number;
  /** Claims the candidate would add. */
  claims: number;
}

export interface PreCheckTotals {
  predicted: number;
  preexisting: number;
  claimsAccepted: number;
  claimsRejected: number;
}

/** The fixed input. No other key is accepted, and an unknown one throws a `TypeError`. */
export interface PreCheckInput {
  /** Decoded candidate `package.json`. */
  manifest?: object;
  /** Candidate `package.json` text; used only when `manifest` is absent. Parsed, never evaluated. */
  manifestText?: string;
  /** Existing claims. Entries without an `owner` are reported, not guessed. */
  occupancy?: PreCheckOccupancyClaim[];
  /** Protocol declarations to turn into occupancy. */
  declarations?: Array<{
    owner?: string;
    declaration: { resources?: unknown[]; capabilities?: { required?: string[] } };
    extra?: object;
  }>;
  /** Running DSH version. Without it C7 cannot fire, and the detector says so. */
  hostVersion?: string;
  /** Running platform. Without it C6 cannot fire, and the detector says so. */
  platform?: string;
  /**
   * Whether `occupancy` lists every provider. Only then are `inject` requirements compared (C1):
   * a host service table has no reverse provider attribution, so "nobody provides X" would
   * otherwise describe the collector rather than the plugin.
   */
  providerSetComplete?: boolean;
  /** Detector claim cap. */
  maxClaims?: number;
}

export interface PreCheckSummary {
  preCheckSummary: typeof PRE_CHECK_SCHEMA;
  version: typeof PRE_CHECK_VERSION;
  detector: string;
  platform: string | null;
  hostVersion: string | null;
  providerSetComplete: boolean;
  manifest: PreCheckManifestSummary;
  /** Conflicts the candidate takes part in. */
  predicted: ConflictRecord[];
  /** Conflicts the table already had, before the candidate. */
  preexisting: ConflictRecord[];
  /** Both lists, in that order. */
  conflicts: ConflictRecord[];
  totals: PreCheckTotals;
  /** The candidate's own table, so a caller can show what was assumed about it. */
  occupancy: OccupancySnapshot;
  findings: PreCheckFinding[];
  limitations: PreCheckLimitation[];
  /** The conflict taxonomy, re-exported rather than restated. */
  codes: readonly ConflictCode[];
  types: Readonly<Record<ConflictCode, string>>;
  kinds: readonly OccupancyKind[];
  conflictLimitations: Readonly<Record<string, ConflictLimitation>>;
  completeness: 'unknown';
  runtimeValidation: 'not-performed';
  certification: false;
}

/**
 * A comparison result. `ok` is false only when the input could not be used; a refusal document
 * still carries every key, with empty lists.
 */
export interface PreCheckResult {
  ok: boolean;
  summary: PreCheckSummary;
}

/**
 * Compare a candidate plugin against existing occupancy.
 *
 * @throws {TypeError} On a non-object input, an unknown key, or a wrongly typed option.
 */
export declare function staticPreCheck(input?: PreCheckInput): PreCheckResult;

/**
 * Exit code implied by a result: 0 predicted nothing, 1 predicted something, 2 unusable. A
 * pre-existing conflict does not raise the code.
 */
export declare function preCheckExitCode(result: PreCheckResult): 0 | 1 | 2;

/** A refusal document carrying exactly one finding and no comparison. */
export declare function preCheckFailure(code: PreCheckCode): PreCheckSummary;
