/**
 * `repair-preview` — render what a repair plan would change, without changing it.
 *
 * TRUST BOUNDARY. Takes a plan value and the text of a document, returns a verdict
 * and a description of the edit. It performs no file I/O, starts no process, and has
 * no code path that writes, renames, creates or deletes anything. The caller reads
 * the file; this module never does.
 *
 * WHY A LINE SCANNER AND NOT A PARSER. The documents this version previews are
 * entry-list profiles written in a deliberately small subset: `- key: value` starts
 * a record, the record's members are `  key: value` lines with literal scalar
 * values, and a config block is `  config:` followed by `    key: value` lines. A
 * general YAML parser would accept far more than this preview can reason about, so
 * the scanner accepts the subset and *refuses* the rest with a closed code instead
 * of guessing. That keeps "could not read" distinguishable from "nothing to
 * change", which no silently-widening parser can.
 *
 * WHY THE POSTCONDITION DIGEST IS COMPARED. Computing the digest of the edited text
 * is the one mechanical check that the plan actually describes the document in hand.
 * If it does not match, the preview says so and stops — it never "fixes up" the plan.
 *
 * @module repair-preview
 */

import { createHash } from 'node:crypto';

import { PLAN_LIMITATIONS, validateRepairPlan } from './repair-plan.js';

/** Largest document the preview will look at. Larger input is refused, never cut. */
export const MAX_PREVIEW_BYTES = 1024 * 1024;

/** Closed preview verdicts. */
export const PREVIEW_VERDICTS = Object.freeze(['ready', 'stale', 'refused', 'mismatch']);

/** Closed preview refusal codes. Every code here is reachable. */
export const PREVIEW_ISSUE_CODES = Object.freeze([
  'PREVIEW_TEXT_NOT_STRING',
  'PREVIEW_TEXT_TOO_LARGE',
  'PREVIEW_PLAN_INVALID',
  'PREVIEW_STALE',
  'PREVIEW_ENTRY_NOT_FOUND',
  'PREVIEW_ENTRY_FIELD_NOT_LITERAL',
  'PREVIEW_ENTRY_RECORD_UNSUPPORTED',
  'PREVIEW_ENTRY_CONFIG_ABSENT',
  'PREVIEW_CONFIG_BLOCK_UNSUPPORTED',
  'PREVIEW_CONFIG_KEY_ABSENT',
  'PREVIEW_POSTCONDITION_DIGEST_MISMATCH',
]);

/** A record opener is `- ` at column zero. */
const RECORD_OPENER = /^- /;

/** A record member is exactly two spaces, a bare key, a colon, and a value. */
const RECORD_MEMBER = /^ {2}([A-Za-z0-9_.-]+): (.*)$/;

/** A bare config header is exactly two spaces and the word `config`. */
const CONFIG_HEADER = /^ {2}config:$/;

/** A config member is exactly four spaces, a bare key, a colon, and a value. */
const CONFIG_MEMBER = /^ {4}([A-Za-z0-9_.-]+): (.*)$/;

/** The only literal forms a target flag field may already have. */
const FLAG_LITERAL = /^(true|false|null)$/;

/**
 * SHA-256 of a text, as lowercase hex. The same function the plan carries.
 *
 * @param {string} text Text to digest.
 * @returns {string} Lowercase hex digest.
 */
export function textDigest(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Split text into lines while remembering whether it ended with a newline, so an
 * edit can be re-joined without changing the file's final-byte convention.
 *
 * @param {string} text Document text.
 * @returns {{lines: string[], trailingNewline: boolean}} Split result.
 */
function splitLines(text) {
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), trailingNewline };
}

/**
 * Join lines back, reproducing the original trailing-newline convention.
 *
 * @param {string[]} lines Lines.
 * @param {boolean} trailingNewline Whether the original ended with a newline.
 * @returns {string} Document text.
 */
function joinLines(lines, trailingNewline) {
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

/**
 * Indexes of every record opener.
 *
 * @param {string[]} lines Document lines.
 * @returns {number[]} Zero-based line indexes of `- ` openers.
 */
function recordStarts(lines) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (RECORD_OPENER.test(lines[index])) starts.push(index);
  }
  return starts;
}

/**
 * Find the record with the requested 1-based index.
 *
 * A record is a run of lines from one `- ` opener up to the line before the next
 * opener. Lines before the first opener (comments, blank lines) belong to no record.
 *
 * @param {string[]} lines Document lines.
 * @param {number} entryIndex 1-based record index.
 * @returns {{start: number, end: number}|null} Inclusive start, exclusive end.
 */
function findRecord(lines, entryIndex) {
  const starts = recordStarts(lines);
  if (entryIndex > starts.length) return null;
  const start = starts[entryIndex - 1];
  const end = entryIndex < starts.length ? starts[entryIndex] : lines.length;
  return { start, end };
}

