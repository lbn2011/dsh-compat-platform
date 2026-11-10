/**
 * dsh-compat-platform — profile-dump: summarize ONE `dsh --profile <n> --dump-config` export.
 *
 * TRUST BOUNDARY, stated once and enforced by construction:
 *
 *   1. This module receives text. It does not read files, does not resolve paths, does not
 *      touch the network and does not spawn anything. The caller owns the read.
 *   2. It imports exactly one thing: `yaml`. Nothing from the document is ever imported,
 *      evaluated, resolved as a specifier or turned into code. `!!js` stays opaque: the walk
 *      records that a tagged scalar exists and where it is, and never reads its value.
 *   3. It calls `parseAllDocuments`, never `parse()` and never `toJS()`/`toJSON()`.
 *      `parse()` is the only entry point that writes to the console; `toJS()` is the only one
 *      that resolves aliases and expands them.
 *   4. Its output is a closed set of numbers, counts and fixed codes. No id, name, origin
 *      label, `# == ` comment text, configuration key, value, expression text or path is ever
 *      copied into it, and no `YAMLError.message` is ever surfaced — those messages carry a
 *      source excerpt (see `prettifyError` in the library).
 *
 * WHAT THE LIMITS HERE DO AND DO NOT BOUND
 * ----------------------------------------
 * `maxBytes`/`maxLines` act BEFORE parsing, on the text. They bound how much text can reach the
 * parser from this module's caller.
 *
 * `maxDepth`/`maxNodes`/`maxEntries`/`maxDiagnostics` act AFTER parsing, during the walk. They
 * bound what this command will *describe*. They are not parse-time protection and this module
 * does not pretend otherwise: the library has no parse-time depth option, and its own
 * `RESOURCE_EXHAUSTION` recovery covers the compose recursion only (compose-node.ts wraps
 * `composeCollection`). A `RangeError` that escapes is caught here and reported as
 * `RESOURCE_EXHAUSTION_UNCAUGHT` — a recovery path, not a guarantee.
 */

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';

/**
 * Format identifier of the summary document produced by this module.
 *
 * Bumped from `0.1-draft.1` when `rows`, `rowsTruncated`, `notDerived` and `limitations` were
 * added: four new top-level keys and one new limit are a shape change, and a consumer that
 * verifies a closed key set must be able to tell the two shapes apart by the version string
 * alone. The counters are unchanged; the version says "there are rows now", not "the numbers
 * moved".
 */
export const PROFILE_DUMP_SCHEMA = 'profile-dump-summary/0.3-draft.1';

/** Fixed, non-configurable limits. Deliberately not exposed as CLI options. */
export const PROFILE_DUMP_LIMITS = Object.freeze({
  maxBytes: 1048576,
  maxLines: 20000,
  maxDepth: 32,
  maxNodes: 20000,
  maxEntries: 5000,
  maxDiagnostics: 64,
  // Rows are a display window over the counters, not a second inventory: `counts.entries` stays
  // authoritative and `rowsTruncated` says the window is short.
  maxRows: 64,
});

/**
 * Things this summary does not establish.
 *
 * Copied verbatim from the accepted profile-export observation record
 * (`experiments/profile-export-fixture/observation.mjs`, `NOT_DERIVED`), because the reasons are
 * the same and a second, differently-worded list would invite a reader to believe the two
 * artifacts promise different things. In particular: a row is not a declaration, and an absent
 * row is ambiguous between "not configured" and "bundle skipped".
 *
 * Frozen, and copied per summary, so one consumer cannot edit the list another consumer observes.
 */
export const PROFILE_DUMP_NOT_DERIVED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
]);

/**
 * Fixed limitation codes, in the style of `COMBINED_REPORT_LIMITATIONS`: statements about this
 * artifact's envelope, not about any particular document.
 */
export const PROFILE_DUMP_LIMITATIONS = Object.freeze([
  'ROW_IS_NOT_A_DECLARATION',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
  'NO_LOADABILITY_OR_ACTIVATION_OBSERVED',
  'ROW_SKIPS_UNMODELLED_KEYS',
  'CONFIG_VALUES_NOT_INSPECTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
]);

/**
 * Limitations added **only** to a summary whose caller asked for identity disclosure. They are
 * appended per summary, so a summary that never asked for text does not carry a warning about
 * text it does not contain.
 */
export const PROFILE_DUMP_DISCLOSURE_LIMITATIONS = Object.freeze([
  'IDENTITY_TEXT_IS_OPERATOR_TEXT_AND_MAY_CARRY_PATHS_OR_PRIVATE_NAMES',
  'IDENTITY_TEXT_IS_NOT_A_PACKAGE_IDENTITY_AND_NOT_A_VERSION',
  'CONFIG_VALUES_ARE_NEVER_EMITTED_EVEN_WHEN_IDENTITY_IS_DISCLOSED',
]);

/** The one tag this command accepts without understanding: the DSH expression form. */
const JS_TAG = 'tag:yaml.org,2002:js';

