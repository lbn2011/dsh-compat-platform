/**
 * TIER-2 TRUSTED HARNESS — not a validator.
 *
 * When dsh-compat-spec is available to the caller (for example as a development
 * reference next to this repository), this file can be passed to
 * `--validator`. It imports the real package by its published *specifier*
 * (never a relative sibling path) and unwraps its export shape.
 *
 * If the package cannot be resolved, loading fails loudly (exit code 3) rather
 * than falling back to a weaker validator: analysis must never silently run
 * against a different rule set than the one the caller believed they injected.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// Resolve the published specifier (never a sibling filesystem path); fail
// loudly instead of degrading to another validator.
const specPath = require.resolve('dsh-compat-spec');
const spec = await import(pathToFileURL(specPath).href);

const candidate =
  typeof spec.validateDeclaration === 'function'
    ? spec.validateDeclaration
    : typeof spec.default?.validateDeclaration === 'function'
      ? spec.default.validateDeclaration
      : null;

if (candidate === null) {
  throw new Error(
    'dsh-compat-spec was resolved but exports no validateDeclaration(); refusing to fall back to another validator.',
  );
}

export const validateDeclaration = candidate;
export default validateDeclaration;
