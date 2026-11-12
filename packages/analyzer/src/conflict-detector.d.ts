/**
 * Types for `conflict-detector.js` — the pure A1 occupancy engine.
 *
 * The engine holds no host access: claims go in, an occupancy table and C1–C11
 * conflict records come out. Nothing here reads files, evaluates configuration or
 * imports a DSH module, and that is why the rule outcomes are testable without a
 * host.
 *
 * Two views are declared on purpose. `table()` is the advertised
 * `Map<kind, Map<key, {owner, uid}>>` resolved view, while `claimsOf()` retains
 * every claimant — the second claimant of a duplicated key *is* the conflict
 * evidence, so a single-occupant map cannot be the only surface.
 */

/** Snapshot document version. */
export declare const CONFLICT_DETECTOR_VERSION: 'conflict-detector/0.1-draft.1';

/** The closed C1–C11 taxonomy, in numeric order. */
export declare const CONFLICT_CODES: readonly [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
];
export type ConflictCode = (typeof CONFLICT_CODES)[number];

/** Machine name of each code. The code, not the name, is the stable cross-process key. */
export declare const CONFLICT_TYPES: Readonly<Record<ConflictCode, string>>;

export declare const CONFLICT_SEVERITIES: readonly ['blocker', 'high', 'medium', 'low'];
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];

/** Severity floor per code. A rule may raise its record's severity, never lower it. */
export declare const DEFAULT_SEVERITY: Readonly<Record<ConflictCode, ConflictSeverity>>;

/** Occupancy kinds. A claim of any other kind is rejected as C11. */
export declare const OCCUPANCY_KINDS: readonly ['service', 'tool', 'slot', 'row', 'waterfall', 'config', 'event'];
export type OccupancyKind = (typeof OCCUPANCY_KINDS)[number];

/**
 * Facts the engine cannot establish from a claim. Reported instead of guessed;
 * an empty list means every applicable rule had the facts it needed.
 */
export declare const CONFLICT_LIMITATIONS: Readonly<{
  HOST_VERSION_UNKNOWN: 'HOST_VERSION_UNKNOWN';
  HOST_RANGE_UNCHECKED: 'HOST_RANGE_UNCHECKED';
  PLATFORM_UNKNOWN: 'PLATFORM_UNKNOWN';
  EVENT_CATALOG_UNAVAILABLE: 'EVENT_CATALOG_UNAVAILABLE';
  EVENT_NOT_IN_CATALOG: 'EVENT_NOT_IN_CATALOG';
  REQUIREMENT_MATCHING_IS_EXACT: 'REQUIREMENT_MATCHING_IS_EXACT';
  WATERFALL_ORDER_UNKNOWN: 'WATERFALL_ORDER_UNKNOWN';
  CONFIG_PRIORITY_UNKNOWN: 'CONFIG_PRIORITY_UNKNOWN';
}>;
export type ConflictLimitation = (typeof CONFLICT_LIMITATIONS)[keyof typeof CONFLICT_LIMITATIONS];

/** One claimant of one key. */
export interface ConflictClaim {
  /** Who occupies the key. A plugin id, bundle module name, or host label. */
  owner: string;
  /** The fiber uid, when the claimant has one; `null` otherwise. */
  uid: number | null;
  kind: OccupancyKind;
  key: string;
  /** The claimant's own static scope label. Not an observed Cordis scope. */
  scope: string;
  /** Platforms the claimant supports; empty means "not declared", never "none". */
  platforms: string[];
  /** Capability names the claimant needs. Matched exactly (see below). */
  requires: string[];
  /** Extra capability names the claimant provides, beyond its own key. */
  provides: string[];
  /** Event names the claimant subscribes to, for the near-miss check (C10). */
  events: string[];
  /** The host range the claimant declares, or `null` when it declares none. */
  hostRange: string | null;
  /** `single` upgrades a duplicate slot key to `blocker` (C3). */
  slotMode: 'single' | 'keyed' | null;
  /** Waterfall order; equal orders across claimants are a C4 conflict. */
  order: number | null;
  /** Config layer priority; equal priorities across claimants are a C5 conflict. */
  layerPriority: number | null;
  /** Set only when the claimant knowingly uses a reserved prefix (C9). */
  reservedAck: boolean;
}

