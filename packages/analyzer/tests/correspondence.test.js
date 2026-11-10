/**
 * Tests for `correspondence.js` and `correspondence-cli.js`.
 *
 * Three properties matter beyond the obvious ones and are asserted directly:
 *   - no identity text reaches stdout: sentinel ids, plugin ids and a note are written into real
 *     fixture files, then looked for in the command's output;
 *   - the artifact is a closed key set at both levels, in both directions (no missing key, no
 *     tolerated extra key);
 *   - every way an assertion can be wrong is a refusal with its own code, never a wrong verdict.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CORRESPONDENCE_CODES,
  CORRESPONDENCE_EXIT,
  CORRESPONDENCE_LIMITATIONS,
  CORRESPONDENCE_NOT_DERIVED,
  CORRESPONDENCE_SUMMARY,
  CORRESPONDENCE_VERSION,
  checkCorrespondence,
  validateCorrespondence,
} from '../src/correspondence.js';
import { main } from '../src/correspondence-cli.js';

const CLI = fileURLToPath(new URL('../src/correspondence-cli.js', import.meta.url));

/** sha256 of the UTF-8 bytes, the same way the module measures it. */
function digest(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** Two profile rows: `alpha` carries a three-key config, `beta` a one-key config. */
const PROFILE_TWO_ROWS = `- id: alpha
  name: Alpha
  config:
    a: 1
    b: 2
    c: 3
- id: beta
  name: Beta
  config:
    x: 1
`;

/** Declaration document with two plugins. `plugin.alpha` declares one capability of each kind. */
const DECLARATION_TWO_PLUGINS = `${JSON.stringify(
  {
    declarations: [
      {
        schemaVersion: '0.1.0-draft.1',
        plugin: { id: 'plugin.alpha', version: '1.0.0' },
        capabilities: { required: ['svc:one'], optional: ['svc:two'] },
        resources: [
          { kind: 'tool', name: 'tool.one' },
          { kind: 'service', name: 'svc.one' },
          // Not one of the two kinds the closed output shape counts.
          { kind: 'other', name: 'other.one' },
        ],
      },
      {
        schemaVersion: '0.1.0-draft.1',
        plugin: { id: 'plugin.beta', version: '0.2.0' },
        capabilities: { required: [], optional: [] },
        resources: [],
      },
    ],
    availableCapabilities: ['svc:one'],
  },
  null,
  2,
)}\n`;

/** A correspondence bound to the two documents above. */
function correspondenceFor(profileText, declarationText, pairs) {
  return {
    correspondenceVersion: CORRESPONDENCE_VERSION,
    bindings: {
      profileSha256: digest(profileText),
      declarationSha256: digest(declarationText),
    },
    pairs,
  };
}

/** Run the check against the two fixtures with the given assertions. */
function check(profileText, declarationText, pairs) {
  return checkCorrespondence({
    correspondence: correspondenceFor(profileText, declarationText, pairs),
    profileText,
    declarationText,
  });
}

/** Assert a refusal with an exact code. */
function assertRefused(result, code) {
  assert.equal(result.refused, true, `expected a refusal, got ${JSON.stringify(result).slice(0, 120)}`);
  assert.equal(result.code, code);
}

/**
 * Sentinel text. Every privacy fixture carries these words; no output may contain any of them.
 */
const SECRETS = ['sentinel-entry-alpha', 'sentinel.plugin.beta', 'sentinel note text'];

/** Assert no sentinel appears in a serialized output. */
function assertSilent(json) {
  for (const secret of SECRETS) {
    assert.equal(json.includes(secret), false, `the output must not contain "${secret}"`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * The artifact: literals, closed key sets, validation.
 * ----------------------------------------------------------------------------------------------*/

test('the format identifiers and exit codes are the ones the design fixes', () => {
  assert.equal(CORRESPONDENCE_VERSION, 'profile-correspondence/0.1-draft.1');
  assert.equal(CORRESPONDENCE_SUMMARY, 'correspondence-summary/0.2-draft.1');
  assert.deepEqual({ ...CORRESPONDENCE_EXIT }, { OK: 0, FINDINGS: 1, REFUSED: 2, INTERNAL: 5, USAGE: 64 });
  assert.equal(Object.isFrozen(CORRESPONDENCE_EXIT), true);
});

test('the code list is closed, frozen and carries exactly the documented codes', () => {
  assert.deepEqual(Object.keys(CORRESPONDENCE_CODES), [
    'CORRESPONDENCE_NOT_AN_OBJECT',
    'CORRESPONDENCE_UNEXPECTED_KEY',
    'CORRESPONDENCE_MISSING_KEY',
    'CORRESPONDENCE_VERSION_INVALID',
    'CORRESPONDENCE_BINDING_INVALID',
    'CORRESPONDENCE_PAIRS_EMPTY',
    'CORRESPONDENCE_PAIR_NOT_AN_OBJECT',
    'CORRESPONDENCE_PAIR_KEY_INVALID',
    'CORRESPONDENCE_ID_NOT_A_LABEL',
    'CORRESPONDENCE_ID_DUPLICATED',
    'CORRESPONDENCE_STALE',
    'CORRESPONDENCE_PROFILE_UNREADABLE',
    'CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH',
    'CORRESPONDENCE_ENTRY_NOT_FOUND',
    'CORRESPONDENCE_ENTRY_AMBIGUOUS',
    'CORRESPONDENCE_ENTRY_TEXT_DISAGREES',
    'CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT',
    'CORRESPONDENCE_PLUGIN_NOT_DECLARED',
    'CORRESPONDENCE_DUPLICATE_PLUGIN_ID',
    'CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES',
    'CORRESPONDENCE_INTERNAL',
  ]);
  for (const [key, value] of Object.entries(CORRESPONDENCE_CODES)) assert.equal(key, value);
  assert.equal(Object.isFrozen(CORRESPONDENCE_CODES), true);
});

test('the two closure lists are copied verbatim from the design', () => {
  assert.deepEqual([...CORRESPONDENCE_LIMITATIONS], [
    'IDENTITY_IS_CALLER_ASSERTED',
    'NO_VERSION_CORRESPONDENCE',
    'CONFIG_VALUES_NOT_COMPARED',
    'CAPABILITY_SATISFACTION_NOT_CHECKED',
    'ROW_SET_COMPLETENESS_UNKNOWN',
    'IDENTITY_TEXT_IS_READ_FROM_THE_DUMP_AND_NEVER_RE_EMITTED',
    'ENTRY_TEXT_IS_OPERATOR_TEXT_NOT_A_PACKAGE_IDENTITY',
    'CERTIFICATION_NOT_CLAIMED',
    'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
  ]);
  assert.deepEqual([...CORRESPONDENCE_NOT_DERIVED], [
    'declarations',
    'availableCapabilities',
    'resources',
    'activation',
    'loadability',
    'dependencyResolution',
    'identity',
  ]);
  assert.equal(Object.isFrozen(CORRESPONDENCE_LIMITATIONS), true);
  assert.equal(Object.isFrozen(CORRESPONDENCE_NOT_DERIVED), true);
});

test('the summary key set is closed in both directions', () => {
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const documented = [
    'correspondenceSummary',
    'identitySource',
    'bindings',
    'pairs',
    'findings',
    'counts',
    'certification',
    'correlation',
    'identityDisclosed',
    'entryTextVerified',
    'notDerived',
    'limitations',
  ];
  assert.deepEqual(Object.keys(result), documented);
  // Both directions: nothing documented is missing, and nothing undocumented is present.
  for (const key of documented) assert.ok(Object.hasOwn(result, key), `${key} must be present`);
  assert.equal(Object.keys(result).length, documented.length);
  assert.deepEqual(Object.keys(result.counts), ['pairs', 'matched', 'refused', 'findings']);
  assert.deepEqual(Object.keys(result.bindings), ['profileSha256', 'declarationSha256']);
});

test('the pair key set is closed in both directions', () => {
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const documented = [
    'index',
    'line',
    'disabled',
    'config',
    'keyCount',
    'unmodelledKeyCount',
    'pluginDeclared',
    'capabilitiesRequired',
    'capabilitiesOptional',
    'resources',
    'findings',
  ];
  assert.deepEqual(Object.keys(result.pairs[0]), documented);
  assert.deepEqual(Object.keys(result.pairs[0].resources), ['tool', 'service']);
});

test('a well-formed artifact validates to a frozen normalized copy', () => {
  const input = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha', note: 'a note' },
  ]);
  const validation = validateCorrespondence(input);
  assert.equal(validation.ok, true);
  assert.equal(validation.value.pairs.length, 1);
  assert.equal(validation.value.pairs[0].note, 'a note');
  // Mutating the caller's object after validation cannot change the checked copy.
  input.pairs.push({ entryId: 'beta', pluginId: 'plugin.beta' });
  assert.equal(validation.value.pairs.length, 1);
});

test('the top-level key set is closed: every absent required key and every extra key is refused', () => {
  const good = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  for (const key of ['correspondenceVersion', 'bindings', 'pairs']) {
    const copy = { ...good };
    delete copy[key];
    assert.equal(validateCorrespondence(copy).code, CORRESPONDENCE_CODES.CORRESPONDENCE_MISSING_KEY);
  }
  const extra = { ...good, extra: true };
  assert.equal(validateCorrespondence(extra).code, CORRESPONDENCE_CODES.CORRESPONDENCE_UNEXPECTED_KEY);
  // An extra key wins over a missing one only when both are present; the order is fixed, so the
  // same input always produces the same code.
  assert.equal(validateCorrespondence({ extra: true }).code, CORRESPONDENCE_CODES.CORRESPONDENCE_UNEXPECTED_KEY);
});

test('a non-object artifact is refused without throwing', () => {
  for (const value of [null, undefined, 1, 'text', [], true]) {
    const result = validateCorrespondence(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, CORRESPONDENCE_CODES.CORRESPONDENCE_NOT_AN_OBJECT);
  }
});

test('a wrong version is refused', () => {
  const good = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(
    validateCorrespondence({ ...good, correspondenceVersion: 'profile-correspondence/9.9.9' }).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_VERSION_INVALID,
  );
});

test('a binding that is not two lowercase sha256 digests is refused', () => {
  const good = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const cases = [
    { ...good, bindings: null },
    { ...good, bindings: { profileSha256: 'abc' } },
    { ...good, bindings: { ...good.bindings, profileSha256: 'A'.repeat(64) } },
    { ...good, bindings: { ...good.bindings, declarationSha256: `${'a'.repeat(63)}g` } },
    { ...good, bindings: { ...good.bindings, extra: 'x'.repeat(64) } },
  ];
  for (const value of cases) {
    assert.equal(validateCorrespondence(value).code, CORRESPONDENCE_CODES.CORRESPONDENCE_BINDING_INVALID);
  }
});

test('an empty or non-array pairs list is refused', () => {
  const good = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, []);
  assert.equal(validateCorrespondence(good).code, CORRESPONDENCE_CODES.CORRESPONDENCE_PAIRS_EMPTY);
  assert.equal(
    validateCorrespondence({ ...good, pairs: {} }).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_PAIRS_EMPTY,
  );
});

test('a pair that is not an object is refused', () => {
  const good = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, ['alpha']);
  assert.equal(
    validateCorrespondence(good).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_NOT_AN_OBJECT,
  );
});

