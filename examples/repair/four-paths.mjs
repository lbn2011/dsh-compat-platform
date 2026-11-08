#!/usr/bin/env node
/**
 * Exercise the four required approval/apply paths against a **copy** of
 * `examples/repair/profile.yml` inside a temporary directory.
 *
 * The four paths are:
 *   1. expired approval      → refused, nothing written
 *   2. denied approval       → refused, nothing written
 *   3. partial failure       → the write lands but the postcondition is not observed
 *   4. recovery              → the byte copy taken before the write restores the file
 *
 * Nothing outside the temporary directory is written, and the example fixture in this
 * repository is only ever read. The receipt for each path is different, which is the
 * point: a refused apply, a denied apply, a partial apply and a restored document must
 * never look the same to a reader.
 *
 * Exit codes: 0 all four checks passed, 3 a check failed, 64 bad usage.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planDigest } from '../../packages/repair/src/repair-plan.js';
import { applyApproved, readFixture, restoreFixture } from '../../packages/repair/src/fixture-applier.js';

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, 'plan.json'), 'utf8'));

/** The digest of the exact plan, computed the way `repair-apply` computes it. */
const digest = planDigest(plan);

/**
 * Build an approval for this plan.
 *
 * @param {object} overrides Fields to override.
 * @returns {object} An approval value.
 */
function approvalFor(overrides = {}) {
  return {
    approvalVersion: 'repair-approval/0.1-draft.1',
    planDigest: digest,
    decision: 'allow',
    approver: 'fixture-operator',
    expiresAtMs: Date.now() + 60_000,
    note: 'demo: approved against a temporary copy of the fixture',
    ...overrides,
  };
}

const root = mkdtempSync(join(tmpdir(), 'repair-four-paths-'));
const name = 'profile.yml';
try {
  copyFileSync(join(here, 'profile.yml'), join(root, name));
  const before = readFixture(root, name);
  const checks = [];
  const report = {};

  /** Record one path's receipt and whether the document was left untouched. */
  function record(label, receipt, expectUntouched) {
    const now = readFixture(root, name);
    const untouched = now.digest === before.digest;
    report[label] = {
      status: receipt.status,
      reasons: [...receipt.reasons],
      wrote: receipt.wrote,
      untouched,
    };
    checks.push({
      name: `${label}-status`,
      ok: typeof receipt.status === 'string' && receipt.status.length > 0,
    });
    if (expectUntouched) {
      checks.push({ name: `${label}-untouched`, ok: untouched && receipt.wrote === false });
    }
    return report[label];
  }

  const nowMs = Date.now();

  // 1. Expired approval: the plan was approved, but the approval lapsed.
  const expired = applyApproved({
    root,
    name,
    plan,
    approval: approvalFor({ expiresAtMs: nowMs - 1000 }),
    nowMs,
  });
  record('expired', expired, true);

  // 2. Denied approval: the approver said no.
  const denied = applyApproved({
    root,
    name,
    plan,
    approval: approvalFor({ decision: 'deny' }),
    nowMs,
  });
  record('denied', denied, true);

  // 3. Partial: a concurrent writer lands in the instant after the write, so the
  //    observed digest does not match the postcondition. The document is really changed.
  const partial = applyApproved({
    root,
    name,
    plan,
    approval: approvalFor(),
    nowMs,
    hooks: {
      afterWrite: (path) => writeFileSync(path, '# concurrent writer\n', 'utf8'),
    },
  });
  const partialNow = readFixture(root, name).digest;
  report.partial = {
    status: partial.status,
    reasons: [...partial.reasons],
    wrote: partial.wrote,
    expectedDigest: partial.expectedDigest,
    actualDigest: partial.actualDigest,
  };
  checks.push({ name: 'partial-status', ok: partial.status === 'partial' });
  checks.push({
    name: 'partial-observed-mismatch',
    ok: partial.wrote === true && partialNow !== partial.expectedDigest,
  });

  // 4. Recovery: restore the byte copy the applier took before writing.
  const restored = restoreFixture({ root, name });
  report.recovery = { status: restored.status, reasons: [...restored.reasons], digest: restored.digest };
  checks.push({ name: 'recovery-status', ok: restored.status === 'restored' });
  checks.push({ name: 'recovery-restores-before', ok: restored.digest === before.digest });

  // The four receipts must be distinguishable from one another.
  const signatures = new Set([
    `refused:${report.expired.reasons.join(',')}`,
    `refused:${report.denied.reasons.join(',')}`,
    `partial:${report.partial.reasons.join(',')}`,
    `restored:${report.recovery.reasons.join(',')}`,
  ]);
  checks.push({ name: 'receipts-distinct', ok: signatures.size === 4 });

  const failed = checks.filter((check) => !check.ok);
  process.stdout.write(`four-paths: ${failed.length === 0 ? 'pass' : 'fail'} on ${name} in a temporary root\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed.length > 0) {
    process.stdout.write(`failed checks: ${failed.map((check) => check.name).join(', ')}\n`);
  }
  process.stdout.write('the example fixture in this repository was only read; nothing outside the temporary root was written\n');
  process.exitCode = failed.length === 0 ? 0 : 3;
} catch (error) {
  process.stderr.write(`four-paths: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 3;
} finally {
  rmSync(root, { recursive: true, force: true });
}
