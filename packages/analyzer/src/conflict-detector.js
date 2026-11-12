/**
 * dsh-compat-platform — the A1 conflict detector: a live occupancy table plus the
 * C1–C11 conflict rules, with no host access of its own.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A *pure* bookkeeping engine. Callers feed it claims — one claim says "this owner
 * occupies this key of this kind" — and it answers:
 *
 *   1. what the occupancy table currently looks like
 *      (`Map<kind, Map<key, {owner, uid}>>`), and
 *   2. which conflicts that table implies, numbered with the platform's C1–C11
 *      taxonomy (`packages/host/src/shared/i18n.js` carries the displayed names).
 *
 * It reads no files, touches no network, imports no DSH module and evaluates no
 * configuration. The event wiring that keeps the table live belongs to
 * `conflict-service.js`, which is a thin adapter over this engine; a test can
 * therefore decide every rule outcome without a host.
 *
 * WHY CLAIMS AND NOT EVENT PAYLOADS
 * ---------------------------------
 * The four events A1 subscribes to do not carry occupancy:
 *
 *   - `plugin-manager/changed(change)` carries only `change.reason`;
 *   - `tools/change()` carries nothing at all;
 *   - `slots/changed(key)` is emitted by the *client* renderer, not the host;
 *   - `internal/status(fiber, oldState)` carries a fiber and its previous state.
 *
 * So the table cannot be derived from the events. The service refreshes it from a
 * collector (and from declarations plugins report), and the events only say *when*
 * to re-read. This module owns the table and the rules, not the reading.
 *
 * OCCUPANCY TABLE SHAPE
 * ---------------------
 * The advertised shape is `Map<kind, Map<key, {owner, uid}>>`. A table that maps
 * one key to exactly one occupant cannot also remember the second occupant of a
 * duplicated key — yet that second occupant is precisely the evidence a conflict
 * needs. The engine therefore keeps two views:
 *
 *   - `table()` returns the advertised resolved view: per key, the claimant with
 *     the smallest `(owner, uid)` in code-unit order. Deterministic, never the
 *     insertion order;
 *   - `claimsOf(kind, key)` and `snapshot().occupancy` retain *every* claimant.
 *
 * A shortcut here would lose attribution, so the duplication is deliberate.
 *
 * WHAT THE RULES ACTUALLY DECIDE
 * ------------------------------
 * Each rule fires only on facts present in the claims (or in the options). Where a
 * rule cannot decide from those facts it adds a *limitation* instead of guessing:
 *
 *   C1  MISSING_DEPENDENCY       a `requires` name no claim provides
 *   C2  DUPLICATE_OCCUPANCY      two claims for one service/row/tool key in one scope
 *   C3  SLOT_KEY_CONFLICT        two claims for one slot key (single-slot upgraded)
 *   C4  WATERFALL_ORDER          two waterfall claims for one key with equal declared order
 *   C5  CONFIG_OVERRIDE_PRECEDENCE  two config claims for one key with equal declared priority
 *   C6  PLATFORM_INCOMPATIBLE    a claim's `platforms` does not name the platform
 *   C7  HOST_VERSION_DRIFT       a claim's `hostRange` rejects the host version
 *   C8  DISPOSE_RACE             an owner was removed and a live claim still needs what it provided
 *   C9  NAMESPACE_POLLUTION      a key outside the grammar, or a reserved prefix
 *   C10 EVENT_STRING_MISUSE      a subscribed event name is a near miss of a known one
 *   C11 PACKAGE_STRUCTURE_INVALID  a claim the engine had to reject, or a shared uid
 *
 * C4 and C5 need a declared order/priority on both sides: an undeclared value is
 * *unknown*, not zero, so those rules report a limitation instead of deciding.
 *
 * C1's requirement vocabulary is *exact*: a claim provides `service:<key>`,
 * `tool:<key>` or `slot:<key>` (plus any `provides` string it lists), and the
 * `svc:` alias of a service key is accepted because the protocol's capability
 * examples use that spelling. Nothing else is inferred.
 *
 * @packageDocumentation
 */

/** Version of the snapshot document this module produces. */
export const CONFLICT_DETECTOR_VERSION = 'conflict-detector/0.1-draft.1';

/** The closed C1–C11 taxonomy, in numeric order. */
export const CONFLICT_CODES = Object.freeze([
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
]);

/** Machine name of each conflict code. The code is what crosses process boundaries. */
export const CONFLICT_TYPES = Object.freeze({
  C1: 'MISSING_DEPENDENCY',
  C2: 'DUPLICATE_OCCUPANCY',
  C3: 'SLOT_KEY_CONFLICT',
  C4: 'WATERFALL_ORDER',
  C5: 'CONFIG_OVERRIDE_PRECEDENCE',
  C6: 'PLATFORM_INCOMPATIBLE',
  C7: 'HOST_VERSION_DRIFT',
  C8: 'DISPOSE_RACE',
  C9: 'NAMESPACE_POLLUTION',
  C10: 'EVENT_STRING_MISUSE',
  C11: 'PACKAGE_STRUCTURE_INVALID',
});