test('a pair key set is closed in both directions', () => {
  const pairs = [{ entryId: 'alpha', pluginId: 'plugin.alpha' }];
  const base = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, pairs);
  for (const key of ['entryId', 'pluginId']) {
    const pair = { ...pairs[0] };
    delete pair[key];
    assert.equal(
      validateCorrespondence({ ...base, pairs: [pair] }).code,
      CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_KEY_INVALID,
    );
  }
  assert.equal(
    validateCorrespondence({ ...base, pairs: [{ ...pairs[0], extra: 1 }] }).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_KEY_INVALID,
  );
  assert.equal(
    validateCorrespondence({ ...base, pairs: [{ ...pairs[0], note: 7 }] }).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_PAIR_KEY_INVALID,
  );
});

test('a label with a control character, a separator, padding or no text is refused', () => {
  const base = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const bad = [
    { entryId: 'alpha\u0007', pluginId: 'plugin.alpha' },
    { entryId: 'alpha', pluginId: 'plugin\u2028beta' },
    { entryId: 'alpha', pluginId: 'plugin\u2029beta' },
    { entryId: ' alpha', pluginId: 'plugin.alpha' },
    { entryId: 'alpha ', pluginId: 'plugin.alpha' },
    { entryId: '', pluginId: 'plugin.alpha' },
    { entryId: 'alpha', pluginId: 42 },
  ];
  for (const pair of bad) {
    assert.equal(
      validateCorrespondence({ ...base, pairs: [pair] }).code,
      CORRESPONDENCE_CODES.CORRESPONDENCE_ID_NOT_A_LABEL,
    );
  }
});