/**
 * Locate the target flag field inside a record.
 *
 * @param {string[]} lines Document lines.
 * @param {{start: number, end: number}} record Record bounds.
 * @param {string} field Field name.
 * @returns {{kind: 'present', line: number, value: string}
 *   | {kind: 'absent', insertAfter: number}
 *   | {kind: 'not-literal', line: number}
 *   | {kind: 'unsupported', line: number}} Where the field is, or why it cannot be read.
 */
function findField(lines, record, field) {
  let lastMember = record.start;
  for (let index = record.start; index < record.end; index += 1) {
    const line = lines[index];
    if (index === record.start) continue;
    if (line.trim() === '') continue;
    const member = RECORD_MEMBER.exec(line);
    if (member === null) return { kind: 'unsupported', line: index };
    lastMember = index;
    if (member[1] === field) {
      const value = member[2];
      return FLAG_LITERAL.test(value)
        ? { kind: 'present', line: index, value }
        : { kind: 'not-literal', line: index };
    }
  }
  return { kind: 'absent', insertAfter: lastMember };
}

/**
 * Locate one config key inside a record's bare `config:` block.
 *
 * The block must be exactly `  config:` with a value on the following `    key:
 * value` lines. An inline mapping (`  config: {`) or a deeper node is refused:
 * this scanner cannot reason about it, and rewriting it would be guesswork.
 *
 * @param {string[]} lines Document lines.
 * @param {{start: number, end: number}} record Record bounds.
 * @param {string} configKey Config key to address.
 * @returns {{kind: 'present', line: number}
 *   | {kind: 'absent'}
 *   | {kind: 'no-block'}
 *   | {kind: 'unsupported', line: number}} Where the key is, or why it cannot be edited.
 */
function findConfigField(lines, record, configKey) {
  let headerLine = -1;
  for (let index = record.start + 1; index < record.end; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    // The bare header carries no value, so it must be recognised before the
    // member pattern: `  config:` is not `  key: value`.
    if (CONFIG_HEADER.test(line)) {
      headerLine = index;
      break;
    }
    const member = RECORD_MEMBER.exec(line);
    if (member === null) return { kind: 'unsupported', line: index };
    if (member[1] === 'config') return { kind: 'unsupported', line: index };
  }
  if (headerLine === -1) return { kind: 'no-block' };

  for (let index = headerLine + 1; index < record.end; index += 1) {
    const line = lines[index];
    if (line.trim() === '') break;
    const member = CONFIG_MEMBER.exec(line);
    if (member === null) return { kind: 'unsupported', line: index };
    if (member[1] === configKey) return { kind: 'present', line: index };
  }
  return { kind: 'absent' };
}

/**
 * Render a plan scalar exactly as it must appear after the colon.
 *
 * @param {boolean|number|string|null} value A value `repair-plan` accepted.
 * @returns {string} Text for the edited line.
 */
function renderScalar(value) {
  if (value === null) return 'null';
  return String(value);
}

/**
 * Validate the plan, check the precondition, and render what would change.
 *
 * @param {{plan: unknown, beforeText: unknown}} input Plan and document text.
 * @returns {{
 *   verdict: string,
 *   reasons: ReadonlyArray<string>,
 *   beforeDigest: string | null,
 *   afterDigest: string | null,
 *   diff: {line: number, removed: string | null, added: string} | null,
 *   edit: {kind: string, line: number} | {kind: 'reorder', fromLine: number, toLine: number} | null,
 *   afterText: string | null,
 *   limitations: ReadonlyArray<string>,
 * }} A frozen, self-describing verdict. Never throws for JSON values.
 */