/** Closed severity set, ordered from most to least urgent. */
export const CONFLICT_SEVERITIES = Object.freeze(['blocker', 'high', 'medium', 'low']);

/**
 * Default severity per code. A rule may raise its own record's severity (C3 raises
 * a single-slot conflict to `blocker`); it never lowers it below this floor.
 */
export const DEFAULT_SEVERITY = Object.freeze({
  C1: 'high',
  C2: 'blocker',
  C3: 'high',
  C4: 'medium',
  C5: 'medium',
  C6: 'high',
  C7: 'high',
  C8: 'high',
  C9: 'medium',
  C10: 'medium',
  C11: 'high',
});

/** Occupancy kinds this engine understands. Anything else is rejected as C11. */
export const OCCUPANCY_KINDS = Object.freeze(['service', 'tool', 'slot', 'row', 'waterfall', 'config', 'event']);

/** Facts this engine cannot establish from a claim, reported instead of guessed. */
export const CONFLICT_LIMITATIONS = Object.freeze({
  HOST_VERSION_UNKNOWN: 'HOST_VERSION_UNKNOWN',
  HOST_RANGE_UNCHECKED: 'HOST_RANGE_UNCHECKED',
  PLATFORM_UNKNOWN: 'PLATFORM_UNKNOWN',
  EVENT_CATALOG_UNAVAILABLE: 'EVENT_CATALOG_UNAVAILABLE',
  EVENT_NOT_IN_CATALOG: 'EVENT_NOT_IN_CATALOG',
  REQUIREMENT_MATCHING_IS_EXACT: 'REQUIREMENT_MATCHING_IS_EXACT',
  WATERFALL_ORDER_UNKNOWN: 'WATERFALL_ORDER_UNKNOWN',
  CONFIG_PRIORITY_UNKNOWN: 'CONFIG_PRIORITY_UNKNOWN',
});

/** Options `createConflictDetector` accepts. Unknown keys are a caller bug (TypeError). */
const OPTION_KEYS = Object.freeze(['platform', 'hostVersion', 'knownEvents', 'maxClaims']);

/** `svc:` is the capability spelling used by the protocol's examples. */
const CAPABILITY_ALIASES = Object.freeze({
  service: ['service:', 'svc:'],
  tool: ['tool:'],
  slot: ['slot:'],
});

/** Keys this grammar refuses. Namespacing rules are a separate, stricter check (C9). */
// A key is a plugin-authored name, so the grammar is deliberately narrow — but it must accept the
// npm scope form, because a host service key is a package name: `@deepseek-ai/dsh-tools` is the
// service a DSH plugin injects, and rejecting it here made C7 unreachable and reported C9 instead.
const KEY_GRAMMAR = /^@?[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

/** Prefixes that belong to the platform, not to a plugin, unless the claim acknowledges it. */
const RESERVED_PREFIXES = Object.freeze(['dsh.', '@deepseek-ai/', 'node:']);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Deterministic ordering by UTF-16 code units: no locale collation anywhere. */
function compareStrings(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(strings) {
  return [...new Set(strings)].sort(compareStrings);
}

function ownerOrder(claim) {
  const uid = claim.uid === null ? -1 : claim.uid;
  return [String(claim.owner), uid];
}

function compareOwners(left, right) {
  const byOwner = compareStrings(left.owner, right.owner);
  if (byOwner !== 0) return byOwner;
  const leftUid = left.uid === null ? -1 : left.uid;
  const rightUid = right.uid === null ? -1 : right.uid;
  return leftUid - rightUid;
}

function normalizeStringArray(value, field, problems) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push({ field, reason: `expected string[], got ${describeValue(value)}` });
    return [];
  }
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      problems.push({ field, reason: `expected non-empty string, got ${describeValue(entry)}` });
      continue;
    }
    result.push(entry);
  }
  return sortedUnique(result);
}

function normalizeOptionalNumber(value, field, problems) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push({ field, reason: `expected finite number, got ${describeValue(value)}` });
    return null;
  }
  return value;
}

/**
 * Normalize one claim. Returns `{ok: true, claim}` or `{ok: false, field, reason}`.
 * A rejected claim becomes a C11 record; it never disappears silently.
 */
