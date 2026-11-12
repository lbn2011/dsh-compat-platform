/**
 * Decision tests for `src/conflict-service.js` — A1 wired to a host.
 *
 * The fake context here is deliberately *smaller* than Cordis: it offers `on`,
 * `emit` and the two host services the default collector reads. If the adapter
 * needed more than that, these tests could not be written — which is the point,
 * because the adapter must not depend on host internals to answer the occupancy
 * question.
 *
 * The cases that matter are the ones a happy path would hide: a collector that
 * throws, an event that fires during startup, two triggers racing, `FAILED` and
 * `DISPOSED` fibers, and a refresh that must not drop plugin-reported claims.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFLICT_EVENTS,
  CONFLICT_SERVICE_VERSION,
  OCCUPANCY_SIGNALS,
  apply,
  createConflictService,
  name as pluginName,
} from '../src/conflict-service.js';
import { OCCUPANCY_KINDS } from '../src/conflict-detector.js';

/** A fake host: records subscriptions and emissions, exposes two services. */
function fakeContext({ tools, bundles, emitThrows = false, withOn = true } = {}) {
  const handlers = new Map();
  const emitted = [];
  const disposers = [];
  const ctx = {
    handlers,
    emitted,
    disposers,
    tools: tools ?? { definitions: async () => [] },
    pluginManager: { listBundles: async () => bundles ?? [] },
  };
  if (withOn) {
    ctx.on = (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      const disposer = () => {
        handlers.set(event, (handlers.get(event) ?? []).filter((entry) => entry !== handler));
      };
      disposers.push(disposer);
      return disposer;
    };
  }
  ctx.emit = (event, payload) => {
    if (emitThrows) throw new Error('emit failed');
    emitted.push({ event, payload });
  };
  return ctx;
}

async function fire(ctx, event, ...args) {
  const handlers = ctx.handlers.get(event) ?? [];
  for (const handler of handlers) await handler(...args);
}

test('the service vocabulary is closed and the plugin entry is named', () => {
  assert.equal(CONFLICT_SERVICE_VERSION, 'conflict-service/0.1-draft.1');
  assert.equal(pluginName, 'dsh-compat-platform-conflicts');
  assert.deepEqual([...OCCUPANCY_SIGNALS], [
    'plugin-manager/changed',
    'tools/change',
    'slots/changed',
    'internal/status',
  ]);
  assert.deepEqual(CONFLICT_EVENTS, {
    DETECTED: 'conflict-detected',
    RESOLVED: 'conflict-resolved',
  });
});

test('the default collector reads tools and bundle rows, and reports a duplicated rowId', async () => {
  const ctx = fakeContext({
    tools: { definitions: async () => [{ name: 'read' }, { name: 'write' }] },
    bundles: [
      { moduleName: 'bundle-a', rows: [{ rowId: 'main' }] },
      { moduleName: 'bundle-b', rows: [{ rowId: 'main' }] },
    ],
  });
  const service = createConflictService(ctx, {});
  const snapshot = await service.refresh();

  assert.deepEqual(
    service.claims().map((claim) => [claim.owner, claim.kind, claim.key]),
    [
      ['bundle-a', 'row', 'main'],
      ['bundle-b', 'row', 'main'],
      ['host:tools', 'tool', 'read'],
      ['host:tools', 'tool', 'write'],
    ],
  );
  assert.deepEqual(snapshot.conflicts.map(({ code, kind, key, severity }) => [code, kind, key, severity]), [
    ['C2', 'row', 'main', 'blocker'],
  ]);
  assert.deepEqual(service.table().get('row').get('main'), { owner: 'bundle-a', uid: null });
});

test('conflict-detected carries only conflicts the previous answer did not have', async () => {
  const ctx = fakeContext({
    bundles: [{ moduleName: 'a', rows: [{ rowId: 'main' }] }],
  });
  const service = createConflictService(ctx, {});
  service.attach();
  await service.refresh();
  assert.deepEqual(ctx.emitted, []);

  // A second bundle appears with the same rowId: one new conflict, one emission.
  ctx.pluginManager.listBundles = async () => [
    { moduleName: 'a', rows: [{ rowId: 'main' }] },
    { moduleName: 'b', rows: [{ rowId: 'main' }] },
  ];
  await fire(ctx, 'plugin-manager/changed', { reason: 'bundle' });

  assert.equal(ctx.emitted.length, 1);
  const [{ event, payload }] = ctx.emitted;
  assert.equal(event, 'conflict-detected');
  assert.equal(payload.conflicts.length, 1);
  assert.equal(payload.conflicts[0].code, 'C2');
  assert.deepEqual(payload.snapshot.delta.removed, []);

  // Nothing changed: no third emission.
  await service.refresh();
  assert.equal(ctx.emitted.length, 1);
});

