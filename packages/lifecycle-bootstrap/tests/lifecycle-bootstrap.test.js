import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  BOOTSTRAP_LIMITATIONS,
  DEFAULT_BUNDLE_PATCH_PATH,
  LIFECYCLE_BOOTSTRAP_VERSION,
  LIFECYCLE_EVENTS,
  LIFECYCLE_SIGNALS,
  createLifecycleBootstrap,
} from '../src/lifecycle-bootstrap.js';
import { apply, inject, name, readOptions } from '../src/index.js';

const PATCH_BLOCK = ['- insert:', '    - id: demo:main', "      name: 'demo'", ''].join('\n');

/**
 * A fake host context: an emitter, a plugin manager whose answer the test
 * controls, and a filesystem map. No real file or process is touched.
 */
function fakeHost({ bundles = [], plugins = [], files = {} } = {}) {
  const events = new EventEmitter();
  const emitted = [];
  const ctx = {
    baseDir: '/repo',
    events,
    on(event, handler) {
      events.on(event, handler);
      return () => events.off(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    get(serviceName) {
      if (serviceName === 'pluginManager') return ctx.pluginManager;
      if (serviceName === 'hmr') return ctx.hmr;
      if (serviceName === 'dshHomePath') return ctx.dshHomePath;
      return undefined;
    },
    pluginManager: {
      async listBundles() {
        return bundles;
      },
      async listPlugins() {
        return plugins;
      },
    },
    hmr: {
      calls: 0,
      async runExclusive(operation) {
        ctx.hmr.calls += 1;
        return operation();
      },
      async reconcileProfile() {
        return { warnings: ['w'], pending: [{}, {}], restartReason: 'module-comparison' };
      },
    },
  };

  const fileMap = new Map(Object.entries(files));
  const writes = [];
  const options = {
    dshHome: '/home/.dsh',
    async readFile(path, encoding) {
      if (!fileMap.has(path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        throw error;
      }
      return fileMap.get(path);
    },
    async writeFile(path, text, encoding) {
      writes.push({ path, text });
      fileMap.set(path, text);
    },
    async rename(from, to) {
      const text = fileMap.get(from);
      fileMap.delete(from);
      fileMap.set(to, text);
    },
  };
  return { ctx, emitted, fileMap, writes, options };
}

const bundle = (moduleName, rowId = moduleName) => ({
  moduleName,
  rows: [{ rowId, moduleName }],
});

const runOk = async (plan, options) => ({
  status: 'ok',
  code: null,
  exitCode: 0,
  signal: null,
  durationMs: 3,
  chunks: [
    { stream: 'stdout', text: 'built\n' },
    { stream: 'stderr', text: 'warn\n' },
  ],
  outputBytes: 11,
  outputTruncated: false,
  limitations: [],
});

test('the vocabulary is closed and frozen', () => {
  assert.equal(LIFECYCLE_BOOTSTRAP_VERSION, 'lifecycle-bootstrap/0.1-draft.1');
  assert.deepEqual(Object.keys(LIFECYCLE_EVENTS).sort(), ['LOG', 'PATCH', 'STATE']);
  assert.deepEqual([...LIFECYCLE_SIGNALS], [
    'plugin-manager/install-state',
    'plugin-manager/install-log',
    'plugin-manager/changed',
  ]);
  assert.equal(DEFAULT_BUNDLE_PATCH_PATH, 'dist/.dsh-patch.yml');
  assert.ok(Object.isFrozen(BOOTSTRAP_LIMITATIONS));
  assert.ok(BOOTSTRAP_LIMITATIONS.includes('HMR_IS_REQUESTED_NOT_VERIFIED'));
});

test('attaching subscribes every signal and establishes a baseline', async () => {
  const host = fakeHost({ bundles: [bundle('existing')] });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();

  for (const signal of LIFECYCLE_SIGNALS) {
    assert.equal(host.ctx.events.listenerCount(signal), 1, signal);
  }
  assert.deepEqual(service.knownPackages(), ['existing']);
  // The baseline itself runs nothing.
  assert.deepEqual(service.runs(), []);
});

test('a package that appears after the baseline is run exactly once', async () => {
  const host = fakeHost({
    bundles: [bundle('existing')],
    files: {
      '/repo/node_modules/new-plugin/package.json': JSON.stringify({
        name: 'new-plugin',
        dsh: { lifecycle: { postInstall: 'scripts/build.js' } },
      }),
    },
  });
  const seen = [];
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: (moduleName) => `/repo/node_modules/${moduleName}`,
    runLifecycle: async (plan, options) => {
      seen.push({ plan, options });
      return runOk(plan, options);
    },
  });
  await service.attach();

  host.ctx.pluginManager.listBundles = async () => [bundle('existing'), bundle('new-plugin')];
  const result = await service.refresh();

  assert.deepEqual(result.newPackages, ['new-plugin']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].plan.scriptPath, '/repo/node_modules/new-plugin/scripts/build.js');
  assert.equal(seen[0].options.cwd, '/repo/node_modules/new-plugin');

  const states = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.STATE);
  assert.equal(states[0].payload.phase, 'running');
  assert.equal(states.at(-1).payload.phase, 'ok');
  assert.equal(states.at(-1).payload.exitCode, 0);

  // A second refresh with the same set runs nothing new.
  const again = await service.refresh();
  assert.deepEqual(again.newPackages, []);
  assert.equal(seen.length, 1);
});

