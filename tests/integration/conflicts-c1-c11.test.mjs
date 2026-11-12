/**
 * C1–C11 — one case per conflict code, driven through the real detector.
 *
 * WHY THIS FILE EXISTS. The analyzer's own unit tests already pin each rule's
 * decision. This file asks a different question: *do the declarations the kit
 * actually generates, validated by the spec, reach the platform's detector and
 * produce the codes the ecosystem documents?* Where a code can be produced from
 * a kit-generated declaration it is; where it cannot (the kit emits no
 * waterfall, config, platform, hostRange or event claims), the case is built
 * from the detector's own claim vocabulary and says so in the assertion
 * message. Nothing is faked into looking like a scaffolded plugin.
 *
 * One finding this file records rather than smooths over: the kit's generated
 * declarations require `ctx.tools`/`ctx.slots`, and a detector that has been
 * given only plugin claims reports C1 for them — because "does *nobody*
 * provide this" is asked of the claim set it was given. That is what C1 means,
 * and the fix (let the host declare what it provides) is asserted in the C1
 * case rather than hidden by pre-seeding.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFLICT_CODES,
  CONFLICT_SEVERITIES,
  createConflictDetector,
} from '../../packages/analyzer/src/conflict-detector.js';
import { LIFECYCLE_SIGNALS } from '../../packages/lifecycle-bootstrap/src/lifecycle-bootstrap.js';
import { planScaffold, renderScaffold } from '../../../dsh-plugin-kit/src/index.js';

/** Templates that emit a kit dependency and therefore require a specifier. */
const NEEDS_KIT_SPECIFIER = new Set(['host-tool-managed', 'host-tool-admitted', 'host-test-driver']);

/**
 * Render one kit template in memory and return its declaration. Rendering is
 * pure, so no directory is created and no file is written.
 *
 * @param {string} template
 * @param {{ slotName?: string, dir?: string }} [extra]
 * @returns {{ declaration: any, files: Map<string, string> }}
 */
function kitTemplate(template, extra = {}) {
  const options = {
    target: `/nonexistent/${extra.dir ?? template}`,
    template,
  };
  if (NEEDS_KIT_SPECIFIER.has(template)) options.kitSpecifier = 'file:../dsh-plugin-kit';
  if (extra.slotName !== undefined) options.slotName = extra.slotName;
  const planned = planScaffold(options);
  assert.equal(planned.ok, true, `${template}: ${JSON.stringify(planned.issues)}`);
  const files = renderScaffold(planned.plan);
  return { declaration: JSON.parse(files.get('declaration.json')), files };
}

/** The conflict codes present in a detector, as a sorted unique list. */
function codes(detector) {
  return [...new Set(detector.conflicts().map((conflict) => conflict.code))].sort();
}

test('the taxonomy this file walks is the closed C1..C11 list', () => {
  assert.deepEqual([...CONFLICT_CODES], [
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11',
  ]);
  assert.deepEqual([...CONFLICT_SEVERITIES].sort(), ['blocker', 'high', 'low', 'medium']);
});

test('C1 — a kit declaration requires a capability the claim set does not provide', () => {
  const detector = createConflictDetector();
  detector.report('acme-combined', kitTemplate('combined').declaration);

  const c1 = detector.conflicts().filter((conflict) => conflict.code === 'C1');
  // `combined` requires all three of cordis.effect, ctx.tools and ctx.slots; only
  // the host provides them, and no host claim was given.
  assert.deepEqual(
    c1.map((conflict) => conflict.detail.requirement).sort(),
    ['cordis.effect', 'ctx.slots', 'ctx.tools'],
  );
  assert.ok(c1.every((conflict) => conflict.severity === 'high'), 'C1 is high');
  assert.deepEqual(detector.snapshot().limitations, ['REQUIREMENT_MATCHING_IS_EXACT']);

  // The stated fix is not a special case in the detector: let the provided
  // capability be claimed, and C1 for it disappears.
  detector.upsert('host:capabilities', [
    {
      kind: 'service',
      key: 'host.capabilities',
      provides: ['cordis.effect', 'ctx.tools', 'ctx.slots'],
    },
  ]);
  const remaining = detector.conflicts().filter((conflict) => conflict.code === 'C1');
  assert.deepEqual(remaining, [], 'a provider claim clears C1');
});

