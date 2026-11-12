/**
 * dsh-compat-platform — A1 as a host service: the live occupancy table.
 *
 * WHAT THIS ADAPTER DOES
 * ----------------------
 * `conflict-detector.js` owns the table and the C1–C11 rules. This module owns the
 * part that needs a host:
 *
 *   - it subscribes to the four change signals DSH already emits,
 *   - it keeps the table current by re-reading a *collector* (never by trusting an
 *     event payload, see below),
 *   - it emits `conflict-detected` when a conflict id appears that the previous
 *     answer did not contain, and optionally `conflict-resolved` when one goes away.
 *
 * WHY EVENTS ARE ONLY A TRIGGER
 * -----------------------------
 * None of the four events carries occupancy:
 *
 *   - `plugin-manager/changed(change)` — `change` is `{reason}` only;
 *   - `tools/change()` — no arguments;
 *   - `slots/changed(key)` — a *client* renderer event, forwarded where available;
 *   - `internal/status(fiber, oldValue)` — a fiber and its previous state.
 *
 * Deriving the table from those payloads is therefore impossible in principle. An
 * event means "something moved, re-read"; the collector supplies the facts. A
 * deployment with no collector still works: plugins report their own claims via
 * `report()`/`upsert()`, and events merely refresh the derived answer.
 *
 * FAILURES ARE NOT CONFLICTS
 * --------------------------
 * A fiber reaching `FAILED` is recorded in the snapshot's `failures` list. It is
 * not a C1–C11 conflict: the taxonomy names declaration and co-tenancy problems,
 * and calling a crash "C1 missing dependency" would be a fabricated attribution.
 *
 * @packageDocumentation
 */

import { createConflictDetector, OCCUPANCY_KINDS } from './conflict-detector.js';

/** Service document version. */
export const CONFLICT_SERVICE_VERSION = 'conflict-service/0.1-draft.1';

/** Event names this service emits. */
export const CONFLICT_EVENTS = Object.freeze({
  DETECTED: 'conflict-detected',
  RESOLVED: 'conflict-resolved',
});

/** The host events this service listens to, exactly as DSH spells them. */
export const OCCUPANCY_SIGNALS = Object.freeze([
  'plugin-manager/changed',
  'tools/change',
  'slots/changed',
  'internal/status',
]);

/** `FiberState.FAILED` / `.DISPOSED` from @deepseek-ai/dsh-fiber's numeric const enum. */
const FIBER_STATE_FAILED = 3;
const FIBER_STATE_DISPOSED = 4;

const OPTION_KEYS = Object.freeze([
  'platform',
  'hostVersion',
  'knownEvents',
  'maxClaims',
  'collect',
  'emitResolved',
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeServiceOptions(options) {
  if (!isPlainObject(options)) throw new TypeError('createConflictService: options must be a plain object');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) throw new TypeError(`createConflictService: unknown option "${key}"`);
  }
  const { collect, emitResolved, ...detectorOptions } = options;
  if (collect !== undefined && typeof collect !== 'function') {
    throw new TypeError('createConflictService: collect must be an async function when given');
  }
  if (emitResolved !== undefined && typeof emitResolved !== 'boolean') {
    throw new TypeError('createConflictService: emitResolved must be a boolean when given');
  }
  return { detectorOptions, collect: collect ?? null, emitResolved: emitResolved === true };
}

/** Read a service off a Cordis context without assuming this Cordis build. */
function serviceOf(ctx, name) {
  if (!ctx) return null;
  if (typeof ctx.get === 'function') {
    try {
      const found = ctx.get(name);
      if (found) return found;
    } catch {
      // A missing optional service is not an error here.
    }
  }
  return ctx[name] ?? null;
}

/**
 * The default collector: what the host can tell us without plugin cooperation.
 *
 * It reads two real host surfaces and nothing else:
 *   - `ctx.tools.definitions()` → one `tool` claim per registered tool name;
 *   - `ctx.pluginManager.listBundles()` → one `row` claim per bundle row, owned by
 *     the bundle's module name, which is what makes a duplicated `rowId` across
 *     bundles a C2 conflict.
 *
 * Services are *not* invented here: a host service table carries no reverse
 * "which plugin provides this" attribution, so claiming one would be a guess. A
 * plugin that wants its services in the table reports them itself.
 */
