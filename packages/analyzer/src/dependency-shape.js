/**
 * dsh-compat-platform — dependency-shape: describe the SHAPE of the `inject` declarations in ONE
 * `dsh --profile <n> --dump-config` export.
 *
 * WHY THIS IS A SEPARATE ARTIFACT
 * -------------------------------
 * `profile-dump` reports a row window whose fields are the ones `EntryOptions` declares minus
 * `inject` (`packages/analyzer/src/profile-dump.js`, `MODELLED_KEYS`). It was left out on purpose:
 * `Inject = (keyof M)[] | { [K in keyof M]?: M[K] }` (`vendor/cordis/src/registry.ts:19`) is a
 * union of a *service-name list* and an *intercept config*, so a single word inside a row would
 * read as "this plugin depends on X" — a claim about resolution that a dump cannot support.
 *
 * This module answers a narrower question, and says so in its own `notDerived`/`limitations`:
 * across the rows of one export, how many declare `inject`, of which kind, and how large. It
 * never says whether anything can be *provided*, *satisfied*, *resolved* or *loaded*.
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
 *   4. Its output is a closed set of numbers, counts and fixed codes. No id, name, service
 *      name, origin label, `# == ` comment text, configuration key, value, expression text or
 *      path is ever copied into it, and no `YAMLError.message` is ever surfaced — those
 *      messages carry a source excerpt (see `prettifyError` in the library).
 *
 * The parse prologue and the safety walk are deliberately a second copy of the ones in
 * `profile-dump.js`, whose bytes are measured and recorded. `tests/dependency-shape.test.js`
 * cross-checks the two modules on a shared malformed-input corpus: they must agree on every
 * refusal, so the copy cannot drift silently.
 *
 * WHAT THE LIMITS HERE DO AND DO NOT BOUND
 * ----------------------------------------
 * `maxBytes`/`maxLines` act BEFORE parsing, on the text. They bound how much text can reach the
 * parser from this module's caller.
 *
 * `maxDepth`/`maxNodes`/`maxEntries`/`maxDiagnostics` act AFTER parsing, during the walk. They
 * bound what this command will *describe*. They are not parse-time protection: an escaping
 * `RangeError` is caught here and reported as `RESOURCE_EXHAUSTION_UNCAUGHT` — a recovery path,
 * not a guarantee.
 */

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';

/** Format identifier of the document produced by this module. */
export const DEPENDENCY_SHAPE_SCHEMA = 'dependency-shape-summary/0.1-draft.1';

/** Fixed, non-configurable limits. Deliberately not exposed as CLI options. */
export const DEPENDENCY_SHAPE_LIMITS = Object.freeze({
  maxBytes: 1048576,
  maxLines: 20000,
  maxDepth: 32,
  maxNodes: 20000,
  maxEntries: 5000,
  maxDiagnostics: 64,
});

/**
 * Things this summary does not establish.
 *
 * The first five names are copied verbatim from the accepted profile-export observation record
 * (`experiments/profile-export-fixture/observation.mjs`, `NOT_DERIVED`) and from
 * `PROFILE_DUMP_NOT_DERIVED`, because the reasons are identical: a dump row is not a declaration,
 * and an absent row is ambiguous between "not configured" and "bundle skipped". The sixth name is
 * this artifact's own addition, because "how many rows declare `inject`" says nothing about
 * whether any declared service is provided.
 *
 * Frozen, and copied per summary, so one consumer cannot edit the list another consumer observes.
 */
export const DEPENDENCY_SHAPE_NOT_DERIVED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
]);

/**
 * Fixed limitation codes, in the style of `COMBINED_REPORT_LIMITATIONS`: statements about this
 * artifact's envelope, not about any particular document.
 */
export const DEPENDENCY_SHAPE_LIMITATIONS = Object.freeze([
  'DEPENDENCY_SHAPE_IS_NOT_RESOLUTION',
  'INJECT_ITEM_NAMES_NOT_EMITTED',
  'NO_ROW_WINDOW_IN_THIS_SUMMARY',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
  'NO_LOADABILITY_OR_ACTIVATION_OBSERVED',
  'CONFIG_VALUES_NOT_INSPECTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
]);

/** The one tag this command accepts without understanding: the DSH expression form. */
const JS_TAG = 'tag:yaml.org,2002:js';

