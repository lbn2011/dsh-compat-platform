import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PATCH_MERGE_CODES,
  PATCH_MERGE_LIMITATIONS,
  PATCH_MERGE_LIMITS,
  PATCH_MERGE_MARKER,
  PATCH_MERGE_STATUSES,
  PATCH_MERGE_VERSION,
  collectBlockIds,
  mentionsId,
  mergePatchBlock,
} from '../src/patch-merge.js';

const BLOCK = [
  '- insert:',
  "    - id: 'demo-plugin:demo'",
  "      name: 'demo-plugin'",
  '',
].join('\n');

test('the vocabulary is closed and frozen', () => {
  assert.equal(PATCH_MERGE_VERSION, 'lifecycle-patch-merge/0.1-draft.1');
  assert.deepEqual([...PATCH_MERGE_STATUSES], ['appended', 'skipped', 'refused']);
  assert.equal(new Set(PATCH_MERGE_CODES).size, PATCH_MERGE_CODES.length);
  assert.ok(Object.isFrozen(PATCH_MERGE_CODES));
  assert.ok(Object.isFrozen(PATCH_MERGE_LIMITATIONS));
  assert.ok(Object.isFrozen(PATCH_MERGE_LIMITS));
  assert.equal(PATCH_MERGE_LIMITS.maxHomeBytes, 1048576);
  assert.equal(PATCH_MERGE_LIMITS.maxBlockBytes, 262144);
  assert.ok(PATCH_MERGE_MARKER.startsWith('#'));
});

test('a block must be a sequence of entries that declares ids', () => {
  assert.deepEqual(collectBlockIds(''), { ids: [], code: 'BUNDLE_BLOCK_EMPTY' });
  assert.deepEqual(collectBlockIds('   \n\n'), { ids: [], code: 'BUNDLE_BLOCK_EMPTY' });
  assert.deepEqual(collectBlockIds(`- insert:\n\t- id: x\n`), {
    ids: [],
    code: 'BUNDLE_BLOCK_TAB_INDENTED',
  });
  assert.deepEqual(collectBlockIds('---\n- id: x\n'), {
    ids: [],
    code: 'BUNDLE_BLOCK_MULTI_DOCUMENT',
  });
  assert.deepEqual(collectBlockIds('insert:\n  - id: x\n'), {
    ids: [],
    code: 'BUNDLE_BLOCK_NOT_A_SEQUENCE',
  });
  assert.deepEqual(collectBlockIds('- insert:\n    - name: x\n'), {
    ids: [],
    code: 'BUNDLE_BLOCK_NO_IDS',
  });
  assert.throws(() => collectBlockIds(5), { name: 'TypeError' });
});

test('ids are unquoted, deduplicated and taken from comment-free lines', () => {
  const block = [
    '- insert:',
    "    - id: 'a:b'",
    '    - id: "c:d"',
    '    - id: plain',
    '    - id: a:b',
    '    # - id: commented-out',
    '',
  ].join('\n');
  assert.deepEqual(collectBlockIds(block), { ids: ['a:b', 'c:d', 'plain'], code: null });
});

test('a mention is a bounded token on a non-comment line', () => {
  assert.equal(mentionsId('- id: alpha\n', 'alpha'), true);
  assert.equal(mentionsId("- id: 'alpha'\n", 'alpha'), true);
  assert.equal(mentionsId('- id: alphabet\n', 'alpha'), false);
  assert.equal(mentionsId('- id: x/alpha\n', 'alpha'), false);
  assert.equal(mentionsId('# - id: alpha\n', 'alpha'), false);
  assert.equal(mentionsId('  # id: alpha\n', 'alpha'), false);
  assert.equal(mentionsId('- config:\n    id: alpha\n', 'alpha'), true);
});

