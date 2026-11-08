/**
 * Resolve a `dsh-compat-spec` module for the suites that must run against the
 * **real** grammar rather than a stub.
 *
 * Two routes are tried, in this order:
 *
 *   1. the published package specifier (`dsh-compat-spec` and its subpaths), so a
 *      consumer that installed the package resolves exactly what its users get;
 *   2. the sibling development checkout (`../../../../dsh-compat-spec/src/*.js`),
 *      because this workspace keeps the spec as a separate repository and does
 *      not install it into node_modules.
 *
 * Both routes name the same file, so neither can quietly substitute a weaker rule
 * set — that is the only thing this helper is allowed to do. `existsSync` decides
 * which route is *attempted*; the caller's own `import()` decides whether it is
 * usable. If neither route is present the helper throws and the calling suite
 * fails: a skip would report "the canonical grammar decided this" without the
 * canonical grammar ever running.
 *
 * @module tests/helpers/spec-module
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Subpath → source file name in the sibling checkout. */
const SOURCE_FILES = Object.freeze({
  '.': 'index.js',
  './admission-evidence': 'admission-evidence.js',
});

/**
 * Resolve one spec module, preferring the package specifier.
 *
 * @param {'.'|'./admission-evidence'} subpath The export subpath to resolve.
 * @returns {{href: string, route: 'package'|'sibling', label: string}} The
 *   resolved file URL, which route found it, and a human-readable label for
 *   error messages.
 * @throws {Error} When the subpath is unknown, or neither route resolves.
 */
export function resolveSpecModule(subpath) {
  const sourceFile = SOURCE_FILES[subpath];
  if (sourceFile === undefined) {
    throw new Error(`resolveSpecModule: unknown subpath ${JSON.stringify(subpath)}`);
  }

  const specifier = subpath === '.' ? 'dsh-compat-spec' : `dsh-compat-spec/${subpath.slice(2)}`;
  const attempts = [];

  try {
    return { href: pathToFileURL(require.resolve(specifier)).href, route: 'package', label: specifier };
  } catch (error) {
    attempts.push(`${specifier}: ${error?.code ?? error?.message ?? 'unresolved'}`);
  }

  const sibling = new URL(`../../../../../dsh-compat-spec/src/${sourceFile}`, import.meta.url);
  if (existsSync(fileURLToPath(sibling))) {
    return { href: sibling.href, route: 'sibling', label: `sibling checkout ${sibling.href}` };
  }
  attempts.push(`sibling: ${sibling.href} does not exist`);

  throw new Error(
    `cannot resolve ${subpath} from dsh-compat-spec; tried ${attempts.join('; ')}. ` +
      'Install the package, or place the dsh-compat-spec checkout next to this repository. ' +
      'This suite never skips.',
  );
}