test('conflict-resolved is opt-in and names the ids that disappeared', async () => {
  const ctx = fakeContext({
    bundles: [
      { moduleName: 'a', rows: [{ rowId: 'main' }] },
      { moduleName: 'b', rows: [{ rowId: 'main' }] },
    ],
  });
  const service = createConflictService(ctx, { emitResolved: true });
  const first = await service.refresh();
  assert.equal(ctx.emitted.length, 1);
  const conflicted = first.conflicts.map((conflict) => conflict.id);

  ctx.pluginManager.listBundles = async () => [{ moduleName: 'a', rows: [{ rowId: 'main' }] }];
  const second = await service.refresh();

  assert.deepEqual(second.conflicts, []);
  const resolved = ctx.emitted.find((entry) => entry.event === 'conflict-resolved');
  assert.deepEqual(resolved.payload.ids, conflicted);

  // Without the option the same change is silent.
  const quiet = fakeContext({
    bundles: [
      { moduleName: 'a', rows: [{ rowId: 'main' }] },
      { moduleName: 'b', rows: [{ rowId: 'main' }] },
    ],
  });
  const quietService = createConflictService(quiet, {});
  await quietService.refresh();
  quiet.pluginManager.listBundles = async () => [{ moduleName: 'a', rows: [{ rowId: 'main' }] }];
  await quietService.refresh();
  assert.deepEqual(quiet.emitted.map((entry) => entry.event), ['conflict-detected']);
});

test('concurrent triggers share one reading of the host', async () => {
  let calls = 0;
  const ctx = fakeContext();
  const service = createConflictService(ctx, {
    collect: async () => {
      calls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return [{ owner: 'x', kind: 'tool', key: 'read' }];
    },
  });

  const [a, b, c] = await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('attach() subscribes to the four signals and the first reading is emitted once', async () => {
  const ctx = fakeContext({
    bundles: [
      { moduleName: 'a', rows: [{ rowId: 'main' }] },
      { moduleName: 'b', rows: [{ rowId: 'main' }] },
    ],
  });
  const service = createConflictService(ctx, {});
  service.attach();
  await service.refresh();

  assert.deepEqual([...ctx.handlers.keys()].sort(), [...OCCUPANCY_SIGNALS].sort());
  assert.deepEqual(ctx.emitted.map((entry) => entry.event), ['conflict-detected']);
  // attach() is idempotent: no second subscription, no second first-reading.
  service.attach();
  await service.refresh();
  assert.equal(ctx.handlers.get('tools/change').length, 1);
  assert.equal(ctx.emitted.length, 1);
});

test('detach() removes every subscription and is safe to call twice', async () => {
  const ctx = fakeContext();
  const service = createConflictService(ctx, {});
  service.attach();
  await service.refresh();
  service.detach();
  service.detach();

  assert.deepEqual(ctx.handlers.get('plugin-manager/changed'), []);
  assert.deepEqual(ctx.handlers.get('internal/status'), []);
});

test('a collector failure is recorded, never thrown at the host', async () => {
  const ctx = fakeContext();
  const service = createConflictService(ctx, {
    async collect() {
      throw new Error('host exploded');
    },
  });

  const snapshot = await service.refresh();
  assert.deepEqual(snapshot.conflicts, []);
  const errors = service.errors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].stage, 'collect');
  assert.match(errors[0].message, /host exploded/);
});

test('a claim without an owner is a recorded adapter error, not a silent drop', async () => {
  const ctx = fakeContext();
  const service = createConflictService(ctx, {
    collect: async () => [{ kind: 'tool', key: 'read' }, { owner: 'ok', kind: 'tool', key: 'write' }],
  });
  await service.refresh();
  assert.deepEqual(service.errors().map((error) => error.stage), ['collect']);
  assert.deepEqual(service.claims().map((claim) => claim.owner), ['ok']);
});

test('plugin-reported claims survive a host re-read that knows nothing about them', async () => {
  const ctx = fakeContext({ tools: { definitions: async () => [{ name: 'read' }] } });
  const service = createConflictService(ctx, {});
  await service.refresh();

  service.upsert('my-plugin', [{ kind: 'service', key: 'catalog' }]);
  // claims() is ordered by kind first, so the service claim precedes the tool claims.
  assert.deepEqual(service.claims().map((claim) => claim.owner), ['my-plugin', 'host:tools']);

  ctx.tools.definitions = async () => [{ name: 'read' }, { name: 'write' }];
  await service.refresh();
  assert.deepEqual(service.claims().map((claim) => `${claim.owner}:${claim.key}`), [
    'my-plugin:catalog',
    'host:tools:read',
    'host:tools:write',
  ]);
});