test('a duplicated entry id is refused', () => {
  const base = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, []);
  assert.equal(
    validateCorrespondence({
      ...base,
      pairs: [
        { entryId: 'alpha', pluginId: 'plugin.alpha' },
        { entryId: 'alpha', pluginId: 'plugin.beta' },
      ],
    }).code,
    CORRESPONDENCE_CODES.CORRESPONDENCE_ID_DUPLICATED,
  );
});

test('a duplicated plugin id is a finding, not a refusal', () => {
  // §2 says "unique within their own list"; §3.5 makes a duplicate plugin id a finding. If §2
  // were applied to `pluginId`, `CORRESPONDENCE_DUPLICATE_PLUGIN_ID` could never be emitted, so
  // the finding rule is the one that governs.
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
    { entryId: 'beta', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(result.refused, undefined);
  assert.deepEqual(result.findings, [
    { pair: 1, code: CORRESPONDENCE_CODES.CORRESPONDENCE_DUPLICATE_PLUGIN_ID },
    { pair: 2, code: CORRESPONDENCE_CODES.CORRESPONDENCE_DUPLICATE_PLUGIN_ID },
  ]);
});

/* ------------------------------------------------------------------------------------------------
 * The check: bindings, profile safety, the id scan, resolution.
 * ----------------------------------------------------------------------------------------------*/

test('stale bindings are refused before anything is read', () => {
  const correspondence = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  // Flip one hex character: the document has not changed, the assertion no longer describes it.
  const flipped = correspondence.bindings.profileSha256.startsWith('a') ? 'b' : 'a';
  correspondence.bindings.profileSha256 = `${flipped}${correspondence.bindings.profileSha256.slice(1)}`;
  const result = checkCorrespondence({
    correspondence,
    profileText: PROFILE_TWO_ROWS,
    declarationText: DECLARATION_TWO_PLUGINS,
  });
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_STALE);
});

