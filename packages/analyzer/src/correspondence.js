/**
 * dsh-compat-platform — correspondence: verify a caller's assertion that a profile row and a
 * plugin declaration belong together, without ever emitting identity text.
 *
 * WHY AN ASSERTION AND NOT A MATCH
 * --------------------------------
 * A profile dump carries an `id` that the loader may have invented (8 hex characters when the key
 * is absent), that two entries may silently share (the second replaces the first, no error), and
 * a `name` with nothing on the declaration side to match it against — a declaration has no module
 * specifier field at all. So the tool cannot *derive* the correspondence. The caller asserts it in
 * its own artifact (`profile-correspondence/0.1-draft.1`) and this module only checks whether the
 * assertion is internally consistent with the bytes on both sides. Every way the assertion can be
 * wrong becomes a refusal, never a guess.
 *
 * TRUST BOUNDARY, stated once and enforced by construction:
 *
 *   1. This module receives text. It does not read files, does not resolve paths, does not touch
 *      the network and does not spawn anything. The caller owns the read.
 *   2. The profile safety decision is not re-derived here: `summarizeProfileDumpText()` is called
 *      first and any refusal of its own stops the check. This module never parses YAML.
 *   3. The only profile text it reads at all is two line patterns — `- ` record openers and
 *      `  id: <bare token>` lines — and the id text is compared, never copied.
 *   4. Its output is a closed set of numbers, positions, fixed words and the two sha256 digests
 *      the caller supplied. No id, plugin id, note, path, config key, value or parser message is
 *      ever copied into it.
 *
 * INTERPRETATIONS (the design does not spell these out):
 *
 *   - `summarizeProfileDumpText` refusals are reported as `CORRESPONDENCE_PROFILE_UNREADABLE`,
 *     a single code of this artifact's own, rather than forwarding the summarizer's code. The
 *     summarizer's vocabulary is part of its output contract, not this one.
 *   - A pair naming the same `pluginId` as another pair is a *finding*, not a refusal, following
 *     §3.5. §2's "unique within their own list" is applied to `entryId` only; if it were applied
 *     to `pluginId` too, `CORRESPONDENCE_DUPLICATE_PLUGIN_ID` could never be emitted.
 *   - A matched row outside the summarizer's row window (the window is capped at 64 rows) cannot
 *     supply `disabled`/`config`/`keyCount`, so the assertion is refused as
 *     `CORRESPONDENCE_ENTRY_NOT_FOUND` rather than reported with invented fields.
 *   - When two declarations share a `plugin.id`, the first in document order supplies the
 *     capability and resource counts. Aggregating them would overstate what any one declaration
 *     says.
 *   - Digests are taken over the UTF-8 bytes of the text as delivered by the reader. A leading
 *     byte-order mark has already been consumed by that reader, so a caller that hashed the raw
 *     file bytes of a BOM-prefixed file would see a mismatch and get `CORRESPONDENCE_STALE`.
 */

import { createHash } from 'node:crypto';

import { summarizeProfileDumpText } from './profile-dump.js';

/** Format identifier of the artifact this module verifies. */
export const CORRESPONDENCE_VERSION = 'profile-correspondence/0.1-draft.1';

/** Format identifier of the document this module produces. */
export const CORRESPONDENCE_SUMMARY = 'correspondence-summary/0.1-draft.1';

/** Exit codes for the command. `1` and `2` mean different things on purpose. */
export const CORRESPONDENCE_EXIT = Object.freeze({
  OK: 0,
  FINDINGS: 1,
  REFUSED: 2,
  INTERNAL: 5,
  USAGE: 64,
});

/**
 * Every code this module can emit. A closed set: a condition with no code here is not reported.
 */
