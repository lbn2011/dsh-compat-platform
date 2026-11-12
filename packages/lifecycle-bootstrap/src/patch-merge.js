/**
 * Appends a package's generated patch block to the user's home patch file.
 *
 * The rule this module exists to enforce: **never rewrite what the operator
 * wrote.** A home `cordis.patch.yml` is hand-maintained. Re-serialising it
 * through a YAML library would silently drop comments, reformat scalars and
 * reorder keys, and a bug in a hand-written parser could corrupt it outright.
 *
 * So the merge is append-only and all-or-nothing:
 *
 * 1. The bundle block is appended verbatim, exactly as the package generated it.
 * 2. Before appending, every id the block would introduce is looked for in the
 *    existing text. If **any** of them is already mentioned, nothing is written
 *    (`skipped` when all are present, `refused` when only some are) — a partial
 *    overlap means the two sides disagree about state, and that is a human
 *    decision, not something to resolve by guessing.
 * 3. Ids are detected by conservative token search, not by parsing. A comment
 *    that mentions an id therefore counts as "present" and suppresses the
 *    append. That direction is safe: a skipped append leaves the file valid,
 *    while a duplicate insert would give the loader two entries with one id.
 *
 * @module dsh-compat-lifecycle-bootstrap/patch-merge
 */

export const PATCH_MERGE_VERSION = 'lifecycle-patch-merge/0.1-draft.1';

export const PATCH_MERGE_STATUSES = Object.freeze(['appended', 'skipped', 'refused']);

export const PATCH_MERGE_CODES = Object.freeze([
  'BUNDLE_BLOCK_EMPTY',
  'BUNDLE_BLOCK_NOT_A_SEQUENCE',
  'BUNDLE_BLOCK_NO_IDS',
  'BUNDLE_BLOCK_TAB_INDENTED',
  'BUNDLE_BLOCK_MULTI_DOCUMENT',
  'HOME_TEXT_NOT_A_SEQUENCE',
  'HOME_TEXT_MULTI_DOCUMENT',
  'HOME_TEXT_TAB_INDENTED',
  'HOME_TEXT_TOO_LARGE',
  'PARTIAL_OVERLAP',
]);

export const PATCH_MERGE_LIMITATIONS = Object.freeze([
  'ID_DETECTION_IS_TEXTUAL_AND_CONSERVATIVE',
  'APPEND_PRESERVES_OPERATOR_BYTES_BUT_DOES_NOT_VALIDATE_THE_RESULT',
  'LOADER_ACCEPTANCE_IS_NOT_ESTABLISHED_HERE',
  'MERGE_IS_NOT_TRANSACTIONAL_ACROSS_PROCESSES',
]);

export const PATCH_MERGE_LIMITS = Object.freeze({
  maxHomeBytes: 1048576,
  maxBlockBytes: 262144,
});

/** A provenance comment so an operator can see where an appended block came from. */
export const PATCH_MERGE_MARKER = '# dsh-compat lifecycle-bootstrap: appended patch block';

const ID_LINE = /^\s*(?:-\s*)?id:\s*(.+?)\s*$/;

const unquote = (raw) => {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return value.slice(1, -1);
    }
  }
  return value;
};

/**
 * Collect every id this patch block would introduce.
 *
 * @param {string} block patch-list YAML text
 * @returns {{ids: string[], code: string|null}}
 */
