import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import {
  ARBITER_EVENTS,
  ARBITER_SERVICE_CODES,
  ARBITER_SIGNALS,
  ARBITER_VERSION,
  createConflictArbiter,
  digestDiagnostic,
  readArbiterOptions,
} from '../src/conflict-arbiter.js'
import { apply, name as pluginName, SERVICE_NAME } from '../src/index.js'

const DUPLICATE_TEXT = 'service "catalog" has been registered at <shop-plugin>'
const OTHER_TEXT = 'property "tools" is already declared as service'

function fakeContext({ pluginManager, isolate, services = {} } = {}) {
  const listeners = new Map()
  const emitted = []
  const provided = new Map()
  const manager = pluginManager ?? { listPlugins: () => Promise.resolve([]) }
  const ctx = {
    baseDir: '/virtual/base',
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => {
        const current = listeners.get(event) ?? []
        const index = current.indexOf(handler)
        if (index >= 0) current.splice(index, 1)
      }
    },
    emit(event, payload) {
      emitted.push({ event, payload })
    },
    get(serviceName) {
      if (serviceName === 'pluginManager') return manager
      if (Object.hasOwn(services, serviceName)) return services[serviceName]
      throw new Error(`cannot get property "${serviceName}" without inject`)
    },
    provide(serviceName, value) {
      if (provided.has(serviceName)) throw new Error(`service "${serviceName}" has been registered at <root>`)
      provided.set(serviceName, value)
    },
    ...(isolate === undefined ? {} : { isolate }),
    provided,
    emitted,
    fire(event, ...args) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(...args)
    },
    countOf(event) {
      return (listeners.get(event) ?? []).length
    },
  }
  return { ctx, manager, emitted, provided, listenerCount: (event) => ctx.countOf(event) }
}

/** Wire inventory + manifests in memory. `files` is test data, never an option. */
function options(fixture, extra = {}) {
  const { files = {}, ...rest } = extra
  return {
    resolvePackageJson: (moduleName) => ({ ok: true, path: `/pkgs/${moduleName}/package.json` }),
    readFile: (path) => {
      if (Object.hasOwn(files, path)) return Promise.resolve(files[path])
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    },
    ...rest,
  }
}

function manifestWith(conflicts) {
  return JSON.stringify({ name: 'loser', dsh: { conflicts } })
}

describe('the service states what it is', () => {
  it('names its version, signal, and event', () => {
    assert.equal(ARBITER_VERSION, 'conflict-arbiter/0.1-draft.1')
    assert.deepEqual([...ARBITER_SIGNALS], ['internal/status'])
    assert.equal(ARBITER_EVENTS.DECIDED, 'dsh-compat/conflict-arbitrated')
  })
})

describe('options are a closed set', () => {
  it('refuses an unknown key, a bad strategy, a bad ceiling, a bad self id, a bad seam', () => {
    assert.throws(() => readArbiterOptions({ nope: 1 }), /unknown key: nope/)
    assert.throws(() => readArbiterOptions({ defaultStrategy: 'auto-win' }), /defaultStrategy/)
    assert.throws(() => readArbiterOptions({ maxDecisions: 0 }), /maxDecisions/)
    assert.throws(() => readArbiterOptions({ selfEntryId: 7 }), /selfEntryId/)
    assert.throws(() => readArbiterOptions({ listPlugins: {} }), /listPlugins/)
    assert.throws(() => readArbiterOptions([]), /must be an object/)
  })

  it('defaults to report-only', () => {
    assert.equal(readArbiterOptions({}).defaultStrategy, 'report-only')
    assert.equal(readArbiterOptions({}).maxDecisions, 200)
  })
})