export const CORRESPONDENCE_CODES = Object.freeze({
  CORRESPONDENCE_NOT_AN_OBJECT: 'CORRESPONDENCE_NOT_AN_OBJECT',
  CORRESPONDENCE_UNEXPECTED_KEY: 'CORRESPONDENCE_UNEXPECTED_KEY',
  CORRESPONDENCE_MISSING_KEY: 'CORRESPONDENCE_MISSING_KEY',
  CORRESPONDENCE_VERSION_INVALID: 'CORRESPONDENCE_VERSION_INVALID',
  CORRESPONDENCE_BINDING_INVALID: 'CORRESPONDENCE_BINDING_INVALID',
  CORRESPONDENCE_PAIRS_EMPTY: 'CORRESPONDENCE_PAIRS_EMPTY',
  CORRESPONDENCE_PAIR_NOT_AN_OBJECT: 'CORRESPONDENCE_PAIR_NOT_AN_OBJECT',
  CORRESPONDENCE_PAIR_KEY_INVALID: 'CORRESPONDENCE_PAIR_KEY_INVALID',
  CORRESPONDENCE_ID_NOT_A_LABEL: 'CORRESPONDENCE_ID_NOT_A_LABEL',
  CORRESPONDENCE_ID_DUPLICATED: 'CORRESPONDENCE_ID_DUPLICATED',
  CORRESPONDENCE_STALE: 'CORRESPONDENCE_STALE',
  CORRESPONDENCE_PROFILE_UNREADABLE: 'CORRESPONDENCE_PROFILE_UNREADABLE',
  CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH: 'CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH',
  CORRESPONDENCE_ENTRY_NOT_FOUND: 'CORRESPONDENCE_ENTRY_NOT_FOUND',
  CORRESPONDENCE_ENTRY_AMBIGUOUS: 'CORRESPONDENCE_ENTRY_AMBIGUOUS',
  CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT: 'CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT',
  CORRESPONDENCE_PLUGIN_NOT_DECLARED: 'CORRESPONDENCE_PLUGIN_NOT_DECLARED',
  CORRESPONDENCE_DUPLICATE_PLUGIN_ID: 'CORRESPONDENCE_DUPLICATE_PLUGIN_ID',
  CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES: 'CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES',
  CORRESPONDENCE_INTERNAL: 'CORRESPONDENCE_INTERNAL',
});

/**
 * Things this summary does not establish. Names, not prose: a consumer may compare them.
 *
 * The first six are the profile-dump list plus `dependencyResolution` (the same reasons apply:
 * this artifact compares two documents and resolves nothing). `identity` is this artifact's own
 * addition: the match is the caller's assertion, so the identity relation is asserted, not derived.
 */
export const CORRESPONDENCE_NOT_DERIVED = Object.freeze([
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
  'identity',
]);

/** Fixed limitation codes describing this artifact's envelope. */
export const CORRESPONDENCE_LIMITATIONS = Object.freeze([
  'IDENTITY_IS_CALLER_ASSERTED',
  'NO_VERSION_CORRESPONDENCE',
  'CONFIG_VALUES_NOT_COMPARED',
  'CAPABILITY_SATISFACTION_NOT_CHECKED',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'IDENTITY_TEXT_NEVER_EMITTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
]);

/** Closed key sets. An object with any other key is refused, at either level. */
const TOP_LEVEL_KEYS = Object.freeze(['correspondenceVersion', 'bindings', 'pairs']);
const BINDING_KEYS = Object.freeze(['profileSha256', 'declarationSha256']);
const PAIR_KEYS = Object.freeze(['entryId', 'pluginId', 'note']);
const REQUIRED_PAIR_KEYS = Object.freeze(['entryId', 'pluginId']);

/** A digest is exactly 64 lowercase hex characters. Uppercase is not accepted. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Control characters and the two Unicode line separators. A label is a single line of text; a
 * character that can move a terminal cursor is not part of one.
 */
const LABEL_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/**
 * A profile `id` value this scan considers literal: plain, unquoted, no tag (`!!`), no anchor or
 * alias (`&`/`*`), no flow collection, no comment, no block indicator. Anything else simply makes
 * that entry unaddressable — it never refuses the document.
 */
const BARE_ID = /^[^\s"'`&*{}\[\],#|>%@!]+$/;

/**
 * The literal line shapes the id scan reads. Nothing else in the profile is looked at.
 *
 * A record opener is a line-anchored `- ` at column 0. The design names the indented `  id:` line
 * as the id shape, and the house fixtures write the same pair as `- id: ...` on the opener line;
 * both spellings are the same key of the same mapping, so both are read and the opener form is
 * tried first.
 */
const OPENER_PREFIX = '- ';
const ID_LINE = /^ {2}id: (.*)$/;
const OPENER_ID_LINE = /^- id: (.*)$/;

/** The closed refusal result. Frozen so a caller cannot turn a refusal into a pass. */
function refuse(code) {
  return Object.freeze({ refused: true, code });
}

/** True for a non-null, non-array object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` owns no key outside `allowed`. */
function hasOnlyKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
}

