import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PLAN_VERSION, planDigest } from '../src/repair-plan.js';
import { APPROVAL_VERSION, approvalExpired, validateApproval } from '../src/repair-approval.js';
import { APPLY_REASONS, RECEIPT_LIMITATIONS, RECEIPT_VERSION, decideApply } from '../src/repair-apply.js';
import { textDigest } from '../src/repair-preview.js';
import {
  CONFINEMENT_REASONS,
  applyApproved,
  fixturePath,
  readFixture,
  restoreFixture,
} from '../src/fixture-applier.js';

const BEFORE = '# fixture\n- id: alpha\n  name: ./a.mjs\n  disabled: false\n';
const AFTER = BEFORE.replace('disabled: false', 'disabled: true');
const NOW = 1_700_000_000_000;

/**
 * A plan against BEFORE that produces AFTER.
 *
 * @param {{expected?: string, value?: boolean}} [options] Overrides.
 * @returns {object} Plan value.
 */
function planFor(options = {}) {
  const value = options.value ?? true;
  return {
    planVersion: PLAN_VERSION,
    operation: { kind: 'set-entry-flag', entryIndex: 1, field: 'disabled', value },
    precondition: { documentSha256: textDigest(BEFORE), revision: 'fixture-v1' },
    expectedPostcondition: {
      documentSha256: options.expected ?? textDigest(AFTER),
      entryIndex: 1,
      field: 'disabled',
      value,
    },
  };
}

/**
 * An approval bound to the digest of `plan`.
 *
 * @param {object} plan Plan to approve.
 * @param {{decision?: string, expiresAtMs?: number, planDigest?: string}} [options] Overrides.
 * @returns {object} Approval value.
 */
function approvalFor(plan, options = {}) {
  return {
    approvalVersion: APPROVAL_VERSION,
    planDigest: options.planDigest ?? planDigest(plan),
    decision: options.decision ?? 'allow',
    approver: 'fixture-operator',
    expiresAtMs: options.expiresAtMs ?? NOW + 60_000,
    note: 'approved for the fixture only',
  };
}

/**
 * A temporary fixture directory with one document.
 *
 * @param {import('node:test').TestContext} t Test context for cleanup.
 * @param {string} [text] Document text.
 * @returns {{root: string, name: string}} Fixture handle.
 */
function fixture(t, text = BEFORE) {
  const root = mkdtempSync(join(tmpdir(), 'repair-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'profile.yml'), text, 'utf8');
  return { root, name: 'profile.yml' };
}

test('an approval validates only with the full closed key set', () => {
  const approval = approvalFor(planFor());
  assert.equal(validateApproval(approval).valid, true);

  assert.equal(validateApproval({ ...approval, extra: 1 }).valid, false);
  const missing = { ...approval };
  delete missing.note;
  assert.equal(validateApproval(missing).valid, false);
  assert.equal(validateApproval({ ...approval, decision: 'maybe' }).valid, false);
  assert.equal(validateApproval({ ...approval, planDigest: 'x' }).valid, false);
  assert.equal(validateApproval({ ...approval, approver: '' }).valid, false);
  assert.equal(validateApproval({ ...approval, expiresAtMs: -1 }).valid, false);
  assert.equal(validateApproval(null).valid, false);
});

test('an approval lapses at its expiry instant', () => {
  const approval = approvalFor(planFor());
  assert.equal(approvalExpired(approval, NOW), false);
  assert.equal(approvalExpired(approval, approval.expiresAtMs - 1), false);
  assert.equal(approvalExpired(approval, approval.expiresAtMs), true);
  assert.equal(approvalExpired({}, NOW), true);
  assert.equal(approvalExpired(approval, Number.NaN), true);
});

test('a fully agreeing plan, approval and document decide ready', () => {
  const plan = planFor();
  const decision = decideApply({
    plan,
    approval: approvalFor(plan),
    beforeText: BEFORE,
    nowMs: NOW,
  });
  assert.equal(decision.status, 'ready');
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.afterText, AFTER);
  assert.equal(decision.beforeDigest, textDigest(BEFORE));
  assert.equal(decision.expectedDigest, textDigest(AFTER));
});

test('a denied approval is refused before anything is decided about the text', () => {
  const plan = planFor();
  const decision = decideApply({
    plan,
    approval: approvalFor(plan, { decision: 'deny' }),
    beforeText: BEFORE,
    nowMs: NOW,
  });
  assert.equal(decision.status, 'refused');
  assert.deepEqual(decision.reasons, ['APPLY_APPROVAL_DENIED']);
  assert.equal(decision.afterText, null);
});

test('an expired approval is refused', () => {
  const plan = planFor();
  const decision = decideApply({
    plan,
    approval: approvalFor(plan, { expiresAtMs: NOW - 1 }),
    beforeText: BEFORE,
    nowMs: NOW,
  });
  assert.deepEqual(decision.reasons, ['APPLY_APPROVAL_EXPIRED']);
});

test('an approval for a different plan is refused', () => {
  const plan = planFor();
  const other = planFor({ value: false });
  const decision = decideApply({
    plan,
    approval: approvalFor(other),
    beforeText: BEFORE,
    nowMs: NOW,
  });
  assert.deepEqual(decision.reasons, ['APPLY_APPROVAL_PLAN_MISMATCH']);
});

test('a stale document is refused even with a valid approval', () => {
  const plan = planFor();
  const decision = decideApply({
    plan,
    approval: approvalFor(plan),
    beforeText: `${BEFORE}# moved on\n`,
    nowMs: NOW,
  });
  assert.deepEqual(decision.reasons, ['APPLY_PREVIEW_STALE']);
});

test('a plan whose postcondition does not follow is refused, not written', () => {
  const plan = planFor({ expected: textDigest('something else') });
  const decision = decideApply({
    plan,
    approval: approvalFor(plan),
    beforeText: BEFORE,
    nowMs: NOW,
  });
  assert.deepEqual(decision.reasons, ['APPLY_POSTCONDITION_MISMATCH', 'PREVIEW_POSTCONDITION_DIGEST_MISMATCH']);
  assert.equal(decision.afterText, null);
});

test('the applied path writes, verifies and reports both digests', (t) => {
  const handle = fixture(t);
  const plan = planFor();
  const receipt = applyApproved({ ...handle, plan, approval: approvalFor(plan), nowMs: NOW });

  assert.equal(receipt.receiptVersion, RECEIPT_VERSION);
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.wrote, true);
  assert.equal(receipt.certification, false);
  assert.equal(receipt.beforeDigest, textDigest(BEFORE));
  assert.equal(receipt.actualDigest, textDigest(AFTER));
  assert.deepEqual(receipt.limitations, RECEIPT_LIMITATIONS);
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), AFTER);
});

