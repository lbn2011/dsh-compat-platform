/**
 * dsh-compat asset proxy — inject declared plugin assets into the boot page.
 *
 * THE EVENT IS THE TRIGGER, NOT THE DATA. `webserver/index-inject` is emitted
 * synchronously on every index render and every worker boot-payload request,
 * with the signature
 * `'webserver/index-inject'(table: IndexInjection[], peer: PeerScope): void`.
 * A listener pushes its CURRENT rows; the payload carries nothing about plugins.
 * Reading every installed `package.json` inside that emit would put filesystem
 * I/O on the render path, so this service keeps a warmed cache and pushes rows
 * from it. When the cache is cold the page renders without our rows and a
 * limitation records that fact — a late row is better than a slow index.
 *
 * WHAT WARMS IT: `plugin-manager/changed` (any install, removal, or enablement
 * change) schedules a single-flight refresh. The refresh lists plugins through
 * `pluginManager.listPlugins()`, resolves each enabled entry's package
 * directory, and reads `dsh.client.assets`.
 *
 * WHY THE PACKAGE DIRECTORY IS RESOLVED FROM THE MODULE NAME: `PluginInfo`
 * carries `entryId`, `moduleName`, `meta`, `enabled`, `fiberPhase`, and
 * `diagnostic` — the parsed manifest's `dsh.client` block is not in it, and
 * `meta` holds display fields only. So the declaration has to be read from disk,
 * and the only bridge from a plugin to its files is its module name.
 *
 * WHAT THIS PLUGIN DOES NOT DO: it emits no CSP header, does not verify that a
 * declared asset exists, never reads asset content, and does not differentiate
 * peers (`PeerScope`) because a declared asset list is static. Those are stated
 * as limitations, not glossed over.
 */

import { readFile as readFileCallback } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ASSET_DECLARATION_LIMITATIONS, readAssetDeclaration } from './asset-declaration.js'
import {
  ASSET_ROWS_CODES,
  ASSET_ROWS_LIMITATIONS,
  collectRows,
  DEFAULT_SCRIPT_PLACEMENT,
} from './asset-rows.js'

/** Service version, for records. */
export const ASSET_PROXY_VERSION = 'asset-proxy/0.1-draft.1'

/** Events this service emits, all under its own namespace. */
export const ASSET_PROXY_EVENTS = Object.freeze({
  CHANGED: 'dsh-compat/assets-changed',
})

/** The host signals this service reads. */
export const ASSET_PROXY_SIGNALS = Object.freeze(['plugin-manager/changed', 'webserver/index-inject'])

/** Codes for facts the proxy itself encounters, beyond per-declaration issues. */
export const ASSET_PROXY_CODES = Object.freeze({
  PLUGIN_PACKAGE_UNRESOLVED: 'PLUGIN_PACKAGE_UNRESOLVED',
  PLUGIN_MANIFEST_UNREADABLE: 'PLUGIN_MANIFEST_UNREADABLE',
  PLUGIN_MANIFEST_NOT_JSON: 'PLUGIN_MANIFEST_NOT_JSON',
  PLUGIN_MANIFEST_NOT_OBJECT: 'PLUGIN_MANIFEST_NOT_OBJECT',
  PLUGIN_INVENTORY_UNAVAILABLE: 'PLUGIN_INVENTORY_UNAVAILABLE',
  INVENTORY_READ_FAILED: 'INVENTORY_READ_FAILED',
  CACHE_COLD_AT_FIRST_INJECT: 'CACHE_COLD_AT_FIRST_INJECT',
  ASSET_ISSUE: 'ASSET_ISSUE',
})

/** What a caller must not infer from a warm cache. */
export const ASSET_PROXY_LIMITATIONS = Object.freeze([
  'ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE',
  'ROWS_COME_FROM_A_CACHE_WARMED_BY_PLUGIN_CHANGES',
  'PLUGIN_PACKAGE_DIRECTORIES_ARE_RESOLVED_FROM_MODULE_NAMES',
  'NO_CSP_HEADER_IS_EMITTED_BY_THIS_PLUGIN',
  'PEER_SCOPE_IS_IGNORED_BECAUSE_A_DECLARED_ASSET_LIST_IS_STATIC',
  'ASSET_EXISTENCE_AND_CONTENT_ARE_NEVER_CHECKED',
])

const OPTION_KEYS = Object.freeze([
  'scriptPlacement',
  'prepend',
  'maxPlugins',
  'listPlugins',
  'readFile',
  'resolvePackageJson',
  'baseDirs',
])