/**
 * A local tag definition for the expression form. Its only job is to stop the library from
 * emitting an "unresolved tag" warning for a tag this module has already decided to allow: the
 * resolver hands the source text back untouched and this module never reads the resulting value.
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
 *
 * The refusal codes carry the same names as `PROFILE_DUMP_CODES`, because they mean the same
 * thing about the same document; a consumer that handles one artifact therefore handles the
 * other. The two attention codes are this module's own: they describe an `inject` value whose
 * shape is outside the union the loader declares, which is a fact about the row, not a reason to
 * reject the document.
 */
export const DEPENDENCY_SHAPE_CODES = Object.freeze({
  // parsed, nothing wrong with the document's shape
  EMPTY_INPUT: 'EMPTY_INPUT',
  EMPTY_INVENTORY: 'EMPTY_INVENTORY',
  // observed, informational — does not by itself change the exit code
  JS_EXPRESSION_NOT_EVALUATED: 'JS_EXPRESSION_NOT_EVALUATED',
  // entry-level: parsed, but an `inject` value the loader's union does not cover
  INJECT_SHAPE_NOT_MODELLED: 'INJECT_SHAPE_NOT_MODELLED',
  INJECT_ITEM_NOT_A_NAME: 'INJECT_ITEM_NOT_A_NAME',
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
export const DEPENDENCY_SHAPE_EXIT = Object.freeze({
  OK: 0,
  ENTRY_DIAGNOSTICS: 1,
  UNUSABLE: 2,
  INTERNAL: 5,
  USAGE: 64,
});

/** Codes that make a document unusable. */
const REFUSAL_CODES = Object.freeze(
  new Set([
    DEPENDENCY_SHAPE_CODES.INPUT_OPEN_FAILED,
    DEPENDENCY_SHAPE_CODES.INPUT_STAT_FAILED,
    DEPENDENCY_SHAPE_CODES.INPUT_READ_FAILED,
    DEPENDENCY_SHAPE_CODES.INPUT_NOT_REGULAR,
    DEPENDENCY_SHAPE_CODES.INPUT_NOT_UTF8,
    DEPENDENCY_SHAPE_CODES.INPUT_TOO_LARGE,
    DEPENDENCY_SHAPE_CODES.INPUT_TOO_MANY_LINES,
    DEPENDENCY_SHAPE_CODES.MULTI_DOCUMENT,
    DEPENDENCY_SHAPE_CODES.PARSE_ERROR,
    DEPENDENCY_SHAPE_CODES.UNEXPECTED_WARNING,
    DEPENDENCY_SHAPE_CODES.RESOURCE_EXHAUSTION_UNCAUGHT,
    DEPENDENCY_SHAPE_CODES.ROOT_NOT_SEQUENCE,
    DEPENDENCY_SHAPE_CODES.ENTRY_NOT_MAPPING,
    DEPENDENCY_SHAPE_CODES.UNSUPPORTED_TAG,
    DEPENDENCY_SHAPE_CODES.TAG_KEY_PRESENT,
    DEPENDENCY_SHAPE_CODES.ALIAS_PRESENT,
    DEPENDENCY_SHAPE_CODES.ANCHOR_PRESENT,
    DEPENDENCY_SHAPE_CODES.MERGE_KEY,
    DEPENDENCY_SHAPE_CODES.DEPTH_LIMIT,
    DEPENDENCY_SHAPE_CODES.NODE_LIMIT,
    DEPENDENCY_SHAPE_CODES.ENTRY_LIMIT,
  ]),
);

/** Codes that make a parsed document "look at this row" rather than "cannot be read". */
const ENTRY_CODES = Object.freeze(
  new Set([
    DEPENDENCY_SHAPE_CODES.INJECT_SHAPE_NOT_MODELLED,
    DEPENDENCY_SHAPE_CODES.INJECT_ITEM_NOT_A_NAME,
  ]),
);

/** Reading the value of a key only ever compares it to this literal. */
const MERGE_KEY_TEXT = '<<';
/** Key name read from a row. Compared, never copied into the output. */
const KEY_INJECT = 'inject';

/**
 * The five `inject` shapes this reader can tell apart.
 *
 * `null` gets its own word rather than being folded into `other`, because
 * `EntryOptions.inject?: Inject | null` (`vendor/loader/src/config/entry.ts:22`) makes it legal
 * and the loader reads it as "not set"; `absent` is kept separate from `null` for the same
 * reason it is kept separate in `profile-dump`. `other` is everything the union does not cover —
 * a string, a number, a boolean, a tagged scalar — and is the one kind that lifts the exit code
 * to 1, because it says the export contains something this reader could not describe.
 */
export const INJECT_KIND = Object.freeze({
  ABSENT: 'absent',
  NULL: 'null',
  SEQUENCE: 'sequence',
  MAPPING: 'mapping',
  OTHER: 'other',
});

/**
 * Collect diagnostics with a hard cap.
 * @param {object} state Mutable walk state.
 * @param {string} code One of {@link DEPENDENCY_SHAPE_CODES}.
 * @param {{ordinal?: number|null, line?: number|null, detail?: string}} [where] Location.
 */
function pushDiagnostic(state, code, where = {}) {
  // Counted BEFORE the cap: the exit code must not depend on what happened to fit in the list.
  // An entry-level problem in row 400 is still an entry-level problem when 64 other diagnostics
  // have already filled the display.
  if (ENTRY_CODES.has(code)) state.entryDiagnostics += 1;
  if (state.diagnostics.length >= DEPENDENCY_SHAPE_LIMITS.maxDiagnostics) {
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
 * Identical in effect to `walkTree` in `profile-dump.js`: the refusals are part of this
 * artifact's contract too, and the cross-check test pins the agreement.
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
    if (nodes > DEPENDENCY_SHAPE_LIMITS.maxNodes) {
      pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.NODE_LIMIT);
      state.refused = true;
      return;
    }
    if (frame.depth > DEPENDENCY_SHAPE_LIMITS.maxDepth) {
      pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.DEPTH_LIMIT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
      return;
    }
    if (frame.depth > state.counts.maxDepth) state.counts.maxDepth = frame.depth;

    if (isAlias(node)) {
      pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.ALIAS_PRESENT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
      continue;
    }

    if (typeof node?.anchor === 'string' && node.anchor !== '') {
      pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.ANCHOR_PRESENT, { line: lineOf(node?.range?.[0]) });
      state.refused = true;
    }

    const tag = node?.tag;
    if (typeof tag === 'string') {
      seenTags.add(tag);
      if (tag === JS_TAG) {
        if (!isScalar(node)) {
          // A collection carrying the expression tag is not something a dump produces.
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.UNSUPPORTED_TAG, {
            line: lineOf(node?.range?.[0]),
            detail: TAG_CLASS.JS_COLLECTION,
          });
          state.refused = true;
        } else {
          // Recorded, never read: the value is the expression text and stays opaque.
          state.counts.jsScalars += 1;
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.JS_EXPRESSION_NOT_EVALUATED, {
            line: lineOf(node.range?.[0]),
          });
        }
      } else {
        const allowed = isScalar(node)
          ? ALLOWED_SCALAR_TAGS.has(tag)
          : ALLOWED_COLLECTION_TAGS.has(tag);
        if (!allowed) {
          // The class, never the tag: `!SECRET_TAG` and `!<https://…>` are operator text.
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.UNSUPPORTED_TAG, {
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
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.TAG_KEY_PRESENT, {
            line: lineOf(key?.range?.[0]),
            detail: tagClass(key.tag),
          });
          state.refused = true;
        }
        if (keyIs(key, MERGE_KEY_TEXT)) {
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.MERGE_KEY, { line: lineOf(key?.range?.[0]) });
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

/** Empty counts object, so the summary shape never varies. */
function emptyCounts() {
  return {
    rows: 0,
    rowsWithInject: 0,
    injectAbsent: 0,
    injectNull: 0,
    injectSequence: 0,
    injectMapping: 0,
    injectOther: 0,
    injectSequenceItems: 0,
    injectNames: 0,
    injectTaggedItems: 0,
    injectNonScalarItems: 0,
    injectMappingKeys: 0,
    injectEmptyMappings: 0,
    jsScalars: 0,
    distinctTags: 0,
    nodes: 0,
    scalars: 0,
    maxDepth: 0,
  };
}

/**
 * Classify one sequence item without copying it.
 *
 * A plain `!!str` scalar (or an implicitly typed string) is a *name*: the loader's union types
 * sequence items as service keys, so it is counted, never emitted. A scalar carrying the opaque
 * expression tag is counted separately, because "an expression stands here" is a different
 * observation from "a name stands here". Anything else — a nested mapping, a sequence, a
 * non-string scalar — is not a name, and is counted as such.
 *
 * @param {object} state Walk state.
 * @param {unknown} node Sequence item.
 * @returns {'name' | 'tagged' | 'other'} Which counter to charge.
 */
function itemKindOf(node) {
  if (!isScalar(node)) return 'other';
  if (node.tag === JS_TAG) return 'tagged';
  const value = node.value;
  const isString = typeof value === 'string' && (node.tag === undefined || node.tag === 'tag:yaml.org,2002:str');
  return isString ? 'name' : 'other';
}

/**
 * Describe the `inject` declarations across the rows.
 *
 * Only the presence and the *shape* of the `inject` value is examined: never a service name,
 * never an intercept-config key, never a value. The row ordinal and the line are reported so a
 * reader can open the export at the right place; the row's identity is not.
 *
 * @param {object} state Walk state.
 * @param {import('yaml').YAMLSeq} root Root sequence.
 * @param {(offset: number) => number} lineOf Offset mapper.
 */
function checkInject(state, root, lineOf) {
  const items = root.items;
  state.counts.rows = items.length;

  if (items.length > DEPENDENCY_SHAPE_LIMITS.maxEntries) {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.ENTRY_LIMIT);
    state.refused = true;
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const ordinal = index + 1;
    const row = items[index];
    if (!isMap(row)) {
      pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.ENTRY_NOT_MAPPING, {
        ordinal,
        line: lineOf(row?.range?.[0]),
      });
      state.refused = true;
      continue;
    }

    const pair = findPair(row, KEY_INJECT);
    if (pair === undefined) {
      state.counts.injectAbsent += 1;
      continue;
    }

    state.counts.rowsWithInject += 1;
    const value = pair.value;
    const line = lineOf(value?.range?.[0] ?? pair.key?.range?.[0] ?? row.range?.[0]);

    if (isSeq(value)) {
      state.counts.injectSequence += 1;
      state.counts.injectSequenceItems += value.items.length;
      for (const item of value.items) {
        const kind = itemKindOf(item);
        if (kind === 'name') {
          state.counts.injectNames += 1;
        } else if (kind === 'tagged') {
          state.counts.injectTaggedItems += 1;
        } else {
          state.counts.injectNonScalarItems += 1;
          pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.INJECT_ITEM_NOT_A_NAME, { ordinal, line });
        }
      }
      continue;
    }

    if (isMap(value)) {
      state.counts.injectMapping += 1;
      state.counts.injectMappingKeys += value.items.length;
      if (value.items.length === 0) state.counts.injectEmptyMappings += 1;
      continue;
    }

    if (isScalar(value) && value.value === null) {
      // Legal: `inject?: Inject | null`. Distinct from absent and from a type error.
      state.counts.injectNull += 1;
      continue;
    }

    // A string, number, boolean or tagged scalar where the union allows only a list or a mapping.
    state.counts.injectOther += 1;
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.INJECT_SHAPE_NOT_MODELLED, { ordinal, line });
  }
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
  return {
    dependencyShapeSummary: DEPENDENCY_SHAPE_SCHEMA,
    input: { bytes: input.bytes, lines: input.lines },
    documents: input.documents,
    inventory,
    root,
    // Null wherever the counters are null: a refused document has no rows to describe, and zeros
    // there would read as "this export declares no dependency" — the exact over-read this
    // artifact exists to avoid.
    counts: inventory === 'none' ? null : state.counts,
    limits: { ...DEPENDENCY_SHAPE_LIMITS },
    diagnostics: state.diagnostics,
    diagnosticsTruncated: state.diagnosticsTruncated,
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
    // Copied per summary, so a caller may adapt its own copy without touching the shared list.
    notDerived: [...DEPENDENCY_SHAPE_NOT_DERIVED],
    limitations: [...DEPENDENCY_SHAPE_LIMITATIONS],
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
 * The library's `error.code` belongs to the parser, not to this command: only the one code that
 * says something this command's contract can state — a duplicate mapping key, which a dump must
 * never contain — is kept; everything else becomes the single word PARSE_FAILURE.
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
 * at all. Any warning therefore describes something this reader did not model, and the document
 * is refused rather than summarised with a caveat. Nothing here reads `warning.message`, which
 * carries source text.
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
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.UNEXPECTED_WARNING, { detail: code });
    state.refused = true;
  }
}