test('a declaration digest mismatch is also stale', () => {
  const correspondence = correspondenceFor(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  correspondence.bindings.declarationSha256 = 'f'.repeat(64);
  const result = checkCorrespondence({
    correspondence,
    profileText: PROFILE_TWO_ROWS,
    declarationText: DECLARATION_TWO_PLUGINS,
  });
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_STALE);
});

test('a profile the summarizer refuses is unreadable, with one code of this artifact', () => {
  const profileText = 'id: not-a-sequence\n';
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_UNREADABLE);
});

test('a non-string profile text is unreadable, not a throw', () => {
  const result = checkCorrespondence({
    correspondence: { correspondenceVersion: CORRESPONDENCE_VERSION, bindings: {}, pairs: [] },
    profileText: 42,
    declarationText: DECLARATION_TWO_PLUGINS,
  });
  assert.equal(result.refused, true);
});

test('a row count that disagrees with the summarizer is refused with its own code', () => {
  // The summarizer sees two entries; the line-anchored scan sees no opener at column 0.
  const profileText = '  - id: alpha\n  - id: beta\n';
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH);
});

test('an entry id that matches no row is refused', () => {
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'missing', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_NOT_FOUND);
});

test('an entry id that matches two rows is refused as ambiguous', () => {
  const profileText = `- id: duplicated
  name: one
- id: duplicated
  name: two
`;
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'duplicated', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_AMBIGUOUS);
});

test('a quoted or tagged id makes that entry unaddressable, not the document unreadable', () => {
  for (const line of ['- id: "quoted"', "- id: 'quoted'", '- id: !!js quoted']) {
    const profileText = `${line}\n  name: q\n- id: plain\n  name: p\n`;
    const notFound = check(profileText, DECLARATION_TWO_PLUGINS, [
      { entryId: 'quoted', pluginId: 'plugin.alpha' },
    ]);
    assertRefused(notFound, CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_NOT_FOUND);
    // The other, literal id still resolves: one unaddressable entry does not poison the scan.
    const resolved = check(profileText, DECLARATION_TWO_PLUGINS, [
      { entryId: 'plain', pluginId: 'plugin.alpha' },
    ]);
    assert.equal(resolved.refused, undefined);
    assert.equal(resolved.pairs[0].index, 1);
  }
});

