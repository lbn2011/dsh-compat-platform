/**
 * Bundle installation, driven through the lifecycle bootstrap — the component
 * that reacts to `plugin-manager/*` events and is the only place in these three
 * repositories where an installed package's patch block reaches disk.
 *
 * A FAKE HOST, A REAL CODE PATH. The plugin-manager answers from a list the test
 * controls and the filesystem is an in-memory map, so nothing here installs,
 * starts or restarts anything. What is real: the bootstrap's own diffing, its
 * decision to run, the lifecycle runner's plan reading, `mergePatchBlock`, and
 * the write-then-rename of the operator's YAML.
 *
 * THE COUPLING THIS FILE PINS DOWN: `applyPatchBlock` runs only after a
 * lifecycle run returns `ok`, and only for packages that declare
 * `dsh.lifecycle` at all (`if (plan === null) return`). A bundle that ships
 * `dsh.bundle.patch` but no lifecycle declaration therefore never has its patch
 * merged. That is the implemented behaviour, not a claim that it is intended;
 * the case is asserted so the gap is visible rather than discovered in
 * production.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  LIFECYCLE_EVENTS,
  createLifecycleBootstrap,
} from '../../packages/lifecycle-bootstrap/src/lifecycle-bootstrap.js';

const HOME_DIR = '/home/.dsh';
const HOME_PATCH = `${HOME_DIR}/cordis.patch.yml`;
const OPERATOR_TEXT = [
  '- id: plugin-manager',
  "  plugin: '@deepseek-ai/dsh-plugin-manager'",
  '',
].join('\n');

const BUNDLE_PATCH = [
  '- insert:',
  '    - id: enterprise-plugin-manager',
  "      name: './lib/plugin-manager.js'",
  '',
].join('\n');

/** The fake host used by the lifecycle-bootstrap package's own tests. */
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
      reconcileCalls: 0,
      async runExclusive(operation) {
        return operation();
      },
      async reconcileProfile() {
        ctx.hmr.reconcileCalls += 1;
        return { warnings: [], pending: [{}], restartReason: 'module-comparison' };
      },
    },
  };
  const fileMap = new Map(Object.entries(files));
  const writes = [];
  const options = {
    dshHome: HOME_DIR,
    async readFile(path) {
      if (!fileMap.has(path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        throw error;
      }
      return fileMap.get(path);
    },
    async writeFile(path, text) {
      writes.push({ path, text });
      fileMap.set(path, text);
    },
    async rename(from, to) {
      const text = fileMap.get(from);
      fileMap.delete(from);
      fileMap.set(to, text);
    },
    resolvePackageDir: (moduleName) => `/repo/node_modules/${moduleName}`,
    runLifecycle: async () => ({
      status: 'ok',
      code: null,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      chunks: [],
      outputBytes: 0,
      outputTruncated: false,
      limitations: [],
    }),
  };
  return { ctx, emitted, fileMap, writes, options };
}

const bundle = (moduleName) => ({ moduleName, rows: [{ rowId: moduleName, moduleName }] });

const installedPackage = (name, { patch = BUNDLE_PATCH, lifecycle = 'scripts/build.js' } = {}) => ({
  [`/repo/node_modules/${name}/package.json`]: JSON.stringify({
    name,
    ...(lifecycle === null ? {} : { dsh: { lifecycle: { postInstall: lifecycle } } }),
  }),
  ...(patch === null ? {} : { [`/repo/node_modules/${name}/dist/.dsh-patch.yml`]: patch }),
});

test('installing a bundle appends its patch block and requests one HMR reconcile', async () => {
  const host = fakeHost({
    bundles: [bundle('core-bundle')],
    files: { [HOME_PATCH]: OPERATOR_TEXT, ...installedPackage('enterprise-bundle') },
  });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();

  // A new bundle appears: the event is only a trigger, the fact comes from the
  // plugin manager's own answer.
  host.ctx.pluginManager.listBundles = async () => [bundle('core-bundle'), bundle('enterprise-bundle')];
  host.ctx.events.emit('plugin-manager/install-state', { requestId: 'req-1', phase: 'ok' });
  const refreshed = await service.refresh();
  assert.deepEqual(refreshed.newPackages, ['enterprise-bundle']);

  // The operator's file is replaced atomically: a temporary name is written and
  // then renamed over it, never written in place.
  assert.equal(host.writes.length, 1);
  assert.match(host.writes[0].path, /cordis\.patch\.yml\.lifecycle-\d+-\d+\.tmp$/);

  const after = host.fileMap.get(HOME_PATCH);
  assert.ok(after.startsWith(OPERATOR_TEXT), 'the operator rows survive byte for byte');
  assert.ok(after.includes('enterprise-plugin-manager'), 'the bundle row is appended');
  // The core row a bundle "replaces" is left alone here: replacement is expressed
  // by the bundle's own declared rows, not by deleting the operator's.
  assert.ok(after.includes("plugin: '@deepseek-ai/dsh-plugin-manager'"));

  const patchRecords = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH);
  assert.equal(patchRecords[0].payload.status, 'appended');
  assert.deepEqual(patchRecords[0].payload.addedIds, ['enterprise-plugin-manager']);
  // And the restart is requested, not performed: an HMR reconcile call is the
  // most this component can do.
  assert.equal(host.ctx.hmr.reconcileCalls, 1);
  assert.ok(patchRecords.some((entry) => entry.payload.status === 'reconcile-requested'));

  // A second install event over the same bundle set changes nothing.
  await service.refresh();
  assert.equal(host.writes.length, 1);
});

