/**
 * The five-operation vocabulary of `repair-plan/0.2-draft.1`, and the previews it
 * drives. Every case here is a behaviour the wider `repair.test.js` does not cover:
 * the four operations added on top of `set-entry-flag`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPERATION_KINDS,
  OPERATION_KEYS_BY_KIND,
  PLAN_VERSION,
  isConfigScalar,
  postconditionKeysFor,
  validateRepairPlan,
} from '../src/repair-plan.js';
import { previewRepair, renderPreview, textDigest } from '../src/repair-preview.js';

const BEFORE = [
  '# fixture profile',
  '- id: alpha',
  '  name: ./plugin-a.mjs',
  '  disabled: false',
  '  config:',
  '    level: debug',
  '    depth: 2',
  '- id: beta',
  '  name: ./plugin-b.mjs',
  '',
].join('\n');

/**
 * Build a plan whose digests are consistent with the given before/after text.
 *
 * @param {object} operation A validated operation member.
 * @param {string} [after] Expected document text.
 * @param {string} [before] Starting document text.
 * @returns {object} A plan value.
 */
function planFor(operation, after = BEFORE, before = BEFORE) {
  return {
    planVersion: PLAN_VERSION,
    operation,
    precondition: { documentSha256: textDigest(before), revision: 'fixture-v1' },
    expectedPostcondition: { documentSha256: textDigest(after) },
  };
}

/**
 * Collect issue codes from a validation verdict.
 *
 * @param {unknown} plan Candidate plan.
 * @returns {string[]} Codes.
 */
function codesOf(plan) {
  return validateRepairPlan(plan).issues.map((issue) => issue.code);
}

test('every operation kind has its own exact key set', () => {
  assert.deepEqual(OPERATION_KINDS, [
    'set-entry-flag',
    'set-entry-config',
    'reorder',
    'disable-conflicting',
    'patch-insert',
  ]);
  for (const kind of OPERATION_KINDS) {
    assert.ok(Array.isArray(OPERATION_KEYS_BY_KIND[kind]), kind);
    assert.equal(OPERATION_KEYS_BY_KIND[kind][0], 'kind', kind);
    assert.equal(new Set(OPERATION_KEYS_BY_KIND[kind]).size, OPERATION_KEYS_BY_KIND[kind].length, kind);
  }
});

test('0.2 pins bytes only; 0.1 keeps the retired coordinates', () => {
  assert.deepEqual(postconditionKeysFor(PLAN_VERSION), ['documentSha256']);
  assert.deepEqual(
    postconditionKeysFor('repair-plan/0.1-draft.1'),
    ['documentSha256', 'entryIndex', 'field', 'value'],
  );
});

test('a config scalar is a boolean, null, a finite number, or a grammar-bound string', () => {
  for (const value of [true, false, null, 0, 3, -1.5, 'debug', 'a.b-c_d:e/f']) {
    assert.equal(isConfigScalar(value), true, String(value));
  }
  for (const value of [{}, [], undefined, () => {}, 'has space', '', 'x'.repeat(257), Number.NaN, Infinity]) {
    assert.equal(isConfigScalar(value), false, String(value));
  }
});

test('set-entry-config replaces one config member and nothing else', () => {
  const after = BEFORE.replace('    level: debug', '    level: trace');
  const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value: 'trace' }, after);
  assert.equal(validateRepairPlan(plan).valid, true);

  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.diff, { line: 6, removed: '    level: debug', added: '    level: trace' });
  assert.deepEqual(verdict.edit, { kind: 'set-entry-config', line: 6 });
  assert.equal(verdict.afterText, after);
});

test('set-entry-config refuses a record with no config block', () => {
  const before = '- id: alpha\n  name: ./a.mjs\n';
  const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value: 1 }, before, before);
  // The plan is well formed; the refusal is about the document in hand.
  assert.equal(validateRepairPlan(plan).valid, true);
  assert.deepEqual(previewRepair({ plan, beforeText: before }).reasons, ['PREVIEW_ENTRY_CONFIG_ABSENT']);
});

