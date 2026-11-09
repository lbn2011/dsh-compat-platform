// Configuration checker: does one configuration value satisfy one declared
// contract schema?
//
// Trust boundary, mirroring the rest of this repository:
//
//   * Input is JSON text parsed by the caller. This module never reads a file,
//     opens a socket or starts a process.
//   * The engine is injected. This module owns no validator and no schema
//     dialect of its own; `src/hyperjump-engine.js` is the only place a
//     third-party engine is named.
//   * Output never carries a configuration value, a schema literal, an engine
//     error object, a `schemaPath`, an instance `data` field, or any engine
//     message text. A finding carries a key path, a closed keyword word and a
//     summary of what the schema allowed there (type names, sizes, bounds,
//     whether a pattern was present) — never the pattern, never the enum.
//   * A result is either a judgement inside the checked subset or an explicit
//     `not-checked`. It is never a judgement about a schema this build cannot
//     evaluate honestly.
//
// The known engine defect: the acquired Hyperjump build interprets identifier
// keywords inside *data* literals, so a `const`/`enum`/`default`/`examples`
// value that itself contains `$id`/`$anchor`/`$schema`/`$ref`… is registered as
// a reference instead of compared as data. That inverts some verdicts and
// raises REGISTER_ERROR on others (reproduced 14/22,
// docs/testing/2026-11-10-config-engine-reproduction.md). No patch is
// authorised, so this module refuses to judge such a schema and says so.

export const CONFIG_CHECK_SUMMARY = 'config-check-summary/0.1-draft.1';

/** Keywords whose value is compared, annotated or emitted as data, not schema. */
export const LITERAL_KEYWORDS = Object.freeze(['const', 'enum', 'default', 'examples']);

/** Identifier-bearing keys the engine picks up inside those literals. */
export const IDENTIFIER_KEYS = Object.freeze([
  '$id',
  '$schema',
  '$anchor',
  '$dynamicAnchor',
  '$recursiveAnchor',
  '$ref',
  '$dynamicRef',
  '$recursiveRef',
  '$vocabulary',
]);

/** Why a schema was refused rather than judged. Closed. */
export const CONFIG_CHECK_REFUSALS = Object.freeze({
  LITERAL_IDENTIFIER: 'CONFIG_SCHEMA_LITERAL_HAS_IDENTIFIER',
  SCHEMA_NOT_OBJECT: 'CONFIG_SCHEMA_NOT_AN_OBJECT',
  NOT_JSON_SCHEMA: 'CONFIG_SCHEMA_REJECTED_BY_ENGINE',
  ENGINE_FAILED: 'CONFIG_ENGINE_FAILED',
});

/** Why a schema could not be judged at all (as opposed to judged invalid). */
export const CONFIG_CHECK_NOT_CHECKED = Object.freeze({
  LITERAL_IDENTIFIER: 'NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER',
});

export const CONFIG_CHECK_LIMITATIONS = Object.freeze([
  'ONLY_THE_SUBSET_THIS_BUILD_CAN_EVALUATE_IS_JUDGED',
  'A_NOT_CHECKED_RESULT_IS_NOT_A_PASS',
  'NO_CONFIGURATION_VALUE_IS_EVER_EMITTED',
  'KEY_PATHS_ARE_RELATIVE_TO_THE_DECLARED_ENTRY',
  'ENGINE_IS_THIRD_PARTY_AND_UNPATCHED',
  'NO_LOADABILITY_OR_ACTIVATION_CLAIMED',
  'CERTIFICATION_NOT_CLAIMED',
]);

export const CONFIG_CHECK_NOT_DERIVED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
  'configurationValue',
]);

const MAX_FINDINGS = 64;
const MAX_PATH_TOKENS = 64;
const MAX_DEPTH = 64;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk the schema for identifier keys inside literal containers.
 *
 * This is deliberately a *syntactic* scan of the schema document, not an
 * interpretation of it: we do not need to know where a keyword applies, only
 * whether such a literal exists anywhere, because the engine's defect fires on
 * every one it processes.
 */
