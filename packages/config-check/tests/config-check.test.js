import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIG_CHECK_SUMMARY,
  CONFIG_CHECK_REFUSALS,
  CONFIG_CHECK_NOT_CHECKED,
  CONFIG_CHECK_LIMITATIONS,
  CONFIG_CHECK_NOT_DERIVED,
  CONFIG_CHECK_EXIT,
  checkConfiguration,
  configCheckExitCode,
  findAffectedLiteral,
  resolveKeywordPath,
  summarizeExpectation,
  renderPath,
  schemaFromDeclaration,
} from '../src/config-check.js';

/**
 * Build a fake engine that records how often it was called.
 *
 * The real engine is never imported here: every test injects its own outcome so
 * the suite runs with no dependencies installed.
 *
 * @param {object} outcome Value returned by `check()`.
 * @returns {{calls: number, check: Function}} Fake engine.
 */
function engineReturning(outcome) {
  const engine = {
    calls: 0,
    async check() {
      engine.calls += 1;
      return outcome;
    },
  };
  return engine;
}

/**
 * Build a fake engine that throws.
 *
 * @param {Error} error Error to throw.
 * @returns {{calls: number, check: Function}} Fake engine.
 */
function engineThrowing(error) {
  const engine = {
    calls: 0,
    async check() {
      engine.calls += 1;
      throw error;
    },
  };
  return engine;
}

const VALID_OUTCOME = { valid: true, errors: [] };
const SIMPLE_SCHEMA = {
  type: 'object',
  properties: { retries: { type: 'integer', minimum: 0 } },
};

test('a valid configuration is checked and carries no findings', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: { retries: 2 },
    engine: engineReturning(VALID_OUTCOME),
  });

  assert.equal(result.schemaStatus, 'checked');
  assert.equal(result.valid, true);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.counts, { checked: 1, invalid: 0, findings: 0, findingsTruncated: false });
  assert.equal(result.certification, false);
  assert.equal(result.configCheckSummary, CONFIG_CHECK_SUMMARY);
  assert.equal(Object.isFrozen(result), true);
});

test('a valid result lists the seven things it does not derive', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineReturning(VALID_OUTCOME),
  });

  assert.deepEqual([...result.notDerived], [
    'declarations',
    'availableCapabilities',
    'resources',
    'activation',
    'loadability',
    'dependencyResolution',
    'configurationValue',
  ]);
  assert.equal(result.notDerived.length, 7);
});

test('a valid result lists the seven limitations verbatim', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineReturning(VALID_OUTCOME),
  });

  assert.deepEqual([...result.limitations], [
    'ONLY_THE_SUBSET_THIS_BUILD_CAN_EVALUATE_IS_JUDGED',
    'A_NOT_CHECKED_RESULT_IS_NOT_A_PASS',
    'NO_CONFIGURATION_VALUE_IS_EVER_EMITTED',
    'KEY_PATHS_ARE_RELATIVE_TO_THE_DECLARED_ENTRY',
    'ENGINE_IS_THIRD_PARTY_AND_UNPATCHED',
    'NO_LOADABILITY_OR_ACTIVATION_CLAIMED',
    'CERTIFICATION_NOT_CLAIMED',
  ]);
  assert.equal(result.limitations.length, 7);
});

test('an invalid configuration carries one finding per engine error', async () => {
  const engine = engineReturning({
    valid: false,
    errors: [
      {
        keyword: 'type',
        instancePath: ['retries'],
        keywordPath: ['properties', 'retries', 'type'],
      },
    ],
  });
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: { retries: 'many' },
    engine,
  });

  assert.equal(result.schemaStatus, 'checked');
  assert.equal(result.valid, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'config.retries');
  assert.equal(result.findings[0].keyword, 'type');
  assert.deepEqual(result.counts, { checked: 1, invalid: 1, findings: 1, findingsTruncated: false });
  assert.equal(engine.calls, 1);
});

