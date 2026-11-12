/**
 * The Patch approval flow, end to end, across the two repositories that own its
 * halves — and an explicit account of the half that does not exist.
 *
 * WHAT THE DESIGN ASKS FOR (docs/requirements-and-design/
 * 2026-11-12-multi-layer-extension-solution.md, Layer 3 安全机制):
 * a patch is proposed, the operator is told which permissions it needs
 * ("插件 X 需要以下权限：…是否允许？"), the operator approves, and only then is the
 * patch applied.
 *
 * WHAT ACTUALLY EXISTS IN THESE THREE REPOSITORIES:
 *   1. dsh-plugin-kit produces the patch: `planPack`/`writePack` merge the
 *      declared `dsh.bundle.patch` files into one YAML block.
 *   2. dsh-compat-platform's repair package defines a digest-bound approval
 *      record (`repair-approval/0.1-draft.1`) and validates it.
 *   3. dsh-compat-platform's lifecycle bootstrap merges the block into the
 *      operator's `cordis.patch.yml`, appending or skipping or refusing.
 *
 * WHAT DOES NOT EXIST: no `ask()`, no dialog, no HTTP route, no CLI that asks a
 * human. `mergePatchBlock` takes no approval argument — it cannot enforce one.
 * So this file proves the *mechanics* of an approval flow (digest binding,
 * expiry, deny, tamper detection, merge gate) and asserts, as a test, that the
 * merge layer does not consult the approval record. An approval artifact proves
 * that somebody wrote it, nothing more.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { planPack, writePack } from '../../../dsh-plugin-kit/src/pack.js';
import { writeScaffold } from '../../../dsh-plugin-kit/src/index.js';
import { mergePatchBlock } from '../../packages/lifecycle-bootstrap/src/patch-merge.js';
import {
  APPROVAL_DECISIONS,
  APPROVAL_ISSUE_CODES,
  APPROVAL_KEYS,
  APPROVAL_VERSION,
  approvalExpired,
  validateApproval,
} from '../../packages/repair/src/repair-approval.js';

const SCRATCH = process.env.TMPDIR && process.env.TMPDIR !== '' ? process.env.TMPDIR : undefined;
const HOME_TEXT = [
  '- id: plugin-manager',
  "  plugin: '@deepseek-ai/dsh-plugin-manager'",
  '',
].join('\n');

function scratch(t) {
  const dir = mkdtempSync(join(SCRATCH ?? '/tmp', 'dsh-int-approval-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The approval record an operator would write, bound to one exact patch digest. */
function approvalFor(digest, overrides = {}) {
  return {
    approvalVersion: APPROVAL_VERSION,
    planDigest: digest,
    decision: 'allow',
    approver: 'integration-tester',
    expiresAtMs: Date.now() + 60_000,
    note: 'integration run: patch reviewed as text',
    ...overrides,
  };
}

test('the approval record vocabulary is the repair package', () => {
  assert.equal(APPROVAL_VERSION, 'repair-approval/0.1-draft.1');
  assert.deepEqual([...APPROVAL_DECISIONS], ['allow', 'deny']);
  // The record's own field list is the contract: a digest, a decision, a name.
  assert.deepEqual([...APPROVAL_KEYS].sort(), [
    'approvalVersion', 'approver', 'decision', 'expiresAtMs', 'note', 'planDigest',
  ]);
  assert.ok(APPROVAL_ISSUE_CODES.length > 0);
});