export function findAffectedLiteral(schema) {
  const stack = [{ node: schema, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (depth > MAX_DEPTH) return { found: true, keyword: 'depth-limit' };
    if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (LITERAL_KEYWORDS.includes(key)) {
          const hit = scanLiteral(value, 0);
          if (hit !== null) return { found: true, keyword: key, identifier: hit };
          continue;
        }
        if (typeof value === 'object' && value !== null) {
          stack.push({ node: value, depth: depth + 1 });
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'object' && item !== null) stack.push({ node: item, depth: depth + 1 });
      }
    }
  }
  return { found: false };
}

function scanLiteral(value, depth) {
  if (depth > MAX_DEPTH) return 'depth-limit';
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (IDENTIFIER_KEYS.includes(key)) return key;
    }
    for (const nested of Object.values(value)) {
      const hit = scanLiteral(nested, depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const hit = scanLiteral(nested, depth + 1);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * Resolve a keyword path into the schema so the finding can describe what the
 * schema allowed. Returns null when the path does not resolve (the engine may
 * report a location inside an embedded resource we did not index).
 */
export function resolveKeywordPath(schema, path) {
  let node = schema;
  for (const token of path) {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return null;
      node = node[index];
      continue;
    }
    if (!Object.hasOwn(node, token)) return null;
    node = node[token];
  }
  return node;
}

/**
 * Describe what the schema allowed at a location, without emitting any of it.
 *
 * Type names, format names and keyword presence are schema vocabulary, not user
 * data. Sizes and bounds are numbers. The pattern itself is never copied — only
 * that one exists — because a pattern can encode a business rule.
 */
export function summarizeExpectation(node) {
  if (!isPlainObject(node)) return Object.freeze({});
  const out = {};
  if (typeof node.type === 'string') out.type = node.type;
  else if (Array.isArray(node.type)) out.types = Object.freeze(node.type.filter((t) => typeof t === 'string'));
  if (typeof node.format === 'string') out.format = node.format;
  if (Array.isArray(node.enum)) out.enumSize = node.enum.length;
  if (Object.hasOwn(node, 'const')) out.acceptsSingleValue = true;
  if (Array.isArray(node.required)) out.requiredCount = node.required.length;
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) {
    if (typeof node[key] === 'number') out[key] = node[key];
  }
  if (typeof node.pattern === 'string') out.hasPattern = true;
  if (isPlainObject(node.properties)) out.propertyCount = Object.keys(node.properties).length;
  return Object.freeze(out);
}

/** Render an instance path as `config.a.b[2]`, never including a value. */
export function renderPath(path) {
  let out = 'config';
  for (const token of path) {
    if (typeof token === 'number' || /^(0|[1-9][0-9]*)$/.test(String(token))) out += `[${token}]`;
    else out += `.${String(token)}`;
  }
  return out;
}

/**
 * Check one configuration value against one contract schema.
 *
 * @param {object} input
 * @param {object} input.schema   the declared contract schema (already parsed)
 * @param {unknown} input.instance the configuration value (already parsed)
 * @param {{check: Function}} input.engine the injected validator; its check() may be async
 * @param {string} [input.entryLabel] closed word for the entry, never user text
 * @returns {object} frozen summary
 */