export function collectBlockIds(block) {
  if (typeof block !== 'string') throw new TypeError('patch-merge: block must be a string');
  const trimmed = block.trim();
  if (trimmed.length === 0) return { ids: [], code: 'BUNDLE_BLOCK_EMPTY' };
  if (block.includes('\t')) return { ids: [], code: 'BUNDLE_BLOCK_TAB_INDENTED' };
  if (/^---\s*$/m.test(block) || /^\.\.\.\s*$/m.test(block)) {
    return { ids: [], code: 'BUNDLE_BLOCK_MULTI_DOCUMENT' };
  }
  const firstMeaningful = trimmed
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (firstMeaningful === undefined || !firstMeaningful.startsWith('-')) {
    return { ids: [], code: 'BUNDLE_BLOCK_NOT_A_SEQUENCE' };
  }
  const ids = [];
  for (const line of block.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const match = ID_LINE.exec(line);
    if (!match) continue;
    const id = unquote(match[1]);
    if (id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { ids: [], code: 'BUNDLE_BLOCK_NO_IDS' };
  return { ids, code: null };
}

/**
 * Whether `id` appears in `text` as a standalone token on a non-comment line.
 * Deliberately over-inclusive: a mention inside a quoted scalar counts.
 */
export function mentionsId(text, id) {
  let index = text.indexOf(id);
  while (index !== -1) {
    const before = index === 0 ? '' : text[index - 1];
    const after = index + id.length >= text.length ? '' : text[index + id.length];
    const boundedBefore = before === '' || !/[A-Za-z0-9._:@/-]/.test(before);
    const boundedAfter = after === '' || !/[A-Za-z0-9._:@/-]/.test(after);
    if (boundedBefore && boundedAfter) {
      const lineStart = text.lastIndexOf('\n', index - 1) + 1;
      const line = text.slice(lineStart, text.indexOf('\n', index) === -1 ? undefined : text.indexOf('\n', index));
      if (!line.trimStart().startsWith('#')) return true;
    }
    index = text.indexOf(id, index + 1);
  }
  return false;
}

/**
 * Merge one package's generated patch block into the home patch text.
 *
 * @param {{homeText: string|null, block: string}} input
 *   `homeText` is `null` when the file does not exist yet (a fresh home).
 * @returns {{status: string, code: string|null, text: string|null,
 *   addedIds: string[], skippedIds: string[], limitations: string[]}}
 *   `text` is the exact bytes to write, or `null` when nothing should be written.
 */
export function mergePatchBlock(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('patch-merge: input must be an object');
  }
  if (input.homeText !== null && typeof input.homeText !== 'string') {
    throw new TypeError('patch-merge: homeText must be a string or null');
  }
  const homeText = input.homeText;
  const block = typeof input.block === 'string' ? input.block : '';
  const limitations = [...PATCH_MERGE_LIMITATIONS];

  const refuse = (code) => ({
    status: 'refused',
    code,
    text: null,
    addedIds: [],
    skippedIds: [],
    limitations,
  });

  if (homeText !== null && Buffer.byteLength(homeText, 'utf8') > PATCH_MERGE_LIMITS.maxHomeBytes) {
    return refuse('HOME_TEXT_TOO_LARGE');
  }
  if (Buffer.byteLength(block, 'utf8') > PATCH_MERGE_LIMITS.maxBlockBytes) {
    return refuse('HOME_TEXT_TOO_LARGE');
  }

  const collected = collectBlockIds(block);
  if (collected.code !== null) return refuse(collected.code);

  if (homeText !== null) {
    if (homeText.includes('\t')) return refuse('HOME_TEXT_TAB_INDENTED');
    if (/^---\s*$/m.test(homeText) || /^\.\.\.\s*$/m.test(homeText)) {
      return refuse('HOME_TEXT_MULTI_DOCUMENT');
    }
    const firstMeaningful = homeText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#'));
    if (firstMeaningful !== undefined && !firstMeaningful.startsWith('-')) {
      return refuse('HOME_TEXT_NOT_A_SEQUENCE');
    }
  }

  const existing = homeText ?? '';
  const present = collected.ids.filter((id) => mentionsId(existing, id));
  const missing = collected.ids.filter((id) => !present.includes(id));

  if (missing.length === 0) {
    return {
      status: 'skipped',
      code: null,
      text: null,
      addedIds: [],
      skippedIds: present,
      limitations,
    };
  }
  if (present.length > 0) {
    return {
      status: 'refused',
      code: 'PARTIAL_OVERLAP',
      text: null,
      addedIds: [],
      skippedIds: present,
      limitations,
    };
  }

  const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  const blockText = block.endsWith('\n') ? block : block + '\n';
  const text = `${existing}${separator}${PATCH_MERGE_MARKER}\n${blockText}`;
  return {
    status: 'appended',
    code: null,
    text,
    addedIds: collected.ids,
    skippedIds: [],
    limitations,
  };
}
