// The only place in this package that names a third-party JSON Schema engine.
//
// The engine is not a dependency of this repository: it is acquired into a
// disposable artifact directory from a reviewed lock
// (scripts/config-engine-install, docs/testing/2026-11-10-config-engine-acquisition.md).
// This adapter therefore takes a loader function rather than importing the
// package by specifier, so nothing here breaks when the tree is absent.
//
// What this adapter is allowed to hand back: a boolean verdict and, for each
// error, a keyword name plus two *paths*. It never passes through an engine
// message, a `data` field, a `schema` fragment or anything else that could carry
// a configuration value into a report.

const KEYWORD_PREFIX = 'https://json-schema.org/keyword/';
const EVALUATION_PREFIX = 'https://json-schema.org/evaluation/';

/** Reduce a keyword URI to its last segment, or `unknown` if it is not one. */
export function shortKeyword(uri) {
  if (typeof uri !== 'string') return 'unknown';
  for (const prefix of [KEYWORD_PREFIX, EVALUATION_PREFIX]) {
    if (!uri.startsWith(prefix)) continue;
    // Dialect-qualified keywords look like
    // `…/keyword/draft-2020-12/format`; the word is the last segment either way.
    const segments = uri.slice(prefix.length).split('/').filter((part) => part.length > 0);
    if (segments.length === 0) return 'unknown';
    const last = segments[segments.length - 1];
    return /^[A-Za-z][A-Za-z0-9-]*$/.test(last) ? last : 'unknown';
  }
  return 'unknown';
}

/**
 * Split a JSON Pointer fragment into tokens.
 *
 * The engine hands back `#/a/b` style locations. They are URI-encoded, so
 * `decodeURIComponent` runs before the JSON Pointer unescaping (`~1` → `/`,
 * `~0` → `~`). A malformed pointer yields no tokens rather than a guess.
 */
export function pointerTokens(location) {
  if (typeof location !== 'string' || !location.startsWith('#')) return Object.freeze([]);
  let fragment = location.slice(1);
  if (fragment === '') return Object.freeze([]);
  if (!fragment.startsWith('/')) return Object.freeze([]);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    return Object.freeze([]);
  }
  return Object.freeze(
    fragment
      .slice(1)
      .split('/')
      .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~')),
  );
}

/** Map one BASIC error to the two paths `config-check.js` needs. */
export function mapError(error) {
  const keyword = shortKeyword(error?.keyword);
  const instancePath = pointerTokens(error?.instanceLocation);
  const absolute = typeof error?.absoluteKeywordLocation === 'string' ? error.absoluteKeywordLocation : '';
  const hash = absolute.indexOf('#');
  const keywordPath = hash >= 0 ? pointerTokens(absolute.slice(hash)) : Object.freeze([]);
  return { keyword, instancePath, keywordPath };
}

/**
 * Build an engine over an already-loaded module namespace.
 *
 * @param {object} moduleNamespace the `@hyperjump/json-schema` draft-2020-12 module
 * @param {{register: Function, validate: Function, unregister?: Function}} [api]
 */
export function engineFromModule(moduleNamespace, { formatsNamespace = null } = {}) {
  const api = moduleNamespace?.default ?? moduleNamespace;
  if (typeof api?.registerSchema !== 'function' || typeof api?.validate !== 'function') {
    throw new TypeError('engineFromModule(namespace): the module does not expose registerSchema() and validate().');
  }
  // Format assertions are opt-in in this engine: without the formats entry point
  // being imported AND the switch being set, `format: "uri"` accepts "not a uri"
  // silently. Both are enabled here, so a schema that declares a format is
  // actually asserted rather than quietly passed. `formatAssertion` records
  // which of the two conditions held, so a caller can tell the difference
  // between "asserted" and "not asserted" instead of assuming.
  let formatAssertion = 'not-asserted';
  if (formatsNamespace !== null) {
    if (typeof api.setShouldValidateFormat === 'function') {
      api.setShouldValidateFormat(true);
      formatAssertion = 'asserted';
    }
  }
  let counter = 0;
  return {
    /** Whether format keywords in this engine are enforced. Closed word. */
    get formatAssertion() {
      return formatAssertion;
    },
    async check({ schema, instance }) {
      const uri = `urn:dsh-compat:config-check:${(counter += 1)}`;
      api.registerSchema(schema, uri);
      try {
        const output = await api.validate(uri, instance, 'BASIC');
        const errors = Array.isArray(output?.errors) ? output.errors : [];
        return { valid: output?.valid === true, errors: errors.map(mapError) };
      } finally {
        try {
          api.unregisterSchema?.(uri);
        } catch {
          // Unregistering is housekeeping; a failure must not mask the verdict.
        }
      }
    },
  };
}

/**
 * Load the engine by specifier and build the adapter.
 *
 * `loadModule` exists so a caller can point at the acquired artifact tree; the
 * default resolves the bare specifier, which only works when the tree is on the
 * resolution path.
 */
export async function createEngine({
  loadModule = (specifier) => import(specifier),
  specifier = '@hyperjump/json-schema/draft-2020-12',
  formatsSpecifier = '@hyperjump/json-schema/formats',
} = {}) {
  const namespace = await loadModule(specifier);
  let formatsNamespace = null;
  try {
    formatsNamespace = await loadModule(formatsSpecifier);
  } catch {
    // Absent formats means formats are not asserted; the adapter says so rather
    // than pretending the check covered them.
    formatsNamespace = null;
  }
  return engineFromModule(namespace, { formatsNamespace });
}