test('the three signals are triggers: any one of them schedules a re-read', async () => {
  const host = fakeHost({ bundles: [bundle('existing')] });
  let reads = 0;
  host.ctx.pluginManager.listBundles = async () => {
    reads += 1;
    return [bundle('existing')];
  };
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  const afterBaseline = reads;

  for (const signal of LIFECYCLE_SIGNALS) {
    host.ctx.events.emit(signal, { phase: 'applying', reason: 'install', jobId: 'x' });
  }
  // The scheduler is single-flight: three triggers, at most one extra read.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(reads - afterBaseline <= 1, `reads grew by ${reads - afterBaseline}`);
  await service.refresh();
  assert.deepEqual(service.runs(), []);
});

test('lifecycle output is forwarded to the install log, with a namespaced job id', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({
        dsh: { lifecycle: { postInstall: { script: 'build.js', timeoutMs: 500 } } },
      }),
    },
  });
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');

  const logs = host.emitted.filter((entry) => entry.event === 'plugin-manager/install-log');
  assert.equal(logs.length, 3); // stdout, stderr, final exit marker
  assert.equal(logs[0].payload.stream, 'stdout');
  assert.equal(logs[0].payload.text, 'built\n');
  assert.equal(logs[1].payload.stream, 'stderr');
  assert.equal(logs[2].payload.exitCode, 0);
  for (const entry of logs) {
    assert.match(entry.payload.jobId, /^dsh-compat-lifecycle:demo:\d+$/);
    assert.equal('requestId' in entry.payload, false);
    assert.equal(entry.payload.cwd, '/pkg');
    assert.ok(Array.isArray(entry.payload.argv));
  }

  // The structured event exists in parallel with the host channel.
  const structured = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.LOG);
  assert.equal(structured.length, 3);
});

test('forwarding can be switched off without losing the structured event', async () => {
  const host = fakeHost({
    files: { '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }) },
  });
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    emitInstallLog: false,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(host.emitted.filter((entry) => entry.event === 'plugin-manager/install-log').length, 0);
  assert.equal(host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.LOG).length, 3);
});

test('a failing run is reported and never merged or thrown', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }),
      '/pkg/dist/.dsh-patch.yml': PATCH_BLOCK,
    },
  });
  let hmrCalls = 0;
  host.ctx.hmr.runExclusive = async (operation) => {
    hmrCalls += 1;
    return operation();
  };
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: async () => ({
      status: 'failed',
      code: null,
      exitCode: 1,
      signal: null,
      durationMs: 2,
      chunks: [{ stream: 'stderr', text: 'nope\n' }],
      outputBytes: 5,
      outputTruncated: false,
      limitations: [],
    }),
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(hmrCalls, 0);
  assert.equal(host.writes.length, 0);
  assert.equal(service.patches().length, 0);
  const last = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.STATE).at(-1);
  assert.equal(last.payload.phase, 'failed');
  assert.equal(last.payload.exitCode, 1);
});

test('an invalid declaration is refused before anything runs', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: '../escape.js' } } }),
    },
  });
  let runs = 0;
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: async () => {
      runs += 1;
      return runOk();
    },
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(runs, 0);
  const refused = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.STATE);
  assert.deepEqual(refused.map((entry) => entry.payload.phase), ['refused']);
  assert.equal(refused[0].payload.code, 'DECLARATION_INVALID');
  assert.deepEqual(refused[0].payload.issues, ['SCRIPT_OUTSIDE_PACKAGE']);
});

test('an unresolvable package is refused, not silently skipped', async () => {
  const host = fakeHost();
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => null,
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('ghost');
  const states = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.STATE);
  assert.equal(states[0].payload.code, 'PACKAGE_DIR_UNRESOLVED');
});

test('a patch block is merged into the home file and HMR is asked to reconcile', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }),
      '/pkg/dist/.dsh-patch.yml': PATCH_BLOCK,
      '/home/.dsh/cordis.patch.yml': '- id: already\n',
    },
  });
  let htCalls = 0;
  host.ctx.hmr.runExclusive = async (operation) => {
    htCalls += 1;
    return operation();
  };
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(htCalls, 1);
  assert.equal(host.writes.length, 1);
  assert.match(host.writes[0].path, /cordis\.patch\.yml\.lifecycle-\d+-\d+\.tmp$/);
  const written = host.fileMap.get('/home/.dsh/cordis.patch.yml');
  assert.ok(written.startsWith('- id: already\n'));
  assert.ok(written.includes('demo:main'));

  const patchEvents = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH);
  assert.deepEqual(patchEvents.map((entry) => entry.payload.status), ['appended', 'reconcile-requested']);
  assert.equal(patchEvents[1].payload.pending, 2);
  assert.equal(patchEvents[1].payload.warnings, 1);
});