/**
 * A local tag definition for the expression form. Its only job is to stop the library from
 * emitting an "unresolved tag" warning for a tag this module has already decided to allow: the
 * resolver hands the source text back untouched and this module never reads the resulting value.
 *
 * Registering it means the warning stream no longer carries `TAG_RESOLVE_FAILED` for `!!js`, so
 * this module never has to *infer* that a tag existed by matching warnings to positions — an
 * inference that goes wrong for block scalars whose tag and value sit on different lines.
 * Everything is decided from `node.tag`, which the composer always records.
 *
 * `yaml@2.9.1` does not export a `Tag` class (only the `ScalarTag`/`CollectionTag` *types*); a
 * custom tag is a plain object shaped like `ScalarTag` — required fields `tag` and
 * `resolve(value, onError, options)`, with no `kind`. Extra parameters are ignored.
 */
const JS_TAG_DEF = {
  tag: JS_TAG,
  identify: () => false,
  resolve: (value) => value,
};

/**
 * Why a tag was refused, in fixed words. The tag text itself is never emitted: a local tag such
 * as `!SECRET_TAG` or a verbatim `!<https://…>` is operator text and must not reach the summary.
 */
const TAG_CLASS = Object.freeze({
  JS_COLLECTION: 'JS_COLLECTION',
  CORE_NOT_ALLOWED: 'CORE_NOT_ALLOWED',
  EXTERNAL: 'EXTERNAL',
});

/** Classify a refused tag without copying it. */
function tagClass(tag) {
  if (tag === JS_TAG) return TAG_CLASS.JS_COLLECTION;
  if (typeof tag === 'string' && tag.startsWith('tag:yaml.org,2002:')) return TAG_CLASS.CORE_NOT_ALLOWED;
  return TAG_CLASS.EXTERNAL;
}

/** Scalar tags a dump can legitimately carry, beyond `JS_TAG`. */
const ALLOWED_SCALAR_TAGS = Object.freeze(
  new Set([
    'tag:yaml.org,2002:str',
    'tag:yaml.org,2002:null',
    'tag:yaml.org,2002:bool',
    'tag:yaml.org,2002:int',
    'tag:yaml.org,2002:float',
  ]),
);

/** Collection tags a dump can legitimately carry. */
const ALLOWED_COLLECTION_TAGS = Object.freeze(
  new Set(['tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq']),
);

/**
 * Every diagnostic code this module can emit. A closed set: if a condition has no code here,
 * it is not reported.
 */
export const PROFILE_DUMP_CODES = Object.freeze({
  // parsed, nothing wrong with the document's shape
  EMPTY_INPUT: 'EMPTY_INPUT',
  EMPTY_INVENTORY: 'EMPTY_INVENTORY',
  // observed, informational — does not by itself change the exit code
  JS_EXPRESSION_NOT_EVALUATED: 'JS_EXPRESSION_NOT_EVALUATED',
  // entry-level: parsed, but a row looks wrong
  ENTRY_ID_NOT_STRING: 'ENTRY_ID_NOT_STRING',
  ENTRY_NAME_NOT_STRING: 'ENTRY_NAME_NOT_STRING',
  DUPLICATE_ID: 'DUPLICATE_ID',
  // unusable
  INPUT_OPEN_FAILED: 'INPUT_OPEN_FAILED',
  INPUT_STAT_FAILED: 'INPUT_STAT_FAILED',
  INPUT_READ_FAILED: 'INPUT_READ_FAILED',
  INPUT_NOT_REGULAR: 'INPUT_NOT_REGULAR',
  INPUT_NOT_UTF8: 'INPUT_NOT_UTF8',
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',
  INPUT_TOO_MANY_LINES: 'INPUT_TOO_MANY_LINES',
  MULTI_DOCUMENT: 'MULTI_DOCUMENT',
  PARSE_ERROR: 'PARSE_ERROR',
  UNEXPECTED_WARNING: 'UNEXPECTED_WARNING',
  RESOURCE_EXHAUSTION_UNCAUGHT: 'RESOURCE_EXHAUSTION_UNCAUGHT',
  ROOT_NOT_SEQUENCE: 'ROOT_NOT_SEQUENCE',
  ENTRY_NOT_MAPPING: 'ENTRY_NOT_MAPPING',
  UNSUPPORTED_TAG: 'UNSUPPORTED_TAG',
  TAG_KEY_PRESENT: 'TAG_KEY_PRESENT',
  ALIAS_PRESENT: 'ALIAS_PRESENT',
  ANCHOR_PRESENT: 'ANCHOR_PRESENT',
  MERGE_KEY: 'MERGE_KEY',
  DEPTH_LIMIT: 'DEPTH_LIMIT',
  NODE_LIMIT: 'NODE_LIMIT',
  ENTRY_LIMIT: 'ENTRY_LIMIT',
  // the command itself failed
  USAGE: 'USAGE',
  INTERNAL: 'INTERNAL',
});