test('a FAILED fiber is recorded as a failure, not as a C-code conflict', async () => {
  const ctx = fakeContext();
  const service = createConflictService(ctx, {});
  service.attach();
  await service.refresh();

  await fire(ctx, 'internal/status', { uid: 12, name: 'broken-plugin', state: 3 }, 2);

  assert.deepEqual(service.snapshot().failures, [
    { owner: 'broken-plugin', uid: 12, state: 'FAILED', message: null, at: null },
  ]);
  assert.deepEqual(service.snapshot().conflicts, []);
  assert.deepEqual(ctx.emitted, []);
});

test('a DISPOSED fiber drops its claims, and a dependent left unsupported is C8', async () => {
  const ctx = fakeContext();
  const service = createConflictService(ctx, {});
  service.attach();
  await service.refresh();

  service.upsert('provider', [{ kind: 'service', key: 'catalog' }]);
  service.upsert('consumer', [{ kind: 'tool', key: 'search', requires: ['svc:catalog'] }]);
  await service.refresh();
  assert.deepEqual(service.snapshot().conflicts, []);

  await fire(ctx, 'internal/status', { uid: 3, name: 'provider', state: 4 }, 2);

  const conflicts = service.snapshot().conflicts;
  assert.deepEqual(conflicts.map((conflict) => conflict.code), ['C8']);
  assert.equal(service.claimsOf('service', 'catalog').length, 0);
  assert.equal(service.claimsOf('tool', 'search').length, 1);
});

test('an event whose emit throws does not break the adapter', async () => {
  const ctx = fakeContext({
    bundles: [
      { moduleName: 'a', rows: [{ rowId: 'main' }] },
      { moduleName: 'b', rows: [{ rowId: 'main' }] },
    ],
    emitThrows: true,
  });
  const service = createConflictService(ctx, {});
  await service.refresh();

  assert.equal(service.snapshot().conflicts.length, 1);
  assert.deepEqual(service.errors().map((error) => error.stage), ['emit']);
  assert.equal(service.errors()[0].event, 'conflict-detected');
});

test('a context with no host services still works, on plugin-reported claims only', async () => {
  const service = createConflictService(null, {});
  const snapshot = await service.refresh();
  assert.deepEqual(snapshot.conflicts, []);
  assert.deepEqual(service.errors(), []);

  service.upsert('only', [{ kind: 'tool', key: 'read' }]);
  assert.deepEqual(service.claims().map((claim) => claim.key), ['read']);
});

test('the table view and the declared kinds are exposed unchanged', async () => {
  const ctx = fakeContext({ tools: { definitions: async () => [{ name: 'read' }] } });
  const service = createConflictService(ctx, {});
  await service.refresh();

  assert.deepEqual([...service.table().keys()], [...OCCUPANCY_KINDS]);
  assert.deepEqual(service.kinds, OCCUPANCY_KINDS);
  assert.deepEqual(service.table().get('tool').get('read'), { owner: 'host:tools', uid: null });
});

test('service options are validated like the engine\'s own', () => {
  assert.throws(() => createConflictService(fakeContext(), { nope: true }), TypeError);
  assert.throws(() => createConflictService(fakeContext(), { collect: 'nope' }), TypeError);
  assert.throws(() => createConflictService(fakeContext(), { emitResolved: 'yes' }), TypeError);
  assert.throws(() => createConflictService(fakeContext(), null), TypeError);
  // Engine options are forwarded, so an unknown platform value still fails closed.
  assert.throws(() => createConflictService(fakeContext(), { platform: '' }), TypeError);
});

test('apply() wires the plugin: provides the service and disposes with the context', async () => {
  const ctx = fakeContext();
  const provided = new Map();
  const disposeHandlers = [];
  ctx.provide = (key, value) => provided.set(key, value);
  ctx.on = ((original) => (event, handler) => {
    if (event === 'dispose') {
      disposeHandlers.push(handler);
      return () => {};
    }
    return original(event, handler);
  })(ctx.on);

  const service = apply(ctx, {});
  await service.refresh();

  assert.equal(provided.get('compatConflicts'), service);
  assert.equal(disposeHandlers.length, 1);
  assert.equal(ctx.handlers.get('tools/change').length, 1);

  disposeHandlers[0]();
  assert.deepEqual(ctx.handlers.get('tools/change'), []);
});

test('report() and removeOwner() pass through to the engine', async () => {
  const service = createConflictService(fakeContext(), {});
  const result = service.report('plugin.one', {
    resources: [{ kind: 'service', name: 'catalog', scope: 'app' }],
    capabilities: { required: ['svc:missing'] },
  });
  assert.deepEqual(result, { accepted: 1, rejected: 0 });
  assert.deepEqual(service.conflicts().map((conflict) => conflict.code), ['C1']);

  service.removeOwner('plugin.one');
  assert.deepEqual(service.conflicts(), []);
  assert.equal(service.claims().length, 0);
});