async function defaultCollect(ctx) {
  const claims = [];

  const tools = serviceOf(ctx, 'tools');
  if (tools && typeof tools.definitions === 'function') {
    const definitions = await tools.definitions();
    for (const definition of Array.isArray(definitions) ? definitions : []) {
      const name = typeof definition?.name === 'string' ? definition.name : null;
      if (!name) continue;
      claims.push({ owner: 'host:tools', kind: 'tool', key: name, scope: 'global' });
    }
  }

  const manager = serviceOf(ctx, 'pluginManager');
  if (manager && typeof manager.listBundles === 'function') {
    const bundles = await manager.listBundles();
    for (const bundle of Array.isArray(bundles) ? bundles : []) {
      const owner = typeof bundle?.moduleName === 'string' ? bundle.moduleName : null;
      if (!owner) continue;
      const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
      for (const row of rows) {
        const rowId = typeof row?.rowId === 'string' ? row.rowId : null;
        if (!rowId) continue;
        claims.push({ owner, kind: 'row', key: rowId, scope: 'bundle' });
      }
    }
  }

  return claims;
}

/**
 * Create the A1 service. Call `attach()` (or use it as a Cordis plugin through
 * `apply()`) to subscribe and take the first reading.
 *
 * Returned surface:
 *   - `refresh()` — re-read the collector and re-derive; resolves to the snapshot;
 *   - `snapshot()` — the current deterministic projection, collector-free;
 *   - `table()` — `Map<kind, Map<key, {owner, uid}>>`;
 *   - `report(owner, declaration, extra)` / `upsert(owner, claims)` — plugin-reported claims;
 *   - `removeOwner(owner)` — drops an owner and records a C8 race if a dependent needs it;
 *   - `detach()` — unsubscribes every host event.
 */
