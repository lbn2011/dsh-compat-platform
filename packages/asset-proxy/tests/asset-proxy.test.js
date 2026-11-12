import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSET_PROXY_CODES,
  ASSET_PROXY_EVENTS,
  ASSET_PROXY_LIMITATIONS,
  ASSET_PROXY_SIGNALS,
  ASSET_PROXY_VERSION,
  createAssetProxy,
  readAssetProxyOptions,
  resolvePackageJson,
} from '../src/asset-proxy.js'
import { apply, name as pluginName, SERVICE_NAME } from '../src/index.js'

/**
 * A composition context just large enough for the proxy.
 *
 * `get` returns registered services and throws for anything else, which is what
 * a real Cordis context does for a service nobody provided — the proxy must cope
 * with that rather than read an undeclared property.
 */
function fakeContext({ plugins = [], files = {}, services = {} } = {}) {
  const listeners = new Map()
  const emitted = []
  const provided = new Map()
  const ctx = {
    baseDir: '/virtual/base',
    on(event, handler, options) {
      const list = listeners.get(event) ?? []
      list.push({ handler, options })
      listeners.set(event, list)
      return () => {
        const current = listeners.get(event) ?? []
        const index = current.findIndex((entry) => entry.handler === handler)
        if (index >= 0) current.splice(index, 1)
      }
    },
    emit(event, payload) {
      emitted.push({ event, payload })
    },
    get(serviceName) {
      if (Object.hasOwn(services, serviceName)) return services[serviceName]
      throw new Error(`cannot get property "${serviceName}" without inject`)
    },
    provide(serviceName, value) {
      // Cordis throws when a name is already registered in the same scope:
      // `service "x" has been registered at <owner>`. Mirroring that is what
      // makes the double-apply case meaningful.
      if (provided.has(serviceName)) {
        throw new Error(`service "${serviceName}" has been registered at <root>`)
      }
      provided.set(serviceName, value)
    },
    provided,
    emitted,
    fire(event, ...args) {
      for (const entry of [...(listeners.get(event) ?? [])]) entry.handler(...args)
    },
    countOf(event) {
      return (listeners.get(event) ?? []).length
    },
    optionsOf(event) {
      return (listeners.get(event) ?? []).map((entry) => entry.options)
    },
  }
  ctx.services = services
  return {
    ctx,
    plugins,
    files,
    listenerCount: (event) => ctx.countOf(event),
  }
}

/** Options wired to in-memory inventory and files. */
function options(fixture, extra = {}) {
  return {
    listPlugins: () => Promise.resolve(fixture.plugins),
    readFile: (path) => {
      if (Object.hasOwn(fixture.files, path)) return Promise.resolve(fixture.files[path])
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    },
    resolvePackageJson: (moduleName) => (
      moduleName === 'broken-layout'
        ? { ok: false, reason: 'unresolved' }
        : { ok: true, path: `/pkgs/${moduleName}/package.json` }
    ),
    ...extra,
  }
}

/** Wait for the scheduled refresh the service starts without awaiting. */
async function settle(service) {
  await service.refresh()
}

describe('the proxy publishes an honest identity', () => {
  it('names its version and the two host signals it reads', () => {
    assert.equal(ASSET_PROXY_VERSION, 'asset-proxy/0.1-draft.1')
    assert.deepEqual([...ASSET_PROXY_SIGNALS], ['plugin-manager/changed', 'webserver/index-inject'])
    assert.equal(ASSET_PROXY_EVENTS.CHANGED, 'dsh-compat/assets-changed')
  })

  it('states that the field is our extension, not a host feature', () => {
    assert.ok(ASSET_PROXY_LIMITATIONS.includes('ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE'))
    assert.ok(ASSET_PROXY_LIMITATIONS.includes('NO_CSP_HEADER_IS_EMITTED_BY_THIS_PLUGIN'))
    assert.ok(ASSET_PROXY_LIMITATIONS.includes('PEER_SCOPE_IS_IGNORED_BECAUSE_A_DECLARED_ASSET_LIST_IS_STATIC'))
  })
})

