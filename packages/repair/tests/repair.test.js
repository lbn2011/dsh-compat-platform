import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_VERSION,
  PLAN_KEYS,
  PLAN_LIMITATIONS,
  PLAN_ISSUE_CODES,
  canonicalJson,
  planDigest,
  validateRepairPlan,
} from '../src/repair-plan.js';
import {
  MAX_PREVIEW_BYTES,
  PREVIEW_ISSUE_CODES,
  previewRepair,
  renderPreview,
  textDigest,
} from '../src/repair-preview.js';

const BEFORE = '# fixture profile\n- id: alpha\n  name: ./plugin-a.mjs\n  disabled: false\n- id: beta\n  name: ./plugin-b.mjs\n';

/**
 * Build a plan whose digests are consistent with the given before/after text.
 *
 * @param {{before?: string, after?: string, entryIndex?: number, value?: boolean}} [options] Overrides.
 * @returns {object} A plan value.
 */
function planFor(options = {}) {
  const before = options.before ?? BEFORE;
  const value = options.value ?? true;
  const after = options.after
    ?? before.replace(`  disabled: ${!value}`, `  disabled: ${value}`);
  return {
    planVersion: PLAN_VERSION,
    operation: { kind: 'set-entry-flag', entryIndex: options.entryIndex ?? 1, field: 'disabled', value },
    precondition: { documentSha256: textDigest(before), revision: 'fixture-v1' },
    expectedPostcondition: {
      documentSha256: textDigest(after),
      entryIndex: options.entryIndex ?? 1,
      field: 'disabled',
      value,
    },
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

test('a well-formed plan validates and reports no issues', () => {
  const verdict = validateRepairPlan(planFor());
  assert.equal(verdict.valid, true);
  assert.deepEqual(verdict.issues, []);
  assert.equal(Object.isFrozen(verdict), true);
});

test('the plan key set is closed and refuses extras in both directions', () => {
  const extra = { ...planFor(), note: 'please' };
  assert.deepEqual(codesOf(extra), ['PLAN_UNKNOWN_FIELD']);

  const missing = planFor();
  delete missing.expectedPostcondition;
  assert.deepEqual(codesOf(missing), ['PLAN_MISSING_FIELD', 'PLAN_POSTCONDITION_NOT_RECORD']);
  assert.equal(PLAN_KEYS.length, 4);
});

test('a non-record plan is refused with one code', () => {
  for (const value of [null, [], 'plan', 7, true]) {
    assert.deepEqual(codesOf(value), ['PLAN_NOT_RECORD']);
  }
});

test('the version literal is exact', () => {
  assert.equal(PLAN_VERSION, 'repair-plan/0.1-draft.1');
  assert.deepEqual(codesOf({ ...planFor(), planVersion: 'repair-plan/0.2-draft.1' }), ['PLAN_VERSION_UNSUPPORTED']);
});

test('the operation vocabulary has exactly one member and refuses others', () => {
  const plan = planFor();
  plan.operation.kind = 'rewrite-document';
  assert.deepEqual(codesOf(plan), ['PLAN_OPERATION_UNSUPPORTED']);
});

test('only the disabled field may be set, and only to a boolean', () => {
  const wrongField = planFor();
  wrongField.operation.field = 'group';
  wrongField.expectedPostcondition.field = 'group';
  assert.ok(codesOf(wrongField).includes('PLAN_FIELD_UNSUPPORTED'));

  const wrongValue = planFor();
  wrongValue.operation.value = 'true';
  wrongValue.expectedPostcondition.value = 'true';
  assert.ok(codesOf(wrongValue).includes('PLAN_VALUE_UNSUPPORTED'));
});

test('entry indexes are 1-based integers', () => {
  for (const index of [0, -1, 1.5, '1', null]) {
    const plan = planFor();
    plan.operation.entryIndex = index;
    plan.expectedPostcondition.entryIndex = index;
    assert.ok(codesOf(plan).includes('PLAN_ENTRY_INDEX_INVALID'), `index ${String(index)}`);
  }
});

test('a digest must be 64 lowercase hex characters', () => {
  const upper = planFor();
  upper.precondition.documentSha256 = upper.precondition.documentSha256.toUpperCase();
  assert.ok(codesOf(upper).includes('PLAN_DIGEST_INVALID'));

  const short = planFor();
  short.expectedPostcondition.documentSha256 = 'abc';
  assert.ok(codesOf(short).includes('PLAN_DIGEST_INVALID'));
});

test('a revision label must be a non-empty bounded string', () => {
  for (const revision of ['', 'x'.repeat(129), 3, null]) {
    const plan = planFor();
    plan.precondition.revision = revision;
    assert.ok(codesOf(plan).includes('PLAN_REVISION_INVALID'), String(revision));
  }
});

test('a postcondition that disagrees with the operation is refused', () => {
  const plan = planFor();
  plan.expectedPostcondition.value = false;
  assert.deepEqual(codesOf(plan), ['PLAN_POSTCONDITION_MISMATCH']);
});

test('nested members with unknown keys are refused by their own codes', () => {
  const plan = planFor();
  plan.operation.extra = true;
  plan.precondition.extra = true;
  plan.expectedPostcondition.extra = true;
  assert.deepEqual(codesOf(plan), [
    'PLAN_OPERATION_UNKNOWN_FIELD',
    'PLAN_PRECONDITION_UNKNOWN_FIELD',
    'PLAN_POSTCONDITION_UNKNOWN_FIELD',
  ]);
});

test('canonical JSON ignores key order and planDigest follows it', () => {
  const plan = planFor();
  const reordered = {
    expectedPostcondition: plan.expectedPostcondition,
    precondition: plan.precondition,
    operation: plan.operation,
    planVersion: plan.planVersion,
  };
  assert.equal(canonicalJson(plan), canonicalJson(reordered));
  assert.equal(planDigest(plan), planDigest(reordered));
  assert.match(planDigest(plan), /^[0-9a-f]{64}$/);
});

test('canonicalJson refuses values JSON cannot carry', () => {
  assert.throws(() => canonicalJson(Number.NaN), TypeError);
  assert.throws(() => canonicalJson(() => {}), TypeError);
  assert.throws(() => canonicalJson(undefined), TypeError);
});

test('a consistent plan previews as ready with a two-line diff', () => {
  const before = BEFORE;
  const plan = planFor({ before });
  const verdict = previewRepair({ plan, beforeText: before });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.reasons, []);
  assert.deepEqual(verdict.diff, { line: 4, removed: '  disabled: false', added: '  disabled: true' });
  assert.equal(verdict.beforeDigest, textDigest(before));
  assert.equal(verdict.afterDigest, plan.expectedPostcondition.documentSha256);
  assert.equal(verdict.afterDigest, textDigest(before.replace('  disabled: false', '  disabled: true')));
});

test('an absent field is inserted after the record\'s last member', () => {
  const before = '- id: alpha\n  name: ./a.mjs\n- id: beta\n';
  const after = '- id: alpha\n  name: ./a.mjs\n  disabled: true\n- id: beta\n';
  const plan = planFor({ before, after });
  const verdict = previewRepair({ plan, beforeText: before });
  assert.equal(verdict.verdict, 'ready');
  assert.deepEqual(verdict.diff, { line: 3, removed: null, added: '  disabled: true' });
});

test('a document that no longer matches the precondition digest is stale', () => {
  const plan = planFor();
  const verdict = previewRepair({ plan, beforeText: `${BEFORE}# edited later\n` });
  assert.equal(verdict.verdict, 'stale');
  assert.deepEqual(verdict.reasons, ['PREVIEW_STALE']);
  assert.equal(verdict.diff, null);
  assert.equal(verdict.afterDigest, null);
});

test('an invalid plan is refused before the text is looked at', () => {
  const plan = planFor();
  plan.operation.kind = 'rewrite-document';
  const verdict = previewRepair({ plan, beforeText: 'not even the right document' });
  assert.equal(verdict.verdict, 'refused');
  assert.equal(verdict.reasons[0], 'PREVIEW_PLAN_INVALID');
  assert.ok(verdict.reasons.includes('PLAN_OPERATION_UNSUPPORTED'));
});

test('an entry index beyond the document is refused, not clamped', () => {
  const before = '- id: alpha\n  disabled: false\n';
  const plan = planFor({ before, entryIndex: 1 });
  plan.operation.entryIndex = 9;
  plan.expectedPostcondition.entryIndex = 9;
  const verdict = previewRepair({ plan, beforeText: before });
  assert.equal(verdict.verdict, 'refused');
  assert.deepEqual(verdict.reasons, ['PREVIEW_ENTRY_NOT_FOUND']);
});

test('a non-literal target value is refused rather than rewritten', () => {
  const before = '- id: alpha\n  disabled: !!js process.env.X\n';
  const plan = planFor();
  plan.precondition.documentSha256 = textDigest(before);
  const verdict = previewRepair({ plan, beforeText: before });
  assert.equal(verdict.verdict, 'refused');
  assert.deepEqual(verdict.reasons, ['PREVIEW_ENTRY_FIELD_NOT_LITERAL']);
});

test('a record outside the accepted subset is refused', () => {
  const before = '- id: alpha\n  nested:\n    deep: true\n';
  const plan = planFor();
  plan.precondition.documentSha256 = textDigest(before);
  const verdict = previewRepair({ plan, beforeText: before });
  assert.equal(verdict.verdict, 'refused');
  assert.deepEqual(verdict.reasons, ['PREVIEW_ENTRY_RECORD_UNSUPPORTED']);
});

test('a postcondition digest that the edit does not produce is a mismatch', () => {
  const plan = planFor();
  plan.expectedPostcondition.documentSha256 = textDigest('something else entirely');
  const verdict = previewRepair({ plan, beforeText: BEFORE });
  assert.equal(verdict.verdict, 'mismatch');
  assert.deepEqual(verdict.reasons, ['PREVIEW_POSTCONDITION_DIGEST_MISMATCH']);
  assert.notEqual(verdict.diff, null);
});

test('non-text and oversize input are refused with their own codes', () => {
  const plan = planFor();
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(previewRepair({ plan, beforeText: value }).reasons, ['PREVIEW_TEXT_NOT_STRING']);
  }
  const huge = 'x'.repeat(MAX_PREVIEW_BYTES + 1);
  assert.deepEqual(
    previewRepair({ plan: planFor({ before: huge, after: huge }), beforeText: huge }).reasons,
    ['PREVIEW_TEXT_TOO_LARGE'],
  );
});

