/**
 * Decision tests for `src/conflict-detector.js` — the pure A1 engine.
 *
 * Each case pins one rule's *decision*, not its wording: which code fires, at which
 * severity, for which claimants, and — just as important — when a rule refuses to
 * decide and reports a limitation instead. The determinism cases exist because the
 * live table feeds a GUI diff: two runs over the same claims in a different
 * insertion order must produce byte-identical snapshots.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFLICT_CODES,
  CONFLICT_DETECTOR_VERSION,
  CONFLICT_LIMITATIONS,
  CONFLICT_SEVERITIES,
  CONFLICT_TYPES,
  DEFAULT_SEVERITY,
  OCCUPANCY_KINDS,
  createConflictDetector,
  satisfiesRange,
} from '../src/conflict-detector.js';

function codes(detector) {
  return detector.conflicts().map((conflict) => conflict.code);
}

function changes(detector, snapshot) {
  return JSON.stringify(snapshot);
}

test('the taxonomy is closed and every code has a type and a severity floor', () => {
  assert.equal(CONFLICT_CODES.length, 11);
  assert.deepEqual(
    [...CONFLICT_CODES],
    ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'],
  );
  assert.deepEqual(Object.keys(CONFLICT_TYPES).sort(), [...CONFLICT_CODES].sort());
  assert.deepEqual(Object.keys(DEFAULT_SEVERITY).sort(), [...CONFLICT_CODES].sort());
  for (const code of CONFLICT_CODES) {
    assert.ok(CONFLICT_SEVERITIES.includes(DEFAULT_SEVERITY[code]), `${code} severity`);
  }
  assert.ok(Object.isFrozen(CONFLICT_CODES));
  assert.ok(Object.isFrozen(CONFLICT_TYPES));
  assert.ok(Object.isFrozen(DEFAULT_SEVERITY));
  assert.ok(Object.isFrozen(OCCUPANCY_KINDS));
  assert.equal(CONFLICT_DETECTOR_VERSION, 'conflict-detector/0.1-draft.1');
});

test('the occupancy table always carries every kind and resolves one occupant per key', () => {
  const detector = createConflictDetector();
  detector.upsert('b-plugin', [{ kind: 'service', key: 'catalog', scope: 'app', uid: 2 }]);
  detector.upsert('a-plugin', [{ kind: 'service', key: 'catalog', scope: 'app', uid: 5 }]);

  const table = detector.table();
  assert.deepEqual([...table.keys()], [...OCCUPANCY_KINDS]);
  for (const kind of OCCUPANCY_KINDS) assert.ok(table.get(kind) instanceof Map);
  assert.deepEqual(table.get('service').get('catalog'), { owner: 'a-plugin', uid: 5 });
  // The resolved view loses the duplicate on purpose; claimsOf keeps the evidence.
  assert.equal(detector.claimsOf('service', 'catalog').length, 2);
  assert.equal(detector.conflicts().length, 1);
});

test('the resolved occupant is the smallest (owner, uid), so owner name decides first', () => {
  const detector = createConflictDetector();
  detector.upsert('b-plugin', [{ kind: 'tool', key: 'read', uid: null }]);
  detector.upsert('a-plugin', [{ kind: 'tool', key: 'read', uid: 7 }]);

  // Owner name outranks uid: "a-plugin" wins even though "b-plugin" has the null uid.
  assert.deepEqual(detector.table().get('tool').get('read'), { owner: 'a-plugin', uid: 7 });
  // Both claimants stay visible; the loser is the conflict evidence.
  assert.deepEqual(
    detector.claimsOf('tool', 'read').map((claim) => [claim.owner, claim.uid]),
    [
      ['a-plugin', 7],
      ['b-plugin', null],
    ],
  );
  assert.deepEqual(detector.conflicts().map((conflict) => conflict.code), ['C2']);
});

test('C1 fires for a requirement nothing provides and disappears when a provider arrives', () => {
  const detector = createConflictDetector();
  detector.upsert('needer', [{ kind: 'tool', key: 'reader', requires: ['svc:catalog'] }]);

  let [conflict] = detector.conflicts();
  assert.equal(conflict.code, 'C1');
  assert.equal(conflict.type, 'MISSING_DEPENDENCY');
  assert.deepEqual(conflict.detail, { requirement: 'svc:catalog' });
  assert.deepEqual(conflict.owners, [{ owner: 'needer', uid: null }]);
  assert.ok(detector.snapshot().limitations.includes('REQUIREMENT_MATCHING_IS_EXACT'));

  detector.upsert('provider', [{ kind: 'service', key: 'catalog' }]);
  assert.deepEqual(codes(detector), []);
});

test('C1 accepts the svc: alias, an explicit provides entry, and a claim satisfying itself', () => {
  const detector = createConflictDetector();
  detector.upsert('provider', [{ kind: 'service', key: 'catalog' }]);
  detector.upsert('tool-user', [{ kind: 'tool', key: 'writer', requires: ['svc:catalog'] }]);
  detector.upsert('custom', [{ kind: 'tool', key: 'helper', provides: ['cap:whatever'] }]);
  detector.upsert('custom-user', [{ kind: 'tool', key: 'consumer', requires: ['cap:whatever'] }]);
  detector.upsert('self', [{ kind: 'service', key: 'own', requires: ['service:own'] }]);
  assert.deepEqual(codes(detector), []);
});

test('C2 separates duplicate services, rows and tools, and ignores another scope', () => {
  const service = createConflictDetector();
  service.upsert('a', [{ kind: 'service', key: 'catalog', scope: 'app' }]);
  service.upsert('b', [{ kind: 'service', key: 'catalog', scope: 'app' }]);
  const [conflict] = service.conflicts();
  assert.equal(conflict.code, 'C2');
  assert.equal(conflict.severity, 'blocker');
  assert.deepEqual(conflict.owners.map((owner) => owner.owner), ['a', 'b']);

  const row = createConflictDetector();
  row.upsert('bundle-a', [{ kind: 'row', key: 'main', scope: 'bundle' }]);
  row.upsert('bundle-b', [{ kind: 'row', key: 'main', scope: 'bundle' }]);
  assert.deepEqual(row.conflicts().map(({ code, severity }) => [code, severity]), [['C2', 'blocker']]);

  const tool = createConflictDetector();
  tool.upsert('a', [{ kind: 'tool', key: 'read' }]);
  tool.upsert('b', [{ kind: 'tool', key: 'read' }]);
  assert.deepEqual(tool.conflicts().map(({ code, severity }) => [code, severity]), [['C2', 'high']]);

  const scoped = createConflictDetector();
  scoped.upsert('a', [{ kind: 'service', key: 'catalog', scope: 'app' }]);
  scoped.upsert('b', [{ kind: 'service', key: 'catalog', scope: 'other' }]);
  assert.deepEqual(codes(scoped), []);
});

test('C3 is high for a keyed slot and blocker for a single-slot claim', () => {
  const keyed = createConflictDetector();
  keyed.upsert('a', [{ kind: 'slot', key: 'panel', slotMode: 'keyed' }]);
  keyed.upsert('b', [{ kind: 'slot', key: 'panel', slotMode: 'keyed' }]);
  assert.deepEqual(keyed.conflicts().map(({ code, severity }) => [code, severity]), [['C3', 'high']]);

  const single = createConflictDetector();
  single.upsert('a', [{ kind: 'slot', key: 'panel', slotMode: 'single' }]);
  single.upsert('b', [{ kind: 'slot', key: 'panel', slotMode: 'keyed' }]);
  const [conflict] = single.conflicts();
  assert.equal(conflict.severity, 'blocker');
  assert.equal(conflict.detail.slotMode, 'single');
});

test('C4 needs a declared order on both sides and fires only on equal orders', () => {
  const equal = createConflictDetector();
  equal.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  equal.upsert('b', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  assert.deepEqual(equal.conflicts().map(({ code, detail }) => [code, detail.order]), [['C4', 10]]);

  const different = createConflictDetector();
  different.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  different.upsert('b', [{ kind: 'waterfall', key: 'compose', order: 20 }]);
  assert.deepEqual(codes(different), []);

  const unknown = createConflictDetector();
  unknown.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  unknown.upsert('b', [{ kind: 'waterfall', key: 'compose' }]);
  assert.deepEqual(codes(unknown), []);
  assert.deepEqual(unknown.snapshot().limitations, ['WATERFALL_ORDER_UNKNOWN']);
});

test('C5 needs a declared layer priority on both sides and fires on equal priorities', () => {
  const equal = createConflictDetector();
  equal.upsert('a', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  equal.upsert('b', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  assert.deepEqual(equal.conflicts().map(({ code, detail }) => [code, detail.layerPriority]), [['C5', 50]]);

  const ranked = createConflictDetector();
  ranked.upsert('a', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  ranked.upsert('b', [{ kind: 'config', key: 'theme', layerPriority: 60 }]);
  assert.deepEqual(codes(ranked), []);

  const unknown = createConflictDetector();
  unknown.upsert('a', [{ kind: 'config', key: 'theme' }]);
  unknown.upsert('b', [{ kind: 'config', key: 'theme' }]);
  assert.deepEqual(codes(unknown), []);
  assert.deepEqual(unknown.snapshot().limitations, ['CONFIG_PRIORITY_UNKNOWN']);
});

test('C6 compares the declared platform set against the configured platform', () => {
  const incompatible = createConflictDetector({ platform: 'linux' });
  incompatible.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['darwin', 'win32'] }]);
  const [conflict] = incompatible.conflicts();
  assert.equal(conflict.code, 'C6');
  assert.deepEqual(conflict.detail, { supported: ['darwin', 'win32'], platform: 'linux' });

  const compatible = createConflictDetector({ platform: 'linux' });
  compatible.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['linux', 'darwin'] }]);
  assert.deepEqual(codes(compatible), []);

  const unknownPlatform = createConflictDetector();
  unknownPlatform.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['darwin'] }]);
  assert.deepEqual(codes(unknownPlatform), []);
  assert.deepEqual(unknownPlatform.snapshot().limitations, ['PLATFORM_UNKNOWN']);
});

test('C7 decides only inside the supported semver subset', () => {
  const drift = createConflictDetector({ hostVersion: '1.2.3' });
  drift.upsert('a', [{ kind: 'tool', key: 'read', hostRange: '^2.0.0' }]);
  assert.deepEqual(drift.conflicts().map(({ code, detail }) => [code, detail.hostRange]), [['C7', '^2.0.0']]);

  const satisfied = createConflictDetector({ hostVersion: '1.2.3' });
  satisfied.upsert('a', [{ kind: 'tool', key: 'read', hostRange: '^1.0.0' }]);
  assert.deepEqual(codes(satisfied), []);

  const noVersion = createConflictDetector();
  noVersion.upsert('a', [{ kind: 'tool', key: 'read', hostRange: '^1.0.0' }]);
  assert.deepEqual(codes(noVersion), []);
  assert.deepEqual(noVersion.snapshot().limitations, ['HOST_VERSION_UNKNOWN']);

  const exotic = createConflictDetector({ hostVersion: '1.2.3' });
  exotic.upsert('a', [{ kind: 'tool', key: 'read', hostRange: 'workspace:*' }]);
  assert.deepEqual(codes(exotic), []);
  assert.deepEqual(exotic.snapshot().limitations, ['HOST_RANGE_UNCHECKED']);
});

test('C8 is derived: a removed provider is a race only while a live claim needs it', () => {
  const detector = createConflictDetector();
  detector.upsert('needer', [{ kind: 'tool', key: 'reader', requires: ['svc:catalog'] }]);
  detector.upsert('provider', [{ kind: 'service', key: 'catalog' }]);
  assert.deepEqual(codes(detector), []);

  detector.removeOwner('provider');
  const [conflict] = detector.conflicts();
  assert.equal(conflict.code, 'C8');
  assert.equal(conflict.severity, 'high');
  assert.deepEqual(conflict.detail, { removed: 'provider', dependent: 'needer', requirement: 'svc:catalog' });
  // C1 must not name the same fact with a less specific diagnosis.
  assert.deepEqual(codes(detector), ['C8']);

  detector.removeOwner('needer');
  assert.deepEqual(codes(detector), []);

  // A replacement provider also clears it, without any cleanup call.
  detector.upsert('needer', [{ kind: 'tool', key: 'reader', requires: ['svc:catalog'] }]);
  assert.deepEqual(codes(detector), ['C8']);
  detector.upsert('provider-2', [{ kind: 'service', key: 'catalog' }]);
  assert.deepEqual(codes(detector), []);
});

test('C9 checks key grammar and reserved prefixes, and honours an explicit acknowledgement', () => {
  const grammar = createConflictDetector();
  grammar.upsert('a', [{ kind: 'tool', key: 'bad key' }]);
  assert.deepEqual(grammar.conflicts().map(({ code, key }) => [code, key]), [['C9', 'bad key']]);

  for (const key of ['dsh.internal', '@deepseek-ai/secret', 'node:fs']) {
    const reserved = createConflictDetector();
    reserved.upsert('a', [{ kind: 'tool', key }]);
    assert.deepEqual(reserved.conflicts().map(({ code }) => code), ['C9'], key);
  }

  const acknowledged = createConflictDetector();
  acknowledged.upsert('a', [{ kind: 'tool', key: 'dsh.extension', reservedAck: true }]);
  assert.deepEqual(codes(acknowledged), []);
});

test('C10 flags a near-miss event name and stays quiet on an exact or unrelated one', () => {
  const detector = createConflictDetector({ knownEvents: ['plugin-manager/changed', 'tools/change'] });
  detector.upsert('a', [{ kind: 'tool', key: 'observer', events: ['tools/changed'] }]);

  const [conflict] = detector.conflicts();
  assert.equal(conflict.code, 'C10');
  assert.deepEqual(conflict.detail, { event: 'tools/changed', nearMiss: 'tools/change', distance: 1 });

  const exact = createConflictDetector({ knownEvents: ['tools/change'] });
  exact.upsert('a', [{ kind: 'tool', key: 'observer', events: ['tools/change'] }]);
  assert.deepEqual(codes(exact), []);

  const unrelated = createConflictDetector({ knownEvents: ['tools/change'] });
  unrelated.upsert('a', [{ kind: 'tool', key: 'observer', events: ['completely-different-event'] }]);
  assert.deepEqual(codes(unrelated), []);
  assert.deepEqual(unrelated.snapshot().limitations, ['EVENT_NOT_IN_CATALOG']);

  const noCatalog = createConflictDetector();
  noCatalog.upsert('a', [{ kind: 'tool', key: 'observer', events: ['tools/changed'] }]);
  assert.deepEqual(codes(noCatalog), []);
  assert.deepEqual(noCatalog.snapshot().limitations, ['EVENT_CATALOG_UNAVAILABLE']);
});

test('C11 reports rejected claims instead of dropping them', () => {
  const detector = createConflictDetector();
  const result = detector.upsert('a', [
    { kind: 'not-a-kind', key: 'x' },
    { kind: 'tool', key: '   ' },
    { kind: 'tool', key: 'read', uid: -1 },
    'not-an-object',
  ]);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 4);

  const rejected = detector.conflicts();
  assert.equal(rejected.length, 4);
  assert.ok(rejected.every((conflict) => conflict.code === 'C11'));
  assert.deepEqual(
    rejected.map((conflict) => conflict.detail.field),
    ['kind', 'key', 'uid', 'claims[3]'],
  );
  assert.equal(detector.snapshot().totals.rejected, 4);
});

test('C11 also reports one uid claimed by two owners', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'tool', key: 'read', uid: 9 }]);
  detector.upsert('b', [{ kind: 'service', key: 'catalog', uid: 9 }]);
  const shared = detector.conflicts().filter((conflict) => conflict.code === 'C11');
  assert.equal(shared.length, 1);
  assert.match(shared[0].detail.reason, /uid 9 is claimed by 2 owners/);
  assert.deepEqual(shared[0].owners.map((owner) => owner.owner), ['a', 'b']);
});

test('report() reads a declaration\'s resources and requirements without validating it', () => {
  const detector = createConflictDetector();
  detector.report('plugin.one', {
    resources: [
      { kind: 'service', name: 'catalog', scope: 'app' },
      { kind: 'tool', name: 'search', scope: 'app' },
    ],
    capabilities: { required: ['svc:missing'] },
  });

  assert.deepEqual(
    detector.claims().map((claim) => [claim.kind, claim.key, claim.scope]),
    [
      ['service', 'catalog', 'app'],
      ['tool', 'search', 'app'],
    ],
  );
  // Requirements hang on the first claim; the spec validator, not this engine, owns
  // whether the declaration itself is valid.
  assert.deepEqual(detector.conflicts().map(({ code, detail }) => [code, detail.requirement]), [
    ['C1', 'svc:missing'],
  ]);
});

test('report() keeps a malformed resource visible as a rejected claim', () => {
  const detector = createConflictDetector();
  const result = detector.report('plugin.one', { resources: ['not-a-resource'] });
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 1);
  assert.equal(detector.conflicts()[0].code, 'C11');
});

test('options are validated: unknown keys and bad values are caller errors', () => {
  assert.throws(() => createConflictDetector(null), TypeError);
  assert.throws(() => createConflictDetector('platform'), TypeError);
  assert.throws(() => createConflictDetector({ nope: 1 }), TypeError);
  assert.throws(() => createConflictDetector({ platform: '' }), TypeError);
  assert.throws(() => createConflictDetector({ hostVersion: 24 }), TypeError);
  assert.throws(() => createConflictDetector({ knownEvents: ['ok', 7] }), TypeError);
  assert.throws(() => createConflictDetector({ maxClaims: 0 }), TypeError);
  assert.throws(() => createConflictDetector({ maxClaims: 1.5 }), TypeError);
});

test('the claim cap throws RangeError instead of silently truncating', () => {
  const detector = createConflictDetector({ maxClaims: 2 });
  detector.upsert('a', [{ kind: 'tool', key: 'one' }, { kind: 'tool', key: 'two' }]);
  assert.throws(() => detector.upsert('b', [{ kind: 'tool', key: 'three' }]), RangeError);
});

test('owner and claim arguments are validated', () => {
  const detector = createConflictDetector();
  assert.throws(() => detector.upsert('', []), TypeError);
  assert.throws(() => detector.upsert('a', 'nope'), TypeError);
  assert.throws(() => detector.removeOwner(7), TypeError);
  assert.throws(() => detector.report('a', null), TypeError);
  assert.throws(() => detector.recordFailure('nope'), TypeError);
});

test('re-reporting a claim is idempotent, and a changed claim replaces its predecessor', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'tool', key: 'read', platforms: ['linux'] }]);
  detector.upsert('a', [{ kind: 'tool', key: 'read', platforms: ['linux'] }]);
  assert.equal(detector.snapshot().totals.claims, 1);

  detector.upsert('a', [{ kind: 'tool', key: 'read' }]);
  assert.equal(detector.snapshot().totals.claims, 1);
  assert.deepEqual(detector.claimsOf('tool', 'read')[0].platforms, []);
});

test('removeOwner reports how many claims remain', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'tool', key: 'one' }]);
  detector.upsert('b', [{ kind: 'tool', key: 'two' }]);
  assert.equal(detector.removeOwner('a'), 1);
  assert.equal(detector.removeOwner('a'), 1);
  assert.equal(detector.removeOwner('b'), 0);
});

test('the snapshot is JSON-serializable and contains no Maps', () => {
  const detector = createConflictDetector({ platform: 'linux', hostVersion: '1.0.0' });
  detector.upsert('a', [{ kind: 'tool', key: 'read' }, { kind: 'slot', key: 'panel' }]);
  detector.upsert('b', [{ kind: 'tool', key: 'read' }]);

  const snapshot = detector.snapshot();
  const roundTrip = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(roundTrip, snapshot);
  assert.equal(snapshot.version, CONFLICT_DETECTOR_VERSION);
  assert.deepEqual(snapshot.occupancy.tool, [{ key: 'read', owner: 'a', uid: null }]);
  assert.deepEqual(snapshot.occupancy.slot, [{ key: 'panel', owner: 'a', uid: null }]);
  assert.deepEqual(snapshot.totals, { claims: 3, rejected: 0, conflicts: 1 });
  assert.equal(roundTrip.occupancy.service.length, 0);
});

test('insertion order never changes the answer', () => {
  const claims = [
    ['a', { kind: 'service', key: 'catalog', scope: 'app', uid: 3 }],
    ['b', { kind: 'service', key: 'catalog', scope: 'app', uid: 1 }],
    ['c', { kind: 'tool', key: 'read', requires: ['svc:missing'] }],
    ['d', { kind: 'slot', key: 'panel', slotMode: 'single' }],
    ['e', { kind: 'slot', key: 'panel', slotMode: 'single' }],
  ];
  const forward = createConflictDetector();
  for (const [owner, claim] of claims) forward.upsert(owner, [claim]);
  const backward = createConflictDetector();
  for (const [owner, claim] of [...claims].reverse()) backward.upsert(owner, [claim]);

  assert.equal(changes(forward, forward.snapshot()), changes(backward, backward.snapshot()));
  assert.deepEqual(
    forward.conflicts().map((conflict) => conflict.code),
    ['C1', 'C2', 'C3'],
  );
  // ids are content keys, so a diff across two detectors is exact.
  assert.deepEqual(
    forward.conflicts().map((conflict) => conflict.id),
    backward.conflicts().map((conflict) => conflict.id),
  );
});

test('conflict records and their ids are stable and frozen', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'service', key: 'catalog' }]);
  detector.upsert('b', [{ kind: 'service', key: 'catalog' }]);
  const [conflict] = detector.conflicts();
  assert.ok(Object.isFrozen(conflict));
  assert.ok(Object.isFrozen(conflict.owners));
  assert.ok(Object.isFrozen(conflict.detail));
  assert.equal(conflict.id, 'C2|service|catalog|a#-,b#-');
  assert.equal(conflict.summary, 'service key "catalog" is claimed by a, b');
});

test('failures are recorded, deduplicated and never become conflicts', () => {
  const detector = createConflictDetector();
  detector.recordFailure({ owner: 'boom', uid: 4, state: 'FAILED', message: 'kaput' });
  detector.recordFailure({ owner: 'boom', uid: 4, state: 'FAILED', message: 'kaput' });
  assert.equal(detector.snapshot().failures.length, 1);
  assert.deepEqual(detector.snapshot().failures[0], {
    owner: 'boom',
    uid: 4,
    state: 'FAILED',
    message: 'kaput',
    at: null,
  });
  assert.deepEqual(detector.conflicts(), []);
});

test('clear() drops claims, rejections, failures and removed-provider memory', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'service', key: 'catalog' }]);
  detector.upsert('b', [{ kind: 'tool', key: 'read', requires: ['svc:catalog'] }]);
  detector.upsert('c', [{ kind: 'nope', key: 'x' }]);
  detector.recordFailure({ owner: 'boom' });
  detector.removeOwner('a');
  assert.equal(detector.conflicts().length, 2);

  detector.clear();
  assert.deepEqual(detector.conflicts(), []);
  assert.deepEqual(detector.claims(), []);
  assert.deepEqual(detector.snapshot().totals, { claims: 0, rejected: 0, conflicts: 0 });
});

test('satisfiesRange covers the declared subset and refuses the rest', () => {
  const cases = [
    ['1.2.3', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.3', '>=1.0.0 <1.3.0', true],
    ['1.3.0', '>=1.0.0 <1.3.0', false],
    ['3.0.0', '^1.0.0 || >=3.0.0', true],
    ['2.0.0', '^1.0.0 || >=3.0.0', false],
    ['1.2.3', '*', true],
    ['1.2.3', 'workspace:*', null],
    ['1.2.3', 'latest', null],
    ['not-a-version', '^1.0.0', null],
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(satisfiesRange(version, range), expected, `${version} vs ${range}`);
  }
});

test('the limitation vocabulary is closed and frozen', () => {
  assert.ok(Object.isFrozen(CONFLICT_LIMITATIONS));
  assert.deepEqual(Object.values(CONFLICT_LIMITATIONS).sort(), [
    'CONFIG_PRIORITY_UNKNOWN',
    'EVENT_CATALOG_UNAVAILABLE',
    'EVENT_NOT_IN_CATALOG',
    'HOST_RANGE_UNCHECKED',
    'HOST_VERSION_UNKNOWN',
    'PLATFORM_UNKNOWN',
    'REQUIREMENT_MATCHING_IS_EXACT',
    'WATERFALL_ORDER_UNKNOWN',
  ]);
});