function normalizeClaim(raw, owner, index) {
  if (!isPlainObject(raw)) {
    return { ok: false, field: `claims[${index}]`, reason: `expected object, got ${describeValue(raw)}` };
  }
  const problems = [];

  const kind = raw.kind;
  if (typeof kind !== 'string' || !OCCUPANCY_KINDS.includes(kind)) {
    problems.push({ field: 'kind', reason: `not one of ${OCCUPANCY_KINDS.join(', ')}` });
  }

  const key = raw.key;
  if (typeof key !== 'string' || key.trim().length === 0 || key !== key.trim()) {
    problems.push({ field: 'key', reason: 'expected a non-empty string without surrounding whitespace' });
  }

  let uid = raw.uid === undefined ? null : raw.uid;
  if (uid !== null && (!Number.isInteger(uid) || uid < 0)) {
    problems.push({ field: 'uid', reason: `expected a non-negative integer or null, got ${describeValue(uid)}` });
    uid = null;
  }

  const scope = raw.scope === undefined || raw.scope === null ? 'global' : raw.scope;
  if (typeof scope !== 'string' || scope.length === 0) {
    problems.push({ field: 'scope', reason: `expected a non-empty string, got ${describeValue(scope)}` });
  }

  const platforms = normalizeStringArray(raw.platforms, 'platforms', problems);
  const requires = normalizeStringArray(raw.requires, 'requires', problems);
  const provides = normalizeStringArray(raw.provides, 'provides', problems);
  const events = normalizeStringArray(raw.events, 'events', problems);

  const hostRange = raw.hostRange === undefined || raw.hostRange === null ? null : raw.hostRange;
  if (hostRange !== null && (typeof hostRange !== 'string' || hostRange.trim().length === 0)) {
    problems.push({ field: 'hostRange', reason: `expected a non-empty string, got ${describeValue(hostRange)}` });
  }

  const slotMode = raw.slotMode === undefined || raw.slotMode === null ? null : raw.slotMode;
  if (slotMode !== null && slotMode !== 'single' && slotMode !== 'keyed') {
    problems.push({ field: 'slotMode', reason: `expected 'single', 'keyed' or null, got ${describeValue(slotMode)}` });
  }

  const disposeKey = raw.disposeKey === undefined || raw.disposeKey === null ? null : raw.disposeKey;
  if (disposeKey !== null && (typeof disposeKey !== 'string' || disposeKey.length === 0)) {
    problems.push({ field: 'disposeKey', reason: `expected a non-empty string, got ${describeValue(disposeKey)}` });
  }

  const order = normalizeOptionalNumber(raw.order, 'order', problems);
  const layerPriority = normalizeOptionalNumber(raw.layerPriority, 'layerPriority', problems);
  const reservedAck = raw.reservedAck === true;

  if (problems.length > 0) {
    const first = problems[0];
    return {
      ok: false,
      field: first.field,
      reason: first.reason,
      problems,
    };
  }

  return {
    ok: true,
    claim: {
      owner,
      uid,
      kind,
      key,
      scope,
      platforms,
      requires,
      provides,
      events,
      hostRange,
      slotMode,
      disposeKey,
      order,
      layerPriority,
      reservedAck,
    },
  };
}