test('a finding describes the parent subschema, not the keyword value', async () => {
  const result = await checkConfiguration({
    schema: { properties: { retries: { type: 'integer', minimum: 0 } } },
    instance: { retries: -1 },
    engine: engineReturning({
      valid: false,
      errors: [
        {
          keyword: 'minimum',
          instancePath: ['retries'],
          keywordPath: ['properties', 'retries', 'minimum'],
        },
      ],
    }),
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'config.retries');
  assert.equal(result.findings[0].keyword, 'minimum');
  // `keywordPath` points at `minimum`, whose value is `0`; the describable node
  // is its parent subschema, which is where `type` lives.
  assert.deepEqual(result.findings[0].expected, { type: 'integer', minimum: 0 });
});

test('a finding whose keyword path does not resolve still reports the error', async () => {
  const result = await checkConfiguration({
    schema: { type: 'object' },
    instance: {},
    engine: engineReturning({
      valid: false,
      errors: [{ keyword: 'required', instancePath: [], keywordPath: ['$defs', 'missing', 'required'] }],
    }),
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'config');
  assert.equal(result.findings[0].keyword, 'required');
  assert.deepEqual(result.findings[0].expected, {});
});

test('findings are capped at 64 and the cap is reported', async () => {
  const errors = Array.from({ length: 70 }, (_, index) => ({
    keyword: 'type',
    instancePath: ['items', index],
    keywordPath: ['properties', 'items', 'type'],
  }));
  const result = await checkConfiguration({
    schema: { properties: { items: { type: 'integer' } } },
    instance: {},
    engine: engineReturning({ valid: false, errors }),
  });

  assert.equal(result.schemaStatus, 'checked');
  assert.equal(result.valid, false);
  assert.equal(result.findings.length, 64);
  assert.deepEqual(result.counts, { checked: 1, invalid: 1, findings: 64, findingsTruncated: true });
});

test('a non-object schema is refused rather than judged', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({
    schema: 'not-a-schema',
    instance: {},
    engine,
  });

  assert.equal(result.schemaStatus, 'refused');
  assert.equal(result.refusal, CONFIG_CHECK_REFUSALS.SCHEMA_NOT_OBJECT);
  assert.equal(result.refusal, 'CONFIG_SCHEMA_NOT_AN_OBJECT');
  assert.deepEqual(result.findings, []);
  assert.equal(configCheckExitCode(result), 2);
  assert.equal(engine.calls, 0);
});

test('an engine that throws is a refusal, never a thrown error', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineThrowing(new Error('engine exploded')),
  });

  assert.equal(result.schemaStatus, 'refused');
  assert.equal(result.refusal, CONFIG_CHECK_REFUSALS.ENGINE_FAILED);
  assert.equal(result.refusal, 'CONFIG_ENGINE_FAILED');
  assert.deepEqual(result.counts, { checked: 0, invalid: 0, findings: 0, findingsTruncated: false });
});

test('a malformed engine outcome (valid not boolean) is refused', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineReturning({ valid: 'yes', errors: [] }),
  });

  assert.equal(result.schemaStatus, 'refused');
  assert.equal(result.refusal, CONFIG_CHECK_REFUSALS.NOT_JSON_SCHEMA);
  assert.equal(result.refusal, 'CONFIG_SCHEMA_REJECTED_BY_ENGINE');
});

test('a malformed engine outcome (errors not an array) is refused', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineReturning({ valid: false, errors: { message: 'nope' } }),
  });

  assert.equal(result.schemaStatus, 'refused');
  assert.equal(result.refusal, CONFIG_CHECK_REFUSALS.NOT_JSON_SCHEMA);
});

test('an engine outcome that is not an object at all is refused', async () => {
  const result = await checkConfiguration({
    schema: SIMPLE_SCHEMA,
    instance: {},
    engine: engineReturning(undefined),
  });

  assert.equal(result.schemaStatus, 'refused');
  assert.equal(result.refusal, CONFIG_CHECK_REFUSALS.NOT_JSON_SCHEMA);
});

test('a const literal carrying $id is not checked and names the literal keyword', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({
    schema: { type: 'object', const: { $id: 'urn:dsh:example' } },
    instance: {},
    engine,
  });

  assert.equal(result.schemaStatus, 'not-checked');
  assert.equal(result.notCheckedReason, CONFIG_CHECK_NOT_CHECKED.LITERAL_IDENTIFIER);
  assert.equal(result.notCheckedReason, 'NOT_CHECKED_SCHEMA_LITERAL_HAS_IDENTIFIER');
  assert.equal(result.notCheckedKeyword, 'const');
  assert.deepEqual(result.counts, { checked: 0, invalid: 0, findings: 0, findingsTruncated: false });
  assert.equal(engine.calls, 0);
});

test('an enum literal carrying $anchor is not checked and names the literal keyword', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({
    schema: { type: 'object', enum: [{ $anchor: 'here' }] },
    instance: {},
    engine,
  });

  assert.equal(result.schemaStatus, 'not-checked');
  assert.equal(result.notCheckedKeyword, 'enum');
  assert.equal(engine.calls, 0);
});

test('a default literal carrying $schema / $ref / $dynamicAnchor is not checked', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({
    schema: { default: { $schema: 'https://json-schema.org/draft/2020-12/schema', $dynamicAnchor: 'd' } },
    instance: {},
    engine,
  });

  assert.equal(result.schemaStatus, 'not-checked');
  assert.equal(result.notCheckedKeyword, 'default');
  assert.equal(engine.calls, 0);
});

