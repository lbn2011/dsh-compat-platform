import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ARBITER_ACTIONS,
  ARBITER_CODES,
  ARBITER_POLICY_LIMITATIONS,
  ARBITER_POLICY_VERSION,
  ARBITER_STRATEGIES,
  DEFAULT_STRATEGY,
  decideArbitration,
  readConflictPolicy,
} from '../src/arbiter-policy.js'

const DUPLICATE = {
  kind: 'duplicate-service',
  code: 'DUPLICATE_SERVICE',
  service: 'catalog',
  existingOwner: 'shop',
  declaredAs: null,
}

describe('reading the declared policy', () => {
  it('reports absence without inventing a strategy', () => {
    for (const pkg of [{}, { dsh: {} }, { dsh: { client: {} } }, null, 42]) {
      const policy = readConflictPolicy(pkg)
      assert.equal(policy.present, false)
      assert.equal(policy.strategy, DEFAULT_STRATEGY)
      assert.deepEqual(policy.issues, [])
    }
  })

  it('reads a valid strategy and service', () => {
    const policy = readConflictPolicy({ dsh: { conflicts: { strategy: 'disable-later', service: 'catalog' } } })
    assert.equal(policy.present, true)
    assert.equal(policy.strategy, 'disable-later')
    assert.equal(policy.service, 'catalog')
    assert.deepEqual(policy.issues, [])
  })

  it('refuses an unknown strategy instead of coercing it', () => {
    const policy = readConflictPolicy({ dsh: { conflicts: { strategy: 'auto-win' } } })
    assert.equal(policy.refused, true)
    assert.equal(policy.strategy, DEFAULT_STRATEGY)
    assert.deepEqual(policy.issues.map((issue) => issue.code), [ARBITER_CODES.STRATEGY_UNKNOWN])
    assert.equal(policy.issues[0].strategy, 'auto-win')
  })

  it('reports a non-object block, a non-string strategy, and a non-string service', () => {
    assert.deepEqual(
      readConflictPolicy({ dsh: { conflicts: [] } }).issues.map((issue) => issue.code),
      [ARBITER_CODES.CONFLICTS_NOT_OBJECT],
    )
    assert.deepEqual(
      readConflictPolicy({ dsh: { conflicts: { strategy: 3 } } }).issues.map((issue) => issue.code),
      [ARBITER_CODES.STRATEGY_NOT_STRING],
    )
    assert.deepEqual(
      readConflictPolicy({ dsh: { conflicts: { service: '' } } }).issues.map((issue) => issue.code),
      [ARBITER_CODES.SERVICE_NOT_STRING],
    )
  })

  it('reports unknown keys rather than ignoring them', () => {
    const policy = readConflictPolicy({ dsh: { conflicts: { strategy: 'report-only', winner: 'me' } } })
    assert.deepEqual(policy.issues.map((issue) => issue.code), [ARBITER_CODES.CONFLICTS_UNKNOWN_KEY])
    assert.equal(policy.issues[0].key, 'winner')
  })
})

describe('report-only is the default and changes nothing', () => {
  it('reports a duplicate without touching the entry', () => {
    const decision = decideArbitration({
      classification: DUPLICATE,
      policy: { present: false, strategy: DEFAULT_STRATEGY, service: null },
      entry: { entryId: 'loser' },
      selfEntryId: 'arbiter',
    })
    assert.equal(decision.action, 'report')
    assert.equal(decision.strategy, 'report-only')
    assert.equal(decision.code, null)
    assert.equal(decision.entryId, 'loser')
    assert.equal(decision.service, 'catalog')
  })

  it('falls back to the configured default when nothing is declared', () => {
    const decision = decideArbitration({
      classification: DUPLICATE,
      policy: { present: false, strategy: DEFAULT_STRATEGY, service: null },
      entry: { entryId: 'loser' },
      defaultStrategy: 'disable-later',
    })
    assert.equal(decision.action, 'disable-entry')
  })
})