export function previewRepair({ plan, beforeText } = {}) {
  const limitations = PLAN_LIMITATIONS;

  if (typeof beforeText !== 'string') {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_TEXT_NOT_STRING'],
      beforeDigest: null,
      afterDigest: null,
      diff: null,
      edit: null,
      afterText: null,
      limitations,
    });
  }
  if (Buffer.byteLength(beforeText, 'utf8') > MAX_PREVIEW_BYTES) {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_TEXT_TOO_LARGE'],
      beforeDigest: null,
      afterDigest: null,
      diff: null,
      edit: null,
      afterText: null,
      limitations,
    });
  }

  const planVerdict = validateRepairPlan(plan);
  if (!planVerdict.valid) {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_PLAN_INVALID', ...planVerdict.issues.map((issue) => issue.code)],
      beforeDigest: null,
      afterDigest: null,
      diff: null,
      edit: null,
      afterText: null,
      limitations,
    });
  }

  const beforeDigest = textDigest(beforeText);
  if (beforeDigest !== plan.precondition.documentSha256) {
    return freeze({
      verdict: 'stale',
      reasons: ['PREVIEW_STALE'],
      beforeDigest,
      afterDigest: null,
      diff: null,
      edit: null,
      afterText: null,
      limitations,
    });
  }

  const { lines, trailingNewline } = splitLines(beforeText);
  const outcome = planEdit(lines, plan.operation);
  if (!outcome.ok) {
    return freeze({
      verdict: 'refused',
      reasons: [outcome.reason],
      beforeDigest,
      afterDigest: null,
      diff: null,
      edit: null,
      afterText: null,
      limitations,
    });
  }

  const afterText = joinLines(outcome.edited, trailingNewline);
  const afterDigest = textDigest(afterText);
  if (afterDigest !== plan.expectedPostcondition.documentSha256) {
    return freeze({
      verdict: 'mismatch',
      reasons: ['PREVIEW_POSTCONDITION_DIGEST_MISMATCH'],
      beforeDigest,
      afterDigest,
      diff: outcome.diff,
      edit: outcome.edit,
      afterText: null,
      limitations,
    });
  }

  return freeze({
    verdict: 'ready',
    reasons: [],
    beforeDigest,
    afterDigest,
    diff: outcome.diff,
    edit: outcome.edit,
    afterText,
    limitations,
  });
}

/**
 * Perform one plan operation on a copy of the lines.
 *
 * Every branch either produces the edited lines plus a description of the change,
 * or a single closed refusal reason. Nothing is coerced and nothing is repaired.
 *
 * @param {string[]} lines Document lines.
 * @param {object} operation A validated `operation` member.
 * @returns {{ok: true, edited: string[], diff: object|null, edit: object}
 *   | {ok: false, reason: string}} The edit, or why it was refused.
 */
function planEdit(lines, operation) {
  switch (operation.kind) {
    case 'set-entry-flag':
      return setFlag(lines, operation.entryIndex, operation.value, 'set-entry-flag');
    case 'disable-conflicting':
      // The later-installed party is the one a conflict resolution disables; the
      // plan validator already refused a provenance that names the reverse order.
      return setFlag(lines, operation.disableIndex, true, 'disable-conflicting');
    case 'set-entry-config':
      return setConfig(lines, operation);
    case 'reorder':
      return reorder(lines, operation.fromIndex, operation.toIndex);
    case 'patch-insert':
      return insertEntry(lines, operation.afterIndex, operation.entryId);
    default:
      // `repair-plan` refused any other kind already; this arm exists so a future
      // vocabulary member cannot silently reach the scanner.
      return { ok: false, reason: 'PREVIEW_PLAN_INVALID' };
  }
}

/**
 * Set one flag field on one record, inserting the member when it is absent.
 *
 * @param {string[]} lines Document lines.
 * @param {number} entryIndex 1-based record index.
 * @param {boolean} value Flag value.
 * @param {string} kind Reported edit kind.
 * @returns {object} Edit outcome.
 */
function setFlag(lines, entryIndex, value, kind) {
  const record = findRecord(lines, entryIndex);
  if (record === null) return { ok: false, reason: 'PREVIEW_ENTRY_NOT_FOUND' };

  const field = findField(lines, record, 'disabled');
  if (field.kind === 'not-literal') {
    return { ok: false, reason: 'PREVIEW_ENTRY_FIELD_NOT_LITERAL' };
  }
  if (field.kind === 'unsupported') {
    return { ok: false, reason: 'PREVIEW_ENTRY_RECORD_UNSUPPORTED' };
  }

  const rendered = `  disabled: ${value}`;
  const edited = lines.slice();
  let diff;
  if (field.kind === 'present') {
    diff = { line: field.line + 1, removed: lines[field.line], added: rendered };
    edited[field.line] = rendered;
  } else {
    diff = { line: field.insertAfter + 2, removed: null, added: rendered };
    edited.splice(field.insertAfter + 1, 0, rendered);
  }
  return {
    ok: true,
    edited,
    diff,
    edit: { kind, line: diff.line },
  };
}

/**
 * Replace one config key's scalar inside a record's config block.
 *
 * A missing config block or a missing key is refused: creating either would write
 * structure the plan did not describe.
 *
 * @param {string[]} lines Document lines.
 * @param {object} operation A validated `set-entry-config` operation.
 * @returns {object} Edit outcome.
 */
function setConfig(lines, operation) {
  const record = findRecord(lines, operation.entryIndex);
  if (record === null) return { ok: false, reason: 'PREVIEW_ENTRY_NOT_FOUND' };

  const field = findConfigField(lines, record, operation.configKey);
  if (field.kind === 'no-block') return { ok: false, reason: 'PREVIEW_ENTRY_CONFIG_ABSENT' };
  if (field.kind === 'unsupported') return { ok: false, reason: 'PREVIEW_CONFIG_BLOCK_UNSUPPORTED' };
  if (field.kind === 'absent') return { ok: false, reason: 'PREVIEW_CONFIG_KEY_ABSENT' };

  const rendered = `    ${operation.configKey}: ${renderScalar(operation.value)}`;
  const edited = lines.slice();
  edited[field.line] = rendered;
  return {
    ok: true,
    edited,
    diff: { line: field.line + 1, removed: lines[field.line], added: rendered },
    edit: { kind: 'set-entry-config', line: field.line + 1 },
  };
}