/** True when `value` owns every key in `required`. */
function hasEveryKey(value, required) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

/** True for a non-empty, already-trimmed label with no control characters or line separators. */
function isLabel(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return false;
  if (value !== value.trim()) return false;
  return !LABEL_FORBIDDEN.test(value);
}

/** sha256 of the UTF-8 bytes of a string, lowercase hex. */
function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/**
 * Validate the correspondence artifact.
 *
 * Never throws, never echoes any part of the argument: a malformed artifact can carry arbitrary
 * text, and that text must not become part of a diagnostic.
 *
 * @param {unknown} value Parsed correspondence document.
 * @returns {{ok: true, value: object} | {ok: false, code: string}} A normalized, frozen copy on
 *   success — the caller's object is not retained, so later mutation cannot change the check.
 */
export function validateCorrespondence(value) {
  if (!isPlainObject(value)) return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_NOT_AN_OBJECT };
  if (!hasOnlyKeys(value, TOP_LEVEL_KEYS)) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_UNEXPECTED_KEY };
  }
  if (!hasEveryKey(value, TOP_LEVEL_KEYS)) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_MISSING_KEY };
  }
  if (value.correspondenceVersion !== CORRESPONDENCE_VERSION) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_VERSION_INVALID };
  }

  const bindings = value.bindings;
  if (!isPlainObject(bindings)) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_BINDING_INVALID };
  }
  if (!hasOnlyKeys(bindings, BINDING_KEYS) || !hasEveryKey(bindings, BINDING_KEYS)) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_BINDING_INVALID };
  }
  if (!SHA256_HEX.test(bindings.profileSha256) || !SHA256_HEX.test(bindings.declarationSha256)) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_BINDING_INVALID };
  }

  if (!Array.isArray(value.pairs) || value.pairs.length === 0) {
    return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PAIRS_EMPTY };
  }

  const pairs = [];
  const entryIds = new Set();
  for (const raw of value.pairs) {
    if (!isPlainObject(raw)) {
      return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_NOT_AN_OBJECT };
    }
    if (!hasOnlyKeys(raw, PAIR_KEYS) || !hasEveryKey(raw, REQUIRED_PAIR_KEYS)) {
      return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_KEY_INVALID };
    }
    // `note` is optional; when present it must be a string. Its content is never read again.
    if (Object.hasOwn(raw, 'note') && typeof raw.note !== 'string') {
      return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_KEY_INVALID };
    }
    if (!isLabel(raw.entryId) || !isLabel(raw.pluginId)) {
      return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_ID_NOT_A_LABEL };
    }
    if (entryIds.has(raw.entryId)) {
      return { ok: false, code: CORRESPONDENCE_CODES.CORRESPONDENCE_ID_DUPLICATED };
    }
    entryIds.add(raw.entryId);
    const pair = { entryId: raw.entryId, pluginId: raw.pluginId };
    if (Object.hasOwn(raw, 'note')) pair.note = raw.note;
    pairs.push(Object.freeze(pair));
  }

  return {
    ok: true,
    value: Object.freeze({
      correspondenceVersion: CORRESPONDENCE_VERSION,
      bindings: Object.freeze({
        profileSha256: bindings.profileSha256,
        declarationSha256: bindings.declarationSha256,
      }),
      pairs: Object.freeze(pairs),
    }),
  };
}

/**
 * Turn one raw `id:` value into a literal id, or `null` when it is not one.
 *
 * Only the shape is judged; the text is returned to the caller for comparison and never stored
 * in an output document.
 *
 * @param {string} raw Text after `id: ` on an exactly two-space-indented line.
 * @returns {string|null} The id, or null when the value is quoted, tagged, aliased, a flow
 *   collection, empty, or otherwise not a bare token.
 */
function literalId(raw) {
  const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (value === '') return null;
  if (!BARE_ID.test(value)) return null;
  return value;
}

/**
 * Scan the profile text for record openers and literal entry ids.
 *
 * Three line patterns only: a line starting with `- ` opens a record, `- id: <value>` on that same
 * opener line and `  id: <value>` on a following line set that record's id when the value is a
 * bare token. The first `id:` line of a record wins, even when its value is not literal — a record
 * whose id cannot be read is never addressable, and a later line must not silently stand in for
 * it. No tag is evaluated and no other YAML is parsed.
 *
 * @param {string} text Profile dump text already accepted by the summarizer.
 * @returns {{openers: number, entries: {ordinal: number, line: number, id: string|null}[]}}
 *   `openers` is the count the row-count check compares against `counts.entries`.
 */