test('set-entry-config refuses an inline config mapping rather than rewriting it', () => {
  const before = '- id: alpha\n  config: { level: 1 }\n';
  const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value: 2 }, before, before);
  assert.deepEqual(previewRepair({ plan, beforeText: before }).reasons, ['PREVIEW_CONFIG_BLOCK_UNSUPPORTED']);
});

test('set-entry-config refuses a key the block does not carry', () => {
  const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'mode', value: 'fast' });
  assert.deepEqual(previewRepair({ plan, beforeText: BEFORE }).reasons, ['PREVIEW_CONFIG_KEY_ABSENT']);
});

test('reorder moves a whole record block and reports both coordinates', () => {
  const after = [
    '# fixture profile',
    '- id: beta',
    '  name: ./plugin-b.mjs',
    '- id: alpha',
    '  name: ./plugin-a.mjs',
    '  disabled: false',
    '  config:',
    '    level: debug',
    '    depth: 2',
    '',
  ].join('\n');
  const plan = planFor({ kind: 'reorder', fromIndex: 2, toIndex: 1 }, after);
  assert.equal(validateRepairPlan(plan).valid, true);

  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'ready');
  assert.equal(verdict.diff, null);
  assert.equal(verdict.edit.kind, 'reorder');
  assert.equal(verdict.afterText, after);
});

test('reorder refuses an index past the end instead of clamping it', () => {
  const plan = planFor({ kind: 'reorder', fromIndex: 3, toIndex: 1 });
  assert.deepEqual(previewRepair({ plan, beforeText: BEFORE }).reasons, ['PREVIEW_ENTRY_NOT_FOUND']);
});

test('a reorder that changes nothing is a validation issue, not a preview', () => {
  assert.deepEqual(codesOf(planFor({ kind: 'reorder', fromIndex: 1, toIndex: 1 })), ['PLAN_OPERATION_NOOP']);
});

test('disable-conflicting disables the later-installed party', () => {
  const after = BEFORE.replace('- id: beta\n  name: ./plugin-b.mjs', '- id: beta\n  name: ./plugin-b.mjs\n  disabled: true');
  const plan = planFor(
    { kind: 'disable-conflicting', disableIndex: 2, keepIndex: 1, conflictId: 'C2|service|catalog|a#-,b#-' },
    after,
  );
  assert.equal(validateRepairPlan(plan).valid, true);

  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.diff, { line: 10, removed: null, added: '  disabled: true' });
  assert.equal(verdict.edit.kind, 'disable-conflicting');
});

test('disable-conflicting refuses evidence that names the reverse order', () => {
  const plan = planFor({ kind: 'disable-conflicting', disableIndex: 1, keepIndex: 2, conflictId: 'c1' });
  assert.deepEqual(codesOf(plan), ['PLAN_CONFLICT_PROVENANCE_INVALID']);
});

test('disable-conflicting requires a conflict id from the closed grammar', () => {
  const plan = planFor({ kind: 'disable-conflicting', disableIndex: 2, keepIndex: 1, conflictId: 'not a id' });
  assert.deepEqual(codesOf(plan), ['PLAN_CONFLICT_ID_INVALID']);
});

test('patch-insert appends a bare record after the last entry', () => {
  const after = `${BEFORE}- id: gamma\n`;
  const plan = planFor({ kind: 'patch-insert', afterIndex: 2, entryId: 'gamma' }, after);
  assert.equal(validateRepairPlan(plan).valid, true);

  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.diff, { line: 10, removed: null, added: '- id: gamma' });
  assert.equal(verdict.afterText, after);
});

test('patch-insert with afterIndex 0 inserts before the first record', () => {
  const after = '# fixture profile\n- id: omega\n' + BEFORE.slice('# fixture profile\n'.length);
  const plan = planFor({ kind: 'patch-insert', afterIndex: 0, entryId: 'omega' }, after);
  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.diff, { line: 2, removed: null, added: '- id: omega' });
});

test('patch-insert refuses an entry id outside the closed grammar', () => {
  assert.deepEqual(codesOf(planFor({ kind: 'patch-insert', afterIndex: 0, entryId: 'bad id' })), ['PLAN_ENTRY_ID_INVALID']);
});