test('a second package carrying the same ids is skipped, not appended twice', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }),
      '/pkg/dist/.dsh-patch.yml': PATCH_BLOCK,
      '/home/.dsh/cordis.patch.yml': "- id: 'demo:main'\n",
    },
  });
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(host.writes.length, 0);
  const patchEvents = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH);
  assert.deepEqual(patchEvents[0].payload.status, 'skipped');
  assert.deepEqual(patchEvents[0].payload.skippedIds, ['demo:main']);
});

test('a package without a generated block does not touch the home file', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }),
    },
  });
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');
  assert.equal(host.writes.length, 0);
  assert.equal(host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH).length, 0);
});

test('an absent HMR service is recorded, not fatal', async () => {
  const host = fakeHost({
    files: {
      '/pkg/package.json': JSON.stringify({ dsh: { lifecycle: { postInstall: 'a.js' } } }),
      '/pkg/dist/.dsh-patch.yml': PATCH_BLOCK,
    },
  });
  delete host.ctx.hmr;
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    resolvePackageDir: () => '/pkg',
    runLifecycle: runOk,
  });
  await service.attach();
  await service.runPackage('demo');

  assert.equal(host.writes.length, 1);
  assert.ok(service.errors().some((entry) => entry.stage === 'hmr'));
});

test('a missing plugin manager is an error entry, not a throw', async () => {
  const host = fakeHost();
  delete host.ctx.pluginManager;
  const service = createLifecycleBootstrap(host.ctx, host.options);
  const result = await service.refresh();
  assert.deepEqual(result, { newPackages: [], ran: 0 });
  assert.ok(service.errors().some((entry) => entry.stage === 'refresh'));
});

test('detaching removes every subscription and is idempotent', async () => {
  const host = fakeHost({ bundles: [bundle('existing')] });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  const token = service.token;
  service.detach();
  service.detach();
  for (const signal of LIFECYCLE_SIGNALS) {
    assert.equal(host.ctx.events.listenerCount(signal), 0, signal);
  }
  assert.equal(service.token, token + 1);
});

test('the plugin entry publishes one service and releases it on dispose', () => {
  const host = fakeHost();
  const provided = new Map();
  let disposeHandler = null;
  host.ctx.provide = (key, value) => provided.set(key, value);
  host.ctx.on = (event, handler) => {
    if (event === 'dispose') disposeHandler = handler;
    return () => {};
  };

  const service = apply(host.ctx, { forwardToHostLog: false });
  assert.equal(name, 'dsh-compat-lifecycle-bootstrap');
  assert.deepEqual(inject, ['pluginManager']);
  assert.equal(provided.get('compatLifecycle'), service);
  assert.equal(typeof disposeHandler, 'function');

  disposeHandler();
  assert.equal(typeof service.detach, 'function');
});

test('config is validated against a closed key set', () => {
  assert.deepEqual(readOptions(undefined), { emitInstallLog: true });
  assert.deepEqual(readOptions({}), { emitInstallLog: true });
  assert.deepEqual(readOptions({ forwardToHostLog: false }), { emitInstallLog: false });
  assert.deepEqual(readOptions({ mergePatches: false, maxOutputBytes: 10 }), {
    emitInstallLog: true,
    mergePatches: false,
    maxOutputBytes: 10,
  });
  assert.throws(() => readOptions('nope'), { name: 'TypeError' });
  assert.throws(() => readOptions({ forwarding: true }), {
    name: 'TypeError',
    message: /unknown key: forwarding/,
  });
  assert.throws(() => readOptions({ forwardToHostLog: 'yes' }), { name: 'TypeError' });
  assert.throws(() => readOptions({ mergePatches: 1 }), { name: 'TypeError' });
  assert.throws(() => readOptions({ dshHome: '' }), { name: 'TypeError' });
  assert.throws(() => readOptions({ bundlePatchPath: 5 }), { name: 'TypeError' });
  assert.throws(() => readOptions({ maxOutputBytes: 0 }), { name: 'TypeError' });
});

test('the service reports its own state without exposing internals', async () => {
  const host = fakeHost({ bundles: [bundle('existing')] });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  const state = service.state();
  assert.deepEqual(state, { known: ['existing'], runs: 0, patches: 0, disposed: false });
  assert.deepEqual(service.limitations(), [...BOOTSTRAP_LIMITATIONS]);
  assert.deepEqual(service.errors(), []);
});