describe('only a transition into FAILED triggers a pass', () => {
  it('subscribes to internal/status and runs one pass at attach', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, { listPlugins: () => Promise.resolve([]) }))
    service.attach()
    assert.equal(fixture.listenerCount('internal/status'), 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(service.state().triggers, 1)
    service.detach()
  })

  it('ignores an active fiber and a repeated FAILED notification', async () => {
    let reads = 0
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => {
        reads += 1
        return Promise.resolve([])
      },
    }))
    service.attach()
    await new Promise((resolve) => setImmediate(resolve))
    const afterAttach = reads
    fixture.ctx.fire('internal/status', { state: 2, name: 'active' }, 1)
    fixture.ctx.fire('internal/status', { state: 3, name: 'still-failed' }, 3)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, afterAttach)
    fixture.ctx.fire('internal/status', { state: 3, name: 'newly-failed' }, 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, afterAttach + 1)
    service.detach()
  })

  it('stops reacting after detach and is idempotent', () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture))
    service.attach()
    service.detach()
    service.detach()
    assert.equal(fixture.listenerCount('internal/status'), 0)
    assert.equal(service.state().disposed, true)
  })
})

describe('a failed entry is classified from its diagnostic', () => {
  it('records a duplicate-service decision under report-only, digesting the text', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      files: {},
    }))
    const summary = await service.inspect()
    assert.deepEqual(summary, { ok: true, failed: 1, decided: 1 })
    const [record] = service.decisions()
    assert.equal(record.entryId, 'loser')
    assert.equal(record.classification.kind, 'duplicate-service')
    assert.equal(record.classification.service, 'catalog')
    assert.equal(record.strategy, 'report-only')
    assert.equal(record.action, 'report')
    assert.equal(record.applied, false)
    // The message is operator text: it is never copied into the record.
    assert.equal(record.diagnosticDigest, digestDiagnostic(DUPLICATE_TEXT).digest)
    assert.equal(record.diagnosticLength, DUPLICATE_TEXT.length)
    assert.equal(JSON.stringify(record).includes('has been registered at'), false)
    assert.equal(JSON.stringify(service.decisions()).includes('has been registered at'), false)
  })

  it('emits one decision event per record', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
    }))
    await service.inspect()
    const decided = fixture.emitted.filter((entry) => entry.event === ARBITER_EVENTS.DECIDED)
    assert.equal(decided.length, 1)
    assert.equal(decided[0].payload.entryId, 'loser')
  })

  it('skips entries with no diagnostic instead of inventing a failure', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([
        { entryId: 'fine', moduleName: 'fine', enabled: true },
        { entryId: 'blank', moduleName: 'blank', enabled: true, diagnostic: '' },
        { entryId: 'bad', moduleName: 'bad', enabled: true, diagnostic: 7 },
      ]),
    }))
    assert.deepEqual(await service.inspect(), { ok: true, failed: 0, decided: 0 })
    assert.deepEqual(service.decisions(), [])
  })

  it('decides the same failure once, even across repeated passes', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
    }))
    await service.inspect()
    await service.inspect()
    assert.equal(service.decisions().length, 1)
    // A different message for the same entry is a new fact.
    const changed = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: OTHER_TEXT }]),
    }))
    await changed.inspect()
    assert.equal(changed.decisions()[0].classification.kind, 'property-conflict')
  })

  it('reports an unclassified failure without assuming a conflict', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'x', moduleName: 'x', enabled: true, diagnostic: 'ENOENT: no such file' }]),
    }))
    await service.inspect()
    const [record] = service.decisions()
    assert.equal(record.classification.kind, 'unclassified')
    assert.equal(record.action, 'report')
  })
})