/**
 * Move one record block to another position in the list.
 *
 * Blank lines after the moved block stay where they are: they belong to the gap
 * between records, not to the record itself.
 *
 * @param {string[]} lines Document lines.
 * @param {number} fromIndex 1-based source position.
 * @param {number} toIndex 1-based destination position in the final list.
 * @returns {object} Edit outcome.
 */
function reorder(lines, fromIndex, toIndex) {
  const starts = recordStarts(lines);
  if (fromIndex > starts.length || toIndex > starts.length) {
    return { ok: false, reason: 'PREVIEW_ENTRY_NOT_FOUND' };
  }

  const fromStart = starts[fromIndex - 1];
  let fromEnd = fromIndex < starts.length ? starts[fromIndex] : lines.length;
  while (fromEnd > fromStart + 1 && lines[fromEnd - 1] === '') fromEnd -= 1;
  const block = lines.slice(fromStart, fromEnd);

  const remaining = [...lines.slice(0, fromStart), ...lines.slice(fromEnd)];
  const remainingStarts = recordStarts(remaining);
  const insertAt = toIndex - 1 < remainingStarts.length
    ? remainingStarts[toIndex - 1]
    : remaining.length;

  const edited = remaining.slice();
  edited.splice(insertAt, 0, ...block);
  return {
    ok: true,
    edited,
    diff: null,
    edit: { kind: 'reorder', fromLine: fromStart + 1, toLine: insertAt + 1 },
  };
}

/**
 * Insert one new entry record after a given position.
 *
 * `afterIndex: 0` means "before the first record"; the inserted record is exactly
 * `- id: <entryId>` — the plan does not describe a config block, so none is added.
 *
 * @param {string[]} lines Document lines.
 * @param {number} afterIndex 0-based position of the record to insert after, 0 = at the head.
 * @param {string} entryId Literal entry id to write.
 * @returns {object} Edit outcome.
 */
function insertEntry(lines, afterIndex, entryId) {
  const starts = recordStarts(lines);
  if (afterIndex > starts.length) return { ok: false, reason: 'PREVIEW_ENTRY_NOT_FOUND' };

  let insertAt;
  if (afterIndex === 0) {
    insertAt = starts.length > 0 ? starts[0] : 0;
  } else if (afterIndex < starts.length) {
    insertAt = starts[afterIndex];
  } else {
    insertAt = lines.length;
  }

  const added = `- id: ${entryId}`;
  const edited = lines.slice();
  edited.splice(insertAt, 0, added);
  return {
    ok: true,
    edited,
    diff: { line: insertAt + 1, removed: null, added },
    edit: { kind: 'patch-insert', line: insertAt + 1 },
  };
}

/**
 * Freeze a preview verdict, including its nested diff and edit.
 *
 * @param {object} value Verdict to freeze.
 * @returns {object} The same value, frozen.
 */
function freeze(value) {
  if (value.diff !== null) Object.freeze(value.diff);
  if (value.edit !== null) Object.freeze(value.edit);
  Object.freeze(value.reasons);
  return Object.freeze(value);
}

/**
 * Render a preview verdict as plain text for a human or for a future GUI panel.
 *
 * The text never claims an edit happened; the word "would" is load-bearing.
 *
 * @param {ReturnType<typeof previewRepair>} verdict A preview verdict.
 * @returns {string} Multi-line text, always ending with a newline.
 */
export function renderPreview(verdict) {
  const lines = [];
  lines.push(`preview: ${verdict.verdict}`);
  if (verdict.beforeDigest !== null) lines.push(`before: ${verdict.beforeDigest}`);
  if (verdict.afterDigest !== null) lines.push(`after:  ${verdict.afterDigest}`);
  if (verdict.reasons.length > 0) lines.push(`reasons: ${verdict.reasons.join(', ')}`);
  if (verdict.edit !== null && verdict.edit.kind === 'reorder') {
    lines.push(`edit: reorder line ${verdict.edit.fromLine} -> ${verdict.edit.toLine}`);
  } else if (verdict.diff !== null) {
    lines.push('--- document');
    lines.push('+++ document (not written)');
    if (verdict.diff.removed !== null) lines.push(`-${verdict.diff.removed}`);
    lines.push(`+${verdict.diff.added}`);
  }
  lines.push('nothing was written; no apply path exists');
  return `${lines.join('\n')}\n`;
}