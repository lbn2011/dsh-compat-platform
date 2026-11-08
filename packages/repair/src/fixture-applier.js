/**
 * `fixture-applier` — the only module in this package that writes, and it writes only
 * inside a directory its caller names.
 *
 * TRUST BOUNDARY. Every path is resolved and then checked against the fixture root: a
 * name that escapes the root, an absolute path, a symlink pointing outside, or a root
 * that is not a real directory is refused before any byte is touched. There is no API
 * that accepts a production path — the caller has to hand over a directory, and the
 * guard refuses anything that is not inside it.
 *
 * WHY WRITE-THEN-VERIFY. A naive applier writes and then checks. This module deliberately
 * does the same, so that the partial-failure path is real rather than hypothetical: if
 * the observed digest after writing differs from the plan's postcondition, the receipt
 * says `partial` and the document really is in that state. Recovery is the byte copy the
 * applier took beforehand, and the receipt never calls that a rollback of anything except
 * this one file.
 *
 * @module fixture-applier
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { buildReceipt, decideApply } from './repair-apply.js';
import { textDigest } from './repair-preview.js';

/** Largest fixture document this module will read or write. */
export const MAX_FIXTURE_BYTES = 1024 * 1024;

/** Closed confinement refusal codes. */
export const CONFINEMENT_REASONS = Object.freeze([
  'FIXTURE_ROOT_MISSING',
  'FIXTURE_ROOT_NOT_DIRECTORY',
  'FIXTURE_NAME_ABSOLUTE',
  'FIXTURE_NAME_ESCAPES_ROOT',
  'FIXTURE_FILE_MISSING',
  'FIXTURE_FILE_NOT_REGULAR',
  'FIXTURE_FILE_TOO_LARGE',
  'FIXTURE_WRITE_FAILED',
]);

/**
 * Refuse by throwing a tagged error — callers catch and turn it into a receipt reason.
 *
 * @param {string} code One of `CONFINEMENT_REASONS`.
 * @returns {never} Always throws.
 */
function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/**
 * Resolve a fixture file name inside a root, refusing escapes.
 *
 * @param {string} root Fixture directory.
 * @param {string} name File name inside it.
 * @returns {string} Absolute path inside the root.
 */