/* ------------------------------------------------------------------ *
 * A deliberately small semver subset.
 * ------------------------------------------------------------------ */

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseVersion(text) {
  const match = VERSION_PATTERN.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Decide one matcher set. Returns null when the syntax is outside the supported
 * subset, so the caller can report a limitation rather than a false verdict.
 */
function parseComparator(token) {
  if (token === '*' || token === 'x' || token === 'X') return { type: 'any' };
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(token);
  if (!match) return null;
  const operator = match[1] || '=';
  const version = parseVersion(match[2]);
  if (!version) return null;

  if (operator === '^') {
    let upper;
    if (version[0] > 0) upper = [version[0] + 1, 0, 0];
    else if (version[1] > 0) upper = [0, version[1] + 1, 0];
    else upper = [0, 0, version[2] + 1];
    return { type: 'range', lower: version, lowerInclusive: true, upper, upperInclusive: false };
  }
  if (operator === '~') {
    const upper = [version[0], version[1] + 1, 0];
    return { type: 'range', lower: version, lowerInclusive: true, upper, upperInclusive: false };
  }
  if (operator === '=') return { type: 'range', lower: version, lowerInclusive: true, upper: version, upperInclusive: true };
  if (operator === '>=') return { type: 'range', lower: version, lowerInclusive: true, upper: null, upperInclusive: false };
  if (operator === '>') return { type: 'range', lower: version, lowerInclusive: false, upper: null, upperInclusive: false };
  if (operator === '<=') return { type: 'range', lower: null, lowerInclusive: false, upper: version, upperInclusive: true };
  if (operator === '<') return { type: 'range', lower: null, lowerInclusive: false, upper: version, upperInclusive: false };
  return null;
}

/**
 * `satisfiesRange('1.2.3', '^1.0.0 || >=2.0.0')`.
 * Returns `null` for a range outside the supported subset (`||`, comparators,
 * caret, tilde, exact, `*`), never a boolean guess.
 */
export function satisfiesRange(version, range) {
  const parsedVersion = parseVersion(String(version));
  if (!parsedVersion) return null;
  if (typeof range !== 'string' || range.trim().length === 0) return null;

  let anySupported = false;
  for (const alternative of range.split('||')) {
    const tokens = alternative.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const comparators = [];
    let supported = true;
    for (const token of tokens) {
      const comparator = parseComparator(token);
      if (!comparator) {
        supported = false;
        break;
      }
      comparators.push(comparator);
    }
    if (!supported) continue;
    anySupported = true;

    const matches = comparators.every((comparator) => {
      if (comparator.type === 'any') return true;
      const { lower, lowerInclusive, upper, upperInclusive } = comparator;
      if (lower) {
        const order = compareVersions(parsedVersion, lower);
        if (order < 0 || (order === 0 && !lowerInclusive)) return false;
      }
      if (upper) {
        const order = compareVersions(parsedVersion, upper);
        if (order > 0 || (order === 0 && !upperInclusive)) return false;
      }
      return true;
    });
    if (matches) return true;
  }
  // No alternative was inside the subset: "unknown", never a false verdict.
  return anySupported ? false : null;
}

/* ------------------------------------------------------------------ *
 * Namespace grammar and event near-miss.
 * ------------------------------------------------------------------ */

function namespaceProblem(claim) {
  const { key, reservedAck } = claim;
  if (!KEY_GRAMMAR.test(key) || key.includes('..')) {
    return 'outside the key grammar [A-Za-z0-9][A-Za-z0-9._:@/-]* without ".."';
  }
  if (!reservedAck) {
    for (const prefix of RESERVED_PREFIXES) {
      if (key.startsWith(prefix)) return `uses the reserved prefix "${prefix}" without reservedAck`;
    }
  }
  return null;
}

/** Levenshtein distance with an early exit above `limit`. */
function editDistanceWithin(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);
  for (let column = 0; column <= right.length; column += 1) previous[column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let best = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (current[column] < best) best = current[column];
    }
    if (best > limit) return limit + 1;
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

function nearestKnownEvent(name, knownEvents) {
  let best = null;
  for (const candidate of knownEvents) {
    if (candidate === name) return { candidate, distance: 0 };
    const distance = editDistanceWithin(name, candidate, 2);
    if (distance <= 2 && (best === null || distance < best.distance || (distance === best.distance && compareStrings(candidate, best.candidate) < 0))) {
      best = { candidate, distance };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

function normalizeOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('createConflictDetector: options must be a plain object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`createConflictDetector: unknown option "${key}"`);
    }
  }

  const platform = options.platform === undefined ? null : options.platform;
  if (platform !== null && (typeof platform !== 'string' || platform.length === 0)) {
    throw new TypeError('createConflictDetector: platform must be a non-empty string when given');
  }

  const hostVersion = options.hostVersion === undefined ? null : options.hostVersion;
  if (hostVersion !== null && (typeof hostVersion !== 'string' || hostVersion.length === 0)) {
    throw new TypeError('createConflictDetector: hostVersion must be a non-empty string when given');
  }

  let knownEvents = null;
  if (options.knownEvents !== undefined) {
    if (!Array.isArray(options.knownEvents) || options.knownEvents.some((name) => typeof name !== 'string' || name.length === 0)) {
      throw new TypeError('createConflictDetector: knownEvents must be an array of non-empty strings');
    }
    knownEvents = sortedUnique(options.knownEvents);
  }

  const maxClaims = options.maxClaims === undefined ? 10000 : options.maxClaims;
  if (!Number.isInteger(maxClaims) || maxClaims <= 0) {
    throw new TypeError('createConflictDetector: maxClaims must be a positive integer');
  }

  return { platform, hostVersion, knownEvents, maxClaims };
}

/* ------------------------------------------------------------------ *
 * The detector
 * ------------------------------------------------------------------ */

/**
 * Create one detector. It holds claims until they are removed or the detector is
 * cleared; `snapshot()` and `conflicts()` re-derive the whole answer on demand,
 * so a caller can never observe a half-updated rule result.
 */
export function createConflictDetector(options = {}) {
  const settings = normalizeOptions(options);

  /** Every accepted claim, keyed by identity so re-reporting is idempotent. */
  const claimsByIdentity = new Map();
  /** Rejected claims, kept as C11 evidence. */
  const rejected = [];
  /** Failures the service observed; the engine never classifies them as a conflict. */
  const failures = [];
  /**
   * Capabilities owners used to provide before they were removed: `owner →
   * capabilities`. Kept so C8 can be re-derived on every read (see `removeOwner`).
   */
  const removedProviders = new Map();

  function identityOf(owner, claim) {
    return JSON.stringify([owner, claim.kind, claim.key, claim.scope]);
  }

  function addClaim(owner, raw, index) {
    const normalized = normalizeClaim(raw, owner, index);
    if (!normalized.ok) {
      rejected.push({
        owner,
        kind: typeof raw?.kind === 'string' ? raw.kind : null,
        key: typeof raw?.key === 'string' ? raw.key : null,
        field: normalized.field,
        reason: normalized.reason,
        problems: normalized.problems,
      });
      return { ok: false };
    }
    const identity = identityOf(owner, normalized.claim);
    // Identity is (owner, kind, key, scope): the same claim twice is a no-op, while a
    // claim whose other fields changed replaces its predecessor. Keeping the first
    // version would silently pin stale metadata to a live key.
    claimsByIdentity.set(identity, normalized.claim);
    return { ok: true };
  }

  /**
   * Add or replace one owner's claims. Replacement is per claim identity
   * `(owner, kind, key, scope)`: reporting the same claim twice is a no-op, and
   * reporting a changed claim overwrites the previous one for that identity.
   * Claims belonging to the owner that this call does not mention are left alone —
   * use `removeOwner` to drop a whole owner.
   */
  function upsert(owner, rawClaims) {
    if (typeof owner !== 'string' || owner.trim().length === 0) {
      throw new TypeError('conflict detector: owner must be a non-empty string');
    }
    if (!Array.isArray(rawClaims)) {
      throw new TypeError('conflict detector: claims must be an array');
    }
    if (claimsByIdentity.size + rawClaims.length > settings.maxClaims) {
      throw new RangeError(`conflict detector: claim limit ${settings.maxClaims} exceeded`);
    }

    let accepted = 0;
    let rejectedCount = 0;
    rawClaims.forEach((raw, index) => {
      const before = rejected.length;
      const result = addClaim(owner, raw, index);
      if (result.ok) accepted += 1;
      else rejectedCount += rejected.length - before;
    });
    return { accepted, rejected: rejectedCount };
  }

  /**
   * Add the claims a protocol declaration implies. Resources become claims of
   * their own kind keyed by `name`; `capabilities.required` becomes the claim's
   * `requires` on a synthetic `service` claim only when the caller asks for it —
   * a declaration has no single place to hang requirements, so the caller passes
   * them in `extra`.
   *
   * The declaration is *not* validated here: the spec validator decides validity,
   * exactly as in `analyze()`. This method only reads `resources[]`.
   */
  function report(owner, declaration, extra = {}) {
    if (!isPlainObject(declaration)) {
      throw new TypeError('conflict detector: declaration must be an object');
    }
    if (!isPlainObject(extra)) {
      throw new TypeError('conflict detector: extra must be an object');
    }
    const resources = Array.isArray(declaration.resources) ? declaration.resources : [];
    const requirements = extra.requires ?? declaration.capabilities?.required ?? [];

    const claims = resources.map((resource, index) => {
      if (!isPlainObject(resource)) {
        // Surface it as a rejected claim rather than throwing: a malformed
        // declaration is a finding, not a caller bug.
        return { kind: resource, key: resource };
      }
      const claim = {
        kind: resource.kind,
        key: resource.name,
        scope: resource.scope,
        requires: index === 0 ? requirements : [],
        platforms: extra.platforms,
        hostRange: extra.hostRange,
        provides: index === 0 ? extra.provides : [],
        events: extra.events,
      };
      return claim;
    });

    if (claims.length === 0 && (requirements.length > 0 || (extra.provides ?? []).length > 0 || (extra.events ?? []).length > 0)) {
      claims.push({
        kind: 'service',
        key: typeof declaration.plugin?.id === 'string' ? declaration.plugin.id : owner,
        scope: 'declaration',
        requires: requirements,
        provides: extra.provides,
        events: extra.events,
        platforms: extra.platforms,
        hostRange: extra.hostRange,
      });
    }

    return upsert(owner, claims.map((claim) => ({
      ...claim,
      uid: extra.uid,
      requires: claim.requires ?? [],
      provides: claim.provides ?? [],
      events: claim.events ?? [],
    })));
  }

  /**
   * Drop every claim of one owner, remembering what it used to provide.
   *
   * The removal itself is just bookkeeping; what makes it interesting is that a
   * dependent may still `requires` a capability this owner provided. That is C8, and
   * it is *derived*, not stored as an event: the race is reported while a live claim
   * needs the capability, nothing provides it any more, and the removed owner was
   * the last thing that did. When the dependent goes away — or something starts
   * providing the capability again — the conflict disappears without any cleanup
   * call, which is what keeps the answer a pure function of current state.
   */
  function removeOwner(owner) {
    if (typeof owner !== 'string' || owner.trim().length === 0) {
      throw new TypeError('conflict detector: owner must be a non-empty string');
    }
    const owned = [...claimsByIdentity.values()].filter((claim) => claim.owner === owner);

    const capabilities = new Set();
    for (const claim of owned) {
      for (const capability of capabilityIds(claim)) capabilities.add(capability);
    }
    if (capabilities.size > 0) {
      const previous = removedProviders.get(owner) ?? new Set();
      for (const capability of capabilities) previous.add(capability);
      removedProviders.set(owner, previous);
    }

    for (const [identity, claim] of claimsByIdentity) {
      if (claim.owner === owner) claimsByIdentity.delete(identity);
    }

    return claimsByIdentity.size;
  }

  /** Record one observed fiber failure. Never turned into a conflict by itself. */
  function recordFailure(failure) {
    if (!isPlainObject(failure)) throw new TypeError('conflict detector: failure must be an object');
    const owner = typeof failure.owner === 'string' && failure.owner.length > 0 ? failure.owner : 'unknown';
    const entry = {
      owner,
      uid: Number.isInteger(failure.uid) && failure.uid >= 0 ? failure.uid : null,
      state: typeof failure.state === 'string' ? failure.state : 'FAILED',
      message: typeof failure.message === 'string' ? failure.message : null,
      at: typeof failure.at === 'string' ? failure.at : null,
    };
    if (!failures.some((existing) => JSON.stringify(existing) === JSON.stringify(entry))) failures.push(entry);
    return entry;
  }

  function clear() {
    claimsByIdentity.clear();
    rejected.length = 0;
    failures.length = 0;
    removedProviders.clear();
  }

  function claims() {
    return [...claimsByIdentity.values()].sort((left, right) => {
      const byKind = compareStrings(left.kind, right.kind);
      if (byKind !== 0) return byKind;
      const byKey = compareStrings(left.key, right.key);
      if (byKey !== 0) return byKey;
      const byScope = compareStrings(left.scope, right.scope);
      if (byScope !== 0) return byScope;
      return compareOwners(left, right);
    });
  }

  function claimsOf(kind, key) {
    return claims().filter((claim) => claim.kind === kind && claim.key === key);
  }

  /**
   * The advertised resolved view: per key, the claimant with the smallest
   * `(owner, uid)` in code-unit order. Every kind is present even when empty, so a
   * reader never has to distinguish "no such kind" from "no occupant".
   */
  function table() {
    const result = new Map();
    for (const kind of OCCUPANCY_KINDS) result.set(kind, new Map());
    for (const claim of claims()) {
      const byKey = result.get(claim.kind);
      if (!byKey.has(claim.key)) byKey.set(claim.key, { owner: claim.owner, uid: claim.uid });
    }
    return result;
  }

  function capabilityIds(claim) {
    const ids = [];
    for (const prefix of CAPABILITY_ALIASES[claim.kind] ?? []) ids.push(prefix + claim.key);
    for (const provided of claim.provides) ids.push(provided);
    return ids;
  }

  function detect() {
    const all = claims();
    const conflicts = [];
    const limitations = new Set();
    const provided = new Set();
    for (const claim of all) for (const id of capabilityIds(claim)) provided.add(id);

    /* C8 — a capability the last provider took away, still required by a live claim.
     *
     * Derived here rather than stored at removal time: the same capability is a race
     * only while nothing provides it. Once the dependent goes away, or a new owner
     * provides the capability, this stops being true and the record disappears. */
    const removedCapabilities = new Map();
    for (const [owner, capabilities] of removedProviders) {
      for (const capability of capabilities) {
        if (provided.has(capability)) continue;
        const dependents = all.filter((claim) => claim.requires.includes(capability));
        if (dependents.length === 0) continue;
        for (const dependent of dependents) {
          conflicts.push(
            makeConflict({
              code: 'C8',
              kind: dependent.kind,
              key: dependent.key,
              owners: [
                { owner, uid: null },
                { owner: dependent.owner, uid: dependent.uid },
              ],
              detail: { removed: owner, dependent: dependent.owner, requirement: capability },
            }),
          );
        }
        removedCapabilities.set(capability, owner);
      }
    }
    if (removedCapabilities.size > 0) {
      limitations.add(CONFLICT_LIMITATIONS.REQUIREMENT_MATCHING_IS_EXACT);
    }

    /* C1 — a requirement no claim provides. A requirement whose provider was removed
     * is C8 above: reporting it as C1 as well would name the same fact twice with a
     * less specific diagnosis. */
    if (all.some((claim) => claim.requires.length > 0)) {
      limitations.add(CONFLICT_LIMITATIONS.REQUIREMENT_MATCHING_IS_EXACT);
    }
    for (const claim of all) {
      for (const requirement of claim.requires) {
        if (provided.has(requirement)) continue;
        if (removedCapabilities.has(requirement)) continue;
        conflicts.push(
          makeConflict({
            code: 'C1',
            kind: claim.kind,
            key: claim.key,
            owners: [{ owner: claim.owner, uid: claim.uid }],
            detail: { requirement },
          }),
        );
      }
    }

    /* Group by (kind, key, scope) for C2/C3/C4/C5. */
    const groups = new Map();
    for (const claim of all) {
      const groupKey = JSON.stringify([claim.kind, claim.key, claim.scope]);
      const bucket = groups.get(groupKey);
      if (bucket) bucket.push(claim);
      else groups.set(groupKey, [claim]);
    }

    for (const bucket of groups.values()) {
      const [first] = bucket;
      if (bucket.length < 2) continue;

      if (first.kind === 'slot') {
        const single = bucket.some((claim) => claim.slotMode === 'single');
        conflicts.push(
          makeConflict({
            code: 'C3',
            kind: 'slot',
            key: first.key,
            severity: single ? 'blocker' : DEFAULT_SEVERITY.C3,
            owners: bucket.map((claim) => ({ owner: claim.owner, uid: claim.uid })),
            detail: { scope: first.scope, slotMode: single ? 'single' : 'keyed' },
          }),
        );
        continue;
      }

      if (first.kind === 'service' || first.kind === 'row' || first.kind === 'tool') {
        conflicts.push(
          makeConflict({
            code: 'C2',
            kind: first.kind,
            key: first.key,
            severity: first.kind === 'tool' ? 'high' : DEFAULT_SEVERITY.C2,
            owners: bucket.map((claim) => ({ owner: claim.owner, uid: claim.uid })),
            detail: { scope: first.scope },
          }),
        );
        continue;
      }

      if (first.kind === 'waterfall') {
        // A missing order is not "order 0": two claims with no declared order have
        // an *unknown* relative position, so C4 cannot decide and says so.
        if (bucket.some((claim) => claim.order === null)) {
          limitations.add(CONFLICT_LIMITATIONS.WATERFALL_ORDER_UNKNOWN);
          continue;
        }
        const orders = new Set(bucket.map((claim) => String(claim.order)));
        if (orders.size === 1) {
          conflicts.push(
            makeConflict({
              code: 'C4',
              kind: 'waterfall',
              key: first.key,
              owners: bucket.map((claim) => ({ owner: claim.owner, uid: claim.uid })),
              detail: { order: bucket[0].order, scope: first.scope },
            }),
          );
        }
        continue;
      }

      if (first.kind === 'config') {
        // As with C4: an undeclared layer priority is unknown, not zero.
        if (bucket.some((claim) => claim.layerPriority === null)) {
          limitations.add(CONFLICT_LIMITATIONS.CONFIG_PRIORITY_UNKNOWN);
          continue;
        }
        const priorities = bucket
          .map((claim) => claim.layerPriority)
          .sort((left, right) => right - left);
        if (priorities[0] === priorities[1]) {
          conflicts.push(
            makeConflict({
              code: 'C5',
              kind: 'config',
              key: first.key,
              owners: bucket.map((claim) => ({ owner: claim.owner, uid: claim.uid })),
              detail: { layerPriority: priorities[0], scope: first.scope },
            }),
          );
        }
      }
    }

    /* C6, C7, C9, C10 — per claim against the environment options. */
    for (const claim of all) {
      if (claim.platforms.length > 0) {
        if (settings.platform === null) {
          limitations.add(CONFLICT_LIMITATIONS.PLATFORM_UNKNOWN);
        } else if (!claim.platforms.includes(settings.platform)) {
          conflicts.push(
            makeConflict({
              code: 'C6',
              kind: claim.kind,
              key: claim.key,
              owners: [{ owner: claim.owner, uid: claim.uid }],
              detail: { supported: claim.platforms, platform: settings.platform },
            }),
          );
        }
      }

      if (claim.hostRange !== null) {
        if (settings.hostVersion === null) {
          limitations.add(CONFLICT_LIMITATIONS.HOST_VERSION_UNKNOWN);
        } else {
          const satisfied = satisfiesRange(settings.hostVersion, claim.hostRange);
          if (satisfied === null) limitations.add(CONFLICT_LIMITATIONS.HOST_RANGE_UNCHECKED);
          else if (!satisfied) {
            conflicts.push(
              makeConflict({
                code: 'C7',
                kind: claim.kind,
                key: claim.key,
                owners: [{ owner: claim.owner, uid: claim.uid }],
                detail: { hostVersion: settings.hostVersion, hostRange: claim.hostRange },
              }),
            );
          }
        }
      }

      const namespace = namespaceProblem(claim);
      if (namespace !== null) {
        conflicts.push(
          makeConflict({
            code: 'C9',
            kind: claim.kind,
            key: claim.key,
            owners: [{ owner: claim.owner, uid: claim.uid }],
            detail: { reason: namespace },
          }),
        );
      }

      if (claim.events.length > 0) {
        if (settings.knownEvents === null) {
          limitations.add(CONFLICT_LIMITATIONS.EVENT_CATALOG_UNAVAILABLE);
        } else {
          for (const name of claim.events) {
            if (settings.knownEvents.includes(name)) continue;
            const near = nearestKnownEvent(name, settings.knownEvents);
            if (near) {
              conflicts.push(
                makeConflict({
                  code: 'C10',
                  kind: claim.kind,
                  key: claim.key,
                  owners: [{ owner: claim.owner, uid: claim.uid }],
                  detail: { event: name, nearMiss: near.candidate, distance: near.distance },
                }),
              );
            } else {
              limitations.add(CONFLICT_LIMITATIONS.EVENT_NOT_IN_CATALOG);
            }
          }
        }
      }
    }

    /* C11 — claims the engine rejected, and one uid claimed by two owners. */
    for (const problem of rejected) {
      conflicts.push(
        makeConflict({
          code: 'C11',
          kind: problem.kind ?? 'unknown',
          key: problem.key ?? 'unknown',
          owners: [{ owner: problem.owner, uid: null }],
          detail: { field: problem.field, reason: problem.reason },
        }),
      );
    }

    const claimsByUid = new Map();
    for (const claim of all) {
      if (claim.uid === null) continue;
      const bucket = claimsByUid.get(claim.uid) ?? [];
      bucket.push(claim);
      claimsByUid.set(claim.uid, bucket);
    }
    for (const [uid, bucket] of claimsByUid) {
      const owners = sortedUnique(bucket.map((claim) => claim.owner));
      if (owners.length < 2) continue;
      conflicts.push(
        makeConflict({
          code: 'C11',
          kind: bucket[0].kind,
          key: bucket[0].key,
          severity: 'high',
          owners: bucket.map((claim) => ({ owner: claim.owner, uid })),
          detail: { reason: `uid ${uid} is claimed by ${owners.length} owners` },
        }),
      );
    }


    return {
      conflicts: sortConflicts(conflicts),
      limitations: [...limitations].sort(compareStrings),
    };
  }

  function conflicts() {
    return detect().conflicts;
  }

  /** A deterministic, JSON-serializable projection. Maps are not JSON. */
  function snapshot() {
    const { conflicts: found, limitations } = detect();
    const occupancy = {};
    for (const kind of OCCUPANCY_KINDS) occupancy[kind] = [];
    const byKey = table();
    for (const kind of OCCUPANCY_KINDS) {
      for (const [key, occupant] of byKey.get(kind)) {
        occupancy[kind].push({ key, owner: occupant.owner, uid: occupant.uid });
      }
    }
    return {
      version: CONFLICT_DETECTOR_VERSION,
      platform: settings.platform,
      hostVersion: settings.hostVersion,
      occupancy,
      conflicts: found,
      limitations,
      failures: [...failures].sort((left, right) => compareStrings(left.owner, right.owner)),
      totals: {
        claims: claimsByIdentity.size,
        rejected: rejected.length,
        conflicts: found.length,
      },
    };
  }

  return {
    options: { ...settings, knownEvents: settings.knownEvents === null ? null : [...settings.knownEvents] },
    upsert,
    report,
    removeOwner,
    recordFailure,
    clear,
    claims,
    claimsOf,
    table,
    conflicts,
    snapshot,
  };
}

/** One conflict record. The id is a stable content key, not a counter. */
function makeConflict({ code, kind, key, owners, severity, detail }) {
  if (!CONFLICT_CODES.includes(code)) throw new TypeError(`unknown conflict code ${code}`);
  const normalizedOwners = [...owners].sort(compareOwners).map((owner) => ({ owner: owner.owner, uid: owner.uid ?? null }));
  const ownerKey = normalizedOwners.map((owner) => `${owner.owner}#${owner.uid === null ? '-' : owner.uid}`).join(',');
  const id = `${code}|${kind}|${key}|${ownerKey}`;
  return Object.freeze({
    id,
    code,
    type: CONFLICT_TYPES[code],
    severity: severity ?? DEFAULT_SEVERITY[code],
    kind,
    key,
    owners: Object.freeze(normalizedOwners),
    detail: Object.freeze({ ...(detail ?? {}) }),
    summary: summarize(code, kind, key, normalizedOwners, detail ?? {}),
  });
}

function summarize(code, kind, key, owners, detail) {
  const names = owners.map((owner) => owner.owner).join(', ');
  switch (code) {
    case 'C1':
      return `"${key}" requires "${detail.requirement}", which no occupant provides`;
    case 'C2':
      return `${kind} key "${key}" is claimed by ${names}`;
    case 'C3':
      return `slot key "${key}" is claimed by ${names} (${detail.slotMode})`;
    case 'C4':
      return `waterfall "${key}" has ${owners.length} claimants at the same order (${detail.order})`;
    case 'C5':
      return `config key "${key}" has ${owners.length} claimants at layer priority ${detail.layerPriority}`;
    case 'C6':
      return `"${key}" does not support platform "${detail.platform}" (supports ${detail.supported.join(', ')})`;
    case 'C7':
      return `"${key}" requires host ${detail.hostRange}, running ${detail.hostVersion}`;
    case 'C8':
      return `"${detail.requirement}" was provided by ${detail.removed}, still required by ${detail.dependent}`;
    case 'C9':
      return `key "${key}" ${detail.reason}`;
    case 'C10':
      return `event "${detail.event}" is not a known event; nearest is "${detail.nearMiss}"`;
    case 'C11':
    default:
      return `claim for "${key}" is invalid: ${detail.reason}`;
  }
}

function sortConflicts(conflicts) {
  const codeOrder = new Map(CONFLICT_CODES.map((code, index) => [code, index]));
  return conflicts.sort((left, right) => {
    const byCode = codeOrder.get(left.code) - codeOrder.get(right.code);
    if (byCode !== 0) return byCode;
    const byKind = compareStrings(left.kind, right.kind);
    if (byKind !== 0) return byKind;
    const byKey = compareStrings(left.key, right.key);
    if (byKey !== 0) return byKey;
    return compareStrings(left.id, right.id);
  });
}