describe('disable-later really disables, and reports what the host said', () => {
  it('calls setPluginEnabled with the failing entry and false', async () => {
    const calls = []
    const fixture = fakeContext({
      pluginManager: {
        listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
        setPluginEnabled: (id, enabled) => {
          calls.push([id, enabled])
          return Promise.resolve({ changed: true, application: 'applied', stage: 'enable', target: id })
        },
      },
    })
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'disable-later' }) },
    }))
    await service.inspect()
    assert.deepEqual(calls, [['loser', false]])
    const [record] = service.decisions()
    assert.equal(record.strategy, 'disable-later')
    assert.equal(record.action, 'disable-entry')
    assert.equal(record.applied, true)
    assert.equal(record.applicationCode, ARBITER_SERVICE_CODES.DISABLE_APPLIED)
    assert.equal(record.application, 'applied')
  })

  it('treats restart-required as applied, and a failed application as not applied', async () => {
    for (const [application, expectedApplied, expectedCode] of [
      ['restart-required', true, ARBITER_SERVICE_CODES.DISABLE_APPLIED],
      ['failed', false, ARBITER_SERVICE_CODES.DISABLE_NOT_APPLIED],
      ['overridden', false, ARBITER_SERVICE_CODES.DISABLE_NOT_APPLIED],
    ]) {
      const fixture = fakeContext({
        pluginManager: {
          listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
          setPluginEnabled: () => Promise.resolve({ changed: true, application }),
        },
      })
      const service = createConflictArbiter(fixture.ctx, options(fixture, {
        files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'disable-later' }) },
      }))
      await service.inspect()
      const [record] = service.decisions()
      assert.equal(record.applied, expectedApplied, application)
      assert.equal(record.applicationCode, expectedCode, application)
    }
  })

  it('reports a thrown disable as a failure, not as success', async () => {
    const fixture = fakeContext({
      pluginManager: {
        listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
        setPluginEnabled: () => Promise.reject(new Error('management unavailable')),
      },
    })
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'disable-later' }) },
    }))
    await service.inspect()
    assert.equal(service.decisions()[0].applicationCode, ARBITER_SERVICE_CODES.DISABLE_FAILED)
    assert.equal(service.errors()[0].stage, 'disable')
  })

  it('refuses a read-only entry without calling the manager', async () => {
    let called = false
    const fixture = fakeContext({
      pluginManager: {
        listPlugins: () => Promise.resolve([{
          entryId: 'loser',
          moduleName: 'loser',
          enabled: true,
          diagnostic: DUPLICATE_TEXT,
          readOnlyReason: 'management-required',
        }]),
        setPluginEnabled: () => {
          called = true
          return Promise.resolve({ changed: true, application: 'applied' })
        },
      },
    })
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'disable-later' }) },
    }))
    await service.inspect()
    assert.equal(called, false)
    assert.equal(service.decisions()[0].code, 'ENTRY_IS_READ_ONLY')
  })
})

describe('isolate yields a scope for a loader, and claims no repair', () => {
  it('creates one scope for the failing service name', async () => {
    const created = []
    const fixture = fakeContext({
      isolate: (serviceName) => {
        const scope = { isolated: serviceName }
        created.push(serviceName)
        return scope
      },
    })
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'isolate' }) },
    }))
    await service.inspect()
    assert.deepEqual(created, ['catalog'])
    const [record] = service.decisions()
    assert.equal(record.action, 'needs-isolated-loader')
    assert.equal(record.applied, false)
    assert.equal(record.applicationCode, ARBITER_SERVICE_CODES.ISOLATE_SCOPE_RETURNED)
    assert.deepEqual(service.scopes(), ['catalog'])
  })

  it('reports a failure when the context cannot isolate', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'isolate' }) },
    }))
    await service.inspect()
    assert.equal(service.decisions()[0].applicationCode, ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED)
    assert.deepEqual(service.createIsolateScope(''), { ok: false, code: ARBITER_SERVICE_CODES.ISOLATE_SCOPE_FAILED })
  })
})

describe('an unreadable policy is recorded, not guessed', () => {
  it('reports POLICY_UNREADABLE when the package cannot be resolved', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'ghost', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      resolvePackageJson: () => ({ ok: false, reason: 'unresolved' }),
    }))
    await service.inspect()
    const [record] = service.decisions()
    assert.equal(record.policyCode, ARBITER_SERVICE_CODES.POLICY_UNREADABLE)
    assert.equal(record.strategy, 'report-only')
  })

  it('reports POLICY_UNREADABLE for malformed JSON', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      files: { '/pkgs/loser/package.json': '{ "dsh": ' },
    }))
    await service.inspect()
    assert.equal(service.decisions()[0].policyCode, ARBITER_SERVICE_CODES.POLICY_UNREADABLE)
  })

  it('refuses an unknown strategy rather than acting on a different one', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => Promise.resolve([{ entryId: 'loser', moduleName: 'loser', enabled: true, diagnostic: DUPLICATE_TEXT }]),
      files: { '/pkgs/loser/package.json': manifestWith({ strategy: 'auto-win' }) },
    }))
    await service.inspect()
    const [record] = service.decisions()
    assert.equal(record.strategy, 'report-only')
    assert.equal(record.action, 'report')
  })
})