test('propose → review → approve → apply, with the approval bound to the patch bytes', async (t) => {
  const dir = scratch(t);
  const target = join(dir, 'acme-tool');
  assert.equal((await writeScaffold({ target, template: 'host-tool' })).ok, true);

  // 1. PROPOSE. The kit reads the declared `dsh.bundle.patch` files and merges
  //    them into one block — this is the artifact a reviewer would be shown.
  const planned = planPack({ root: target });
  assert.equal(planned.ok, true, JSON.stringify(planned.issues));
  const patchYaml = planned.plan.yaml;
  assert.ok(patchYaml.length > 0);
  // One declared source file, and the block carries the id it declares.
  assert.equal(planned.plan.sources.length, 1);
  assert.ok(patchYaml.includes('acme-tool'));

  // 2. REVIEW. The reviewer's evidence is the text itself: what ids it touches
  //    and whether it is a patch list at all. Nothing is executed to review it.
  const ids = [...patchYaml.matchAll(/^\s*-?\s*id: '?([^'\n]+)'?$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, ['acme-tool:acme-tool']);

  // 3. APPROVE. The record names the digest of exactly those bytes.
  const digest = sha256(patchYaml);
  assert.match(digest, /^[0-9a-f]{64}$/);
  const approval = approvalFor(digest);
  const verdict = validateApproval(approval);
  assert.equal(verdict.valid, true, JSON.stringify(verdict.issues));
  assert.equal(approvalExpired(approval, Date.now()), false);

  // 4. APPLY. The merge gate accepts the reviewed block and the operator's own
  //    text survives byte for byte.
  const merged = mergePatchBlock({ homeText: HOME_TEXT, block: patchYaml });
  assert.equal(merged.status, 'appended', JSON.stringify(merged.code));
  assert.ok(merged.text.startsWith(HOME_TEXT));

  // The written artifact is what the loader reads: packing to disk and reading
  // it back yields the same block that was approved.
  const written = writePack({ root: target });
  assert.equal(written.ok, true, JSON.stringify(written.issues));
  assert.equal(written.plan.yaml, patchYaml, 'the approved bytes are the written bytes');
  // Re-applying the same block is a no-op, not a duplicate: the id is present.
  assert.equal(mergePatchBlock({ homeText: merged.text, block: patchYaml }).status, 'skipped');
});

test('tampering with the patch after approval breaks the digest binding', async (t) => {
  const dir = scratch(t);
  const target = join(dir, 'acme-tool');
  assert.equal((await writeScaffold({ target, template: 'host-tool' })).ok, true);
  const approvedYaml = planPack({ root: target }).plan.yaml;
  const approval = approvalFor(sha256(approvedYaml));

  // A different patch — the reviewer's record still says "allow" for the old
  // digest, so the binding fails. Detecting this is the caller's comparison:
  // validateApproval only checks the record's own shape.
  const otherYaml = approvedYaml.replace('acme-tool:acme-tool', 'acme-tool:acme-tool-2');
  assert.notEqual(sha256(otherYaml), approval.planDigest);
  assert.equal(validateApproval(approval).valid, true, 'a stale record is still a well-formed record');
});

test('a denied, expired, or malformed approval is never a green light', () => {
  const digest = sha256('- insert: []\n');

  const denied = approvalFor(digest, { decision: 'deny' });
  assert.equal(validateApproval(denied).valid, true, 'a denial is a valid record');
  assert.equal(denied.decision, 'deny', 'and the caller must read the decision, not just validity');

  const expired = approvalFor(digest, { expiresAtMs: Date.now() - 1_000 });
  assert.equal(approvalExpired(expired, Date.now()), true);

  const badDigest = validateApproval(approvalFor('not-a-digest'));
  assert.equal(badDigest.valid, false);
  assert.ok(badDigest.issues.length > 0);

  const badDecision = validateApproval(approvalFor(digest, { decision: 'maybe' }));
  assert.equal(badDecision.valid, false);

  const unknownField = validateApproval({ ...approvalFor(digest), approvedBy: 'someone' });
  assert.equal(unknownField.valid, false, 'the record has a closed field list');

  const longApprover = validateApproval(approvalFor(digest, { approver: 'x'.repeat(129) }));
  assert.equal(longApprover.valid, false);
});

test('the merge layer does not consult an approval record — recorded, not assumed', () => {
  // This is the gap the design names and the implementation does not close: the
  // operator YAML is merged by a function whose only inputs are text and a block.
  // If an approval gate is ever required, it belongs in a caller above this.
  assert.equal(mergePatchBlock.length, 1, 'one options object: { homeText, block }');
  const block = '- insert:\n    - id: acme\n      name: ./x.js\n    - id: beta\n      name: ./y.js\n';
  const withoutApproval = mergePatchBlock({ homeText: HOME_TEXT, block });
  assert.equal(withoutApproval.status, 'appended', 'no approval argument exists, and none is required');
  // The refusal path exists for a different reason: partial overlap would make
  // two writers own one id, so it is refused rather than resolved. One of the
  // block's two ids is already present, so this is partial, not complete.
  const partial = mergePatchBlock({ homeText: '- id: acme\n  name: ./x.js\n', block });
  assert.equal(partial.status, 'refused');
  assert.equal(partial.code, 'PARTIAL_OVERLAP');
});