export function fixturePath(root, name) {
  if (typeof root !== 'string' || root.length === 0) refuse('FIXTURE_ROOT_MISSING');
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) {
    refuse('FIXTURE_ROOT_NOT_DIRECTORY');
  }
  if (typeof name !== 'string' || name.length === 0) refuse('FIXTURE_FILE_MISSING');
  if (isAbsolute(name)) refuse('FIXTURE_NAME_ABSOLUTE');
  if (basename(name) !== name) refuse('FIXTURE_NAME_ESCAPES_ROOT');

  const target = join(resolvedRoot, name);
  const rootReal = realpathSync(resolvedRoot);
  const parentReal = realpathSync(dirname(target));
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${sep}`)) {
    refuse('FIXTURE_NAME_ESCAPES_ROOT');
  }
  return target;
}

/**
 * Read a fixture document as UTF-8 text, with a byte ceiling.
 *
 * @param {string} root Fixture directory.
 * @param {string} name File name inside it.
 * @returns {{text: string, digest: string, bytes: number}} Document and its digest.
 */
export function readFixture(root, name) {
  const path = fixturePath(root, name);
  if (!existsSync(path)) refuse('FIXTURE_FILE_MISSING');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) refuse('FIXTURE_FILE_NOT_REGULAR');
  if (stat.size > MAX_FIXTURE_BYTES) refuse('FIXTURE_FILE_TOO_LARGE');
  const text = readFileSync(path, 'utf8');
  return { text, digest: textDigest(text), bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Apply one approved plan to one fixture document, then observe what happened.
 *
 * `hooks.afterWrite` exists so a test or demo can simulate a concurrent writer landing
 * in the instant after the write, before the observation. That window is real for any write-then-verify
 * applier; the hook makes it reproducible instead of theoretical, and no production
 * caller passes it.
 *
 * @param {{root: string, name: string, plan: unknown, approval: unknown, nowMs: number,
 *   hooks?: {afterWrite?: (path: string) => void}}} input Fixture root, file name, plan,
 *   approval, clock and optional test seam.
 * @returns {object} A frozen receipt; `status` is `refused`, `applied` or `partial`.
 */
export function applyApproved({ root, name, plan, approval, nowMs, hooks = {} } = {}) {
  let document;
  try {
    document = readFixture(root, name);
  } catch (error) {
    return buildReceipt({
      status: 'refused',
      reasons: [error.code ?? 'FIXTURE_FILE_MISSING'],
    });
  }

  const decision = decideApply({ plan, approval, beforeText: document.text, nowMs });
  if (decision.status !== 'ready') {
    return buildReceipt({
      status: 'refused',
      reasons: decision.reasons,
      planDigest: decision.planDigest,
      approvalDigest: decision.approvalDigest,
      beforeDigest: decision.beforeDigest,
      decision: approval?.decision ?? null,
      approver: approval?.approver ?? null,
    });
  }

  const path = fixturePath(root, name);
  const backupName = `${name}.before`;
  const backupPath = join(dirname(path), backupName);
  const folder = dirname(path);
  mkdirSync(folder, { recursive: true });

  try {
    copyFileSync(path, backupPath);
  } catch {
    return buildReceipt({
      status: 'refused',
      reasons: ['APPLY_WRITE_FAILED', 'FIXTURE_WRITE_FAILED'],
      planDigest: decision.planDigest,
      approvalDigest: decision.approvalDigest,
      beforeDigest: document.digest,
      decision: approval.decision,
      approver: approval.approver,
    });
  }

  try {
    writeFileSync(path, decision.afterText, 'utf8');
    if (typeof hooks.afterWrite === 'function') hooks.afterWrite(path);
  } catch {
    return buildReceipt({
      status: 'refused',
      reasons: ['APPLY_WRITE_FAILED', 'FIXTURE_WRITE_FAILED'],
      planDigest: decision.planDigest,
      approvalDigest: decision.approvalDigest,
      beforeDigest: document.digest,
      expectedDigest: decision.expectedDigest,
      decision: approval.decision,
      approver: approval.approver,
    });
  }

  const observed = readFixture(root, name);
  const status = observed.digest === decision.expectedDigest ? 'applied' : 'partial';
  return buildReceipt({
    status,
    reasons: status === 'applied' ? [] : ['APPLY_POSTCONDITION_NOT_OBSERVED'],
    planDigest: decision.planDigest,
    approvalDigest: decision.approvalDigest,
    beforeDigest: document.digest,
    expectedDigest: decision.expectedDigest,
    actualDigest: observed.digest,
    wrote: true,
    decision: approval.decision,
    approver: approval.approver,
  });
}

/**
 * Restore a fixture document from the byte copy the applier took before writing.
 *
 * This restores one file and says so; it is not a rollback of anything else.
 *
 * @param {{root: string, name: string}} input Fixture root and file name.
 * @returns {{status: 'restored'|'refused', reasons: string[], digest: string|null}} Outcome.
 */
export function restoreFixture({ root, name } = {}) {
  try {
    const backupName = `${name}.before`;
    const backup = readFixture(root, backupName);
    const path = fixturePath(root, name);
    writeFileSync(path, backup.text, 'utf8');
    const observed = readFixture(root, name);
    return Object.freeze({
      status: observed.digest === backup.digest ? 'restored' : 'refused',
      reasons: Object.freeze(observed.digest === backup.digest ? [] : ['FIXTURE_WRITE_FAILED']),
      digest: observed.digest,
    });
  } catch (error) {
    return Object.freeze({
      status: 'refused',
      reasons: Object.freeze([error.code ?? 'FIXTURE_FILE_MISSING']),
      digest: null,
    });
  }
}