describe('options are a closed set', () => {
  it('refuses an unknown key', () => {
    assert.throws(() => readAssetProxyOptions({ nope: 1 }), /unknown key: nope/)
  })

  it('refuses a bad placement, a bad flag, and a bad ceiling', () => {
    assert.throws(() => readAssetProxyOptions({ scriptPlacement: 'body ' }), /scriptPlacement/)
    assert.throws(() => readAssetProxyOptions({ prepend: 'yes' }), /prepend/)
    assert.throws(() => readAssetProxyOptions({ maxPlugins: 0 }), /maxPlugins/)
  })

  it('refuses a seam that is not a function', () => {
    assert.throws(() => readAssetProxyOptions({ listPlugins: {} }), /listPlugins/)
  })

  it('defaults to head placement and no prepend', () => {
    const resolved = readAssetProxyOptions({})
    assert.equal(resolved.scriptPlacement, 'head')
    assert.equal(resolved.prepend, false)
    assert.equal(resolved.maxPlugins, 500)
  })
})

describe('the injection table is filled from a warm cache', () => {
  it('pushes rows for a declared script and stylesheet', async () => {
    const fixture = fakeContext({
      plugins: [
        { entryId: 'a', moduleName: 'plugin-a', enabled: true },
        { entryId: 'b', moduleName: 'plugin-b', enabled: true },
      ],
      files: {
        '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { platform: 'web', assets: ['/a.js'] } } }),
        '/pkgs/plugin-b/package.json': JSON.stringify({ dsh: { client: { platform: 'web', assets: { styles: ['/b.css'] } } } }),
      },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    const table = []
    service.inject(table)
    assert.deepEqual(table, [
      { kind: 'script-src', placement: 'head', src: '/a.js' },
      { kind: 'html', placement: 'head', html: '<link rel="stylesheet" href="/b.css">' },
    ])
    assert.equal(service.table().warmed, true)
  })

  it('subscribes to both signals at attach', () => {
    const fixture = fakeContext()
    const service = createAssetProxy(fixture.ctx, options(fixture))
    service.attach()
    assert.equal(fixture.listenerCount('plugin-manager/changed'), 1)
    assert.equal(fixture.listenerCount('webserver/index-inject'), 1)
    service.detach()
  })

  it('passes prepend to the injection listener only when configured', () => {
    const plain = fakeContext()
    createAssetProxy(plain.ctx, options(plain, { prepend: false })).attach()
    assert.deepEqual(plain.ctx.optionsOf('webserver/index-inject'), [undefined])

    const prepended = fakeContext()
    createAssetProxy(prepended.ctx, options(prepended, { prepend: true })).attach()
    assert.deepEqual(prepended.ctx.optionsOf('webserver/index-inject'), [{ prepend: true }])
  })

  it('emits a change event after a refresh that saw declarations', async () => {
    const fixture = fakeContext({
      plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: true }],
      files: { '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { assets: ['/a.js'] } } }) },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    const changed = fixture.ctx.emitted.filter((entry) => entry.event === ASSET_PROXY_EVENTS.CHANGED)
    assert.equal(changed.length, 1)
    assert.deepEqual(changed[0].payload, { ok: true, plugins: 1, rows: 1, declared: 1 })
  })
})

describe('a cold cache is reported, not hidden', () => {
  it('records one cold-inject issue and pushes nothing on the first render', () => {
    const fixture = fakeContext()
    const service = createAssetProxy(fixture.ctx, options(fixture))
    const table = []
    service.inject(table)
    assert.deepEqual(table, [])
    service.inject(table)
    assert.deepEqual(table, [])
    const cold = service.issues().filter((issue) => issue.code === ASSET_PROXY_CODES.CACHE_COLD_AT_FIRST_INJECT)
    assert.equal(cold.length, 1)
  })

  it('pushes rows on the render after the cache warms', async () => {
    const fixture = fakeContext({
      plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: true }],
      files: { '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { assets: ['/a.js'] } } }) },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    service.inject([])
    await settle(service)
    const table = []
    service.inject(table)
    assert.equal(table.length, 1)
  })

  it('refuses a table that is not an array instead of throwing at the host', () => {
    const fixture = fakeContext()
    const service = createAssetProxy(fixture.ctx, options(fixture))
    service.inject(null)
    assert.equal(service.errors()[0].stage, 'inject')
  })
})

describe('what is skipped, and why', () => {
  it('skips a disabled entry so its script cannot load', async () => {
    const fixture = fakeContext({
      plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: false }],
      files: { '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { assets: ['/a.js'] } } }) },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    assert.deepEqual(service.rows(), [])
    assert.deepEqual(service.plugins(), [{ id: 'a', disposition: 'skipped-disabled' }])
  })

  it('records an unresolved package directory', async () => {
    const fixture = fakeContext({
      plugins: [{ entryId: 'x', moduleName: 'broken-layout', enabled: true }],
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    assert.deepEqual(service.issues().map((issue) => issue.code), [ASSET_PROXY_CODES.PLUGIN_PACKAGE_UNRESOLVED])
    assert.deepEqual(service.plugins(), [{ id: 'x', disposition: 'skipped-unresolved' }])
  })

  it('records an unreadable manifest', async () => {
    const fixture = fakeContext({ plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: true }] })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    assert.deepEqual(service.issues().map((issue) => issue.code), [ASSET_PROXY_CODES.PLUGIN_MANIFEST_UNREADABLE])
    assert.equal(service.errors()[0].stage, 'read')
  })

  it('records malformed JSON without quoting the manifest', async () => {
    const fixture = fakeContext({
      plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: true }],
      files: { '/pkgs/plugin-a/package.json': '{ "dsh": ' },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    const issue = service.issues()[0]
    assert.equal(issue.code, ASSET_PROXY_CODES.PLUGIN_MANIFEST_NOT_JSON)
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'id'])
  })

  it('separates "declared nothing" from "declared nothing valid"', async () => {
    const fixture = fakeContext({
      plugins: [
        { entryId: 'none', moduleName: 'plugin-none', enabled: true },
        { entryId: 'bad', moduleName: 'plugin-bad', enabled: true },
      ],
      files: {
        '/pkgs/plugin-none/package.json': JSON.stringify({ dsh: { client: { platform: 'web' } } }),
        '/pkgs/plugin-bad/package.json': JSON.stringify({ dsh: { client: { assets: ['https://cdn/a.js'] } } }),
      },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    assert.deepEqual(service.plugins(), [
      { id: 'bad', disposition: 'declared-nothing-valid' },
      { id: 'none', disposition: 'declared-nothing' },
    ])
    const assetIssue = service.issues().find((issue) => issue.code === ASSET_PROXY_CODES.ASSET_ISSUE)
    assert.equal(assetIssue.code, ASSET_PROXY_CODES.ASSET_ISSUE)
    assert.equal(assetIssue.id, 'bad')
  })

  it('reports a cross-plugin duplicate once, as an issue', async () => {
    const fixture = fakeContext({
      plugins: [
        { entryId: 'a', moduleName: 'plugin-a', enabled: true },
        { entryId: 'b', moduleName: 'plugin-b', enabled: true },
      ],
      files: {
        '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { assets: ['/shared.js'] } } }),
        '/pkgs/plugin-b/package.json': JSON.stringify({ dsh: { client: { assets: ['/shared.js'] } } }),
      },
    })
    const service = createAssetProxy(fixture.ctx, options(fixture))
    await settle(service)
    assert.equal(service.rows().length, 1)
    const duplicates = service.issues().filter((issue) => issue.code === ASSET_PROXY_CODES.ASSET_ISSUE && issue.src === '/shared.js')
    assert.equal(duplicates.length, 1)
  })
})

describe('a failed inventory read keeps the previous rows', () => {
  it('does not blank the page on a transient error', async () => {
    let fail = false
    const fixture = fakeContext({
      plugins: [{ entryId: 'a', moduleName: 'plugin-a', enabled: true }],
      files: { '/pkgs/plugin-a/package.json': JSON.stringify({ dsh: { client: { assets: ['/a.js'] } } }) },
    })
    const service = createAssetProxy(fixture.ctx, {
      ...options(fixture),
      listPlugins: () => (fail ? Promise.reject(new Error('inventory down')) : Promise.resolve(fixture.plugins)),
    })
    await settle(service)
    assert.equal(service.rows().length, 1)
    fail = true
    await settle(service)
    assert.equal(service.rows().length, 1)
    assert.deepEqual(service.issues().map((issue) => issue.code), [ASSET_PROXY_CODES.INVENTORY_READ_FAILED])
  })

  it('reports an unavailable plugin manager service', async () => {
    const ctx = fakeContext().ctx
    const service = createAssetProxy(ctx, {})
    const summary = await service.refresh()
    assert.equal(summary.ok, false)
    assert.equal(service.errors()[0].stage, 'inventory')
  })
})

describe('refresh is single flight', () => {
  it('shares one inventory read across concurrent triggers', async () => {
    let reads = 0
    const fixture = fakeContext({ plugins: [] })
    const service = createAssetProxy(fixture.ctx, {
      ...options(fixture),
      listPlugins: () => {
        reads += 1
        return new Promise((resolve) => setTimeout(() => resolve([]), 5))
      },
    })
    await Promise.all([service.refresh(), service.refresh(), service.refresh()])
    assert.equal(reads, 1)
  })
})

describe('detach is idempotent and stops work', () => {
  it('removes both listeners once and reports disposed', () => {
    const fixture = fakeContext()
    const service = createAssetProxy(fixture.ctx, options(fixture))
    service.attach()
    service.detach()
    service.detach()
    assert.equal(fixture.listenerCount('webserver/index-inject'), 0)
    assert.equal(fixture.listenerCount('plugin-manager/changed'), 0)
    assert.equal(service.state().disposed, true)
  })

  it('ignores an inject after detach', () => {
    const fixture = fakeContext()
    const service = createAssetProxy(fixture.ctx, options(fixture))
    service.attach()
    service.detach()
    const table = []
    service.inject(table)
    assert.deepEqual(table, [])
  })
})

describe('the plugin entry', () => {
  it('is named, injects the two services it uses, and publishes the service', async () => {
    assert.equal(pluginName, 'dsh-compat-asset-proxy')
    const fixture = fakeContext({
      services: {
        webServer: { register: () => () => {} },
        pluginManager: { listPlugins: () => Promise.resolve([]) },
      },
    })
    const service = apply(fixture.ctx, undefined)
    assert.equal(fixture.ctx.provided.get(SERVICE_NAME), service)
    assert.equal(typeof service.attach, 'function')
    service.detach()
  })

  it('refuses a config with an unknown key and a bad placement', () => {
    const fixture = fakeContext()
    assert.throws(() => apply(fixture.ctx, { nope: true }), /unknown key: nope/)
    assert.throws(() => apply(fixture.ctx, { scriptPlacement: 'middle' }), /scriptPlacement/)
  })

  it('refuses a second instance in the same scope', () => {
    const fixture = fakeContext()
    apply(fixture.ctx, {})
    assert.throws(() => apply(fixture.ctx, {}), /already provided/)
  })
})

describe('package resolution', () => {
  it('refuses an empty module name', () => {
    assert.deepEqual(resolvePackageJson('', ['/tmp']), { ok: false, reason: 'module-name-missing' })
  })

  it('returns unresolved rather than throwing for a name nothing provides', () => {
    const result = resolvePackageJson('definitely-not-a-real-package-xyz', ['/tmp'])
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unresolved')
  })

  it('resolves a real package manifest through the module name', () => {
    // `yaml` is the analyzer package's dependency and is present on this machine;
    // resolving it proves the two-attempt strategy finds a real manifest.
    const result = resolvePackageJson('yaml', ['/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer'])
    assert.equal(result.ok, true)
    assert.ok(result.path.endsWith('package.json'))
  })
})