/** Exit codes for this command. `1` and `2` mean different things on purpose. */
export const PROFILE_DUMP_EXIT = Object.freeze({
  OK: 0,
  ENTRY_DIAGNOSTICS: 1,
  UNUSABLE: 2,
  INTERNAL: 5,
  USAGE: 64,
});

/** Codes that make a document unusable. */
const REFUSAL_CODES = Object.freeze(
  new Set([
    PROFILE_DUMP_CODES.INPUT_OPEN_FAILED,
    PROFILE_DUMP_CODES.INPUT_STAT_FAILED,
    PROFILE_DUMP_CODES.INPUT_READ_FAILED,
    PROFILE_DUMP_CODES.INPUT_NOT_REGULAR,
    PROFILE_DUMP_CODES.INPUT_NOT_UTF8,
    PROFILE_DUMP_CODES.INPUT_TOO_LARGE,
    PROFILE_DUMP_CODES.INPUT_TOO_MANY_LINES,
    PROFILE_DUMP_CODES.MULTI_DOCUMENT,
    PROFILE_DUMP_CODES.PARSE_ERROR,
    PROFILE_DUMP_CODES.UNEXPECTED_WARNING,
    PROFILE_DUMP_CODES.RESOURCE_EXHAUSTION_UNCAUGHT,
    PROFILE_DUMP_CODES.ROOT_NOT_SEQUENCE,
    PROFILE_DUMP_CODES.ENTRY_NOT_MAPPING,
    PROFILE_DUMP_CODES.UNSUPPORTED_TAG,
    PROFILE_DUMP_CODES.TAG_KEY_PRESENT,
    PROFILE_DUMP_CODES.ALIAS_PRESENT,
    PROFILE_DUMP_CODES.ANCHOR_PRESENT,
    PROFILE_DUMP_CODES.MERGE_KEY,
    PROFILE_DUMP_CODES.DEPTH_LIMIT,
    PROFILE_DUMP_CODES.NODE_LIMIT,
    PROFILE_DUMP_CODES.ENTRY_LIMIT,
  ]),
);

/** Codes that make a parsed document "look at this row" rather than "cannot be read". */
const ENTRY_CODES = Object.freeze(
  new Set([
    PROFILE_DUMP_CODES.ENTRY_ID_NOT_STRING,
    PROFILE_DUMP_CODES.ENTRY_NAME_NOT_STRING,
    PROFILE_DUMP_CODES.DUPLICATE_ID,
  ]),
);

/** Reading the value of a key only ever compares it to this literal. */
const MERGE_KEY_TEXT = '<<';
/** Key names read from a row. Compared, never copied into the output. */
const KEY_ID = 'id';
const KEY_NAME = 'name';
const KEY_CONFIG = 'config';
const KEY_GROUP = 'group';
const KEY_DISABLED = 'disabled';

/**
 * The row fields this reader models. A key outside this set is counted, never copied, never
 * interpreted: `plugin.id` nested inside `config` is arbitrary text, not a declaration pointer.
 */
const MODELLED_KEYS = Object.freeze(new Set([KEY_ID, KEY_NAME, KEY_CONFIG, KEY_GROUP, KEY_DISABLED]));

/**
 * Row vocabularies. Every field below is a count, a 1-based position, or one of these closed
 * words — no user text ever enters a row.
 *
 * The distinctions are the whole point of having rows at all: `disabled: 'other'` is a different
 * observation from `disabled: 'false'`, `config: 'not-mapping'` is a different one from
 * `config: 'absent'`, and `disabled: 'null'` is different again because `EntryOptions` accepts
 * null. Collapsing these pairs into booleans would make the summary unable to distinguish a typo
 * from a deliberate setting.
 */
const ROW_TEXT_KIND = Object.freeze({
  ABSENT: 'absent',
  STRING: 'string',
  NON_STRING: 'non-string',
});
const ROW_FLAG_KIND = Object.freeze({
  ABSENT: 'absent',
  TRUE: 'true',
  FALSE: 'false',
  NULL: 'null',
  OTHER: 'other',
});
const ROW_CONFIG_KIND = Object.freeze({
  ABSENT: 'absent',
  MAPPING: 'mapping',
  NOT_MAPPING: 'not-mapping',
});

/**
 * Collect diagnostics with a hard cap.
 * @param {object} state Mutable walk state.
 * @param {string} code One of {@link PROFILE_DUMP_CODES}.
 * @param {{ordinal?: number|null, line?: number|null, detail?: string}} [where] Location.
 */
function pushDiagnostic(state, code, where = {}) {
  // Counted BEFORE the cap: the exit code must not depend on what happened to fit in the list.
  // An entry-level problem in row 400 is still an entry-level problem when 64 other diagnostics
  // have already filled the display.
  if (ENTRY_CODES.has(code)) state.entryDiagnostics += 1;
  if (state.diagnostics.length >= PROFILE_DUMP_LIMITS.maxDiagnostics) {
    state.diagnosticsTruncated = true;
    return;
  }
  state.diagnostics.push({
    ordinal: where.ordinal ?? null,
    code,
    line: where.line ?? null,
    detail: where.detail ?? null,
  });
}