/** Default ceiling on plugins inspected per refresh. */
export const DEFAULT_MAX_PLUGINS = 500

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a Cordis service without assuming it exists.
 *
 * An undeclared service is not a safe property read: the context proxy throws
 * for unknown keys. Every service this plugin touches goes through here, so a
 * composition without `pluginManager` degrades to "inventory unavailable"
 * instead of failing the plugin.
 *
 * @param {object} ctx - Composition context.
 * @param {string} name - Service name.
 * @returns {object|null} The service, or null.
 */
function resolveService(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try {
      const service = ctx.get(name)
      if (service !== undefined && service !== null) return service
    } catch {
      // Fall through to the guarded property read.
    }
  }
  try {
    const service = ctx?.[name]
    return service === undefined ? null : service
  } catch {
    return null
  }
}

/**
 * Resolve a module's `package.json` from its specifier.
 *
 * Two attempts, because `exports` may not expose `./package.json`: first ask for
 * the manifest directly, then resolve the module entry and walk up to the
 * nearest directory that holds a manifest. Bounded depth, and every failure is
 * a null rather than an exception — a plugin whose layout we cannot read simply
 * contributes no rows.
 *
 * @param {string} moduleName - Module specifier from the inventory.
 * @param {string[]} baseDirs - Directories to resolve from.
 * @returns {{ ok: boolean, path?: string, reason?: string }} The result.
 */
export function resolvePackageJson(moduleName, baseDirs) {
  if (typeof moduleName !== 'string' || moduleName === '') {
    return { ok: false, reason: 'module-name-missing' }
  }
  for (const baseDir of baseDirs) {
    if (typeof baseDir !== 'string' || baseDir === '') continue
    let requireFrom
    try {
      requireFrom = createRequire(pathToFileURL(join(baseDir, 'index.js')))
    } catch {
      continue
    }
    try {
      return { ok: true, path: requireFrom.resolve(`${moduleName}/package.json`) }
    } catch {
      // The package may not export its manifest; try the entry walk below.
    }
    try {
      const entry = requireFrom.resolve(moduleName)
      let directory = dirname(entry)
      for (let depth = 0; depth < 8; depth += 1) {
        try {
          requireFrom.resolve(join(directory, 'package.json'))
          return { ok: true, path: join(directory, 'package.json') }
        } catch {
          const parent = dirname(directory)
          if (parent === directory) break
          directory = parent
        }
      }
    } catch {
      // Unresolvable from this base; the next base may still work.
    }
  }
  return { ok: false, reason: 'unresolved' }
}

function readPositiveInteger(value, field, fallback) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`asset-proxy: option.${field} must be a positive integer`)
  }
  return value
}

/**
 * Validate the proxy options.
 *
 * @param {unknown} options - Raw options.
 * @returns {object} Resolved options.
 */
export function readAssetProxyOptions(options) {
  if (options === undefined) options = {}
  if (!isPlainRecord(options)) throw new TypeError('asset-proxy: options must be an object')
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`asset-proxy: options carry an unknown key: ${key}`)
    }
  }
  const scriptPlacement = options.scriptPlacement ?? DEFAULT_SCRIPT_PLACEMENT
  if (scriptPlacement !== 'head' && scriptPlacement !== 'body') {
    throw new TypeError('asset-proxy: option.scriptPlacement must be "head" or "body"')
  }
  if (options.prepend !== undefined && typeof options.prepend !== 'boolean') {
    throw new TypeError('asset-proxy: option.prepend must be a boolean')
  }
  for (const field of ['listPlugins', 'readFile', 'resolvePackageJson']) {
    if (options[field] !== undefined && typeof options[field] !== 'function') {
      throw new TypeError(`asset-proxy: option.${field} must be a function`)
    }
  }
  if (options.baseDirs !== undefined) {
    if (!Array.isArray(options.baseDirs) || options.baseDirs.some((dir) => typeof dir !== 'string')) {
      throw new TypeError('asset-proxy: option.baseDirs must be an array of strings')
    }
  }
  return {
    scriptPlacement,
    prepend: options.prepend === true,
    maxPlugins: readPositiveInteger(options.maxPlugins, 'maxPlugins', DEFAULT_MAX_PLUGINS),
    listPlugins: options.listPlugins ?? null,
    readFile: options.readFile ?? null,
    resolvePackageJson: options.resolvePackageJson ?? null,
    baseDirs: options.baseDirs ?? null,
  }
}

/**
 * Create the asset proxy service.
 *
 * @param {object} ctx - Composition context.
 * @param {object} [options] - See {@link readAssetProxyOptions}.
 * @returns {object} The service.
 */