/** A claim as a caller supplies it; every field except `kind` and `key` is optional. */
export interface ConflictClaimInput {
  kind: OccupancyKind;
  key: string;
  uid?: number | null;
  scope?: string;
  platforms?: string[];
  requires?: string[];
  provides?: string[];
  events?: string[];
  hostRange?: string;
  slotMode?: 'single' | 'keyed';
  order?: number;
  layerPriority?: number;
  reservedAck?: boolean;
}

/** One conflict. `id` is a stable content key, so a diff across refreshes is exact. */
export interface ConflictRecord {
  id: string;
  code: ConflictCode;
  type: string;
  severity: ConflictSeverity;
  kind: string;
  key: string;
  owners: ReadonlyArray<{ owner: string; uid: number | null }>;
  detail: Readonly<Record<string, unknown>>;
  summary: string;
}

/** A fiber failure the service observed. Never classified as a conflict. */
export interface ConflictFailure {
  owner: string;
  uid: number | null;
  state: string;
  message: string | null;
  at: string | null;
}

/** Occupancy per kind, as a sorted array per kind so the snapshot can be serialized. */
export type OccupancySnapshot = Record<OccupancyKind, Array<{ key: string; owner: string; uid: number | null }>>;

export interface ConflictSnapshot {
  version: string;
  platform: string | null;
  hostVersion: string | null;
  occupancy: OccupancySnapshot;
  conflicts: ConflictRecord[];
  limitations: ConflictLimitation[];
  failures: ConflictFailure[];
  totals: { claims: number; rejected: number; conflicts: number };
}

/** The advertised resolved view: per key, the smallest `(owner, uid)` claimant. */
export type OccupancyTable = Map<OccupancyKind, Map<string, { owner: string; uid: number | null }>>;

export interface ConflictDetectorOptions {
  /** Current platform; when absent, platform-scoped rules report `PLATFORM_UNKNOWN`. */
  platform?: string;
  /** Current host version; when absent, host-range rules report a limitation. */
  hostVersion?: string;
  /** Known event names, for the near-miss check. When absent, C10 is not evaluated. */
  knownEvents?: string[];
  /** Hard cap on held claims. Exceeding it throws `RangeError`. Defaults to 10000. */
  maxClaims?: number;
}

export interface ConflictDetector {
  readonly options: {
    platform: string | null;
    hostVersion: string | null;
    knownEvents: string[] | null;
    maxClaims: number;
  };
  /** Add or replace one owner's claims by identity `(owner, kind, key, scope)`. */
  upsert(owner: string, claims: ConflictClaimInput[]): { accepted: number; rejected: number };
  /** Add the claims a protocol declaration implies, reading only `resources[]`. */
  report(
    owner: string,
    declaration: { resources?: unknown[]; capabilities?: { required?: string[] } },
    extra?: {
      uid?: number;
      requires?: string[];
      provides?: string[];
      events?: string[];
      platforms?: string[];
      hostRange?: string;
    },
  ): { accepted: number; rejected: number };
  /**
   * Drop every claim of one owner, remembering what it provided. A C8 race appears
   * in `conflicts()` only while a live claim requires a capability the removed owner
   * provided and nothing provides it now; it clears itself when that stops being true.
   */
  removeOwner(owner: string): number;
  /** Record an observed fiber failure. Never becomes a conflict on its own. */
  recordFailure(failure: Partial<ConflictFailure> & { owner?: string }): ConflictFailure;
  clear(): void;
  claims(): ConflictClaim[];
  claimsOf(kind: OccupancyKind, key: string): ConflictClaim[];
  table(): OccupancyTable;
  conflicts(): ConflictRecord[];
  snapshot(): ConflictSnapshot;
}

/**
 * Decide whether `version` matches `range` — `||`, comparators, caret, tilde,
 * exact and `*` only. Returns `null` when the range is outside that subset, so a
 * caller reports a limitation instead of a false verdict.
 */
export declare function satisfiesRange(version: string, range: string): boolean | null;

/**
 * Create one detector. Throws `TypeError` for a non-object options value or an
 * unknown option key — a caller mistake is not a protocol issue, and it must not
 * be silently ignored.
 */
export declare function createConflictDetector(options?: ConflictDetectorOptions): ConflictDetector;