export async function checkConfiguration(input) {
  if (!isPlainObject(input)) throw new TypeError('checkConfiguration(input): input must be an object.');
  const { schema, instance, engine } = input;
  if (!isPlainObject(engine) || typeof engine.check !== 'function') {
    throw new TypeError('checkConfiguration(input): input.engine must be an object with a check() function.');
  }
  const entryLabel = typeof input.entryLabel === 'string' ? input.entryLabel : null;

  const base = {
    configCheckSummary: CONFIG_CHECK_SUMMARY,
    entryLabel,
    certification: false,
    notDerived: CONFIG_CHECK_NOT_DERIVED,
    limitations: CONFIG_CHECK_LIMITATIONS,
  };

  if (!isPlainObject(schema) && typeof schema !== 'boolean') {
    return finish(base, {
      schemaStatus: 'refused',
      refusal: CONFIG_CHECK_REFUSALS.SCHEMA_NOT_OBJECT,
      findings: [],
      counts: { checked: 0, invalid: 0, findings: 0, findingsTruncated: false },
    });
  }

  // A boolean schema has no literals to mistake for identifiers.
  if (isPlainObject(schema)) {
    const literal = findAffectedLiteral(schema);
    if (literal.found) {
      return finish(base, {
        schemaStatus: 'not-checked',
        notCheckedReason: CONFIG_CHECK_NOT_CHECKED.LITERAL_IDENTIFIER,
        notCheckedKeyword: literal.keyword,
        findings: [],
        counts: { checked: 0, invalid: 0, findings: 0, findingsTruncated: false },
      });
    }
  }

  let outcome;
  try {
    outcome = await engine.check({ schema, instance });
  } catch (error) {
    return finish(base, {
      schemaStatus: 'refused',
      refusal: CONFIG_CHECK_REFUSALS.ENGINE_FAILED,
      findings: [],
      counts: { checked: 0, invalid: 0, findings: 0, findingsTruncated: false },
    });
  }
  if (!isPlainObject(outcome) || typeof outcome.valid !== 'boolean' || !Array.isArray(outcome.errors)) {
    return finish(base, {
      schemaStatus: 'refused',
      refusal: CONFIG_CHECK_REFUSALS.NOT_JSON_SCHEMA,
      findings: [],
      counts: { checked: 0, invalid: 0, findings: 0, findingsTruncated: false },
    });
  }
  if (outcome.valid) {
    return finish(base, {
      schemaStatus: 'checked',
      valid: true,
      findings: [],
      counts: { checked: 1, invalid: 0, findings: 0, findingsTruncated: false },
    });
  }

  const findings = [];
  let truncated = false;
  for (const error of outcome.errors) {
    if (findings.length >= MAX_FINDINGS) {
      truncated = true;
      break;
    }
    const instancePath = normalizePath(error.instancePath);
    const keywordPath = normalizePath(error.keywordPath);
    // The engine points at the *keyword*, whose value is the constraint itself
    // (`minimum` → 0). The describable schema is its parent subschema, so the
    // summary reads `type`, bounds and siblings from there.
    const node = resolveKeywordPath(schema, keywordPath.slice(0, -1));
    findings.push(
      Object.freeze({
        path: renderPath(instancePath),
        keyword: typeof error.keyword === 'string' ? error.keyword : 'unknown',
        expected: summarizeExpectation(node),
      }),
    );
  }
  return finish(base, {
    schemaStatus: 'checked',
    valid: false,
    findings,
    counts: {
      checked: 1,
      invalid: 1,
      findings: findings.length,
      findingsTruncated: truncated,
    },
  });
}

function normalizePath(path) {
  if (!Array.isArray(path)) return Object.freeze([]);
  const out = [];
  for (const token of path.slice(0, MAX_PATH_TOKENS)) {
    if (typeof token === 'string' || typeof token === 'number') out.push(token);
  }
  return Object.freeze(out);
}

function finish(base, rest) {
  return Object.freeze({ ...base, ...rest });
}

/** Exit-code table. 2 covers both refusals and not-checked: neither is a pass. */
export const CONFIG_CHECK_EXIT = Object.freeze({
  VALID: 0,
  INVALID: 1,
  NOT_CHECKED: 2,
  INTERNAL: 5,
  USAGE: 64,
});

export function configCheckExitCode(result) {
  if (!isPlainObject(result)) throw new TypeError('configCheckExitCode(result): result must be an object.');
  if (result.schemaStatus === 'checked') return result.valid === true ? CONFIG_CHECK_EXIT.VALID : CONFIG_CHECK_EXIT.INVALID;
  if (result.schemaStatus === 'not-checked' || result.schemaStatus === 'refused') return CONFIG_CHECK_EXIT.NOT_CHECKED;
  throw new TypeError('configCheckExitCode(result): result does not carry a documented schemaStatus.');
}