test('a denied approval leaves the fixture byte-identical', (t) => {
  const handle = fixture(t);
  const plan = planFor();
  const receipt = applyApproved({
    ...handle,
    plan,
    approval: approvalFor(plan, { decision: 'deny' }),
    nowMs: NOW,
  });

  assert.equal(receipt.status, 'refused');
  assert.equal(receipt.wrote, false);
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), BEFORE);
});

test('an expired input path is refused and leaves the fixture untouched', (t) => {
  const handle = fixture(t);
  const plan = planFor();
  const receipt = applyApproved({
    ...handle,
    plan,
    approval: approvalFor(plan, { expiresAtMs: NOW - 1 }),
    nowMs: NOW,
  });
  assert.deepEqual(receipt.reasons, ['APPLY_APPROVAL_EXPIRED']);
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), BEFORE);
});

test('a postcondition the edit cannot produce is refused before any write', (t) => {
  const handle = fixture(t);
  const plan = planFor({ expected: textDigest('# not the edited text\n') });
  const receipt = applyApproved({ ...handle, plan, approval: approvalFor(plan), nowMs: NOW });

  assert.equal(receipt.status, 'refused');
  assert.deepEqual(receipt.reasons, ['APPLY_POSTCONDITION_MISMATCH', 'PREVIEW_POSTCONDITION_DIGEST_MISMATCH']);
  assert.equal(receipt.wrote, false);
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), BEFORE);
});

test('a concurrent writer inside the write window yields partial, then recovery restores', (t) => {
  const handle = fixture(t);
  const plan = planFor();
  const receipt = applyApproved({
    ...handle,
    plan,
    approval: approvalFor(plan),
    nowMs: NOW,
    hooks: {
      afterWrite: (path) => {
        // Simulates another process landing immediately after the write.
        writeFileSync(path, '# someone else was here\n', 'utf8');
      },
    },
  });

  assert.equal(receipt.status, 'partial');
  assert.deepEqual(receipt.reasons, ['APPLY_POSTCONDITION_NOT_OBSERVED']);
  assert.equal(receipt.wrote, true);
  assert.equal(receipt.expectedDigest, textDigest(AFTER));
  assert.equal(receipt.actualDigest, textDigest('# someone else was here\n'));
  // The document really is in the interfered state: that is what `partial` means.
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), '# someone else was here\n');

  const restored = restoreFixture(handle);
  assert.equal(restored.status, 'restored');
  assert.equal(restored.digest, textDigest(BEFORE));
  assert.equal(readFileSync(join(handle.root, handle.name), 'utf8'), BEFORE);
});

test('the confinement guard refuses absolute names, escapes and missing roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'repair-guard-'));
  try {
    writeFileSync(join(root, 'ok.yml'), BEFORE, 'utf8');
    assert.throws(() => fixturePath(root, '/etc/passwd'), { code: 'FIXTURE_NAME_ABSOLUTE' });
    assert.throws(() => fixturePath(root, '../escape.yml'), { code: 'FIXTURE_NAME_ESCAPES_ROOT' });
    assert.throws(() => fixturePath(join(root, 'missing'), 'ok.yml'), { code: 'FIXTURE_ROOT_NOT_DIRECTORY' });
    assert.equal(fixturePath(root, 'ok.yml'), join(root, 'ok.yml'));
    assert.ok(CONFINEMENT_REASONS.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reading a fixture reports text, digest and byte count', (t) => {
  const handle = fixture(t);
  const document = readFixture(handle.root, handle.name);
  assert.equal(document.text, BEFORE);
  assert.equal(document.digest, textDigest(BEFORE));
  assert.equal(document.bytes, Buffer.byteLength(BEFORE, 'utf8'));
});

test('every apply reason is a distinct uppercase constant', () => {
  assert.equal(new Set(APPLY_REASONS).size, APPLY_REASONS.length);
  assert.ok(APPLY_REASONS.every((reason) => /^APPLY_[A-Z_]+$/.test(reason)));
  assert.ok(RECEIPT_LIMITATIONS.includes('BACKUP_IS_NOT_PRESENTED_AS_ROLLBACK'));
});
