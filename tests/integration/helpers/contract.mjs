/**
 * Shared integration-test contract: where the sibling repositories are, what
 * version each one reports, and how a cross-repo import states its assumption.
 *
 * INTEGRATION TESTS ARE ALLOWED TO IMPORT A SIBLING REPOSITORY BY PATH; the
 * shipped packages are not. Every package README in this repository says a
 * package never resolves a sibling repository at runtime, and that stays true:
 * this helper lives under `tests/`, is imported by test files only, and never
 * by anything under `packages/`. A path that is missing produces one labelled
 * error naming the repository, so a failure says "the sibling tree is not
 * checked out here" instead of an unhandled `ERR_MODULE_NOT_FOUND` deep in a
 * stack trace.
 *
 * The resolution order is: `DSH_ECOSYSTEM_ROOT` if set, otherwise the
 * ecosystem root two levels above this repository (`projects/<repo>`, so
 * `../..` from the repository root). No network, no registry, no submodule.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of this repository (`projects/dsh-compat-platform`). */
export const PLATFORM_ROOT = resolve(HERE, '..', '..', '..');

/**
 * The ecosystem checkout that holds `projects/{dsh-compat-spec,dsh-plugin-kit,dsh-compat-platform}`.
 * Overridable so the envelope can point at a moved checkout without editing code.
 */
export const ECOSYSTEM_ROOT = process.env.DSH_ECOSYSTEM_ROOT
  ? resolve(process.env.DSH_ECOSYSTEM_ROOT)
  : resolve(PLATFORM_ROOT, '..', '..');

/** Absolute paths of the three repositories under test. */
export const REPOS = Object.freeze({
  platform: PLATFORM_ROOT,
  spec: join(ECOSYSTEM_ROOT, 'projects', 'dsh-compat-spec'),
  kit: join(ECOSYSTEM_ROOT, 'projects', 'dsh-plugin-kit'),
});

/**
 * Resolve a path inside a repository, failing with a sentence that names the
 * repository rather than with a bare ENOENT from an import.
 *
 * @param {'platform'|'spec'|'kit'} repo
 * @param {string} relativePath
 * @returns {string} absolute path
 */
export function repoPath(repo, relativePath) {
  const root = REPOS[repo];
  if (typeof root !== 'string') throw new Error(`integration: unknown repository "${repo}"`);
  if (!existsSync(root)) {
    throw new Error(
      `integration: repository "${repo}" is not checked out at ${root}. `
      + 'Set DSH_ECOSYSTEM_ROOT to the ecosystem root that holds projects/.',
    );
  }
  const target = resolve(root, relativePath);
  if (!existsSync(target)) {
    throw new Error(`integration: ${repo} does not contain ${relativePath} (looked at ${target})`);
  }
  return target;
}