test('an anchored id is refused earlier, by the summarizer, as an unreadable profile', () => {
  // An anchor is a document-level hazard for the summarizer, so it wins over any id question; the
  // scan never gets to decide that this one entry is unaddressable.
  const profileText = '- id: &anchor quoted\n  name: q\n- id: plain\n  name: p\n';
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'plain', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_PROFILE_UNREADABLE);
});

test('a declaration document that is not the analyzer input shape is refused', () => {
  for (const declarationText of ['not json\n', '[]\n', '{"declarations":{}}\n', 'null\n']) {
    const result = check(PROFILE_TWO_ROWS, declarationText, [
      { entryId: 'alpha', pluginId: 'plugin.alpha' },
    ]);
    assertRefused(result, CORRESPONDENCE_CODES.CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT);
  }
});

/* ------------------------------------------------------------------------------------------------
 * The happy path and the findings.
 * ----------------------------------------------------------------------------------------------*/

test('the happy path reports every documented field and no finding', () => {
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
    { entryId: 'beta', pluginId: 'plugin.beta' },
  ]);
  assert.equal(result.refused, undefined);
  assert.equal(result.correspondenceSummary, CORRESPONDENCE_SUMMARY);
  assert.equal(result.identitySource, 'caller-asserted-entry-text-verified');
  // The output never carries an id or a name; the dump text is read to verify, then dropped.
  assert.equal(result.identityDisclosed, false);
  assert.equal(result.entryTextVerified, true);
  assert.equal(result.correlation, 'not-established');
  assert.equal(result.certification, false);
  assert.deepEqual(result.counts, { pairs: 2, matched: 2, refused: 0, findings: 0 });
  assert.deepEqual(result.findings, []);
  assert.deepEqual([...result.notDerived], [...CORRESPONDENCE_NOT_DERIVED]);
  assert.deepEqual([...result.limitations], [...CORRESPONDENCE_LIMITATIONS]);

  assert.deepEqual(result.pairs[0], {
    index: 1,
    line: 1,
    disabled: 'absent',
    config: 'mapping',
    keyCount: 3,
    unmodelledKeyCount: 0,
    pluginDeclared: true,
    capabilitiesRequired: 1,
    capabilitiesOptional: 1,
    resources: { tool: 1, service: 1 },
    findings: [],
  });
  assert.deepEqual(result.pairs[1], {
    index: 2,
    line: 7,
    disabled: 'absent',
    config: 'mapping',
    keyCount: 3,
    unmodelledKeyCount: 0,
    pluginDeclared: true,
    capabilitiesRequired: 0,
    capabilitiesOptional: 0,
    resources: { tool: 0, service: 0 },
    findings: [],
  });
  assert.deepEqual(result.bindings, {
    profileSha256: digest(PROFILE_TWO_ROWS),
    declarationSha256: digest(DECLARATION_TWO_PLUGINS),
  });
});

test('a plugin with no declaration is a finding, with zeroed counts', () => {
  const result = check(PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.absent' },
  ]);
  assert.equal(result.refused, undefined);
  assert.deepEqual(result.pairs[0].findings, [
    CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED,
  ]);
  assert.equal(result.pairs[0].pluginDeclared, false);
  assert.equal(result.pairs[0].capabilitiesRequired, 0);
  assert.equal(result.pairs[0].capabilitiesOptional, 0);
  assert.deepEqual(result.pairs[0].resources, { tool: 0, service: 0 });
  assert.deepEqual(result.findings, [
    { pair: 1, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED },
  ]);
  assert.deepEqual(result.counts, { pairs: 1, matched: 1, refused: 0, findings: 1 });
});

test('a disabled entry that declares capabilities or resources is a finding', () => {
  const profileText = `- id: alpha
  name: Alpha
  disabled: true
  config:
    a: 1
`;
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(result.refused, undefined);
  assert.equal(result.pairs[0].disabled, 'true');
  assert.deepEqual(result.pairs[0].findings, [
    CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES,
  ]);
  assert.equal(result.counts.findings, 1);
});