function scanProfileIds(text) {
  const entries = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
    if (line.startsWith(OPENER_PREFIX)) {
      const entry = { ordinal: entries.length + 1, line: index + 1, id: null, idSeen: false };
      const onOpener = OPENER_ID_LINE.exec(line);
      if (onOpener !== null) {
        entry.id = literalId(onOpener[1]);
        entry.idSeen = true;
      }
      entries.push(entry);
      continue;
    }
    if (entries.length === 0) continue;
    const match = ID_LINE.exec(line);
    if (match === null) continue;
    const current = entries[entries.length - 1];
    if (current.idSeen) continue;
    current.id = literalId(match[1]);
    current.idSeen = true;
  }
  return { openers: entries.length, entries };
}

/**
 * Parse the declaration document and return its declarations, or null when it is not the
 * analyzer input shape (`{ declarations, availableCapabilities }`).
 *
 * @param {string} text Declaration document text.
 * @returns {unknown[]|null} The declarations array, or null.
 */
function readDeclarations(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A parse failure is a malformed declaration document, not an internal error. The parser's
    // message carries a source excerpt and is dropped here.
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if (!Array.isArray(parsed.declarations)) return null;
  return parsed.declarations;
}

/**
 * Read the facts this check needs from one declaration. Never throws; a malformed declaration
 * contributes nothing rather than refusing the whole document (the declaration document was
 * already a JSON object with an array).
 *
 * @param {unknown} declaration Entry of `declarations`.
 * @returns {{pluginId: string|null, required: number, optional: number, tool: number,
 *   service: number}} Facts with zero counts when a field is absent or not of the right shape.
 */
function declarationFacts(declaration) {
  const facts = { pluginId: null, required: 0, optional: 0, tool: 0, service: 0 };
  if (!isPlainObject(declaration)) return facts;

  const plugin = isPlainObject(declaration.plugin) ? declaration.plugin : null;
  if (plugin !== null && typeof plugin.id === 'string') facts.pluginId = plugin.id;

  const capabilities = isPlainObject(declaration.capabilities) ? declaration.capabilities : null;
  if (capabilities !== null) {
    if (Array.isArray(capabilities.required)) facts.required = capabilities.required.length;
    if (Array.isArray(capabilities.optional)) facts.optional = capabilities.optional.length;
  }

  if (Array.isArray(declaration.resources)) {
    for (const resource of declaration.resources) {
      const kind = isPlainObject(resource) ? resource.kind : undefined;
      // The output shape is `{tool, service}`; a kind outside those two is not counted, because
      // there is no closed field to count it in.
      if (kind === 'tool') facts.tool += 1;
      else if (kind === 'service') facts.service += 1;
    }
  }
  return facts;
}

/** The code order findings are sorted by, so the output order cannot depend on discovery order. */
const FINDING_ORDER = Object.freeze([
  CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED,
  CORRESPONDENCE_CODES.CORRESPONDENCE_DUPLICATE_PLUGIN_ID,
  CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES,
]);

/**
 * Check one asserted correspondence.
 *
 * Order is part of the contract: shape, then bindings, then the profile safety decision, then the
 * id scan and row-count check, then resolution, then findings.
 *
 * @param {{correspondence: unknown, profileText: string, declarationText: string}} input Parsed
 *   correspondence, profile dump text and declaration document text.
 * @returns {object} The summary document of design §5, or `{refused: true, code}`.
 * @throws {TypeError} Only when `input` itself is not an object. The CLI reports that as exit 5.
 */
