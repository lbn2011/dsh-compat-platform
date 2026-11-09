import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shortKeyword,
  pointerTokens,
  mapError,
  engineFromModule,
} from '../src/hyperjump-engine.js';

test('shortKeyword reduces keyword and evaluation URIs to their last segment', () => {
  assert.equal(shortKeyword('https://json-schema.org/keyword/minimum'), 'minimum');
  assert.equal(shortKeyword('https://json-schema.org/evaluation/validate'), 'validate');
  assert.equal(shortKeyword('https://json-schema.org/keyword/type'), 'type');
});

test('shortKeyword returns unknown for anything else', () => {
  assert.equal(shortKeyword('https://example.com/keyword/minimum'), 'unknown');
  assert.equal(shortKeyword('https://json-schema.org/keyword/'), 'unknown');
  // Dialect-qualified keywords are real: the engine reports
  // `…/keyword/draft-2020-12/format` for a format assertion, so the word is the
  // last segment. This line used to expect 'unknown' before the format entry
  // point was enabled and the real URI was observed.
  assert.equal(shortKeyword('https://json-schema.org/keyword/draft-2020-12/format'), 'format');
  assert.equal(shortKeyword('https://json-schema.org/keyword/a/b'), 'b');
  assert.equal(shortKeyword('https://json-schema.org/keyword/a/1bad'), 'unknown');
  assert.equal(shortKeyword(''), 'unknown');
  assert.equal(shortKeyword(undefined), 'unknown');
  assert.equal(shortKeyword(null), 'unknown');
  assert.equal(shortKeyword(42), 'unknown');
});

test('pointerTokens handles the empty and root fragment', () => {
  assert.deepEqual([...pointerTokens('#')], []);
  assert.deepEqual([...pointerTokens('#/')], ['']);
});

test('pointerTokens splits a plain pointer', () => {
  assert.deepEqual([...pointerTokens('#/a/b')], ['a', 'b']);
  assert.deepEqual([...pointerTokens('#/properties/retries/minimum')], ['properties', 'retries', 'minimum']);
});

test('pointerTokens unescapes JSON Pointer tokens', () => {
  assert.deepEqual([...pointerTokens('#/a~0b')], ['a~b']);
  assert.deepEqual([...pointerTokens('#/a~1b')], ['a/b']);
  assert.deepEqual([...pointerTokens('#/~0~1')], ['~/']);
});

test('pointerTokens percent-decodes before unescaping', () => {
  assert.deepEqual([...pointerTokens('#/a%20b')], ['a b']);
  assert.deepEqual([...pointerTokens('#/caf%C3%A9')], ['café']);
});

test('pointerTokens returns no tokens for a malformed pointer', () => {
  assert.deepEqual([...pointerTokens('#a')], []);
  assert.deepEqual([...pointerTokens('a/b')], []);
  assert.deepEqual([...pointerTokens('')], []);
  assert.deepEqual([...pointerTokens(undefined)], []);
  assert.deepEqual([...pointerTokens(null)], []);
  assert.deepEqual([...pointerTokens(7)], []);
});

test('pointerTokens returns no tokens for a bad percent escape', () => {
  assert.deepEqual([...pointerTokens('#/%zz')], []);
  assert.deepEqual([...pointerTokens('#/a%2')], []);
});

test('mapError maps a BASIC error to keyword and both paths', () => {
  const mapped = mapError({
    keyword: 'https://json-schema.org/keyword/minimum',
    instanceLocation: '#/a',
    absoluteKeywordLocation: 'urn:x#/properties/a/minimum',
  });

  assert.deepEqual(mapped, {
    keyword: 'minimum',
    instancePath: ['a'],
    keywordPath: ['properties', 'a', 'minimum'],
  });
});

test('mapError maps an evaluation keyword and a root instance location', () => {
  const mapped = mapError({
    keyword: 'https://json-schema.org/evaluation/validate',
    instanceLocation: '#',
    absoluteKeywordLocation: 'urn:x#/',
  });

  assert.equal(mapped.keyword, 'validate');
  assert.deepEqual([...mapped.instancePath], []);
  assert.deepEqual([...mapped.keywordPath], ['']);
});

test('mapError tolerates missing fields', () => {
  assert.deepEqual(mapError({}), {
    keyword: 'unknown',
    instancePath: [],
    keywordPath: [],
  });
  assert.deepEqual(mapError(undefined), {
    keyword: 'unknown',
    instancePath: [],
    keywordPath: [],
  });
  assert.deepEqual(mapError(null), {
    keyword: 'unknown',
    instancePath: [],
    keywordPath: [],
  });
});

