/**
 * dsh-compat-asset-proxy — Cordis plugin entry.
 *
 * A host plugin in the shapes the installed host uses: `name`, `inject`,
 * `apply(ctx, config)`. It publishes one service (`compatAssetProxy`) so a
 * composition can read the warm table, and it subscribes to
 * `webserver/index-inject` to push rows.
 *
 * `webServer` is injected because `webserver/index-inject` is the web carrier's
 * event: without a carrier, nothing renders an index and this plugin has no
 * work. `pluginManager` is injected because the declaration lives in each
 * installed package's manifest.
 */

import { ASSET_PROXY_VERSION, createAssetProxy, readAssetProxyOptions } from './asset-proxy.js'

/** Plugin name, as the host composition records it. */
export const name = 'dsh-compat-asset-proxy'

/** Services this plugin needs. */
export const inject = ['webServer', 'pluginManager']

/** The service name this plugin publishes. */
export const SERVICE_NAME = 'compatAssetProxy'

const CONFIG_KEYS = Object.freeze(['scriptPlacement', 'prepend', 'maxPlugins'])

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the plugin config.
 *
 * Only the three deployment-level knobs are configurable here; the injectable
 * seams (`listPlugins`, `readFile`, …) exist for tests and are deliberately not
 * reachable from a composition's config file.
 *
 * @param {unknown} config - Raw plugin config.
 * @returns {object} Options for {@link createAssetProxy}.
 */
export function readOptions(config) {
  if (config === undefined || config === null) return {}
  if (!isPlainRecord(config)) throw new TypeError(`${name}: config must be an object`)
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw new TypeError(`${name}: config carries an unknown key: ${key}`)
    }
  }
  const options = {}
  if (config.scriptPlacement !== undefined) options.scriptPlacement = config.scriptPlacement
  if (config.prepend !== undefined) options.prepend = config.prepend
  if (config.maxPlugins !== undefined) options.maxPlugins = config.maxPlugins
  // Validate once here so a bad config fails at load with a named field, not at
  // the first refresh with a stack trace.
  readAssetProxyOptions(options)
  return options
}

/**
 * Apply the plugin.
 *
 * @param {object} ctx - Composition context.
 * @param {unknown} [config] - `{ scriptPlacement?, prepend?, maxPlugins? }`.
 * @returns {object} The service, also published as `compatAssetProxy`.
 */
export function apply(ctx, config) {
  const service = createAssetProxy(ctx, readOptions(config))
  try {
    ctx.provide(SERVICE_NAME, service)
  } catch (error) {
    // A second instance in one scope is a real conflict; surfacing it is better
    // than silently running two proxies that both push rows.
    throw new TypeError(`${name}: ${SERVICE_NAME} is already provided`)
  }
  try {
    ctx.on('dispose', () => service.detach())
  } catch {
    // A context without disposable lifecycle still detaches with the process.
  }
  service.attach()
  return service
}

export { ASSET_PROXY_VERSION }