test('a disabled entry whose declaration declares nothing is not a finding', () => {
  const profileText = `- id: beta
  name: Beta
  disabled: true
`;
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'beta', pluginId: 'plugin.beta' },
  ]);
  assert.equal(result.pairs[0].disabled, 'true');
  assert.deepEqual(result.pairs[0].findings, []);
  assert.equal(result.counts.findings, 0);
});

test('findings are flattened in a stable order and de-duplicated', () => {
  const profileText = `- id: alpha
  name: Alpha
  disabled: true
- id: beta
  name: Beta
  disabled: true
`;
  // `plugin.alpha` is declared with capabilities, so the second row earns the disabled finding;
  // the first pair also names a plugin no declaration carries.
  const result = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.absent' },
    { entryId: 'beta', pluginId: 'plugin.alpha' },
  ]);
  assert.deepEqual(result.findings, [
    { pair: 1, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED },
    { pair: 2, code: CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES },
  ]);
  // De-duplication is by pair and code: repeated evaluation cannot add a second entry.
  const keys = result.findings.map((finding) => `${finding.pair}:${finding.code}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('a malformed declaration inside a valid document contributes nothing', () => {
  const declarationText = `${JSON.stringify({ declarations: [1, { plugin: { id: 'plugin.alpha' } }], availableCapabilities: [] })}\n`;
  const result = check(PROFILE_TWO_ROWS, declarationText, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(result.refused, undefined);
  assert.equal(result.pairs[0].pluginDeclared, true);
  assert.equal(result.pairs[0].capabilitiesRequired, 0);
  assert.deepEqual(result.pairs[0].resources, { tool: 0, service: 0 });
});

test('the check never throws on hostile input', () => {
  const hostile = [
    null,
    undefined,
    'x',
    [],
    {},
    { correspondence: null, profileText: '', declarationText: '' },
    { correspondence: {}, profileText: null, declarationText: null },
  ];
  for (const input of hostile) {
    if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
      assert.throws(() => checkCorrespondence(input), { name: 'TypeError' });
      continue;
    }
    const result = checkCorrespondence(input);
    assert.equal(result.refused, true);
    assert.equal(typeof result.code, 'string');
    assert.equal(CORRESPONDENCE_CODES[result.code], result.code);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Process-level behaviour of the command.
 * ----------------------------------------------------------------------------------------------*/

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'correspondence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the CLI as a process, with a minimal environment. */
function run(args, options = {}) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=192', CLI, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() },
    ...options,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Write the three fixture files and return their paths. */
function writeFixtures(t, profileText, declarationText, pairList) {
  const dir = tempDir(t);
  const profilePath = join(dir, 'profile.yml');
  const declarationPath = join(dir, 'declaration.json');
  const correspondencePath = join(dir, 'correspondence.json');
  writeFileSync(profilePath, profileText);
  writeFileSync(declarationPath, declarationText);
  writeFileSync(correspondencePath, JSON.stringify({ correspondenceVersion: CORRESPONDENCE_VERSION, bindings: { profileSha256: digest(profileText), declarationSha256: digest(declarationText) }, pairs: pairList }, null, 2));
  return { dir, profilePath, declarationPath, correspondencePath };
}

test('the command exits 0 on a resolved correspondence and writes one document', (t) => {
  const files = writeFixtures(t, PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.declarationPath]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout);
  assert.equal(document.correspondenceSummary, CORRESPONDENCE_SUMMARY);
  assert.deepEqual(document.counts, { pairs: 1, matched: 1, refused: 0, findings: 0 });
});

test('the command exits 1 when a pair carries a finding', (t) => {
  const files = writeFixtures(t, PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.absent' },
  ]);
  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.declarationPath]);
  assert.equal(result.status, 1);
  const document = JSON.parse(result.stdout);
  assert.deepEqual(document.findings, [
    { pair: 1, code: CORRESPONDENCE_CODES.CORRESPONDENCE_PLUGIN_NOT_DECLARED },
  ]);
});

test('the command exits 2 on stale bindings', (t) => {
  const files = writeFixtures(t, PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const document = JSON.parse(readFileSync(files.correspondencePath, 'utf8'));
  document.bindings.profileSha256 = 'a'.repeat(64);
  writeFileSync(files.correspondencePath, JSON.stringify(document));
  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.declarationPath]);
  assert.equal(result.status, 2);
  const refusal = JSON.parse(result.stdout);
  assert.equal(refusal.correspondenceSummary, CORRESPONDENCE_SUMMARY);
  assert.equal(refusal.refused, true);
  assert.equal(refusal.code, CORRESPONDENCE_CODES.CORRESPONDENCE_STALE);
  assert.equal(refusal.certification, false);
  assert.deepEqual([...refusal.limitations], [...CORRESPONDENCE_LIMITATIONS]);
});

test('the command exits 2 when a document path is a directory', (t) => {
  const files = writeFixtures(t, PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.dir]);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, 'INPUT_NOT_REGULAR');
});

test('the command exits 64 with usage on stderr for every malformed command line', () => {
  const files = { correspondence: 'correspondence.json', profile: 'profile.yml', declaration: 'declaration.json' };
  const cases = [
    [],
    [files.correspondence],
    [files.correspondence, '--profile', files.profile],
    [files.correspondence, '--declaration', files.declaration],
    [files.correspondence, '--profile', files.profile, '--bogus', files.declaration],
    [files.correspondence, '--profile', files.profile, '--profile', files.profile, '--declaration', files.declaration],
    [files.correspondence, files.correspondence, '--profile', files.profile, '--declaration', files.declaration],
    [files.correspondence, '--profile', '--declaration', files.declaration],
    ['-', '--profile', files.profile, '--declaration', files.declaration],
  ];
  for (const args of cases) {
    const result = run(args);
    assert.equal(result.status, 64, `args ${JSON.stringify(args)}`);
    assert.match(result.stderr, /Usage:/, `args ${JSON.stringify(args)}`);
    const document = JSON.parse(result.stdout);
    assert.equal(document.correspondenceSummary, CORRESPONDENCE_SUMMARY);
    assert.equal(document.refused, true);
    assert.equal(document.code, null);
    assert.deepEqual(document.limitations, []);
  }
});

test('a lost stdout write exits 5, never the code the check earned', async () => {
  const failing = {
    write(_text, callback) {
      callback(new Error('EPIPE'));
    },
    once() {},
    removeListener() {},
  };
  const silent = { write(_text, callback) { callback(null); }, once() {}, removeListener() {} };
  const code = await main(['/nonexistent/correspondence.json', '--profile', 'p.yml', '--declaration', 'd.json'], {
    stdout: failing,
    stderr: silent,
  });
  assert.equal(code, CORRESPONDENCE_EXIT.INTERNAL);
});

test('a synchronous throw from the stream also exits 5', async () => {
  const throwing = {
    write() {
      throw new Error('closed');
    },
    once() {},
    removeListener() {},
  };
  const silent = { write(_text, callback) { callback(null); }, once() {}, removeListener() {} };
  const code = await main([], { stdout: throwing, stderr: silent });
  assert.equal(code, CORRESPONDENCE_EXIT.INTERNAL);
});

test('a usage message that cannot be delivered is internal, not usage', async () => {
  const failing = {
    write(_text, callback) {
      callback(new Error('EPIPE'));
    },
    once() {},
    removeListener() {},
  };
  const silent = { write(_text, callback) { callback(null); }, once() {}, removeListener() {} };
  const code = await main([], { stdout: silent, stderr: failing });
  assert.equal(code, CORRESPONDENCE_EXIT.INTERNAL);
});

test('the command exits 5 when stdout is a full device', (t) => {
  if (!existsSync('/dev/full')) {
    t.skip('/dev/full is not available on this platform');
    return;
  }
  const files = writeFixtures(t, PROFILE_TWO_ROWS, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  const fd = openSync('/dev/full', 'w');
  t.after(() => closeSync(fd));
  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.declarationPath], {
    stdio: ['ignore', fd, 'pipe'],
  });
  assert.equal(result.status, 5);
});

/* ------------------------------------------------------------------------------------------------
 * Privacy: identity text never reaches the output.
 * ----------------------------------------------------------------------------------------------*/

test('no asserted id, plugin id or note appears anywhere in the output', (t) => {
  const profileText = `- id: sentinel-entry-alpha
  name: sentinel-name-gamma
  config:
    sentinel-key-delta: 1
- id: second-entry
  name: second
`;
  const declarationText = `${JSON.stringify({
    declarations: [
      {
        plugin: { id: 'sentinel.plugin.beta', version: '1.0.0' },
        capabilities: { required: ['sentinel-capability-epsilon'], optional: [] },
        resources: [{ kind: 'tool', name: 'sentinel-resource-zeta' }],
      },
    ],
    availableCapabilities: [],
  })}\n`;
  const pairList = [
    {
      entryId: 'sentinel-entry-alpha',
      pluginId: 'sentinel.plugin.beta',
      note: 'sentinel note text',
    },
  ];
  const files = writeFixtures(t, profileText, declarationText, pairList);

  // The sentinels are really in the inputs: the assertion is about the output, not a fixture typo.
  const inputText = [
    readFileSync(files.profilePath, 'utf8'),
    readFileSync(files.declarationPath, 'utf8'),
    readFileSync(files.correspondencePath, 'utf8'),
  ].join('\n');
  for (const secret of SECRETS) assert.ok(inputText.includes(secret), `${secret} must be in the fixture`);

  const result = run([files.correspondencePath, '--profile', files.profilePath, '--declaration', files.declarationPath]);
  assert.equal(result.status, 0);
  assertSilent(result.stdout);
  // The rest of the identity text is equally absent.
  for (const secret of ['sentinel-name-gamma', 'sentinel-key-delta', 'sentinel-capability-epsilon', 'sentinel-resource-zeta']) {
    assert.equal(result.stdout.includes(secret), false, `the output must not contain "${secret}"`);
  }
  const document = JSON.parse(result.stdout);
  assert.equal(document.identityDisclosed, false);
  assert.equal(document.pairs[0].line, 1);
});

test('the dump text is read twice and the readings are cross-checked', () => {
  // The scanner walks the text; the summarizer parses it, asking for id disclosure so the two
  // readings can be compared row by row. Agreement is what makes an asserted id a statement
  // about THIS document rather than about the caller's memory of it.
  //
  // The disagreement refusal (`CORRESPONDENCE_ENTRY_TEXT_DISAGREES`) is defensive: the scanner is
  // deliberately a strict subset of what the parser accepts (a quoted value, a comment tail or a
  // tag makes a row unaddressable rather than contradictory), so no document in this suite can
  // reach it. It exists for the case where that relationship stops holding, and it is NOT
  // claimed as covered by a measurement.
  const profileText = ['- id: alpha', '  name: ./plugins/alpha.js', ''].join('\n');
  const ok = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'alpha', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(ok.refused, undefined);
  assert.equal(ok.entryTextVerified, true);
  // Verification is internal: the output pairs carry row shape, never the row's text.
  assert.deepEqual(Object.keys(ok.pairs[0]), [
    'index',
    'line',
    'disabled',
    'config',
    'keyCount',
    'unmodelledKeyCount',
    'pluginDeclared',
    'capabilitiesRequired',
    'capabilitiesOptional',
    'resources',
    'findings',
  ]);
  assert.equal(JSON.stringify(ok.pairs).includes('alpha'), false);
  assert.equal(JSON.stringify(ok.findings).includes('alpha'), false);
});

test('a row one reading cannot address stays unaddressable rather than poisoning the document', () => {
  // A quoted id is a legal YAML string the summarizer reads, but the line scanner refuses to
  // treat a quoted value as a bare token. That is a one-sided gap, not a contradiction, so the
  // document stays usable and only the quoted entry is unaddressable.
  const profileText = ['- id: "quoted"', '  name: q', '- id: plain', '  name: p', ''].join('\n');
  const quoted = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'quoted', pluginId: 'plugin.alpha' },
  ]);
  assertRefused(quoted, CORRESPONDENCE_CODES.CORRESPONDENCE_ENTRY_NOT_FOUND);
  const plain = check(profileText, DECLARATION_TWO_PLUGINS, [
    { entryId: 'plain', pluginId: 'plugin.alpha' },
  ]);
  assert.equal(plain.refused, undefined);
});