export function createConflictService(ctx, options = {}) {
  const { detectorOptions, collect: configuredCollect, emitResolved } = normalizeServiceOptions(options);
  const detector = createConflictDetector(detectorOptions);
  // The host-reading collector is the default: an event with nothing listening to
  // what the host knows would refresh an empty table forever.
  const collect = configuredCollect ?? (() => defaultCollect(ctx));

  /** Ids emitted by the previous derived answer. */
  let emitted = new Set();
  /** Claims a collector produced on the previous refresh, so a re-read can replace them. */
  let collectedOwners = new Set();
  let inflight = null;
  let disposers = [];
  let attached = false;
  const errors = [];

  function currentIds() {
    return new Set(detector.conflicts().map((conflict) => conflict.id));
  }

  function diffAndEmit(snapshot) {
    const next = new Set(snapshot.conflicts.map((conflict) => conflict.id));
    const added = snapshot.conflicts.filter((conflict) => !emitted.has(conflict.id));
    const removed = [...emitted].filter((id) => !next.has(id));
    emitted = next;

    // The payload carries the same delta the caller sees, so a listener that only
    // reads the event (and never calls refresh) still knows what just changed.
    const answer = { ...snapshot, delta: { added, removed } };
    if (added.length > 0) emit(CONFLICT_EVENTS.DETECTED, { conflicts: added, snapshot: answer });
    if (emitResolved && removed.length > 0) emit(CONFLICT_EVENTS.RESOLVED, { ids: removed, snapshot: answer });
    return { added, removed };
  }

  function emit(event, payload) {
    if (typeof ctx?.emit !== 'function') return;
    try {
      ctx.emit(event, payload);
    } catch (error) {
      errors.push({ stage: 'emit', event, message: String(error?.message ?? error) });
    }
  }

  async function runRefresh() {
    if (collect) {
      let claims = [];
      try {
        claims = await collect();
      } catch (error) {
        errors.push({ stage: 'collect', message: String(error?.message ?? error) });
        claims = [];
      }
      const list = Array.isArray(claims) ? claims : [];
      // Replace only what the collector owned last time: plugin-reported claims
      // must survive a host re-read that knows nothing about them.
      for (const owner of collectedOwners) detector.removeOwner(owner);
      const owners = new Set();
      for (const claim of list) {
        if (!isPlainObject(claim) || typeof claim.owner !== 'string') {
          errors.push({ stage: 'collect', message: 'collector returned a claim without a string owner' });
          continue;
        }
        owners.add(claim.owner);
      }
      for (const owner of owners) {
        const owned = list.filter((claim) => claim.owner === owner);
        try {
          detector.upsert(owner, owned.map(({ owner: _owner, ...rest }) => rest));
        } catch (error) {
          errors.push({ stage: 'collect', owner, message: String(error?.message ?? error) });
        }
      }
      collectedOwners = owners;
    }

    const snapshot = detector.snapshot();
    const delta = diffAndEmit(snapshot);
    return { ...snapshot, delta };
  }

  /**
   * Single-flight: concurrent triggers share one reading. Host re-reads are cheap
   * but not free, and a burst of `tools/change` during startup must not fan out
   * into N overlapping readings of the same state.
   */
  function refresh() {
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(runRefresh)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function onEvent(eventName) {
    // The promise is returned so a caller (test, or a host that wants to await a
    // settled view) can tell when the re-read finished; Cordis ignores listener
    // return values, so this costs nothing in production.
    return () =>
      refresh().catch((error) => {
        errors.push({ stage: 'refresh', event: eventName, message: String(error?.message ?? error) });
      });
  }

  function handleInternalStatus(fiber, oldState) {
    const uid = Number.isInteger(fiber?.uid) ? fiber.uid : null;
    const owner = typeof fiber?.name === 'string' && fiber.name.length > 0 ? fiber.name : 'unknown';
    const state = fiber?.state;

    if (state === FIBER_STATE_FAILED && oldState !== FIBER_STATE_FAILED) {
      detector.recordFailure({ owner, uid, state: 'FAILED' });
    }
    if (state === FIBER_STATE_DISPOSED && oldState !== FIBER_STATE_DISPOSED) {
      // A disposed owner can leave a dependent unsupported; the detector decides
      // whether that is a C8 race using the requirements it already holds.
      detector.removeOwner(owner);
    }
    return refresh();
  }

  function attach() {
    if (attached) return service;
    attached = true;
    if (typeof ctx?.on === 'function') {
      for (const eventName of OCCUPANCY_SIGNALS) {
        const handler = eventName === 'internal/status' ? handleInternalStatus : onEvent(eventName);
        try {
          const disposer = ctx.on(eventName, handler);
          if (typeof disposer === 'function') disposers.push(disposer);
        } catch (error) {
          errors.push({ stage: 'subscribe', event: eventName, message: String(error?.message ?? error) });
        }
      }
    }
    refresh().catch((error) => {
      errors.push({ stage: 'refresh', event: 'attach', message: String(error?.message ?? error) });
    });
    return service;
  }

  function detach() {
    for (const disposer of disposers) {
      try {
        disposer();
      } catch (error) {
        errors.push({ stage: 'dispose', message: String(error?.message ?? error) });
      }
    }
    disposers = [];
    attached = false;
    return service;
  }

  const service = {
    version: CONFLICT_SERVICE_VERSION,
    attach,
    detach,
    refresh,
    snapshot: () => detector.snapshot(),
    table: () => detector.table(),
    conflicts: () => detector.conflicts(),
    /** Every claimant of every key — duplicates included, because they are the evidence. */
    claims: () => detector.claims(),
    claimsOf: (kind, key) => detector.claimsOf(kind, key),
    report: (owner, declaration, extra) => {
      const result = detector.report(owner, declaration, extra);
      return result;
    },
    upsert: (owner, claims) => detector.upsert(owner, claims),
    removeOwner: (owner) => detector.removeOwner(owner),
    recordFailure: (failure) => detector.recordFailure(failure),
    /** Errors this adapter swallowed (collector, subscriber, emit). Never thrown at the host. */
    errors: () => [...errors],
    get detector() {
      return detector;
    },
    /** Kinds the occupancy table always contains, in order. */
    kinds: OCCUPANCY_KINDS,
  };

  return service;
}

/**
 * Cordis plugin entry. `tools` and `pluginManager` are optional: without them the
 * service still runs on plugin-reported claims.
 */
export const name = 'dsh-compat-platform-conflicts';

export function apply(ctx, config = {}) {
  const service = createConflictService(ctx, config);
  service.attach();
  if (ctx && typeof ctx.on === 'function') {
    ctx.on('dispose', () => service.detach());
  }
  if (ctx && typeof ctx.provide === 'function') ctx.provide('compatConflicts', service);
  return service;
}
