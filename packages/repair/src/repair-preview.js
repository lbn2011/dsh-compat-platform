/**
 * `repair-preview` — render what a repair plan would change, without changing it.
 *
 * TRUST BOUNDARY. Takes a plan value and the text of a document, returns a verdict
 * and a two-line diff. It performs no file I/O, starts no process, and has no code
 * path that writes, renames, creates or deletes anything. The caller reads the file;
 * this module never does.
 *
 * WHY A LINE SCANNER AND NOT A PARSER. The documents this version previews are
 * entry-list profiles written in a deliberately small subset: `- key: value` starts
 * a record, and the record's members are `  key: value` lines with literal scalar
 * values. A general YAML parser would accept far more than this preview can reason
 * about, so the scanner accepts the subset and *refuses* the rest with a closed code
 * instead of guessing. That keeps "could not read" distinguishable from "nothing to
 * change", which no silently-widening parser can.
 *
 * WHY THE POSTCONDITION DIGEST IS COMPARED. Computing the digest of the edited text
 * is the one mechanical check that the plan actually describes the document in hand.
 * If it does not match, the preview says so and stops — it never "fixes up" the plan.
 *
 * @module repair-preview
 */

import { createHash } from 'node:crypto';

import { validateRepairPlan, PLAN_LIMITATIONS } from './repair-plan.js';

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
  'PREVIEW_POSTCONDITION_DIGEST_MISMATCH',
]);

/** A record opener is `- ` at column zero. */
const RECORD_OPENER = /^- /;

/** A record member is exactly two spaces, a bare key, a colon, and a value. */
const RECORD_MEMBER = /^ {2}([A-Za-z0-9_.-]+): (.*)$/;

/** The only literal forms a target field may already have. */
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
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (RECORD_OPENER.test(lines[index])) starts.push(index);
  }
  if (entryIndex > starts.length) return null;
  const start = starts[entryIndex - 1];
  const end = entryIndex < starts.length ? starts[entryIndex] : lines.length;
  return { start, end };
}

/**
 * Locate the target field inside a record.
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
 * Validate the plan, check the precondition, and render what would change.
 *
 * @param {{plan: unknown, beforeText: unknown}} input Plan and document text.
 * @returns {{
 *   verdict: string,
 *   reasons: ReadonlyArray<string>,
 *   beforeDigest: string | null,
 *   afterDigest: string | null,
 *   diff: {line: number, removed: string | null, added: string} | null,
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
      limitations,
    });
  }

  const { lines, trailingNewline } = splitLines(beforeText);
  const record = findRecord(lines, plan.operation.entryIndex);
  if (record === null) {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_ENTRY_NOT_FOUND'],
      beforeDigest,
      afterDigest: null,
      diff: null,
      limitations,
    });
  }

  const field = findField(lines, record, plan.operation.field);
  if (field.kind === 'not-literal') {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_ENTRY_FIELD_NOT_LITERAL'],
      beforeDigest,
      afterDigest: null,
      diff: null,
      limitations,
    });
  }
  if (field.kind === 'unsupported') {
    return freeze({
      verdict: 'refused',
      reasons: ['PREVIEW_ENTRY_RECORD_UNSUPPORTED'],
      beforeDigest,
      afterDigest: null,
      diff: null,
      limitations,
    });
  }

  const rendered = `  ${plan.operation.field}: ${plan.operation.value}`;
  const edited = lines.slice();
  let diff;
  if (field.kind === 'present') {
    diff = { line: field.line + 1, removed: lines[field.line], added: rendered };
    edited[field.line] = rendered;
  } else {
    diff = { line: field.insertAfter + 2, removed: null, added: rendered };
    edited.splice(field.insertAfter + 1, 0, rendered);
  }

  const afterText = joinLines(edited, trailingNewline);
  const afterDigest = textDigest(afterText);
  if (afterDigest !== plan.expectedPostcondition.documentSha256) {
    return freeze({
      verdict: 'mismatch',
      reasons: ['PREVIEW_POSTCONDITION_DIGEST_MISMATCH'],
      beforeDigest,
      afterDigest,
      diff,
      limitations,
    });
  }

  return freeze({ verdict: 'ready', reasons: [], beforeDigest, afterDigest, diff, limitations });
}

/**
 * Freeze a preview verdict, including its nested diff.
 *
 * @param {object} value Verdict to freeze.
 * @returns {object} The same value, frozen.
 */
function freeze(value) {
  if (value.diff !== null) Object.freeze(value.diff);
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
  if (verdict.diff !== null) {
    lines.push('--- document');
    lines.push('+++ document (not written)');
    if (verdict.diff.removed !== null) lines.push(`-${verdict.diff.removed}`);
    lines.push(`+${verdict.diff.added}`);
  }
  lines.push('nothing was written; no apply path exists');
  return `${lines.join('\n')}\n`;
}