/** Read a parsed package.json from a repository root. */
export function packageJsonOf(repo) {
  const path = repoPath(repo, 'package.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The versions this run is evidence for. Kept as one object so a record can
 * quote exactly what was executed instead of "latest".
 *
 * @returns {{ spec: string, kit: string, platform: string, node: string }}
 */
export function versions() {
  const platformPkg = JSON.parse(
    readFileSync(repoPath('platform', 'packages/analyzer/package.json'), 'utf8'),
  );
  return {
    spec: packageJsonOf('spec').version,
    kit: packageJsonOf('kit').version,
    platform: platformPkg.version,
    node: process.version,
  };
}

/**
 * A short, one-line fingerprint of `versions()` for assertion messages.
 *
 * @returns {string}
 */
export function versionLine() {
  const v = versions();
  return `spec@${v.spec} kit@${v.kit} platform@${v.platform} node@${v.node}`;
}

/**
 * The environment facts every integration assertion about budgets depends on.
 * Values are read, never assumed: the bounded runner sets `BR_*` inside the
 * envelope, and outside it these are absent, which the tests report as such.
 *
 * @returns {{
 *   inEnvelope: boolean,
 *   memoryLimitBytes: number|null,
 *   tasksMax: number|null,
 *   runtimeLimitMs: number|null,
 *   nodeOptions: string|null,
 * }}
 */
export function envelopeFacts() {
  const asInt = (value) => {
    if (value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    inEnvelope: process.env.DSH_INTEGRATION_ENVELOPE === '1'
      || process.env.BR_UNIT !== undefined,
    memoryLimitBytes: asInt(process.env.BR_MEMORY_BYTES),
    tasksMax: asInt(process.env.BR_TASKS),
    runtimeLimitMs: asInt(process.env.BR_RUNTIME_USEC) === null
      ? null
      : Math.round(asInt(process.env.BR_RUNTIME_USEC) / 1000),
    nodeOptions: process.env.NODE_OPTIONS ?? null,
  };
}

/**
 * Where the DeepSeek Harness install keeps its `@deepseek-ai/*` packages, so a
 * generated plugin's real peer imports can be resolved without installing
 * anything. Returns the directory that *contains* `@deepseek-ai/`, or `null`
 * when this machine has no such checkout — a caller must then skip the
 * execution case and say so, not pretend it ran.
 *
 * @returns {string|null}
 */
export function dshPeerModulesRoot() {
  const candidates = [];
  if (process.env.DSH_INSTALL_ROOT) candidates.push(process.env.DSH_INSTALL_ROOT);
  // <prefix>/bin/node -> <prefix>/lib/node_modules/@deepseek-ai/dsh
  candidates.push(join(dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  candidates.push(join(dirname(process.execPath), '..', 'node_modules', '@deepseek-ai', 'dsh'));
  for (const candidate of candidates) {
    const inner = join(candidate, 'node_modules');
    if (existsSync(join(inner, '@deepseek-ai', 'dsh-tools', 'package.json'))) return inner;
    const outer = join(candidate, '..');
    if (existsSync(join(outer, 'dsh-tools', 'package.json'))) return outer;
  }
  return null;
}

/**
 * Read the effective cgroup limits when this process is inside a cgroup that
 * carries them (the bounded runner's unit does). Values are returned as the
 * kernel writes them, because "the kernel says 402653184" is the evidence; a
 * parsed copy would only be this file's opinion.
 *
 * @returns {{ available: boolean, error: string|null, membership: string|null,
 *   memoryMax: string|null, memoryMaxBytes: number|null, swapMax: string|null,
 *   pidsMax: string|null }}
 */
export function cgroupLimits() {
  const read = (path) => {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const membership = read('/proc/self/cgroup');
  // Read the cgroup this process is ACTUALLY in, not the root of the mount: under
  // `systemd-run --scope` the unit's files live at /sys/fs/cgroup/<unit path>, and
  // the root files read `max`/`max` no matter what the unit was given.
  const self = (membership ?? '')
    .split('\n')
    .map((line) => line.split('::'))
    .find((parts) => parts.length === 2);
  const cgroupPath = self === undefined || self[1] === '/' || self[1] === '' ? null : self[1];
  const directory = cgroupPath === null ? null : `/sys/fs/cgroup${cgroupPath}`;
  const memoryMax = directory === null ? null : read(`${directory}/memory.max`);
  const swapMax = directory === null ? null : read(`${directory}/memory.swap.max`);
  const pidsMax = directory === null ? null : read(`${directory}/pids.max`);
  const missing = [
    ['memory.max', memoryMax],
    ['pids.max', pidsMax],
  ].filter(([, value]) => value === null).map(([name]) => name);
  return {
    available: missing.length === 0 && memoryMax !== 'max' && pidsMax !== 'max',
    error: missing.length === 0 ? null : `unreadable or unlimited: ${missing.join(', ')}`,
    membership,
    cgroupPath,
    memoryMax,
    memoryMaxBytes: memoryMax === null || memoryMax === 'max' ? null : Number(memoryMax),
    swapMax,
    pidsMax,
  };
}