test('the rendered preview says the document was not written', () => {
  const text = renderPreview(previewRepair({ plan: planFor(), beforeText: BEFORE }));
  assert.match(text, /^preview: ready$/m);
  assert.match(text, /^\+  disabled: true$/m);
  assert.match(text, /^nothing was written; no apply path exists$/m);
  assert.ok(text.endsWith('\n'));
});

test('every advertised code is a string constant, and the lists are closed and frozen', () => {
  assert.ok(Object.isFrozen(PLAN_ISSUE_CODES));
  assert.ok(Object.isFrozen(PREVIEW_ISSUE_CODES));
  assert.ok(Object.isFrozen(PLAN_LIMITATIONS));
  assert.ok(PLAN_ISSUE_CODES.every((code) => typeof code === 'string' && code.startsWith('PLAN_')));
  assert.ok(PREVIEW_ISSUE_CODES.every((code) => code.startsWith('PREVIEW_')));
  assert.ok(PLAN_LIMITATIONS.includes('NO_APPLY_PATH_EXISTS_IN_THIS_DELIVERY'));
  for (const list of [PLAN_ISSUE_CODES, PREVIEW_ISSUE_CODES]) {
    assert.equal(new Set(list).size, list.length, 'codes must be unique');
  }
});

test('the package exposes no writer and no apply path', async () => {
  const planModule = await import('../src/repair-plan.js');
  const previewModule = await import('../src/repair-preview.js');
  const forbidden = /^(apply|write|save|commit|install|exec|run)/i;
  for (const [name, value] of [...Object.entries(planModule), ...Object.entries(previewModule)]) {
    if (typeof value !== 'function') continue;
    assert.ok(!forbidden.test(name), `export ${name} looks like a writer`);
  }
});