test('mapError tolerates an absolute location without a fragment', () => {
  const mapped = mapError({
    keyword: 'https://json-schema.org/keyword/type',
    instanceLocation: '#/x',
    absoluteKeywordLocation: 'urn:no-fragment',
  });

  assert.equal(mapped.keyword, 'type');
  assert.deepEqual([...mapped.instancePath], ['x']);
  assert.deepEqual([...mapped.keywordPath], []);
});

test('engineFromModule throws TypeError when the namespace lacks the API', () => {
  assert.throws(() => engineFromModule({}), TypeError);
  assert.throws(() => engineFromModule(null), TypeError);
  assert.throws(() => engineFromModule(undefined), TypeError);
  assert.throws(() => engineFromModule({ registerSchema() {} }), TypeError);
  assert.throws(() => engineFromModule({ validate() {} }), TypeError);
  assert.throws(() => engineFromModule({ registerSchema: 1, validate: 1 }), TypeError);
});

test('engineFromModule builds an engine over a stub namespace', async () => {
  const registrations = [];
  const validations = [];
  const unregistered = [];
  const api = {
    registerSchema(schema, uri) {
      registrations.push({ schema, uri });
    },
    async validate(uri, instance, format) {
      validations.push({ uri, instance, format });
      return {
        valid: false,
        errors: [
          {
            keyword: 'https://json-schema.org/keyword/minimum',
            instanceLocation: '#/a',
            absoluteKeywordLocation: 'urn:x#/properties/a/minimum',
          },
        ],
      };
    },
    unregisterSchema(uri) {
      unregistered.push(uri);
    },
  };

  const engine = engineFromModule(api);
  const schema = { properties: { a: { type: 'integer', minimum: 0 } } };
  const instance = { a: -1 };

  const outcome = await engine.check({ schema, instance });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].schema, schema);
  assert.equal(registrations[0].uri, validations[0].uri);
  assert.match(registrations[0].uri, /^urn:dsh-compat:config-check:/);
  assert.equal(validations[0].instance, instance);
  assert.equal(validations[0].format, 'BASIC');
  assert.deepEqual(unregistered, [validations[0].uri]);

  assert.equal(outcome.valid, false);
  assert.equal(outcome.errors.length, 1);
  assert.deepEqual(outcome.errors[0], {
    keyword: 'minimum',
    instancePath: ['a'],
    keywordPath: ['properties', 'a', 'minimum'],
  });
});

test('each check registers the schema under a distinct urn', async () => {
  const uris = [];
  const api = {
    registerSchema(schema, uri) {
      uris.push(uri);
    },
    async validate() {
      return { valid: true, errors: [] };
    },
    unregisterSchema() {},
  };

  const engine = engineFromModule(api);
  const schema = { type: 'object' };

  const first = await engine.check({ schema, instance: {} });
  const second = await engine.check({ schema, instance: {} });

  assert.equal(first.valid, true);
  assert.deepEqual([...first.errors], []);
  assert.equal(second.valid, true);
  assert.equal(uris.length, 2);
  assert.notEqual(uris[0], uris[1]);
});

test('engineFromModule accepts a namespace that carries a default export', async () => {
  const api = {
    registerSchema() {},
    async validate() {
      return { valid: true, errors: [] };
    },
    unregisterSchema() {},
  };

  const engine = engineFromModule({ default: api });
  const outcome = await engine.check({ schema: { type: 'object' }, instance: {} });

  assert.equal(outcome.valid, true);
});

test('a validate() throw still unregisters and propagates', async () => {
  const unregistered = [];
  const api = {
    registerSchema() {},
    async validate() {
      throw new Error('boom');
    },
    unregisterSchema(uri) {
      unregistered.push(uri);
    },
  };

  const engine = engineFromModule(api);

  await assert.rejects(() => engine.check({ schema: { type: 'object' }, instance: {} }), /boom/);
  assert.equal(unregistered.length, 1);
  assert.match(unregistered[0], /^urn:dsh-compat:config-check:/);
});

test('an unregister failure does not mask the verdict', async () => {
  const api = {
    registerSchema() {},
    async validate() {
      return { valid: true, errors: [] };
    },
    unregisterSchema() {
      throw new Error('unregister exploded');
    },
  };

  const engine = engineFromModule(api);
  const outcome = await engine.check({ schema: { type: 'object' }, instance: {} });

  assert.equal(outcome.valid, true);
});