export function checkCorrespondence(input) {
  if (!isPlainObject(input)) {
    throw new TypeError('correspondence: the input must be an object');
  }

  const validation = validateCorrespondence(input.correspondence);
  if (!validation.ok) return refuse(validation.code);
  const { bindings, pairs } = validation.value;

  const profileText = input.profileText;
  const declarationText = input.declarationText;
  if (typeof profileText !== 'string') {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_UNREADABLE);
  }
  if (typeof declarationText !== 'string') {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT);
  }

  const profileSha256 = sha256Hex(profileText);
  const declarationSha256 = sha256Hex(declarationText);
  if (profileSha256 !== bindings.profileSha256 || declarationSha256 !== bindings.declarationSha256) {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_STALE);
  }

  let summarized;
  try {
    summarized = summarizeProfileDumpText(profileText);
  } catch {
    // Includes an escaping RangeError from the parser's own recursion.
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_UNREADABLE);
  }
  if (!summarized.ok || summarized.summary.counts === null) {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_UNREADABLE);
  }
  const profileSummary = summarized.summary;

  const scan = scanProfileIds(profileText);
  if (scan.openers !== profileSummary.counts.entries) {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH);
  }

  const declarations = readDeclarations(declarationText);
  if (declarations === null) {
    return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT);
  }

  // Ordinals per literal id. A non-literal id simply never appears here.
  const ordinalsById = new Map();
  for (const entry of scan.entries) {
    if (entry.id === null) continue;
    const existing = ordinalsById.get(entry.id);
    if (existing === undefined) ordinalsById.set(entry.id, [entry.ordinal]);
    else existing.push(entry.ordinal);
  }
  const rowsByIndex = new Map();
  for (const row of profileSummary.rows) rowsByIndex.set(row.index, row);

  /** Resolve every asserted entry id first: one unresolved assertion refuses the whole check. */
  const resolved = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const ordinals = ordinalsById.get(pair.entryId) ?? [];
    if (ordinals.length === 0) {
      return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_NOT_FOUND);
    }
    if (ordinals.length > 1) {
      // The silent collapse the loader performs on a duplicated id: a refusal, never a guess.
      return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_AMBIGUOUS);
    }
    const row = rowsByIndex.get(ordinals[0]);
    if (row === undefined) {
      // The summarizer's row window is capped, so a later row has no shape facts to report.
      return refuse(CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_NOT_FOUND);
    }
    resolved.push({ index: index + 1, pair, row });
  }

  const facts = declarations.map(declarationFacts);

  /** How many asserted pairs name each plugin id: a duplicate is a finding on each of them. */
  const pluginUseCount = new Map();
  for (const { pair } of resolved) {
    pluginUseCount.set(pair.pluginId, (pluginUseCount.get(pair.pluginId) ?? 0) + 1);
  }

  const outputPairs = [];
  const findings = [];
  let matched = 0;

  for (const { index, pair, row } of resolved) {
    const declared = facts.find((entry) => entry.pluginId === pair.pluginId);
    const pluginDeclared = declared !== undefined;
    const capabilitiesRequired = pluginDeclared ? declared.required : 0;
    const capabilitiesOptional = pluginDeclared ? declared.optional : 0;
    const resources = {
      tool: pluginDeclared ? declared.tool : 0,
      service: pluginDeclared ? declared.service : 0,
    };

    const codes = [];
    if (!pluginDeclared) codes.push(CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED);
    if ((pluginUseCount.get(pair.pluginId) ?? 0) > 1) {
      codes.push(CORRESPONDENCE_CODES.CORRESPONDENCE_DUPLICATE_PLUGIN_ID);
    }
    const declaredCount = capabilitiesRequired + capabilitiesOptional + resources.tool + resources.service;
    if (row.disabled === 'true' && declaredCount > 0) {
      codes.push(CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES);
    }
    codes.sort((left, right) => FINDING_ORDER.indexOf(left) - FINDING_ORDER.indexOf(right));

    for (const code of codes) findings.push({ pair: index, code });

    outputPairs.push({
      index,
      line: row.line,
      disabled: row.disabled,
      config: row.config,
      keyCount: row.keyCount,
      unmodelledKeyCount: row.unmodelledKeyCount,
      pluginDeclared,
      capabilitiesRequired,
      capabilitiesOptional,
      resources,
      findings: codes,
    });
    matched += 1;
  }

  return {
    correspondenceSummary: CORRESPONDENCE_SUMMARY,
    identitySource: 'caller-asserted',
    bindings: { profileSha256, declarationSha256 },
    pairs: outputPairs,
    findings,
    counts: { pairs: pairs.length, matched, refused: 0, findings: findings.length },
    certification: false,
    correlation: 'not-established',
    identityDisclosed: false,
    notDerived: [...CORRESPONDENCE_NOT_DERIVED],
    limitations: [...CORRESPONDENCE_LIMITATIONS],
  };
}