test('a fresh home receives the block verbatim after a marker', () => {
  const result = mergePatchBlock({ homeText: null, block: BLOCK });
  assert.equal(result.status, 'appended');
  assert.equal(result.code, null);
  assert.deepEqual(result.addedIds, ['demo-plugin:demo']);
  assert.deepEqual(result.skippedIds, []);
  assert.deepEqual(result.limitations, [...PATCH_MERGE_LIMITATIONS]);
  assert.ok(result.text.startsWith(`${PATCH_MERGE_MARKER}\n`));
  assert.ok(result.text.endsWith(BLOCK));
  assert.equal(result.text.slice(PATCH_MERGE_MARKER.length + 1), BLOCK);
});

test('an existing home is preserved byte for byte and gets one blank line', () => {
  const home = '- id: already\n  name: already\n';
  const result = mergePatchBlock({ homeText: home, block: BLOCK });
  assert.equal(result.status, 'appended');
  assert.ok(result.text.startsWith(home));
  assert.equal(result.text, `${home}\n${PATCH_MERGE_MARKER}\n${BLOCK}`);
});

test('a home without a trailing newline still separates cleanly', () => {
  const result = mergePatchBlock({ homeText: '- id: already', block: BLOCK });
  assert.equal(result.status, 'appended');
  assert.ok(result.text.startsWith('- id: already\n\n'));
});

test('a block whose ids are all present is skipped, not duplicated', () => {
  const home = "- id: 'demo-plugin:demo'\n";
  const result = mergePatchBlock({ homeText: home, block: BLOCK });
  assert.equal(result.status, 'skipped');
  assert.equal(result.code, null);
  assert.equal(result.text, null);
  assert.deepEqual(result.addedIds, []);
  assert.deepEqual(result.skippedIds, ['demo-plugin:demo']);
});

test('a partial overlap is refused rather than half-applied', () => {
  const block = ['- insert:', '    - id: one', '    - id: two', ''].join('\n');
  const result = mergePatchBlock({ homeText: '- id: one\n', block });
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'PARTIAL_OVERLAP');
  assert.equal(result.text, null);
  assert.deepEqual(result.skippedIds, ['one']);
  assert.deepEqual(result.addedIds, []);
});

test('the operator file is refused when it cannot be edited safely', () => {
  assert.equal(mergePatchBlock({ homeText: '- id: x\n\t- id: y\n', block: BLOCK }).code,
    'HOME_TEXT_TAB_INDENTED');
  assert.equal(mergePatchBlock({ homeText: '---\n- id: x\n', block: BLOCK }).code,
    'HOME_TEXT_MULTI_DOCUMENT');
  assert.equal(mergePatchBlock({ homeText: 'root:\n  id: x\n', block: BLOCK }).code,
    'HOME_TEXT_NOT_A_SEQUENCE');
  const huge = `- id: ${'x'.repeat(PATCH_MERGE_LIMITS.maxHomeBytes)}\n`;
  assert.equal(mergePatchBlock({ homeText: huge, block: BLOCK }).code, 'HOME_TEXT_TOO_LARGE');
});

test('a malformed block is refused before the home file is considered', () => {
  for (const [block, code] of [
    ['', 'BUNDLE_BLOCK_EMPTY'],
    ['root:\n  id: x\n', 'BUNDLE_BLOCK_NOT_A_SEQUENCE'],
    ['- insert:\n    - name: x\n', 'BUNDLE_BLOCK_NO_IDS'],
  ]) {
    const result = mergePatchBlock({ homeText: '- id: keep\n', block });
    assert.equal(result.status, 'refused');
    assert.equal(result.code, code);
    assert.equal(result.text, null);
  }
});

test('bad argument shapes are programming errors, not refusals', () => {
  assert.throws(() => mergePatchBlock(null), { name: 'TypeError' });
  assert.throws(() => mergePatchBlock([]), { name: 'TypeError' });
  assert.throws(() => mergePatchBlock({ homeText: 5, block: BLOCK }), {
    name: 'TypeError',
    message: /homeText must be a string or null/,
  });
});