/** Count newlines the way a reader counts lines: 1 for the empty string. */
function countLines(text) {
  if (text === '') return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

/**
 * Build an offset→line mapper without depending on the library's LineCounter.
 * @param {string} text Decoded document text.
 * @returns {(offset: number) => number} 1-based line for a character offset.
 */
function makeLineOf(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return (offset) => {
    if (typeof offset !== 'number' || offset < 0) return 1;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** Compare a mapping key node to a literal key name without materialising anything. */
function keyIs(node, text) {
  return isScalar(node) && node.value === text;
}

/** Find a pair by literal key name. */
function findPair(map, name) {
  for (const pair of map.items) {
    if (keyIs(pair.key, name)) return pair;
  }
  return undefined;
}

/** True when a scalar is a literal string (implicitly or explicitly `!!str`). */
function isLiteralString(node) {
  if (!isScalar(node)) return false;
  if (typeof node.value !== 'string') return false;
  return node.tag === undefined || node.tag === 'tag:yaml.org,2002:str';
}

/** Node class name, for the `root` field. Never a value. */
function describeRoot(node) {
  if (node === null || node === undefined) return 'null';
  if (isSeq(node)) return 'sequence';
  if (isMap(node)) return 'mapping';
  if (isScalar(node)) return 'scalar';
  if (isAlias(node)) return 'alias';
  return 'other';
}

/**
 * Walk the composed tree iteratively (never recursively), collecting counts and refusals.
 *
 * @param {object} state Mutable walk state.
 * @param {import('yaml').Node} root Root node.
 * @param {(offset: number) => number} lineOf Offset mapper.
 */
function walkTree(state, root, lineOf) {
  const seenTags = new Set();
  /** @type {{node: unknown, depth: number}[]} */
  const stack = [{ node: root, depth: 1 }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    const node = frame.node;
    nodes += 1;
    if (nodes > PROFILE_DUMP_LIMITS.maxNodes) {
      pushDiagnostic(state, PROFILE_DUMP_CODES.NODE_LIMIT);
      state.refused = true;
      return;
    }
    if (frame.depth > PROFILE_DUMP_LIMITS.maxDepth) {
      pushDiagnostic(state, PROFILE_DUMP_CODES.DEPTH_LIMIT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
      return;
    }
    if (frame.depth > state.counts.maxDepth) state.counts.maxDepth = frame.depth;

    if (isAlias(node)) {
      pushDiagnostic(state, PROFILE_DUMP_CODES.ALIAS_PRESENT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
      continue;
    }

    if (typeof node?.anchor === 'string' && node.anchor !== '') {
      pushDiagnostic(state, PROFILE_DUMP_CODES.ANCHOR_PRESENT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
    }

    const tag = node?.tag;
    if (typeof tag === 'string') {
      seenTags.add(tag);
      if (tag === JS_TAG) {
        if (!isScalar(node)) {
          // A collection carrying the expression tag is not something a dump produces.
          pushDiagnostic(state, PROFILE_DUMP_CODES.UNSUPPORTED_TAG, {
            line: lineOf(node?.range?.[0]),
            detail: TAG_CLASS.JS_COLLECTION,
          });
          state.refused = true;
        } else {
          // Recorded, never read: the value is the expression text and stays opaque.
          state.counts.jsScalars += 1;
          state.jsScalars.push({ line: lineOf(node.range?.[0]), start: node.range?.[0] ?? -1 });
          pushDiagnostic(state, PROFILE_DUMP_CODES.JS_EXPRESSION_NOT_EVALUATED, {
            line: lineOf(node.range?.[0]),
          });
        }
      } else {
        const allowed = isScalar(node)
          ? ALLOWED_SCALAR_TAGS.has(tag)
          : ALLOWED_COLLECTION_TAGS.has(tag);
        if (!allowed) {
          // The class, never the tag: `!SECRET_TAG` and `!<https://…>` are operator text.
          pushDiagnostic(state, PROFILE_DUMP_CODES.UNSUPPORTED_TAG, {
            line: lineOf(node?.range?.[0]),
            detail: tagClass(tag),
          });
          state.refused = true;
        }
      }
    }

    if (isSeq(node)) {
      for (const item of node.items) stack.push({ node: item, depth: frame.depth + 1 });
      continue;
    }

    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key;
        if (typeof key?.tag === 'string') {
          // Any explicitly tagged key — including `!!str` — is not something the dumper writes, and
          // its resolution is not ours. All tagged keys are refused.
          pushDiagnostic(state, PROFILE_DUMP_CODES.TAG_KEY_PRESENT, {
            line: lineOf(key?.range?.[0]),
            detail: tagClass(key.tag),
          });
          state.refused = true;
        }
        if (keyIs(key, MERGE_KEY_TEXT)) {
          pushDiagnostic(state, PROFILE_DUMP_CODES.MERGE_KEY, { line: lineOf(key?.range?.[0]) });
          state.refused = true;
        }
        stack.push({ node: key, depth: frame.depth + 1 });
        stack.push({ node: pair.value, depth: frame.depth + 1 });
      }
      continue;
    }

    if (isScalar(node)) state.counts.scalars += 1;
  }

  state.counts.nodes = nodes;
  state.counts.distinctTags = seenTags.size;
}

/**
 * Classify a present/absent pair whose value should be a literal string.
 * @param {object|undefined} pair Pair, or undefined when the key is absent.
 * @returns {string} One of {@link ROW_TEXT_KIND}.
 */
function textKindOf(pair) {
  if (pair === undefined) return ROW_TEXT_KIND.ABSENT;
  return isLiteralString(pair.value) ? ROW_TEXT_KIND.STRING : ROW_TEXT_KIND.NON_STRING;
}

/**
 * Classify a present/absent pair whose declared type is `boolean | null`.
 *
 * `null` gets its own word rather than being folded into `other`, because `EntryOptions` accepts
 * it (`group?: boolean | null`, `disabled?: boolean | null`,
 * `vendor/loader/src/config/entry.ts:8-24`) and the loader reads it as "not set". Reporting a
 * legal form as a type error would send a reader looking for a bug that is not there.
 *
 * @param {object|undefined} pair Pair, or undefined when the key is absent.
 * @returns {string} One of {@link ROW_FLAG_KIND}.
 */
function flagKindOf(pair) {
  if (pair === undefined) return ROW_FLAG_KIND.ABSENT;
  if (!isScalar(pair.value)) return ROW_FLAG_KIND.OTHER;
  const value = pair.value.value;
  if (value === true) return ROW_FLAG_KIND.TRUE;
  if (value === false) return ROW_FLAG_KIND.FALSE;
  if (value === null) return ROW_FLAG_KIND.NULL;
  return ROW_FLAG_KIND.OTHER;
}

/**
 * Count the row's keys this reader does not model.
 *
 * The keys themselves are not returned: a key name is operator text, and `config:` in particular
 * can hold anything. A count with a line number is enough to send a reader to the right line.
 *
 * @param {import('yaml').YAMLMap} row Entry mapping.
 * @returns {number} How many pairs carry an unmodelled key.
 */
function unmodelledKeyCount(row) {
  let count = 0;
  for (const pair of row.items) {
    const key = pair?.key;
    const name = isScalar(key) ? key.value : undefined;
    if (typeof name !== 'string' || !MODELLED_KEYS.has(name)) count += 1;
  }
  return count;
}

/**
 * Build one row: position, line, and closed-vocabulary shape facts only.
 *
 * This is deliberately *not* a structured declaration. It answers "what does this dump row look
 * like" and can never answer "what will this profile load". It never carries a config value or a
 * dependency statement; `id`/`name` are present only when the caller explicitly asked for
 * disclosure, and even then they are operator text, not a resolved package identity.
 *
 * @param {import('yaml').YAMLMap} row Entry mapping that is already known to be a mapping.
 * @param {number} index Zero-based position in the root sequence.
 * @param {number|null} line 1-based line the row starts on.
 * @param {boolean} discloseIdentity Whether this summary was asked for id/name text.
 * @returns {object} Row with a fixed key order.
 */
function buildRow(row, index, line, discloseIdentity) {
  const idPair = findPair(row, KEY_ID);
  const namePair = findPair(row, KEY_NAME);
  const configPair = findPair(row, KEY_CONFIG);
  const groupPair = findPair(row, KEY_GROUP);
  const disabledPair = findPair(row, KEY_DISABLED);
  const configIsMapping = configPair !== undefined && isMap(configPair.value);

  return {
    index: index + 1,
    line,
    keyCount: row.items.length,
    idKind: textKindOf(idPair),
    nameKind: textKindOf(namePair),
    group: flagKindOf(groupPair),
    disabled: flagKindOf(disabledPair),
    config: configPair === undefined
      ? ROW_CONFIG_KIND.ABSENT
      : (configIsMapping ? ROW_CONFIG_KIND.MAPPING : ROW_CONFIG_KIND.NOT_MAPPING),
    configKeyCount: configIsMapping ? configPair.value.items.length : null,
    unmodelledKeyCount: unmodelledKeyCount(row),
    // Both are null unless the caller opted in — and even then only a literal-string value is
    // copied. Nothing else about the row's text is reachable from this artifact.
    id: discloseIdentity && isLiteralString(idPair?.value) ? idPair.value.value : null,
    name: discloseIdentity && isLiteralString(namePair?.value) ? namePair.value.value : null,
  };
}

/**
 * Check the top-level rows, and collect the row window while doing it.
 *
 * Only the fields `EntryOptions` declares are looked at, and only their presence and literal
 * type — never their content.
 *
 * @param {object} state Mutable walk state.
 * @param {import('yaml').YAMLSeq} root Root sequence.
 * @param {(offset: number) => number} lineOf Offset mapper.
 */
function checkEntries(state, root, lineOf) {
  const ids = new Set();
  const items = root.items;
  state.counts.entries = items.length;

  if (items.length > PROFILE_DUMP_LIMITS.maxEntries) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.ENTRY_LIMIT);
    state.refused = true;
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const ordinal = index + 1;
    const row = items[index];
    if (!isMap(row)) {
      pushDiagnostic(state, PROFILE_DUMP_CODES.ENTRY_NOT_MAPPING, {
        ordinal,
        line: lineOf(row?.range?.[0]),
      });
      state.refused = true;
      continue;
    }

    const idPair = findPair(row, KEY_ID);
    const namePair = findPair(row, KEY_NAME);
    const configPair = findPair(row, KEY_CONFIG);
    const groupPair = findPair(row, KEY_GROUP);
    const disabledPair = findPair(row, KEY_DISABLED);

    if (idPair !== undefined) {
      state.counts.entriesWithId += 1;
      if (!isLiteralString(idPair.value)) {
        pushDiagnostic(state, PROFILE_DUMP_CODES.ENTRY_ID_NOT_STRING, {
          ordinal,
          line: lineOf(idPair.value?.range?.[0] ?? row.range?.[0]),
        });
      } else if (idPair.value.value !== '') {
        // Only a non-empty id is comparable; empty ids are left to whatever assigns them.
        if (ids.has(idPair.value.value)) {
          pushDiagnostic(state, PROFILE_DUMP_CODES.DUPLICATE_ID, {
            ordinal,
            line: lineOf(idPair.value.range?.[0]),
          });
        } else {
          ids.add(idPair.value.value);
        }
      }
    }

    if (namePair !== undefined) {
      state.counts.entriesWithName += 1;
      if (!isLiteralString(namePair.value)) {
        pushDiagnostic(state, PROFILE_DUMP_CODES.ENTRY_NAME_NOT_STRING, {
          ordinal,
          line: lineOf(namePair.value?.range?.[0] ?? row.range?.[0]),
        });
      }
    }

    if (configPair !== undefined) state.counts.entriesWithConfig += 1;
    if (groupPair !== undefined && isScalar(groupPair.value) && groupPair.value.value === true) {
      state.counts.entryGroups += 1;
    }
    if (
      disabledPair !== undefined &&
      isScalar(disabledPair.value) &&
      disabledPair.value.value === true
    ) {
      state.counts.entriesDisabled += 1;
    }

    // A row is a display window over the counters, so the cap truncates the window and says so;
    // `counts.entries` remains authoritative and is never truncated.
    if (state.rows.length >= PROFILE_DUMP_LIMITS.maxRows) {
      state.rowsTruncated = true;
    } else {
      state.rows.push(buildRow(row, index, lineOf(row.range?.[0]), state.discloseIdentity));
    }
  }
}

/** Empty counts object, so the summary shape never varies. */
function emptyCounts() {
  return {
    entries: 0,
    entryGroups: 0,
    entriesWithId: 0,
    entriesWithName: 0,
    entriesWithConfig: 0,
    entriesDisabled: 0,
    jsScalars: 0,
    distinctTags: 0,
    nodes: 0,
    scalars: 0,
    maxDepth: 0,
  };
}

/**
 * Build the summary envelope. Field order is fixed and serialisation is explicit.
 *
 * @param {object} state Walk state.
 * @param {string} inventory `present` | `empty` | `none`.
 * @param {string} root Root description.
 * @param {{bytes: number, lines: number, documents: number}} input Counters.
 * @returns {object} Summary document.
 */
function buildSummary(state, inventory, root, input) {
  const limitations = [...PROFILE_DUMP_LIMITATIONS];
  if (state.discloseIdentity) limitations.push(...PROFILE_DUMP_DISCLOSURE_LIMITATIONS);
  return {
    profileDumpSummary: PROFILE_DUMP_SCHEMA,
    input: { bytes: input.bytes, lines: input.lines },
    documents: input.documents,
    inventory,
    root,
    identityDisclosed: state.discloseIdentity,
    counts: inventory === 'none' ? null : state.counts,
    // Rows follow `counts` and are null wherever the counters are null: a refused document has no
    // inventory to window over, and an empty array would read as "there are no entries".
    rows: inventory === 'none' ? null : state.rows,
    rowsTruncated: inventory === 'none' ? false : state.rowsTruncated,
    limits: { ...PROFILE_DUMP_LIMITS },
    diagnostics: state.diagnostics,
    diagnosticsTruncated: state.diagnosticsTruncated,
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
    // Copied per summary, so a caller may adapt its own copy without touching the shared list.
    notDerived: [...PROFILE_DUMP_NOT_DERIVED],
    limitations,
  };
}

/**
 * Read the only option this module accepts.
 *
 * An unknown key is refused rather than ignored: silently dropping `{discloseIdentty: true}`
 * would produce a summary that looks disclosure-free while the caller believes otherwise.
 *
 * @param {unknown} options Caller-supplied options.
 * @returns {boolean} Whether identity text was requested.
 * @throws {TypeError} On any shape other than an empty object or `{discloseIdentity: boolean}`.
 */
function readDisclosureOption(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('profile-dump: options must be an object');
  }
  const keys = Object.keys(options);
  for (const key of keys) {
    if (key !== 'discloseIdentity') {
      throw new TypeError('profile-dump: options carry an unknown key');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'discloseIdentity')) return false;
  if (typeof options.discloseIdentity !== 'boolean') {
    throw new TypeError('profile-dump: discloseIdentity must be a boolean');
  }
  return options.discloseIdentity;
}

/**
 * Summarize one dump document.
 *
 * @param {string} text Decoded UTF-8 document text.
 * @param {{discloseIdentity?: boolean}} [options] `discloseIdentity` copies each row's literal
 *   `id` and `name` text into the summary. It is off by default, it never copies a config value,
 *   and an unknown option key is refused rather than ignored.
 * @returns {{ok: boolean, summary: object, entryDiagnostics: number}} `ok` is false for every
 *   refusal; `entryDiagnostics` counts entry-level problems found, including any that did not fit
 *   in the diagnostics list.
 * @throws {TypeError} When `text` is not a string or `options` is not an object of the declared
 *   shape. Every message is fixed and never echoes the argument.
 */
export function summarizeProfileDumpText(text, options = {}) {
  if (typeof text !== 'string') {
    // Fixed text: the argument could be anything, including something worth not echoing.
    throw new TypeError('profile-dump: the document must be a string');
  }
  const discloseIdentity = readDisclosureOption(options);
  // Always measured here. An earlier draft accepted a caller-supplied byte count, which let a
  // caller claim 0 bytes for a 40 MiB document and walk straight past the cap.
  const bytes = Buffer.byteLength(text, 'utf8');
  const state = {
    counts: emptyCounts(),
    discloseIdentity,
    rows: [],
    rowsTruncated: false,
    diagnostics: [],
    diagnosticsTruncated: false,
    entryDiagnostics: 0,
    refused: false,
    jsScalars: [],
  };
  const lines = countLines(text);
  const header = { bytes, lines, documents: 0 };

  if (text === '') {
    pushDiagnostic(state, PROFILE_DUMP_CODES.EMPTY_INPUT);
    return { ok: true, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'empty', 'null', header) };
  }
  if (bytes > PROFILE_DUMP_LIMITS.maxBytes) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.INPUT_TOO_LARGE);
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', 'unknown', header) };
  }
  if (lines > PROFILE_DUMP_LIMITS.maxLines) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.INPUT_TOO_MANY_LINES);
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', 'unknown', header) };
  }

  let documents;
  try {
    documents = parseAllDocuments(text, {
      version: '1.2',
      schema: 'core',
      resolveKnownTags: false,
      merge: false,
      uniqueKeys: true,
      prettyErrors: false,
      // Registered so the expression tag resolves locally instead of arriving as a warning we
      // would then have to pair with a node position.
      customTags: [JS_TAG_DEF],
    });
  } catch (error) {
    // An escaping RangeError means the library's own recovery did not catch a stack overflow.
    pushDiagnostic(
      state,
      error instanceof RangeError
        ? PROFILE_DUMP_CODES.RESOURCE_EXHAUSTION_UNCAUGHT
        : PROFILE_DUMP_CODES.PARSE_ERROR,
    );
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', 'unknown', header) };
  }

  header.documents = documents.length;
  const lineOf = makeLineOf(text);

  if (documents.length > 1) {
    // Counted here, never inferred from the library's MULTIPLE_DOCS error (parseDocument only).
    pushDiagnostic(state, PROFILE_DUMP_CODES.MULTI_DOCUMENT);
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', 'unknown', header) };
  }

  // `parseAllDocuments` returns a plain array for real content, but for whitespace-only or
  // comment-only input it returns an EMPTY ARRAY carrying `empty: true` plus the stream's own
  // `errors`/`warnings` (v2.9.1 public-api.ts: `Object.assign([], { empty: true }, composer.streamInfo())`).
  // `'\n'` is exactly what `groupedDump` writes for an empty export, and an invalid `%directive`
  // arrives on that same stream — so these two properties, not `documents[0]`, are what must be
  // read. Reading `documents[0]` alone would have turned a clean empty export into a refusal and
  // would have dropped a stream-level directive error entirely.
  const document = documents.length === 1 ? documents[0] : null;
  const errors = document ? (document.errors ?? []) : (documents.errors ?? []);
  const warnings = document ? (document.warnings ?? []) : (documents.warnings ?? []);

  for (const error of errors) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.PARSE_ERROR, {
      line: lineForError(error, lineOf),
      // A closed whitelist, never `error.code` verbatim: the library's internal vocabulary is
      // not this command's output contract.
      detail: parseErrorDetail(error),
    });
    state.refused = true;
  }

  // A document that already failed to parse is refused here, before any entry check or walk:
  // inspecting the contents of a broken tree costs time and can only produce noise about a
  // structure the parser itself did not accept.
  if (state.refused) {
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', 'unknown', header) };
  }

  const contents = document?.contents ?? null;
  const root = describeRoot(contents);

  if (contents === null) {
    // Empty export (a single newline, or `# == <origin>` with no rows) and whitespace land here as
    // a null `contents`. They are "empty", not "healthy" — and only when the stream reported no
    // error and no warning; both were classified above, so a bad directive stays refused. (An
    // explicit `[]` is a sequence node with non-null contents and is classified later, not here.)
    classifyWarnings(state, warnings);
    pushDiagnostic(state, PROFILE_DUMP_CODES.EMPTY_INVENTORY);
    const empty = !state.refused;
    return {
      ok: empty,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, empty ? 'empty' : 'none', root, header),
    };
  }

  if (!isSeq(contents)) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.ROOT_NOT_SEQUENCE, { line: lineOf(contents?.range?.[0]) });
    return { ok: false, entryDiagnostics: state.entryDiagnostics, summary: buildSummary(state, 'none', root, header) };
  }

  checkEntries(state, contents, lineOf);
  walkTree(state, contents, lineOf);
  classifyWarnings(state, warnings);

  const inventory = contents.items.length === 0 ? 'empty' : 'present';
  if (inventory === 'empty') pushDiagnostic(state, PROFILE_DUMP_CODES.EMPTY_INVENTORY);

  const ok = !state.refused;
  return {
    ok,
    entryDiagnostics: state.entryDiagnostics,
    summary: buildSummary(state, ok ? inventory : 'none', root, header),
  };
}

