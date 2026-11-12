import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FAILURE_CLASSIFIER_LIMITATIONS,
  FAILURE_CLASSIFIER_VERSION,
  FAILURE_CODES,
  FAILURE_KINDS,
  classifyFailure,
  isArbitrable,
} from '../src/failure-classify.js'

describe('the classifier reads the host error text, not a guess', () => {
  it('classifies the duplicate-service text cordis actually throws', () => {
    // Verbatim from cordis/lib/index.js in reflect.provide.
    const result = classifyFailure('service "catalog" has been registered at <shop-plugin>')
    assert.equal(result.kind, 'duplicate-service')
    assert.equal(result.code, FAILURE_CODES.DUPLICATE_SERVICE)
    assert.equal(result.service, 'catalog')
    assert.equal(result.existingOwner, 'shop-plugin')
    assert.equal(result.declaredAs, null)
  })

  it('finds the message on a later line of a multi-line diagnostic', () => {
    const text = [
      'failed to load plugin shop',
      'service "catalog" has been registered at <shop-plugin>',
      '    at load (file:///x.js:1:1)',
    ].join('\n')
    const result = classifyFailure(text)
    assert.equal(result.kind, 'duplicate-service')
    assert.equal(result.service, 'catalog')
  })

  it('strips ANSI colour before matching', () => {
    const result = classifyFailure('\u001b[31mservice "catalog" has been registered at <shop>\u001b[0m')
    assert.equal(result.kind, 'duplicate-service')
    assert.equal(result.service, 'catalog')
  })

  it('classifies a property conflict separately', () => {
    const result = classifyFailure('property "tools" is already declared as service')
    assert.equal(result.kind, 'property-conflict')
    assert.equal(result.code, FAILURE_CODES.PROPERTY_CONFLICT)
    assert.equal(result.service, 'tools')
    assert.equal(result.declaredAs, 'service')
    assert.equal(result.existingOwner, null)
  })

  it('leaves an unrelated message unclassified rather than forcing a kind', () => {
    const result = classifyFailure('ENOENT: no such file or directory, open package.json')
    assert.equal(result.kind, 'unclassified')
    assert.equal(result.code, FAILURE_CODES.UNCLASSIFIED)
    assert.equal(result.service, null)
  })

  it('reports a missing message as absent, not as a conflict', () => {
    for (const value of [undefined, null, '', 42, {}]) {
      assert.equal(classifyFailure(value).code, FAILURE_CODES.MESSAGE_ABSENT)
      assert.equal(classifyFailure(value).kind, 'unclassified')
    }
  })
})

describe('arbitrability', () => {
  it('accepts the two conflict kinds and rejects the rest', () => {
    assert.equal(isArbitrable(classifyFailure('service "a" has been registered at <b>')), true)
    assert.equal(isArbitrable(classifyFailure('property "a" is already declared as service')), true)
    assert.equal(isArbitrable(classifyFailure('boom')), false)
    assert.equal(isArbitrable(classifyFailure(null)), false)
  })

  it('tolerates a malformed classification object', () => {
    assert.equal(isArbitrable(undefined), false)
    assert.equal(isArbitrable({ kind: 'duplicate-service' }), true)
  })
})

describe('the classifier states its limits', () => {
  it('freezes the vocabulary', () => {
    assert.equal(FAILURE_CLASSIFIER_VERSION, 'failure-classifier/0.1-draft.1')
    assert.deepEqual([...FAILURE_KINDS], ['duplicate-service', 'property-conflict', 'unclassified'])
    assert.ok(Object.isFrozen(FAILURE_CODES))
    assert.ok(Object.isFrozen(FAILURE_CLASSIFIER_LIMITATIONS))
    assert.ok(FAILURE_CLASSIFIER_LIMITATIONS.length > 0)
  })

  it('never returns a kind outside the closed set', () => {
    const samples = ['', 'x', 'service "a" has been registered at <b>', 'property "a" is already declared as service']
    for (const sample of samples) assert.ok(FAILURE_KINDS.includes(classifyFailure(sample).kind))
  })
})