export function createAssetProxy(ctx, options) {
  const settings = readAssetProxyOptions(options)
  const errors = []
  const issues = []
  const dispositions = []
  let rows = []
  let warmed = false
  let coldReported = false
  let disposed = false
  let inflight = null
  const disposers = []

  function recordError(stage, error) {
    errors.push({ stage, name: error?.name ?? 'Error', message: String(error?.message ?? error) })
  }

  function recordIssue(code, detail) {
    issues.push({ code, ...detail })
  }

  function readFile(path) {
    if (settings.readFile) return settings.readFile(path)
    return readFileCallback(path, 'utf8')
  }

  function listPlugins() {
    if (settings.listPlugins) return settings.listPlugins()
    const pluginManager = resolveService(ctx, 'pluginManager')
    if (!pluginManager || typeof pluginManager.listPlugins !== 'function') {
      return Promise.reject(new Error('plugin inventory is unavailable'))
    }
    return pluginManager.listPlugins()
  }

  function resolveFor(moduleName) {
    const resolver = settings.resolvePackageJson ?? resolvePackageJson
    const bases = settings.baseDirs ?? defaultBaseDirs()
    return resolver(moduleName, bases)
  }

  function defaultBaseDirs() {
    const bases = []
    try {
      const baseDir = ctx?.baseDir
      if (typeof baseDir === 'string' && baseDir !== '') bases.push(baseDir)
    } catch {
      // A context without baseDir is normal in tests.
    }
    bases.push(process.cwd())
    return bases
  }

  /**
   * Rebuild the cached row table.
   *
   * Single-flight: concurrent triggers share one inventory read, which is what
   * keeps a burst of install events from walking the inventory repeatedly.
   *
   * @returns {Promise<object>} A summary of what the refresh saw.
   */
  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      // A refresh replaces the inventory-derived view. The cold-cache report is
      // a fact about a render that already happened — dropping it here would
      // hide a miss the operator can no longer see, so it survives the reset.
      const coldReports = issues.filter((issue) => issue.code === ASSET_PROXY_CODES.CACHE_COLD_AT_FIRST_INJECT)
      issues.length = 0
      issues.push(...coldReports)
      dispositions.length = 0
      let inventory
      try {
        inventory = await listPlugins()
      } catch (error) {
        recordError('inventory', error)
        recordIssue(ASSET_PROXY_CODES.INVENTORY_READ_FAILED, {})
        // The previous rows stay: a failed read is not evidence that the assets
        // were removed, and dropping them would blank the page on a transient error.
        return { ok: false, plugins: 0, rows: rows.length, declared: 0 }
      }
      if (!Array.isArray(inventory)) {
        recordError('inventory', new TypeError('plugin inventory is not an array'))
        recordIssue(ASSET_PROXY_CODES.INVENTORY_READ_FAILED, {})
        return { ok: false, plugins: 0, rows: rows.length, declared: 0 }
      }
      const declarations = []
      let inspected = 0
      for (const plugin of inventory) {
        if (inspected >= settings.maxPlugins) break
        const id = typeof plugin?.entryId === 'string' ? plugin.entryId : null
        const moduleName = typeof plugin?.moduleName === 'string' ? plugin.moduleName : null
        // Disabled entries are skipped: their assets must not load, and a plugin
        // that will not run this session should not inject a boot script.
        if (plugin?.enabled === false) {
          dispositions.push({ id, disposition: 'skipped-disabled' })
          continue
        }
        if (id === null || moduleName === null) {
          recordIssue(ASSET_PROXY_CODES.PLUGIN_PACKAGE_UNRESOLVED, { id: id ?? 'unknown', reason: 'entry-missing-fields' })
          continue
        }
        inspected += 1
        const located = resolveFor(moduleName)
        if (!located.ok) {
          recordIssue(ASSET_PROXY_CODES.PLUGIN_PACKAGE_UNRESOLVED, { id, reason: located.reason })
          dispositions.push({ id, disposition: 'skipped-unresolved' })
          continue
        }
        let text
        try {
          text = await readFile(located.path)
        } catch (error) {
          recordError('read', error)
          recordIssue(ASSET_PROXY_CODES.PLUGIN_MANIFEST_UNREADABLE, { id })
          dispositions.push({ id, disposition: 'skipped-unreadable' })
          continue
        }
        let pkg
        try {
          pkg = JSON.parse(text)
        } catch {
          // The parse message may quote manifest text; the manifest is operator
          // content, so only the code crosses the boundary.
          recordIssue(ASSET_PROXY_CODES.PLUGIN_MANIFEST_NOT_JSON, { id })
          dispositions.push({ id, disposition: 'skipped-malformed' })
          continue
        }
        if (!isPlainRecord(pkg)) {
          recordIssue(ASSET_PROXY_CODES.PLUGIN_MANIFEST_NOT_OBJECT, { id })
          dispositions.push({ id, disposition: 'skipped-malformed' })
          continue
        }
        const declaration = readAssetDeclaration(pkg)
        for (const declarationIssue of declaration.issues) {
          // The declaration's own code goes in `reason`: `code` belongs to this
          // service's closed vocabulary, and one field cannot carry both.
          const { code: reason, ...rest } = declarationIssue
          recordIssue(ASSET_PROXY_CODES.ASSET_ISSUE, { id, reason, ...rest })
        }
        if (declaration.assets.length === 0) {
          dispositions.push({ id, disposition: declaration.present ? 'declared-nothing-valid' : 'declared-nothing' })
          continue
        }
        dispositions.push({ id, disposition: 'declared', assets: declaration.assets.length })
        declarations.push({ id, assets: declaration.assets })
      }
      const collected = collectRows(declarations, { scriptPlacement: settings.scriptPlacement })
      for (const duplicate of collected.duplicates) {
        recordIssue(ASSET_PROXY_CODES.ASSET_ISSUE, {
          id: 'duplicate',
          reason: ASSET_ROWS_CODES.DUPLICATE_ASSET_EMITTED_ONCE,
          src: duplicate,
        })
      }
      rows = collected.rows
      warmed = true
      const summary = { ok: true, plugins: inspected, rows: rows.length, declared: declarations.length }
      emit(ASSET_PROXY_EVENTS.CHANGED, summary)
      return summary
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  function emit(event, payload) {
    if (typeof ctx?.emit !== 'function') return
    try {
      ctx.emit(event, payload)
    } catch (error) {
      recordError('emit', error)
    }
  }

  function schedule() {
    if (disposed) return
    // Deliberately not awaited: the event that triggered this is synchronous and
    // its emitter must not wait on our filesystem reads.
    refresh().catch((error) => recordError('refresh', error))
  }

  function onIndexInject(table) {
    if (disposed) return
    if (!Array.isArray(table)) {
      recordError('inject', new TypeError('index injection table is not an array'))
      return
    }
    if (!warmed) {
      if (!coldReported) {
        // Honest about the miss: this page renders without our rows, and the
        // refresh is already scheduled so the NEXT render carries them.
        coldReported = true
        recordIssue(ASSET_PROXY_CODES.CACHE_COLD_AT_FIRST_INJECT, {})
        schedule()
      }
      return
    }
    if (rows.length === 0) return
    // `table.push` in the listener is the host's own idiom (see
    // dsh-client-modules and dsh-client-ui-theme).
    table.push(...rows)
  }

  function attach() {
    if (disposed) return
    const subscribe = (event, handler) => {
      try {
        const dispose = ctx.on(event, handler)
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        recordError('subscribe', error)
      }
    }
    subscribe('plugin-manager/changed', () => schedule())
    // `prepend: true` puts our rows ahead of earlier subscribers, which matters
    // when a declared asset has to load before another plugin's boot script.
    if (settings.prepend && typeof ctx.on === 'function') {
      try {
        const dispose = ctx.on('webserver/index-inject', onIndexInject, { prepend: true })
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        recordError('subscribe', error)
        subscribe('webserver/index-inject', onIndexInject)
      }
    } else {
      subscribe('webserver/index-inject', onIndexInject)
    }
    schedule()
  }

  function detach() {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        recordError('dispose', error)
      }
    }
  }

  return {
    version: ASSET_PROXY_VERSION,
    options: settings,
    attach,
    detach,
    refresh,
    inject: onIndexInject,
    rows: () => rows.map((row) => ({ ...row })),
    table: () => ({ rows: rows.length, warmed }),
    // Sorted by entry id: the inventory's order is a host detail, and a report
    // that reorders itself between reads is hard to diff.
    plugins: () => dispositions
      .map((entry) => ({ ...entry }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    issues: () => issues.map((entry) => ({ ...entry })),
    errors: () => errors.map((entry) => ({ ...entry })),
    limitations: () => [...ASSET_PROXY_LIMITATIONS, ...ASSET_DECLARATION_LIMITATIONS, ...ASSET_ROWS_LIMITATIONS],
    state: () => ({ version: ASSET_PROXY_VERSION, signals: ASSET_PROXY_SIGNALS, warmed, disposed, rows: rows.length }),
  }
}
