#!/usr/bin/env node
/**
 * Exercise the **installed** surface of the packed packages from inside a throwaway
 * consumer directory.
 *
 * Everything here goes through a package specifier. Nothing reaches into a sibling
 * checkout, so a green run means the export map, the `files` list and the dependency
 * resolution all work for a consumer who only has tarballs. Every resolved module path is
 * checked to live under the consumer's own `node_modules`, which is what makes that claim
 * checkable rather than asserted.
 *
 * Exit codes: 0 all checks pass, 3 a check failed, 64 bad usage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const selfDir = dirname(fileURLToPath(import.meta.url));
const consumerDir = process.env.CONSUMER_DIR ?? selfDir;
const nodeModules = join(consumerDir, 'node_modules');
const checks = [];

/**
 * Record one check.
 *
 * @param {string} name Check name.
 * @param {boolean} ok Whether it passed.
 * @param {string} [detail] Extra text for the report.
 */
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

/**
 * Resolve a specifier and assert it lives under the consumer's node_modules.
 *
 * @param {string} specifier Package specifier (optionally with a subpath).
 * @returns {Promise<object|string>} The imported module namespace, or '' on failure.
 */
async function importInstalled(specifier) {
  let resolved;
  try {
    const require = createRequire(join(consumerDir, 'package.json'));
    resolved = require.resolve(specifier);
  } catch (error) {
    check(`resolve:${specifier}`, false, error.code ?? 'ERR');
    return '';
  }
  const inside = resolved.startsWith(`${nodeModules}${sep}`);
  check(`inside-node-modules:${specifier}`, inside, resolved);
  if (!inside) return '';
  try {
    return await import(pathToFileURL(resolved).href);
  } catch (error) {
    check(`import:${specifier}`, false, error.code ?? 'ERR');
    return '';
  }
}

/** Read a package manifest from the consumer's node_modules. */
function installedManifest(name) {
  const path = join(nodeModules, name, 'package.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const expectFile = process.env.EXPECT_FILE ?? join(selfDir, 'expect.json');
const expect = JSON.parse(readFileSync(expectFile, 'utf8'));

// 1. Every expected package is installed at the version the tarball declared.
for (const [name, expected] of Object.entries(expect.packages)) {
  const manifest = installedManifest(name);
  if (manifest === null) {
    check(`installed:${name}`, false, 'missing');
    continue;
  }
  check(`installed:${name}`, manifest.version === expected.version, `${manifest.name}@${manifest.version}`);
}

// 2. The dependency came along: yaml is present at the pinned version, hoisted or nested.
const yamlManifest = installedManifest('yaml')
  ?? installedManifest('dsh-compat-platform/node_modules/yaml');
check('dependency:yaml@2.9.1', yamlManifest?.version === '2.9.1', yamlManifest?.version ?? 'missing');

// 3. Each documented subpath resolves inside node_modules and exposes its functions.
for (const [specifier, names] of Object.entries(expect.surfaces)) {
  const module = await importInstalled(specifier);
  if (module === '') continue;
  const missing = names.filter((name) => typeof module[name] !== 'function');
  check(`surface:${specifier}`, missing.length === 0, missing.join(',') || 'complete');
}

// 4. One real call through the installed dependency: the YAML summariser parses text.
const dump = await importInstalled('dsh-compat-platform/profile-dump');
if (dump !== '') {
  const result = dump.summarizeProfileDumpText('- id: alpha\n  name: ./plugin.mjs\n');
  const summary = result?.summary ?? result;
  check('call:profile-dump', summary?.profileDumpSummary === 'profile-dump-summary/0.3-draft.1',
    String(summary?.profileDumpSummary ?? 'none'));
  check('call:profile-dump-counts', summary?.counts?.entries === 1, String(summary?.counts?.entries));
}

// 5. One real call through the installed repair surface: an invalid plan is refused.
const apply = await importInstalled('dsh-compat-repair/repair-apply');
if (apply !== '') {
  const decision = apply.decideApply({ plan: { planVersion: 'nope' }, approval: {}, beforeText: '', nowMs: 0 });
  check('call:repair-apply', decision.status === 'refused'
    && decision.reasons.includes('APPLY_PLAN_INVALID'), decision.reasons.join(','));
}

const failed = checks.filter((entry) => !entry.ok);
process.stdout.write(`consumer: ${failed.length === 0 ? 'pass' : 'fail'} in ${consumerDir}\n`);
for (const entry of checks) {
  process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name} ${entry.detail}\n`);
}
process.exitCode = failed.length === 0 ? 0 : 3;