/**
 * Describe the `inject` declarations of one dump document.
 *
 * @param {string} text Decoded UTF-8 document text.
 * @returns {{ok: boolean, summary: object, entryDiagnostics: number}} `ok` is false for every
 *   refusal; `entryDiagnostics` counts entry-level problems found, including any that did not fit
 *   in the diagnostics list.
 * @throws {TypeError} When `text` is not a string. The message is fixed and never echoes the
 *   argument.
 */
export function summarizeDependencyShapeText(text) {
  if (typeof text !== 'string') {
    // Fixed text: the argument could be anything, including something worth not echoing.
    throw new TypeError('dependency-shape: the document must be a string');
  }
  // Always measured here: a caller-supplied byte count would let a caller claim 0 bytes for a
  // 40 MiB document and walk straight past the cap.
  const bytes = Buffer.byteLength(text, 'utf8');
  const state = {
    counts: emptyCounts(),
    diagnostics: [],
    diagnosticsTruncated: false,
    entryDiagnostics: 0,
    refused: false,
  };
  const lines = countLines(text);
  const header = { bytes, lines, documents: 0 };

  if (text === '') {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.EMPTY_INPUT);
    return {
      ok: true,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'empty', 'null', header),
    };
  }
  if (bytes > DEPENDENCY_SHAPE_LIMITS.maxBytes) {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.INPUT_TOO_LARGE);
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', 'unknown', header),
    };
  }
  if (lines > DEPENDENCY_SHAPE_LIMITS.maxLines) {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.INPUT_TOO_MANY_LINES);
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', 'unknown', header),
    };
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
        ? DEPENDENCY_SHAPE_CODES.RESOURCE_EXHAUSTION_UNCAUGHT
        : DEPENDENCY_SHAPE_CODES.PARSE_ERROR,
    );
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', 'unknown', header),
    };
  }

  header.documents = documents.length;
  const lineOf = makeLineOf(text);

  if (documents.length > 1) {
    // Counted here, never inferred from the library's MULTIPLE_DOCS error (parseDocument only).
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.MULTI_DOCUMENT);
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', 'unknown', header),
    };
  }

  // For whitespace-only or comment-only input `parseAllDocuments` returns an EMPTY ARRAY carrying
  // `empty: true` plus the stream's own `errors`/`warnings`; `'\n'` is exactly what `groupedDump`
  // writes for an empty export, and an invalid `%directive` arrives on that same stream. These two
  // properties, not `documents[0]`, are what must be read.
  const document = documents.length === 1 ? documents[0] : null;
  const errors = document ? (document.errors ?? []) : (documents.errors ?? []);
  const warnings = document ? (document.warnings ?? []) : (documents.warnings ?? []);

  for (const error of errors) {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.PARSE_ERROR, {
      line: lineForError(error, lineOf),
      // A closed whitelist, never `error.code` verbatim.
      detail: parseErrorDetail(error),
    });
    state.refused = true;
  }

  // A document that already failed to parse is refused here, before any check or walk.
  if (state.refused) {
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', 'unknown', header),
    };
  }

  const contents = document?.contents ?? null;
  const root = describeRoot(contents);

  if (contents === null) {
    // Empty export (a single newline, or `# == <origin>` with no rows) and whitespace land here as
    // a null `contents`. They are "empty", not "healthy" — and only when the stream reported no
    // error and no warning.
    classifyWarnings(state, warnings);
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.EMPTY_INVENTORY);
    const empty = !state.refused;
    return {
      ok: empty,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, empty ? 'empty' : 'none', root, header),
    };
  }

  if (!isSeq(contents)) {
    pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.ROOT_NOT_SEQUENCE, {
      line: lineOf(contents?.range?.[0]),
    });
    return {
      ok: false,
      entryDiagnostics: state.entryDiagnostics,
      summary: buildSummary(state, 'none', root, header),
    };
  }

  checkInject(state, contents, lineOf);
  walkTree(state, contents, lineOf);
  classifyWarnings(state, warnings);

  const inventory = contents.items.length === 0 ? 'empty' : 'present';
  if (inventory === 'empty') pushDiagnostic(state, DEPENDENCY_SHAPE_CODES.EMPTY_INVENTORY);

  const ok = !state.refused;
  return {
    ok,
    entryDiagnostics: state.entryDiagnostics,
    summary: buildSummary(state, ok ? inventory : 'none', root, header),
  };
}

/**
 * Exit code implied by a summary.
 *
 * @param {{ok: boolean, entryDiagnostics: number, summary: object}} result Result from
 *   {@link summarizeDependencyShapeText}.
 * @returns {number} One of {@link DEPENDENCY_SHAPE_EXIT}.
 */
export function dependencyShapeExitCode(result) {
  if (!result.ok) return DEPENDENCY_SHAPE_EXIT.UNUSABLE;
  // Read from the counter, never from the diagnostics list: that list is capped at 64, and an
  // entry-level problem in row 500 would otherwise be invisible to the exit code.
  if ((result.entryDiagnostics ?? 0) > 0) return DEPENDENCY_SHAPE_EXIT.ENTRY_DIAGNOSTICS;
  return DEPENDENCY_SHAPE_EXIT.OK;
}

/** Codes that always mean "unusable", exported for tests and callers. */
export const DEPENDENCY_SHAPE_REFUSAL_CODES = Object.freeze([...REFUSAL_CODES]);