test('C2 — two scaffolds shipping the same tool key conflict in the same scope', () => {
  const detector = createConflictDetector();
  // Same target basename in two different parents: same generated tool name,
  // two owners. Nothing about the declaration is edited.
  detector.report('acme-one', kitTemplate('host-tool', { dir: 'acme' }).declaration);
  detector.report('acme-two', kitTemplate('host-tool', { dir: 'acme' }).declaration);

  const conflicts = detector.conflicts();
  const c2 = conflicts.filter((conflict) => conflict.code === 'C2');
  assert.equal(c2.length, 1);
  assert.equal(c2[0].severity, 'high', 'tool duplicates are high, not blocker');
  assert.equal(c2[0].key, 'acme_hello');
  assert.deepEqual(c2[0].detail, { scope: 'plugin' });
  assert.deepEqual(c2[0].owners.map((owner) => owner.owner), ['acme-one', 'acme-two']);

  // A service duplicate in the same scope is a blocker, which is the analyzer's
  // documented severity floor — asserted here so the two levels stay distinct.
  const serviceDetector = createConflictDetector();
  serviceDetector.upsert('a', [{ kind: 'service', key: 'catalog', scope: 'app' }]);
  serviceDetector.upsert('b', [{ kind: 'service', key: 'catalog', scope: 'app' }]);
  assert.equal(serviceDetector.conflicts()[0].severity, 'blocker');

  // Different scopes are not a conflict.
  const scoped = createConflictDetector();
  scoped.upsert('a', [{ kind: 'tool', key: 'read', scope: 'app' }]);
  scoped.upsert('b', [{ kind: 'tool', key: 'read', scope: 'user' }]);
  assert.deepEqual(codes(scoped), []);
});

test('C3 — two client-slot scaffolds claiming one slot name conflict', () => {
  const detector = createConflictDetector();
  detector.report('slot-one', kitTemplate('client-slot', { slotName: 'acme.panel' }).declaration);
  detector.report('slot-two', kitTemplate('client-slot', { slotName: 'acme.panel' }).declaration);

  const c3 = detector.conflicts().filter((conflict) => conflict.code === 'C3');
  assert.equal(c3.length, 1);
  assert.equal(c3[0].key, 'acme.panel');
  assert.equal(c3[0].severity, 'high', 'the kit emits no slotMode, so the slot reads as keyed');
  assert.deepEqual(c3[0].detail, { scope: 'plugin', slotMode: 'keyed' });

  // When either claimant says `single`, the conflict is a blocker.
  const single = createConflictDetector();
  single.upsert('a', [{ kind: 'slot', key: 'panel', slotMode: 'single' }]);
  single.upsert('b', [{ kind: 'slot', key: 'panel', slotMode: 'keyed' }]);
  assert.equal(single.conflicts()[0].severity, 'blocker');
  assert.equal(single.conflicts()[0].detail.slotMode, 'single');
});

