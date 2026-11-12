/**
 * Types for `conflict-service.js` — A1 wired to a host.
 *
 * The adapter subscribes to the four change signals DSH emits and re-reads a
 * collector; it never derives occupancy from an event payload, because none of the
 * four carries any. The Cordis context is typed *structurally*: this package does
 * not import DSH, so it also runs against a fake context in a test.
 */

import type {
  ConflictClaimInput,
  ConflictDetector,
  ConflictFailure,
  ConflictRecord,
  ConflictSnapshot,
  OccupancyKind,
  OccupancyTable,
} from './conflict-detector.js';

/** Service document version. */
export declare const CONFLICT_SERVICE_VERSION: 'conflict-service/0.1-draft.1';

/** Events this service emits. */
export declare const CONFLICT_EVENTS: Readonly<{
  DETECTED: 'conflict-detected';
  RESOLVED: 'conflict-resolved';
}>;

/**
 * The host events this service listens to, exactly as DSH spells them.
 *
 * `plugin-manager/changed` carries only a change reason; `tools/change` carries no
 * arguments; `slots/changed` is a client-renderer event that a host-side forward may
 * or may not surface; `internal/status` carries a fiber and its previous state.
 */
export declare const OCCUPANCY_SIGNALS: readonly [
  'plugin-manager/changed',
  'tools/change',
  'slots/changed',
  'internal/status',
];

/** The smallest tools surface the default collector uses. */
export interface ToolsLike {
  definitions(scope?: string): readonly { name: string }[] | Promise<readonly { name: string }[]>;
}

/** The smallest plugin-manager surface the default collector uses. */
export interface PluginManagerLike {
  listBundles(): Promise<readonly { moduleName?: string; rows?: readonly { rowId?: string }[] }[]>;
}

/** The structural Cordis context this adapter needs. Every member is optional. */
export interface ConflictServiceContext {
  on?(event: string, listener: (...args: any[]) => unknown): (() => void) | void;
  emit?(event: string, payload: unknown): void;
  get?(name: string): unknown;
  tools?: ToolsLike;
  pluginManager?: PluginManagerLike;
  dispose?(callback: () => void): void;
  provide?(name: string, value: unknown): void;
}

/** One claim as the collector returns it: the owner sits on the claim here. */
export type CollectedClaim = ConflictClaimInput & { owner: string };

export interface ConflictServiceOptions {
  platform?: string;
  hostVersion?: string;
  knownEvents?: string[];
  maxClaims?: number;
  /**
   * Replaces the default host-reading collector. The default reads
   * `ctx.tools.definitions()` (one `tool` claim each) and
   * `ctx.pluginManager.listBundles()` rows (one `row` claim each, owned by the
   * bundle module name). Services are not invented: a host service table carries no
   * reverse provider attribution, so claiming one would be a guess.
   */
  collect?: (context: ConflictServiceContext) => Promise<CollectedClaim[]> | CollectedClaim[];
  /** Emit `conflict-resolved` when an id disappears. Defaults to false. */
  emitResolved?: boolean;
}

/** Payload of `conflict-detected`: only ids the previous answer did not contain. */
export interface ConflictDetectedPayload {
  conflicts: ConflictRecord[];
  snapshot: ConflictSnapshot & { delta: { added: ConflictRecord[]; removed: string[] } };
}

/** Payload of `conflict-resolved`, emitted only when `emitResolved` is true. */
export interface ConflictResolvedPayload {
  ids: string[];
  snapshot: ConflictSnapshot & { delta: { added: ConflictRecord[]; removed: string[] } };
}

/** A swallowed adapter error: collector, subscriber or emit. Never thrown at the host. */
export interface ConflictServiceError {
  stage: 'collect' | 'subscribe' | 'refresh' | 'emit' | 'dispose';
  event?: string;
  owner?: string;
  message: string;
}

export interface ConflictService {
  readonly version: string;
  /** Subscribe to the four signals and take the first reading. Idempotent. */
  attach(): ConflictService;
  /** Unsubscribe everything. Idempotent. */
  detach(): ConflictService;
  /** Re-read the collector and re-derive. Concurrent calls share one reading. */
  refresh(): Promise<ConflictSnapshot & { delta: { added: ConflictRecord[]; removed: string[] } }>;
  snapshot(): ConflictSnapshot;
  table(): OccupancyTable;
  conflicts(): ConflictRecord[];
  /** Every claimant of every key, duplicates included — they are the conflict evidence. */
  claims(): ReturnType<ConflictDetector['claims']>;
  claimsOf(kind: OccupancyKind, key: string): ReturnType<ConflictDetector['claimsOf']>;
  /** Add a declaration's claims. The declaration is not validated here. */
  report(
    owner: string,
    declaration: Parameters<ConflictDetector['report']>[1],
    extra?: Parameters<ConflictDetector['report']>[2],
  ): { accepted: number; rejected: number };
  upsert(owner: string, claims: ConflictClaimInput[]): { accepted: number; rejected: number };
  removeOwner(owner: string): number;
  recordFailure(failure: Partial<ConflictFailure> & { owner?: string }): ConflictFailure;
  errors(): ConflictServiceError[];
  /** The engine, for a caller that wants the rule surface directly. */
  readonly detector: ConflictDetector;
  /** Kinds the occupancy table always contains, in order. */
  readonly kinds: readonly OccupancyKind[];
}

/**
 * Create the A1 service. Throws `TypeError` for an unknown option key, a
 * non-function `collect` or a non-boolean `emitResolved`.
 */
export declare function createConflictService(
  context: ConflictServiceContext | null,
  options?: ConflictServiceOptions,
): ConflictService;

/** Cordis plugin name. */
export declare const name: 'dsh-compat-platform-conflicts';

/**
 * Cordis plugin entry: creates the service, attaches it, disposes it with the
 * context and provides it as `compatConflicts` when the context supports `provide`.
 */
export declare function apply(
  context: ConflictServiceContext,
  config?: ConflictServiceOptions,
): ConflictService;