/** 1-based line for a library error, without reading its message. */
function lineForError(error, lineOf) {
  const pos = Array.isArray(error?.pos) ? error.pos[0] : null;
  if (typeof pos !== 'number' || pos < 0) return null;
  return lineOf(pos);
}

/**
 * A closed whitelist of parse-error details.
 *
 * The library's `error.code` belongs to the parser, not to this command: copying it through would
 * make an internal enumeration part of a published output shape, and would publish parser detail
 * the caller never asked for. Only the one code that says something this command's contract can
 * state — a duplicate mapping key, which a dump must never contain — is kept; everything else
 * becomes the single word PARSE_FAILURE.
 *
 * @param {object} error A `YAMLError` from the document's `errors` list.
 * @returns {'DUPLICATE_KEY' | 'PARSE_FAILURE'} Fixed detail word.
 */
function parseErrorDetail(error) {
  return error?.code === 'DUPLICATE_KEY' ? 'DUPLICATE_KEY' : 'PARSE_FAILURE';
}

/**
 * Refuse every warning that survives registration of the expression tag.
 *
 * With `!!js` registered locally, a dump of the shape this command expects produces no warnings
 * at all. Any warning therefore describes something this reader did not model — an illegal
 * directive, a vendor tag, an unexpected implicit tag — and the document is refused rather than
 * summarised with a caveat. Nothing here reads `warning.message`, which carries source text.
 *
 * @param {object} state Walk state.
 * @param {object[]} warnings Library warnings.
 */