test('an examples literal carrying $ref is not checked and names the literal keyword', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({
    schema: { type: 'object', examples: [{ $ref: '#/a' }] },
    instance: {},
    engine,
  });

  assert.equal(result.schemaStatus, 'not-checked');
  assert.equal(result.notCheckedKeyword, 'examples');
  assert.equal(engine.calls, 0);
});

test('a $vocabulary literal nested deep inside is still detected', () => {
  const hit = findAffectedLiteral({
    properties: { nested: { examples: [{ one: { $vocabulary: {} } }] } },
  });
  assert.deepEqual(hit, { found: true, keyword: 'examples', identifier: '$vocabulary' });
});

test('an identifier-free schema has no affected literal', () => {
  assert.deepEqual(findAffectedLiteral(SIMPLE_SCHEMA), { found: false });
});

test('a boolean schema is passed through to the engine', async () => {
  const engine = engineReturning(VALID_OUTCOME);
  const result = await checkConfiguration({ schema: true, instance: { anything: 1 }, engine });

  assert.equal(result.schemaStatus, 'checked');
  assert.equal(result.valid, true);
  assert.equal(engine.calls, 1);
});

test('checkConfiguration throws TypeError for non-object input', async () => {
  await assert.rejects(() => checkConfiguration(null), TypeError);
  await assert.rejects(() => checkConfiguration('schema'), TypeError);
  await assert.rejects(() => checkConfiguration([]), TypeError);
  await assert.rejects(() => checkConfiguration(undefined), TypeError);
});

test('checkConfiguration throws TypeError for a missing or malformed engine', async () => {
  await assert.rejects(() => checkConfiguration({ schema: {}, instance: {} }), TypeError);
  await assert.rejects(() => checkConfiguration({ schema: {}, instance: {}, engine: null }), TypeError);
  await assert.rejects(() => checkConfiguration({ schema: {}, instance: {}, engine: {} }), TypeError);
  await assert.rejects(() => checkConfiguration({ schema: {}, instance: {}, engine: { check: 1 } }), TypeError);
});

test('findAffectedLiteral ignores identifier keys outside literal keywords', () => {
  assert.deepEqual(findAffectedLiteral({ $id: 'urn:dsh:root', properties: { a: { type: 'string' } } }), {
    found: false,
  });
});

test('resolveKeywordPath resolves arrays and returns null for a miss', () => {
  const schema = { properties: { a: { type: 'string' } }, allOf: [{ minimum: 1 }] };
  assert.deepEqual(resolveKeywordPath(schema, ['properties', 'a']), { type: 'string' });
  assert.deepEqual(resolveKeywordPath(schema, ['allOf', 0, 'minimum']), 1);
  assert.equal(resolveKeywordPath(schema, ['properties', 'b']), null);
  assert.equal(resolveKeywordPath(schema, ['allOf', 5]), null);
  assert.equal(resolveKeywordPath(schema, ['properties', 'a', 'type', 'deeper']), null);
});

test('summarizeExpectation records vocabulary but never literal content', () => {
  const summary = summarizeExpectation({
    type: 'string',
    format: 'email',
    enum: ['a', 'b', 'c'],
    const: 'fixed',
    required: ['x', 'y'],
    minLength: 3,
    pattern: '^secret-business-rule$',
    properties: { a: {}, b: {} },
  });

  assert.equal(summary.type, 'string');
  assert.equal(summary.format, 'email');
  assert.equal(summary.enumSize, 3);
  assert.equal(summary.acceptsSingleValue, true);
  assert.equal(summary.requiredCount, 2);
  assert.equal(summary.minLength, 3);
  assert.equal(summary.hasPattern, true);
  assert.equal(summary.propertyCount, 2);
  assert.equal(Object.hasOwn(summary, 'pattern'), false);
  assert.equal(Object.hasOwn(summary, 'enum'), false);
  assert.equal(JSON.stringify(summary).includes('secret-business-rule'), false);
});

test('configCheckExitCode maps every documented schemaStatus', () => {
  assert.equal(configCheckExitCode({ schemaStatus: 'checked', valid: true }), 0);
  assert.equal(configCheckExitCode({ schemaStatus: 'checked', valid: false }), 1);
  assert.equal(configCheckExitCode({ schemaStatus: 'not-checked' }), 2);
  assert.equal(configCheckExitCode({ schemaStatus: 'refused' }), 2);
  assert.equal(CONFIG_CHECK_EXIT.VALID, 0);
  assert.equal(CONFIG_CHECK_EXIT.INVALID, 1);
  assert.equal(CONFIG_CHECK_EXIT.NOT_CHECKED, 2);
});