describe('disable-later names the losing entry', () => {
  const policy = { present: true, strategy: 'disable-later', service: 'catalog' }

  it('disables the entry that failed', () => {
    const decision = decideArbitration({ classification: DUPLICATE, policy, entry: { entryId: 'loser' }, selfEntryId: 'arbiter' })
    assert.equal(decision.action, 'disable-entry')
    assert.equal(decision.entryId, 'loser')
    assert.equal(decision.code, null)
  })

  it('refuses when the entry cannot be addressed', () => {
    const decision = decideArbitration({ classification: DUPLICATE, policy, entry: {}, selfEntryId: 'arbiter' })
    assert.equal(decision.action, 'refuse')
    assert.equal(decision.code, ARBITER_CODES.ENTRY_NOT_ADDRESSABLE)
  })

  it('refuses to disable itself', () => {
    const decision = decideArbitration({ classification: DUPLICATE, policy, entry: { entryId: 'arbiter' }, selfEntryId: 'arbiter' })
    assert.equal(decision.action, 'refuse')
    assert.equal(decision.code, ARBITER_CODES.ARBITER_DOES_NOT_DISABLE_ITSELF)
  })

  it('refuses a read-only entry', () => {
    const decision = decideArbitration({ classification: DUPLICATE, policy, entry: { entryId: 'loser', readOnly: true }, selfEntryId: 'arbiter' })
    assert.equal(decision.action, 'refuse')
    assert.equal(decision.code, ARBITER_CODES.ENTRY_IS_READ_ONLY)
  })
})

describe('isolate is not a repair this plugin can perform', () => {
  it('returns needs-isolated-loader and says so', () => {
    const decision = decideArbitration({
      classification: DUPLICATE,
      policy: { present: true, strategy: 'isolate', service: 'catalog' },
      entry: { entryId: 'loser' },
      selfEntryId: 'arbiter',
    })
    assert.equal(decision.action, 'needs-isolated-loader')
    assert.equal(decision.code, ARBITER_CODES.STRATEGY_NEEDS_ISOLATED_LOADER)
    // The scope is the service name the loader would isolate, not the entry id.
    assert.equal(decision.service, 'catalog')
  })
})

describe('a declared service disagreeing with the failure is reported, not enforced', () => {
  it('keeps the host observation and records the disagreement', () => {
    const decision = decideArbitration({
      classification: DUPLICATE,
      policy: { present: true, strategy: 'report-only', service: 'something-else' },
      entry: { entryId: 'loser' },
      selfEntryId: 'arbiter',
    })
    assert.equal(decision.service, 'catalog')
    assert.ok(decision.reasons.includes(ARBITER_CODES.SERVICE_DISAGREES_WITH_FAILURE))
  })

  it('says nothing when the two agree', () => {
    const decision = decideArbitration({
      classification: DUPLICATE,
      policy: { present: true, strategy: 'report-only', service: 'catalog' },
      entry: { entryId: 'loser' },
      selfEntryId: 'arbiter',
    })
    assert.deepEqual(decision.reasons, [])
  })
})

describe('the policy vocabulary is closed and the limits are stated', () => {
  it('freezes strategies and actions', () => {
    assert.equal(ARBITER_POLICY_VERSION, 'arbiter-policy/0.1-draft.1')
    assert.deepEqual([...ARBITER_STRATEGIES], ['report-only', 'disable-later', 'isolate'])
    assert.deepEqual([...ARBITER_ACTIONS], ['report', 'disable-entry', 'needs-isolated-loader', 'refuse'])
    assert.equal(DEFAULT_STRATEGY, 'report-only')
  })

  it('states that arbitration is post-failure and prevention is upstream', () => {
    assert.ok(ARBITER_POLICY_LIMITATIONS.includes('ARBITRATION_RUNS_AFTER_A_FAILURE_AND_CANNOT_PREVENT_ONE'))
    assert.ok(ARBITER_POLICY_LIMITATIONS.includes('ISOLATE_STRATEGY_NEEDS_AN_ISOLATED_LOADER_THIS_PLUGIN_DOES_NOT_OWN'))
    assert.ok(ARBITER_POLICY_LIMITATIONS.includes('PREVENTION_BELONGS_TO_A_STATIC_PRE_CHECK_BEFORE_INSTALL'))
    assert.ok(Object.isFrozen(ARBITER_POLICY_LIMITATIONS))
  })

  it('never returns an action outside the closed set', () => {
    const strategies = [...ARBITER_STRATEGIES, 'unknown']
    for (const strategy of strategies) {
      for (const entry of [{}, { entryId: 'x' }, { entryId: 'x', readOnly: true }]) {
        const decision = decideArbitration({
          classification: DUPLICATE,
          policy: { present: true, strategy, service: 'catalog' },
          entry,
          selfEntryId: 'arbiter',
        })
        assert.ok(ARBITER_ACTIONS.includes(decision.action), `${strategy}/${JSON.stringify(entry)} -> ${decision.action}`)
      }
    }
  })
})
