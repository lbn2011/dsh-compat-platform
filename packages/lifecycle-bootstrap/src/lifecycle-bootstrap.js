/**
 * Watches the plugin manager for newly installed packages and runs the lifecycle
 * script each of them declared in `dsh.lifecycle.postInstall`.
 *
 * The events this service listens to are only *triggers*: none of them carries a
 * package identity. `plugin-manager/install-state` is
 * `{ requestId, phase: 'installing' | 'cancelling' | 'applying', attempt? }`,
 * `plugin-manager/install-log` describes one output chunk of a pnpm run, and
 * `plugin-manager/changed` is `{ reason }`. So a trigger means "re-read", and the
 * package set is read from `pluginManager.listBundles()` / `listPlugins()` and
 * compared with the previous answer. A package is "new" when its module name was
 * absent from the previous read.
 *
 * Nothing here throws at the host. Every failure — an unreachable service, an
 * unresolvable package directory, a refused declaration, a non-zero exit — is
 * recorded and, where it concerns one package, published as an event.
 *
 * @module dsh-compat-lifecycle-bootstrap/lifecycle-bootstrap
 */

import { readFile as nodeReadFile, writeFile as nodeWriteFile, rename as nodeRename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { lifecyclePlanKey, readLifecyclePlan } from './lifecycle-manifest.js';
import { renderOutput, runLifecycle } from './lifecycle-runner.js';
import { mergePatchBlock } from './patch-merge.js';

export const LIFECYCLE_BOOTSTRAP_VERSION = 'lifecycle-bootstrap/0.1-draft.1';

/** Events this service publishes. All are namespaced under `dsh-compat/`. */
export const LIFECYCLE_EVENTS = Object.freeze({
  STATE: 'dsh-compat/lifecycle-state',
  LOG: 'dsh-compat/lifecycle-log',
  PATCH: 'dsh-compat/lifecycle-patch',
});

/** Host events this service subscribes to, all treated as "re-read" triggers. */
export const LIFECYCLE_SIGNALS = Object.freeze([
  'plugin-manager/install-state',
  'plugin-manager/install-log',
  'plugin-manager/changed',
]);

/** Where a package may publish the patch block this service merges. */
export const DEFAULT_BUNDLE_PATCH_PATH = 'dist/.dsh-patch.yml';

export const BOOTSTRAP_LIMITATIONS = Object.freeze([
  'NEW_PACKAGE_IS_INFERRED_FROM_A_SET_DIFF_NOT_FROM_THE_EVENT',
  'INSTALL_THAT_CHANGES_NO_MODULE_NAME_IS_INVISIBLE_HERE',
  'PATCH_MERGE_ASSUMES_A_WELL_FORMED_GENERATED_BLOCK',
  'HMR_IS_REQUESTED_NOT_VERIFIED',
  'SCRIPT_RUNS_ONCE_PER_DECLARATION_CHANGE',
]);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a service without assuming it was declared. An undeclared Cordis service
 * is not a safe property read, and a plugin that throws on a missing service
 * takes the host down with it.
 */
function resolveService(ctx, name) {
  if (!ctx) return null;
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined;
    if (viaGet !== undefined && viaGet !== null) return viaGet;
  } catch {
    /* Not declared and not readable: treated as absent. */
  }
  try {
    const direct = ctx[name];
    if (direct !== undefined && direct !== null) return direct;
  } catch {
    /* A getter that throws means "absent" for our purposes. */
  }
  return null;
}

const moduleNamesOf = (bundles, plugins) => {
  const names = new Set();
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    for (const row of Array.isArray(bundle?.rows) ? bundle.rows : []) {
      if (typeof row?.moduleName === 'string' && row.moduleName.length > 0) {
        names.add(row.moduleName);
      }
    }
  }
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    if (typeof plugin?.moduleName === 'string' && plugin.moduleName.length > 0) {
      names.add(plugin.moduleName);
    }
  }
  return [...names].sort();
};