test('C4 — two waterfall claims at the same declared order (kit emits no waterfall)', () => {
  const equal = createConflictDetector();
  equal.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  equal.upsert('b', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  assert.deepEqual(codes(equal), ['C4']);
  assert.equal(equal.conflicts()[0].detail.order, 10);
  assert.equal(equal.conflicts()[0].severity, 'medium');

  // Distinct orders are a decision, not a conflict, and an undeclared order is a
  // limitation rather than a guess.
  const ranked = createConflictDetector();
  ranked.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  ranked.upsert('b', [{ kind: 'waterfall', key: 'compose', order: 20 }]);
  assert.deepEqual(codes(ranked), []);

  const unknown = createConflictDetector();
  unknown.upsert('a', [{ kind: 'waterfall', key: 'compose', order: 10 }]);
  unknown.upsert('b', [{ kind: 'waterfall', key: 'compose' }]);
  assert.deepEqual(codes(unknown), []);
  assert.ok(unknown.snapshot().limitations.includes('WATERFALL_ORDER_UNKNOWN'));
});

test('C5 — two config claims at the same layer priority (kit emits no config)', () => {
  const equal = createConflictDetector();
  equal.upsert('a', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  equal.upsert('b', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  assert.deepEqual(codes(equal), ['C5']);
  assert.equal(equal.conflicts()[0].detail.layerPriority, 50);

  const ordered = createConflictDetector();
  ordered.upsert('a', [{ kind: 'config', key: 'theme', layerPriority: 50 }]);
  ordered.upsert('b', [{ kind: 'config', key: 'theme', layerPriority: 60 }]);
  assert.deepEqual(codes(ordered), []);

  const unknown = createConflictDetector();
  unknown.upsert('a', [{ kind: 'config', key: 'theme' }]);
  unknown.upsert('b', [{ kind: 'config', key: 'theme' }]);
  assert.deepEqual(codes(unknown), []);
  assert.ok(unknown.snapshot().limitations.includes('CONFIG_PRIORITY_UNKNOWN'));
});

test('C6 — a claim whose platform set excludes the configured platform', () => {
  const linux = createConflictDetector({ platform: 'linux' });
  linux.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['darwin', 'win32'] }]);
  assert.deepEqual(codes(linux), ['C6']);
  assert.deepEqual(linux.conflicts()[0].detail, { supported: ['darwin', 'win32'], platform: 'linux' });

  const compatible = createConflictDetector({ platform: 'linux' });
  compatible.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['linux', 'darwin'] }]);
  assert.deepEqual(codes(compatible), []);

  // No configured platform is unknown, not compatible.
  const unknown = createConflictDetector();
  unknown.upsert('a', [{ kind: 'tool', key: 'screenshot', platforms: ['darwin'] }]);
  assert.deepEqual(codes(unknown), []);
  assert.ok(unknown.snapshot().limitations.includes('PLATFORM_UNKNOWN'));
});

test('C7 — a hostRange that excludes the configured host version', () => {
  const drift = createConflictDetector({ hostVersion: '1.4.0' });
  drift.upsert('a', [{ kind: 'tool', key: 'reader', hostRange: '^2.0.0' }]);
  assert.deepEqual(codes(drift), ['C7']);
  assert.equal(drift.conflicts()[0].detail.hostRange, '^2.0.0');

  const inside = createConflictDetector({ hostVersion: '1.4.0' });
  inside.upsert('a', [{ kind: 'tool', key: 'reader', hostRange: '^1.2.0' }]);
  assert.deepEqual(codes(inside), []);

  // A range outside the supported subset is not evaluated: it is reported.
  const unsupported = createConflictDetector({ hostVersion: '1.4.0' });
  unsupported.upsert('a', [{ kind: 'tool', key: 'reader', hostRange: 'workspace:*' }]);
  assert.deepEqual(codes(unsupported), []);
  assert.ok(unsupported.snapshot().limitations.includes('HOST_RANGE_UNCHECKED'));
});

test('C8 — a provider removed while a live claim still needs it (derived, self-clearing)', () => {
  const detector = createConflictDetector();
  detector.upsert('provider', [{ kind: 'service', key: 'catalog' }]);
  detector.upsert('consumer', [{ kind: 'tool', key: 'search', requires: ['svc:catalog'] }]);
  assert.deepEqual(codes(detector), [], 'nothing is wrong while the provider lives');

  detector.removeOwner('provider');
  assert.deepEqual(codes(detector), ['C8']);
  // C1 must not name the same fact twice: the requirement was covered when the
  // provider was removed, and C8 owns that observation.
  assert.deepEqual(codes(detector).includes('C1'), false);

  // The record disappears when a replacement provider arrives — it is derived on
  // every read, not stored.
  detector.upsert('provider-2', [{ kind: 'service', key: 'catalog' }]);
  assert.deepEqual(codes(detector), []);
});

