/**
 * `repair-approval` — a digest-bound approval record for one repair plan.
 *
 * TRUST BOUNDARY. This module validates a JSON value and answers whether it permits
 * one specific plan at one specific time. It performs no I/O and has no opinion about
 * who the approver really is: an approval file is evidence that *somebody* wrote those
 * bytes, and this module says so rather than pretending otherwise.
 *
 * WHAT AN APPROVAL IS BOUND TO. The digest of the exact plan, so an approval cannot be
 * carried over to a re-worded plan. Approval of a plan is not approval of a document:
 * the plan's own precondition digest still has to match the document at apply time, and
 * a plan that was approved against an older document is stale, not approved.
 *
 * WHAT AN APPROVAL IS NOT. It is not authentication. Nothing here verifies a signature,
 * a key, or a session. A caller who can write the approval file can approve anything, so
 * the receipt says `approver: <label as written>` and never `verified`.
 *
 * @module repair-approval
 */

/** The approval schema this module accepts. */
export const APPROVAL_VERSION = 'repair-approval/0.1-draft.1';

/** The complete key set of an approval. Extras are refused. */
export const APPROVAL_KEYS = Object.freeze([
  'approvalVersion',
  'planDigest',
  'decision',
  'approver',
  'expiresAtMs',
  'note',
]);

/** The complete decision vocabulary. */
export const APPROVAL_DECISIONS = Object.freeze(['allow', 'deny']);

/** Closed approval issue codes. Every code here is reachable. */
export const APPROVAL_ISSUE_CODES = Object.freeze([
  'APPROVAL_NOT_RECORD',
  'APPROVAL_UNKNOWN_FIELD',
  'APPROVAL_MISSING_FIELD',
  'APPROVAL_VERSION_UNSUPPORTED',
  'APPROVAL_PLAN_DIGEST_INVALID',
  'APPROVAL_DECISION_UNSUPPORTED',
  'APPROVAL_APPROVER_INVALID',
  'APPROVAL_EXPIRY_INVALID',
  'APPROVAL_NOTE_INVALID',
]);

/** A lowercase hex SHA-256. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Longest approver label and note accepted. */
export const MAX_APPROVER_LENGTH = 128;

/** Longest note accepted. */
export const MAX_NOTE_LENGTH = 1024;

/**
 * Is this an ordinary record?
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped objects.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an approval record.
 *
 * @param {unknown} value Candidate approval.
 * @returns {{valid: boolean, issues: ReadonlyArray<{code: string, path: string}>}} Frozen verdict.
 */
export function validateApproval(value) {
  const issues = [];
  const add = (code, path) => issues.push(Object.freeze({ code, path }));

  if (!isRecord(value)) {
    add('APPROVAL_NOT_RECORD', 'approval');
    return Object.freeze({ valid: false, issues: Object.freeze(issues) });
  }

  for (const key of Object.keys(value)) {
    if (!APPROVAL_KEYS.includes(key)) add('APPROVAL_UNKNOWN_FIELD', key);
  }
  for (const key of APPROVAL_KEYS) {
    if (!Object.hasOwn(value, key)) add('APPROVAL_MISSING_FIELD', key);
  }

  if (Object.hasOwn(value, 'approvalVersion') && value.approvalVersion !== APPROVAL_VERSION) {
    add('APPROVAL_VERSION_UNSUPPORTED', 'approvalVersion');
  }
  if (Object.hasOwn(value, 'planDigest')
    && !(typeof value.planDigest === 'string' && SHA256_PATTERN.test(value.planDigest))) {
    add('APPROVAL_PLAN_DIGEST_INVALID', 'planDigest');
  }
  if (Object.hasOwn(value, 'decision') && !APPROVAL_DECISIONS.includes(value.decision)) {
    add('APPROVAL_DECISION_UNSUPPORTED', 'decision');
  }
  if (Object.hasOwn(value, 'approver')) {
    const approver = value.approver;
    if (typeof approver !== 'string' || approver.length === 0 || approver.length > MAX_APPROVER_LENGTH) {
      add('APPROVAL_APPROVER_INVALID', 'approver');
    }
  }
  if (Object.hasOwn(value, 'expiresAtMs')) {
    const expiry = value.expiresAtMs;
    if (!Number.isSafeInteger(expiry) || expiry < 0) add('APPROVAL_EXPIRY_INVALID', 'expiresAtMs');
  }
  if (Object.hasOwn(value, 'note')) {
    const note = value.note;
    if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) {
      add('APPROVAL_NOTE_INVALID', 'note');
    }
  }

  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

/**
 * Has this approval lapsed at `nowMs`?
 *
 * An approval with no readable expiry is treated as lapsed: a record whose lifetime
 * cannot be read must not authorize anything.
 *
 * @param {unknown} approval Approval value.
 * @param {number} nowMs Current time in epoch milliseconds.
 * @returns {boolean} True when the approval is expired or unreadable.
 */
export function approvalExpired(approval, nowMs) {
  if (!isRecord(approval)) return true;
  const expiry = approval.expiresAtMs;
  if (!Number.isSafeInteger(expiry)) return true;
  if (!Number.isSafeInteger(nowMs)) return true;
  return nowMs >= expiry;
}