test('configCheckExitCode throws TypeError for an undocumented schemaStatus', () => {
  assert.throws(() => configCheckExitCode({ schemaStatus: 'maybe' }), TypeError);
  assert.throws(() => configCheckExitCode({ schemaStatus: undefined }), TypeError);
  assert.throws(() => configCheckExitCode(null), TypeError);
});

test('no configuration value leaks into the result', async () => {
  const secret = 'sk-live-SECRET';
  const schema = {
    type: 'object',
    properties: { apiKey: { type: 'string', minLength: 40 } },
  };
  const instance = { apiKey: secret, region: 'eu-west-1' };
  const result = await checkConfiguration({
    schema,
    instance,
    engine: engineReturning({
      valid: false,
      errors: [
        {
          keyword: 'minLength',
          instancePath: ['apiKey'],
          keywordPath: ['properties', 'apiKey', 'minLength'],
          // Deliberately hostile extra fields: an engine may echo the value.
          message: `apiKey "${secret}" is too short`,
          data: { apiKey: secret },
          schema: { minLength: 40 },
          value: secret,
          $id: 'urn:leaked',
          $anchor: 'leaked',
        },
      ],
    }),
  });

  const text = JSON.stringify(result);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('eu-west-1'), false);
  assert.equal(text.includes('$id'), false);
  assert.equal(text.includes('$anchor'), false);
  assert.equal(text.includes('urn:leaked'), false);
  assert.deepEqual(result.findings[0], {
    path: 'config.apiKey',
    keyword: 'minLength',
    expected: { type: 'string', minLength: 40 },
  });
});

test('renderPath renders key paths without values', () => {
  assert.equal(renderPath([]), 'config');
  assert.equal(renderPath(['a', 'b']), 'config.a.b');
  assert.equal(renderPath(['items', 2, 'x']), 'config.items[2].x');
  assert.equal(renderPath([0]), 'config[0]');
});

test('schemaFromDeclaration requires an injected validator', () => {
  assert.throws(() => schemaFromDeclaration({}, {}), TypeError);
});

test('schemaFromDeclaration returns the contract of a valid declaration', () => {
  const contract = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };
  const result = schemaFromDeclaration(
    { schemaVersion: '0.2.0-draft.1', configSchema: contract },
    { validateDeclaration: () => ({ valid: true, issues: [] }) },
  );
  assert.deepEqual(result, { ok: true, schema: contract });
});

test('a legacy declaration has no contract, and that is not an error', () => {
  const result = schemaFromDeclaration(
    { schemaVersion: '0.1.0-draft.1' },
    { validateDeclaration: () => ({ valid: true, issues: [] }) },
  );
  assert.deepEqual(result, { ok: false, refusal: CONFIG_CHECK_REFUSALS.NO_CONFIG_CONTRACT });
});

test('an invalid declaration refuses before the contract is considered', () => {
  const result = schemaFromDeclaration(
    { schemaVersion: '0.2.0-draft.1', configSchema: true },
    { validateDeclaration: () => ({ valid: false, issues: [{ code: 'NOPE', path: 'x' }] }) },
  );
  assert.deepEqual(result, { ok: false, refusal: CONFIG_CHECK_REFUSALS.DECLARATION_INVALID });
});

test('a validator that throws refuses rather than escaping', () => {
  const result = schemaFromDeclaration(
    { schemaVersion: '0.2.0-draft.1', configSchema: true },
    { validateDeclaration: () => { throw new Error('boom'); } },
  );
  assert.deepEqual(result, { ok: false, refusal: CONFIG_CHECK_REFUSALS.DECLARATION_INVALID });
});

test('a boolean contract is carried as-is', () => {
  const result = schemaFromDeclaration(
    { schemaVersion: '0.2.0-draft.1', configSchema: false },
    { validateDeclaration: () => ({ valid: true }) },
  );
  assert.deepEqual(result, { ok: true, schema: false });
});

test('a declaration without configSchema refuses with NO_CONFIG_CONTRACT', () => {
  const legacy = { schemaVersion: '0.1.0-draft.1', plugin: { id: 'a.b', version: '1.0.0' } };
  const result = schemaFromDeclaration(legacy, {
    validateDeclaration: (value) => ({ valid: Object.hasOwn(value, 'configSchema') === false, issues: [] }),
  });
  assert.deepEqual(result, { ok: false, refusal: CONFIG_CHECK_REFUSALS.NO_CONFIG_CONTRACT });
});

test('a configSchema that is neither boolean nor object refuses as invalid', () => {
  const result = schemaFromDeclaration(
    { schemaVersion: '0.2.0-draft.1', configSchema: [] },
    { validateDeclaration: () => ({ valid: true, issues: [] }) },
  );
  assert.deepEqual(result, { ok: false, refusal: CONFIG_CHECK_REFUSALS.DECLARATION_INVALID });
});