test('a bundle whose patch is already present is skipped, and its YAML is not rewritten', async () => {
  const homeWithRow = `${OPERATOR_TEXT}- insert:\n    - id: enterprise-plugin-manager\n      name: './lib/plugin-manager.js'\n`;
  const host = fakeHost({
    bundles: [bundle('core-bundle')],
    files: { [HOME_PATCH]: homeWithRow, ...installedPackage('second-bundle') },
  });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  host.ctx.pluginManager.listBundles = async () => [bundle('core-bundle'), bundle('second-bundle')];
  await service.refresh();

  const records = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH && entry.payload.package === 'second-bundle');
  assert.equal(records.length, 1);
  assert.equal(host.fileMap.get(HOME_PATCH), homeWithRow, 'nothing to add means nothing is written');
  assert.equal(host.ctx.hmr.reconcileCalls, 0, 'and no restart is requested');
});

test('a partially overlapping patch is refused and the operator file is untouched', async () => {
  // The operator's file already owns one of the two ids the bundle wants.
  const homePartial = `${OPERATOR_TEXT}- id: enterprise-plugin-manager\n  name: './lib/old.js'\n`;
  const partialBlock = [
    '- insert:',
    '    - id: enterprise-plugin-manager',
    "      name: './lib/plugin-manager.js'",
    '    - id: enterprise-audit',
    "      name: './lib/audit.js'",
    '',
  ].join('\n');
  const host = fakeHost({
    bundles: [bundle('core-bundle')],
    files: { [HOME_PATCH]: homePartial, ...installedPackage('partial-bundle', { patch: partialBlock }) },
  });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  // partial-bundle is the one that appears after the baseline.
  host.ctx.pluginManager.listBundles = async () => [bundle('core-bundle'), bundle('partial-bundle')];
  await service.refresh();

  const refused = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH && entry.payload.package === 'partial-bundle');
  assert.equal(refused[0].payload.status, 'refused');
  assert.equal(refused[0].payload.code, 'PARTIAL_OVERLAP');
  assert.equal(host.fileMap.get(HOME_PATCH), homePartial, 'a refused merge writes nothing');
  assert.equal(host.writes.length, 0);
});

test('a bundle patch without a lifecycle declaration is never merged — the coupling, asserted', async () => {
  // The package ships dist/.dsh-patch.yml but declares no dsh.lifecycle, so the
  // bootstrap returns before applyPatchBlock is reached. Nothing is merged and
  // nothing is said: the package produces no STATE and no PATCH record.
  const host = fakeHost({
    bundles: [bundle('patch-only-bundle')],
    files: { [HOME_PATCH]: OPERATOR_TEXT, ...installedPackage('patch-only-bundle', { lifecycle: null }) },
  });
  const service = createLifecycleBootstrap(host.ctx, host.options);
  await service.attach();
  host.ctx.pluginManager.listBundles = async () => [bundle('patch-only-bundle'), bundle('plain')];
  for (const [path, text] of Object.entries(installedPackage('plain', { lifecycle: null }))) host.fileMap.set(path, text);
  const result = await service.refresh();

  assert.deepEqual(result.newPackages, ['plain']);
  assert.equal(host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH).length, 0);
  assert.equal(host.fileMap.get(HOME_PATCH), OPERATOR_TEXT, 'the patch block was not merged');
});

test('a failed lifecycle run does not merge its patch', async () => {
  const host = fakeHost({
    bundles: [bundle('broken-bundle')],
    files: { [HOME_PATCH]: OPERATOR_TEXT, ...installedPackage('broken-bundle') },
  });
  const service = createLifecycleBootstrap(host.ctx, {
    ...host.options,
    runLifecycle: async () => ({
      status: 'failed',
      code: 'EXIT_CODE_NON_ZERO',
      exitCode: 1,
      signal: null,
      durationMs: 2,
      chunks: [{ stream: 'stderr', text: 'boom\n' }],
      outputBytes: 5,
      outputTruncated: false,
      limitations: [],
    }),
  });
  await service.attach();
  host.ctx.pluginManager.listBundles = async () => [bundle('broken-bundle'), bundle('other')];
  for (const [path, text] of Object.entries(installedPackage('other'))) host.fileMap.set(path, text);
  await service.refresh();

  const states = host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.STATE && entry.payload.package === 'other');
  assert.equal(states.at(-1).payload.phase, 'failed');
  assert.equal(host.emitted.filter((entry) => entry.event === LIFECYCLE_EVENTS.PATCH).length, 0);
  assert.equal(host.fileMap.get(HOME_PATCH), OPERATOR_TEXT);
});