function classifyWarnings(state, warnings) {
  if (warnings.length === 0) return;

  const seen = new Set();
  for (const warning of warnings) {
    // A closed pair of words: the library's code is not copied through.
    const code = warning?.code === 'TAG_RESOLVE_FAILED' ? 'UNRESOLVED_TAG' : 'OTHER_WARNING';
    seen.add(code);
  }
  for (const code of seen) {
    pushDiagnostic(state, PROFILE_DUMP_CODES.UNEXPECTED_WARNING, { detail: code });
    state.refused = true;
  }
}

/**
 * Exit code implied by a summary.
 *
 * @param {{ok: boolean, summary: object}} result Result from {@link summarizeProfileDumpText}.
 * @returns {number} One of {@link PROFILE_DUMP_EXIT}.
 */
export function profileDumpExitCode(result) {
  if (!result.ok) return PROFILE_DUMP_EXIT.UNUSABLE;
  // Read from the counter, never from the diagnostics list: that list is capped at 64, and an
  // entry-level problem in row 500 would otherwise be invisible to the exit code merely because
  // 64 informational diagnostics had already filled it.
  if ((result.entryDiagnostics ?? 0) > 0) return PROFILE_DUMP_EXIT.ENTRY_DIAGNOSTICS;
  return PROFILE_DUMP_EXIT.OK;
}

/** Codes that always mean "unusable", exported for tests and callers. */
export const PROFILE_DUMP_REFUSAL_CODES = Object.freeze([...REFUSAL_CODES]);
