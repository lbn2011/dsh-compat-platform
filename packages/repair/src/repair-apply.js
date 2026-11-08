/**
 * `repair-apply` — the decision half of applying one approved plan to one document.
 *
 * TRUST BOUNDARY. This module is pure: a plan, an approval, a document's text and a
 * clock. It returns a decision and, when everything agrees, the text that the change
 * would produce. It writes nothing; `fixture-applier.js` is the only module in this
 * package that touches a filesystem, and it refuses any path outside the fixture
 * directory its caller names.
 *
 * THE ORDER IS THE POINT. Approval is checked against the *plan digest*, the plan is
 * checked against the *document digest*, and the document is checked through the same
 * preview the user saw. Only when all three agree does an apply proceed. Denied,
 * expired, mismatched and stale approvals are refused before any byte is written, so a
 * refusal can never leave a half-changed document.
 *
 * WHAT A RECEIPT IS NOT. It is not a rollback promise. The applier keeps a byte copy of
 * the document it replaced, and that copy is exactly what recovery restores — but the
 * receipt never claims the system returned to a prior state, because restoring a file
 * says nothing about anything else that may have happened outside it.
 *
 * @module repair-apply
 */

import { validateRepairPlan, planDigest } from './repair-plan.js';
import { validateApproval, approvalExpired } from './repair-approval.js';
import { previewRepair, textDigest } from './repair-preview.js';

/** The receipt schema written by this module. */
export const RECEIPT_VERSION = 'repair-receipt/0.1-draft.1';

/** The complete key set of a receipt. */
export const RECEIPT_KEYS = Object.freeze([
  'receiptVersion',
  'planDigest',
  'approvalDigest',
  'decision',
  'approver',
  'status',
  'reasons',
  'beforeDigest',
  'expectedDigest',
  'actualDigest',
  'wrote',
  'certification',
  'limitations',
]);

/** Closed receipt statuses. */
export const RECEIPT_STATUSES = Object.freeze(['refused', 'applied', 'partial']);

/** Closed apply refusal codes. */
export const APPLY_REASONS = Object.freeze([
  'APPLY_PLAN_INVALID',
  'APPLY_APPROVAL_INVALID',
  'APPLY_APPROVAL_PLAN_MISMATCH',
  'APPLY_APPROVAL_EXPIRED',
  'APPLY_APPROVAL_DENIED',
  'APPLY_PREVIEW_STALE',
  'APPLY_PREVIEW_REFUSED',
  'APPLY_POSTCONDITION_MISMATCH',
  'APPLY_WRITE_FAILED',
  'APPLY_POSTCONDITION_NOT_OBSERVED',
]);

/** What a receipt never claims, printed with every receipt. */
export const RECEIPT_LIMITATIONS = Object.freeze([
  'APPROVAL_IS_NOT_AUTHENTICATION',
  'BACKUP_IS_NOT_PRESENTED_AS_ROLLBACK',
  'APPLY_IS_CONFINED_TO_A_FIXTURE_DIRECTORY',
  'PRODUCTION_PATHS_ARE_NOT_ACCEPTED',
  'RECEIPT_RECORDS_ONE_ATTEMPT',
  'NOTHING_IS_LOADED_OR_ACTIVATED_BY_AN_APPLY',
]);

/**
 * Build a receipt object with both digests of the approval it names.
 *
 * @param {object} fields Receipt fields.
 * @returns {object} Frozen receipt.
 */
export function buildReceipt(fields) {
  return Object.freeze({
    receiptVersion: RECEIPT_VERSION,
    planDigest: fields.planDigest ?? null,
    approvalDigest: fields.approvalDigest ?? null,
    decision: fields.decision ?? null,
    approver: fields.approver ?? null,
    status: fields.status,
    reasons: Object.freeze([...fields.reasons]),
    beforeDigest: fields.beforeDigest ?? null,
    expectedDigest: fields.expectedDigest ?? null,
    actualDigest: fields.actualDigest ?? null,
    wrote: fields.wrote === true,
    certification: false,
    limitations: RECEIPT_LIMITATIONS,
  });
}

/**
 * Decide whether one approved plan may be applied to one document.
 *
 * @param {{plan: unknown, approval: unknown, beforeText: unknown, nowMs: number}} input Plan,
 *   approval, document text and clock.
 * @returns {{
 *   status: 'refused'|'ready',
 *   reasons: string[],
 *   afterText: string|null,
 *   planDigest: string|null,
 *   approvalDigest: string|null,
 *   beforeDigest: string|null,
 *   expectedDigest: string|null,
 * }} A decision. `ready` means the text may be written; it says nothing about the write.
 */
export function decideApply({ plan, approval, beforeText, nowMs } = {}) {
  const planVerdict = validateRepairPlan(plan);
  if (!planVerdict.valid) {
    return refusal(['APPLY_PLAN_INVALID', ...planVerdict.issues.map((issue) => issue.code)]);
  }
  const digest = planDigest(plan);

  const approvalVerdict = validateApproval(approval);
  if (!approvalVerdict.valid) {
    return refusal(['APPLY_APPROVAL_INVALID', ...approvalVerdict.issues.map((issue) => issue.code)], digest);
  }
  const approvalDigest = textDigest(JSON.stringify(approval));

  if (approval.planDigest !== digest) {
    return refusal(['APPLY_APPROVAL_PLAN_MISMATCH'], digest, approvalDigest);
  }
  if (approvalExpired(approval, nowMs)) {
    return refusal(['APPLY_APPROVAL_EXPIRED'], digest, approvalDigest);
  }
  if (approval.decision === 'deny') {
    return refusal(['APPLY_APPROVAL_DENIED'], digest, approvalDigest);
  }

  const preview = previewRepair({ plan, beforeText });
  if (preview.verdict === 'stale') {
    return refusal(['APPLY_PREVIEW_STALE'], digest, approvalDigest, preview.beforeDigest);
  }
  if (preview.verdict !== 'ready') {
    const detail = preview.verdict === 'mismatch' ? 'APPLY_POSTCONDITION_MISMATCH' : 'APPLY_PREVIEW_REFUSED';
    return refusal([detail, ...preview.reasons], digest, approvalDigest, preview.beforeDigest);
  }

  return Object.freeze({
    status: 'ready',
    reasons: Object.freeze([]),
    afterText: preview.afterText,
    planDigest: digest,
    approvalDigest,
    beforeDigest: preview.beforeDigest,
    expectedDigest: plan.expectedPostcondition.documentSha256,
  });
}

/**
 * Internal refusal constructor with positional defaults.
 *
 * @param {string[]} reasons Reason codes.
 * @param {string|null} [plan] Plan digest.
 * @param {string|null} [approval] Approval digest.
 * @param {string|null} [before] Document digest.
 * @returns {object} Frozen refusal.
 */
function refusal(reasons, plan = null, approval = null, before = null) {
  return Object.freeze({
    status: 'refused',
    reasons: Object.freeze(reasons),
    afterText: null,
    planDigest: plan,
    approvalDigest: approval,
    beforeDigest: before,
    expectedDigest: null,
  });
}