/**
 * @param {object} ctx host context
 * @param {object} [options]
 * @param {Function} [options.readFile] fs/promises readFile-compatible
 * @param {Function} [options.writeFile] fs/promises writeFile-compatible
 * @param {Function} [options.rename] fs/promises rename-compatible
 * @param {Function} [options.runLifecycle] runner injection for tests
 * @param {Function} [options.resolvePackageDir] (moduleName) => string|null
 * @param {string}   [options.dshHome] home directory holding cordis.patch.yml
 * @param {string}   [options.bundlePatchPath] block path inside the package
 * @param {boolean}  [options.emitInstallLog] forward to plugin-manager/install-log
 * @param {number}   [options.maxOutputBytes]
 * @param {boolean}  [options.mergePatches]
 */
export function createLifecycleBootstrap(ctx, options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError('lifecycle-bootstrap: options must be an object');
  }
  const known = new Set();
  const ranKeys = new Set();
  const runs = [];
  const patches = [];
  const errors = [];
  const disposers = [];
  let inflight = null;
  let detoken = 0;
  let disposed = false;
  let sequence = 0;

  const readFile = options.readFile ?? nodeReadFile;
  const writeFile = options.writeFile ?? nodeWriteFile;
  const rename = options.rename ?? nodeRename;
  const runImpl = options.runLifecycle ?? runLifecycle;
  const emitInstallLog = options.emitInstallLog !== false;
  const mergePatches = options.mergePatches !== false;
  const bundlePatchPath = options.bundlePatchPath ?? DEFAULT_BUNDLE_PATCH_PATH;
  const maxOutputBytes = options.maxOutputBytes ?? 65536;

  const emit = (name, payload) => {
    try {
      if (typeof ctx?.emit === 'function') ctx.emit(name, payload);
    } catch (error) {
      errors.push({ stage: 'emit', event: name, message: String(error?.message ?? error) });
    }
  };

  const dshHome = () => {
    if (typeof options.dshHome === 'string') return options.dshHome;
    const service = resolveService(ctx, 'dshHomePath');
    try {
      if (typeof service === 'function') {
        const resolved = service();
        if (typeof resolved === 'string') return resolved;
      }
    } catch {
      /* Fall through to the environment. */
    }
    const fromEnv = ctx?.env?.DSH_HOME;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
    const processEnv = typeof process !== 'undefined' ? process.env?.DSH_HOME : undefined;
    return typeof processEnv === 'string' && processEnv.length > 0 ? processEnv : null;
  };

  const defaultResolvePackageDir = (moduleName) => {
    const bases = [];
    try {
      if (typeof ctx?.baseDir === 'string') bases.push(ctx.baseDir);
    } catch {
      /* ignore */
    }
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') bases.push(process.cwd());
    for (const base of bases) {
      try {
        const require = createRequire(pathToFileURL(join(base, 'index.js')));
        return dirname(require.resolve(`${moduleName}/package.json`));
      } catch {
        /* try the next base */
      }
    }
    return null;
  };
  const resolvePackageDir = options.resolvePackageDir ?? defaultResolvePackageDir;

  const emitLog = (payload) => {
    emit(LIFECYCLE_EVENTS.LOG, payload);
    if (!emitInstallLog) return;
    emit('plugin-manager/install-log', {
      jobId: payload.jobId,
      argv: payload.argv,
      cwd: payload.cwd,
      stream: payload.stream,
      text: payload.text,
      ...(payload.exitCode === undefined ? {} : { exitCode: payload.exitCode }),
    });
  };

  const applyPatchBlock = async (moduleName, packageDir) => {
    if (!mergePatches) return;
    const blockPath = join(packageDir, bundlePatchPath);
    let block;
    try {
      block = await readFile(blockPath, 'utf8');
    } catch {
      return; // No generated block is the common case, not a failure.
    }
    const home = dshHome();
    if (home === null) {
      const record = { package: moduleName, status: 'refused', code: 'HOME_UNKNOWN', addedIds: [], skippedIds: [] };
      patches.push(record);
      emit(LIFECYCLE_EVENTS.PATCH, record);
      return;
    }
    const homePath = join(home, 'cordis.patch.yml');
    let homeText = null;
    try {
      homeText = await readFile(homePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const record = { package: moduleName, status: 'refused', code: 'HOME_UNREADABLE', addedIds: [], skippedIds: [] };
        patches.push(record);
        emit(LIFECYCLE_EVENTS.PATCH, record);
        return;
      }
    }
    const merged = mergePatchBlock({ homeText, block });
    const record = {
      package: moduleName,
      status: merged.status,
      code: merged.code,
      addedIds: merged.addedIds,
      skippedIds: merged.skippedIds,
    };
    patches.push(record);
    emit(LIFECYCLE_EVENTS.PATCH, record);
    if (merged.status !== 'appended' || merged.text === null) return;

    const temporary = `${homePath}.lifecycle-${process.pid}-${++sequence}.tmp`;
    try {
      await writeFile(temporary, merged.text, 'utf8');
      await rename(temporary, homePath);
    } catch (error) {
      errors.push({ stage: 'patch-write', package: moduleName, message: String(error?.message ?? error) });
      return;
    }
    const hmr = resolveService(ctx, 'hmr');
    try {
      if (hmr && typeof hmr.runExclusive === 'function' && typeof hmr.reconcileProfile === 'function') {
        const result = await hmr.runExclusive(() => hmr.reconcileProfile());
        emit(LIFECYCLE_EVENTS.PATCH, {
          package: moduleName,
          status: 'reconcile-requested',
          warnings: Array.isArray(result?.warnings) ? result.warnings.length : 0,
          pending: Array.isArray(result?.pending) ? result.pending.length : 0,
          restartReason: result?.restartReason ?? null,
        });
      } else {
        errors.push({ stage: 'hmr', package: moduleName, message: 'hmr service absent; the watcher must apply the file' });
      }
    } catch (error) {
      errors.push({ stage: 'hmr', package: moduleName, message: String(error?.message ?? error) });
    }
  };

  const runOne = async (moduleName) => {
    const packageDir = resolvePackageDir(moduleName);
    if (typeof packageDir !== 'string' || packageDir.length === 0) {
      emit(LIFECYCLE_EVENTS.STATE, {
        package: moduleName,
        phase: 'refused',
        code: 'PACKAGE_DIR_UNRESOLVED',
      });
      return;
    }
    let pkgJson;
    try {
      const text = await readFile(join(packageDir, 'package.json'), 'utf8');
      pkgJson = JSON.parse(text);
    } catch (error) {
      emit(LIFECYCLE_EVENTS.STATE, {
        package: moduleName,
        phase: 'refused',
        code: 'PACKAGE_JSON_UNREADABLE',
        message: String(error?.message ?? error),
      });
      return;
    }

    const { plan, issues, limitations } = readLifecyclePlan(pkgJson, { packageDir });
    if (issues.length > 0) {
      emit(LIFECYCLE_EVENTS.STATE, { package: moduleName, phase: 'refused', code: 'DECLARATION_INVALID', issues });
      return;
    }
    if (plan === null) return; // No lifecycle declared: nothing to do, nothing to say.

    const key = `${moduleName}\u0000${lifecyclePlanKey(plan)}`;
    if (ranKeys.has(key)) return;
    ranKeys.add(key);

    const jobId = `dsh-compat-lifecycle:${moduleName}:${++sequence}`;
    emit(LIFECYCLE_EVENTS.STATE, {
      package: moduleName,
      phase: 'running',
      jobId,
      script: plan.script,
      args: plan.args,
      timeoutMs: plan.timeoutMs,
      limitations,
    });

    const result = await runImpl(plan, {
      cwd: packageDir,
      maxOutputBytes,
      env: typeof process !== 'undefined' ? process.env : {},
    });

    for (const chunk of result.chunks) {
      emitLog({
        jobId,
        argv: [process.execPath, plan.scriptPath, ...plan.args],
        cwd: packageDir,
        stream: chunk.stream,
        text: chunk.text,
      });
    }
    emitLog({
      jobId,
      argv: [process.execPath, plan.scriptPath, ...plan.args],
      cwd: packageDir,
      stream: 'stdout',
      text: '',
      exitCode: result.exitCode,
    });

    const record = {
      package: moduleName,
      phase: result.status,
      code: result.code,
      jobId,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      outputBytes: result.outputBytes,
      outputTruncated: result.outputTruncated,
      output: renderOutput(result.chunks),
      limitations: result.limitations,
    };
    runs.push(record);
    emit(LIFECYCLE_EVENTS.STATE, record);

    if (result.status === 'ok') await applyPatchBlock(moduleName, packageDir);
  };

  const refresh = async () => {
    if (inflight !== null) return inflight;
    inflight = (async () => {
      const pluginManager = resolveService(ctx, 'pluginManager');
      if (!pluginManager) {
        errors.push({ stage: 'refresh', message: 'pluginManager service absent' });
        return { newPackages: [], ran: 0 };
      }
      let bundles = [];
      let plugins = [];
      try {
        if (typeof pluginManager.listBundles === 'function') bundles = await pluginManager.listBundles();
      } catch (error) {
        errors.push({ stage: 'listBundles', message: String(error?.message ?? error) });
      }
      try {
        if (typeof pluginManager.listPlugins === 'function') plugins = await pluginManager.listPlugins();
      } catch (error) {
        errors.push({ stage: 'listPlugins', message: String(error?.message ?? error) });
      }
      const names = moduleNamesOf(bundles, plugins);
      if (names.length === 0 && bundles.length === 0 && plugins.length === 0) {
        // An empty answer is not evidence that every package was removed.
        return { newPackages: [], ran: 0 };
      }
      const fresh = names.filter((name) => !known.has(name));
      known.clear();
      for (const name of names) known.add(name);
      let ran = 0;
      for (const moduleName of fresh) {
        try {
          await runOne(moduleName);
          ran += 1;
        } catch (error) {
          errors.push({ stage: 'run', package: moduleName, message: String(error?.message ?? error) });
        }
      }
      return { newPackages: fresh, ran };
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const schedule = () => {
    if (inflight !== null) return;
    queueMicrotask(() => {
      refresh().catch((error) => {
        errors.push({ stage: 'schedule', message: String(error?.message ?? error) });
      });
    });
  };

  const attach = () => {
    const disposer = ctx?.on ? null : undefined;
    if (typeof ctx?.on !== 'function') {
      errors.push({ stage: 'attach', message: 'ctx.on is unavailable' });
      return false;
    }
    for (const signal of LIFECYCLE_SIGNALS) {
      try {
        const dispose = ctx.on(signal, () => schedule());
        if (typeof dispose === 'function') disposers.push(dispose);
      } catch (error) {
        errors.push({ stage: 'subscribe', event: signal, message: String(error?.message ?? error) });
      }
    }
    // Establish the baseline without running anything: only packages that appear
    // after attach are "new".
    const baseline = (async () => {
      const pluginManager = resolveService(ctx, 'pluginManager');
      if (!pluginManager) return;
      try {
        const bundles = typeof pluginManager.listBundles === 'function' ? await pluginManager.listBundles() : [];
        const plugins = typeof pluginManager.listPlugins === 'function' ? await pluginManager.listPlugins() : [];
        const names = moduleNamesOf(bundles, plugins);
        if (names.length > 0) for (const name of names) known.add(name);
      } catch (error) {
        errors.push({ stage: 'baseline', message: String(error?.message ?? error) });
      }
    })();
    return baseline.then(() => true);
  };

  const detach = () => {
    if (disposed) return;
    disposed = true;
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      try {
        dispose?.();
      } catch (error) {
        errors.push({ stage: 'dispose', message: String(error?.message ?? error) });
      }
    }
    detoken += 1;
  };

  return {
    version: LIFECYCLE_BOOTSTRAP_VERSION,
    attach,
    detach,
    refresh,
    state: () => ({
      known: [...known].sort(),
      runs: runs.length,
      patches: patches.length,
      disposed,
    }),
    runs: () => [...runs],
    patches: () => [...patches],
    errors: () => [...errors],
    limitations: () => [...BOOTSTRAP_LIMITATIONS],
    // Exposed for tests and for a caller that wants to run one package on demand.
    runPackage: (moduleName) => runOne(moduleName),
    knownPackages: () => [...known].sort(),
    get token() {
      return detoken;
    },
  };
}

/** Publish the constants a caller may want to render without importing each module. */
export const LIFECYCLE_BOOTSTRAP_CONSTANTS = Object.freeze({
  events: LIFECYCLE_EVENTS,
  signals: LIFECYCLE_SIGNALS,
  limitations: BOOTSTRAP_LIMITATIONS,
  bundlePatchPath: DEFAULT_BUNDLE_PATCH_PATH,
});