test('C9 — a reserved prefix needs an explicit acknowledgement', () => {
  const detector = createConflictDetector();
  detector.upsert('a', [{ kind: 'tool', key: 'dsh.internal-tool' }]);
  const c9 = detector.conflicts().filter((conflict) => conflict.code === 'C9');
  assert.equal(c9.length, 1);
  assert.match(c9[0].summary, /reserved prefix "dsh\."/);

  // The kit is the other side of the same rule, and it applies it by rewriting
  // the generated key rather than by refusing the target: a plugin scaffolded as
  // `dsh.internal` gets the tool key `dsh_internal_hello` (dots are not legal in
  // a resource key), so a scaffolded plugin cannot produce a reserved-prefix
  // claim. C9 therefore guards hand-written declarations, which is exactly what
  // this file asserts separately above.
  const scaffolded = planScaffold({ target: '/nonexistent/dsh.internal', template: 'host-tool' });
  assert.equal(scaffolded.ok, true);
  assert.equal(scaffolded.plan.toolName, 'dsh_internal_hello');
  const fromKit = createConflictDetector();
  fromKit.report('dsh-internal', kitTemplate('host-tool', { dir: 'dsh.internal' }).declaration);
  assert.equal(
    fromKit.conflicts().some((conflict) => conflict.code === 'C9'),
    false,
    'a scaffolded plugin id never becomes a reserved-prefix resource key',
  );

  // Acknowledged, and grammatically valid: quiet.
  const acknowledged = createConflictDetector();
  acknowledged.upsert('a', [{ kind: 'tool', key: 'dsh.internal-tool', reservedAck: true }]);
  assert.deepEqual(codes(acknowledged), []);
  // Broken grammar is C9 too.
  const grammar = createConflictDetector();
  grammar.upsert('a', [{ kind: 'tool', key: 'bad key' }]);
  assert.deepEqual(codes(grammar), ['C9']);
});

test('C10 — a near-miss event name, judged against the real lifecycle signal catalog', () => {
  // The catalog is the lifecycle-bootstrap package's own signal list, not a
  // hand-written array: this is the one real event vocabulary the ecosystem has.
  const catalog = [...LIFECYCLE_SIGNALS];
  assert.ok(catalog.includes('plugin-manager/changed'));

  const detector = createConflictDetector({ knownEvents: catalog });
  detector.upsert('a', [{ kind: 'tool', key: 'observer', events: ['plugin-manager/change'] }]);
  assert.deepEqual(codes(detector), ['C10']);
  assert.deepEqual(detector.conflicts()[0].detail, {
    event: 'plugin-manager/change',
    nearMiss: 'plugin-manager/changed',
    distance: 1,
  });

  const exact = createConflictDetector({ knownEvents: catalog });
  exact.upsert('a', [{ kind: 'tool', key: 'observer', events: ['plugin-manager/changed'] }]);
  assert.deepEqual(codes(exact), []);

  // Without a catalog, C10 cannot run and says so.
  const noCatalog = createConflictDetector();
  noCatalog.upsert('a', [{ kind: 'tool', key: 'observer', events: ['plugin-manager/change'] }]);
  assert.deepEqual(codes(noCatalog), []);
  assert.ok(noCatalog.snapshot().limitations.includes('EVENT_CATALOG_UNAVAILABLE'));
});

test('C11 — a rejected claim is reported, and one uid claimed twice is one conflict', () => {
  const detector = createConflictDetector();
  // A declaration the spec accepts can still carry a resource the detector
  // refuses; the rejection must be visible, not dropped.
  const { declaration } = kitTemplate('host-tool');
  const broken = {
    ...declaration,
    resources: [...declaration.resources, { kind: 'tool', name: '   ', scope: 'plugin' }],
  };
  const result = detector.report('acme-broken', broken);
  assert.equal(result.accepted, declaration.resources.length);
  assert.equal(result.rejected, 1);

  const rejected = detector.conflicts().filter((conflict) => conflict.code === 'C11');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].severity, 'high');
  assert.equal(detector.snapshot().totals.rejected, 1);

  // The second C11 shape: two owners claiming one uid.
  const shared = createConflictDetector();
  shared.upsert('a', [{ kind: 'tool', key: 'read', uid: 9 }]);
  shared.upsert('b', [{ kind: 'service', key: 'catalog', uid: 9 }]);
  const uidConflicts = shared.conflicts().filter((conflict) => conflict.code === 'C11');
  assert.equal(uidConflicts.length, 1);
  assert.match(uidConflicts[0].detail.reason, /uid 9 is claimed by 2 owners/);
});