test('patch-insert refuses a position past the end', () => {
  const plan = planFor({ kind: 'patch-insert', afterIndex: 5, entryId: 'gamma' });
  assert.deepEqual(previewRepair({ plan, beforeText: BEFORE }).reasons, ['PREVIEW_ENTRY_NOT_FOUND']);
});

test('a 0.1 plan may not name a 0.2 operation', () => {
  const plan = {
    planVersion: 'repair-plan/0.1-draft.1',
    operation: { kind: 'patch-insert', afterIndex: 0, entryId: 'gamma' },
    precondition: { documentSha256: textDigest(BEFORE), revision: 'r1' },
    expectedPostcondition: {
      documentSha256: textDigest(BEFORE),
      entryIndex: 1,
      field: 'disabled',
      value: true,
    },
  };
  assert.ok(codesOf(plan).includes('PLAN_OPERATION_UNSUPPORTED'));
});

test('an operation key from another kind is refused as unknown', () => {
  const plan = planFor({ kind: 'reorder', fromIndex: 1, toIndex: 2, entryId: 'gamma' });
  assert.deepEqual(codesOf(plan), ['PLAN_OPERATION_UNKNOWN_FIELD']);
});

test('a config key must satisfy the closed grammar', () => {
  for (const configKey of ['bad key', '', 'x'.repeat(65), '-leading', 7]) {
    const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey, value: 1 });
    assert.ok(codesOf(plan).includes('PLAN_CONFIG_KEY_INVALID'), String(configKey));
  }
});

test('a config value must be a scalar the scanner can render', () => {
  for (const value of [{}, [], undefined, 'has space']) {
    const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value });
    assert.ok(codesOf(plan).includes('PLAN_VALUE_UNSUPPORTED'), String(value));
  }
});

test('a stale document refuses every new operation before any edit is computed', () => {
  for (const operation of [
    { kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value: 'trace' },
    { kind: 'reorder', fromIndex: 1, toIndex: 2 },
    { kind: 'disable-conflicting', disableIndex: 2, keepIndex: 1, conflictId: 'c1' },
    { kind: 'patch-insert', afterIndex: 0, entryId: 'gamma' },
  ]) {
    const verdict = previewRepair({ plan: planFor(operation), beforeText: `${BEFORE}# later edit\n` });
    assert.equal(verdict.verdict, 'stale', operation.kind);
    assert.equal(verdict.diff, null, operation.kind);
    assert.equal(verdict.edit, null, operation.kind);
  }
});

test('a postcondition the edit does not produce is reported, not applied', () => {
  const plan = planFor({ kind: 'set-entry-config', entryIndex: 1, configKey: 'level', value: 'trace' });
  plan.expectedPostcondition.documentSha256 = textDigest('some other document');
  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'mismatch');
  assert.equal(verdict.afterText, null);
  assert.notEqual(verdict.diff, null);
});

test('a reorder preview renders its two coordinates and disclaims writing', () => {
  const after = [
    '# fixture profile',
    '- id: beta',
    '  name: ./plugin-b.mjs',
    '- id: alpha',
    '  name: ./plugin-a.mjs',
    '  disabled: false',
    '  config:',
    '    level: debug',
    '    depth: 2',
    '',
  ].join('\n');
  const text = renderPreview(previewRepair({ plan: planFor({ kind: 'reorder', fromIndex: 2, toIndex: 1 }, after), beforeText: BEFORE }));
  assert.match(text, /^preview: ready$/m);
  assert.match(text, /^edit: reorder line \d+ -> \d+$/m);
  assert.match(text, /^nothing was written; no apply path exists$/m);
});

test('every preview carries the plan limitations, including the conflict caveat', () => {
  const verdict = previewRepair({ plan: planFor({ kind: 'reorder', fromIndex: 1, toIndex: 2 }), beforeText: BEFORE });
  assert.ok(verdict.limitations.includes('CONFLICT_PROVENANCE_IS_CALLER_SUPPLIED_AND_UNVERIFIED'));
  assert.ok(verdict.limitations.includes('PLAN_EDITS_ARE_LIMITED_TO_THE_ENTRY_LIST_SUBSET'));
  assert.equal(Object.isFrozen(verdict.limitations), true);
});