describe('inventory problems degrade instead of throwing', () => {
  it('reports an unavailable inventory', async () => {
    const fixture = fakeContext()
    // No service at all: this is what a composition without pluginManagement
    // looks like, and `ctx.get` is the only honest way to ask.
    fixture.ctx.get = () => {
      throw new Error('cannot get property "pluginManager" without inject')
    }
    const service = createConflictArbiter(fixture.ctx, {})
    assert.deepEqual(await service.inspect(), { ok: false, failed: 0, decided: 0 })
    assert.equal(service.errors()[0].stage, 'inventory')
  })

  it('reports a non-array inventory', async () => {
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, { listPlugins: () => Promise.resolve({}) }))
    assert.deepEqual(await service.inspect(), { ok: false, failed: 0, decided: 0 })
    assert.equal(service.errors()[0].stage, 'inventory')
  })

  it('keeps records bounded by maxDecisions', async () => {
    const plugins = []
    const files = {}
    for (let index = 0; index < 5; index += 1) {
      plugins.push({ entryId: `p${index}`, moduleName: `p${index}`, enabled: true, diagnostic: `service "s${index}" has been registered at <other>` })
      files[`/pkgs/p${index}/package.json`] = manifestWith({ strategy: 'report-only' })
    }
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      maxDecisions: 3,
      listPlugins: () => Promise.resolve(plugins),
      files,
    }))
    await service.inspect()
    assert.equal(service.decisions().length, 3)
    assert.deepEqual(service.decisions().map((record) => record.entryId), ['p2', 'p3', 'p4'])
  })
})

describe('inspect is single flight', () => {
  it('shares one inventory read across concurrent triggers', async () => {
    let reads = 0
    const fixture = fakeContext()
    const service = createConflictArbiter(fixture.ctx, options(fixture, {
      listPlugins: () => {
        reads += 1
        return new Promise((resolve) => setTimeout(() => resolve([]), 5))
      },
    }))
    await Promise.all([service.inspect(), service.inspect(), service.inspect()])
    assert.equal(reads, 1)
  })
})

describe('the plugin entry', () => {
  it('is named, injects pluginManager, and publishes the service', () => {
    assert.equal(pluginName, 'dsh-compat-conflict-arbiter')
    const fixture = fakeContext()
    const service = apply(fixture.ctx, { defaultStrategy: 'report-only' })
    assert.equal(fixture.ctx.provided.get(SERVICE_NAME), service)
    service.detach()
  })

  it('refuses an unknown config key and a bad strategy', () => {
    const fixture = fakeContext()
    assert.throws(() => apply(fixture.ctx, { nope: 1 }), /unknown key: nope/)
    assert.throws(() => apply(fixture.ctx, { defaultStrategy: 'auto-win' }), /defaultStrategy/)
  })

  it('refuses a second instance in the same scope', () => {
    const fixture = fakeContext()
    apply(fixture.ctx, {})
    assert.throws(() => apply(fixture.ctx, {}), /already provided/)
  })
})

describe('digests are stable and do not leak text', () => {
  it('returns a truncated sha256 and the length', () => {
    const message = 'service "a" has been registered at <b>'
    const expected = createHash('sha256').update(message, 'utf8').digest('hex').slice(0, 32)
    assert.deepEqual(digestDiagnostic(message), { digest: expected, length: message.length })
    assert.equal(digestDiagnostic(message).digest.length, 32)
  })
})
