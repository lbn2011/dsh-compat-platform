/**
 * dsh-compat-conflict-arbiter — Cordis plugin entry.
 *
 * A host plugin in the shapes the installed host uses: `name`, `inject`,
 * `apply(ctx, config)`. It subscribes to `internal/status`, reads each failed
 * entry's `dsh.conflicts` declaration, and applies the one remedy the installed
 * host exposes (`setPluginEnabled(entryId, false)`) when a plugin asks for it.
 *
 * `pluginManager` is injected because the inventory and the disable call are
 * both its API. Nothing else is: the arbiter never touches the web carrier, the
 * HMR service, or the loader.
 */

import { createConflictArbiter, readArbiterOptions } from './conflict-arbiter.js'

/** Plugin name, as the host composition records it. */
export const name = 'dsh-compat-conflict-arbiter'

/** Services this plugin needs. */
export const inject = ['pluginManager']

/** The service name this plugin publishes. */
export const SERVICE_NAME = 'compatConflictArbiter'

const CONFIG_KEYS = Object.freeze(['defaultStrategy', 'maxDecisions', 'selfEntryId'])

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the plugin config.
 *
 * The injectable seams (`listPlugins`, `readFile`, …) are for tests and are
 * deliberately not reachable from a composition's config file.
 *
 * @param {unknown} config - Raw plugin config.
 * @returns {object} Options for {@link createConflictArbiter}.
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
  for (const key of CONFIG_KEYS) {
    if (config[key] !== undefined) options[key] = config[key]
  }
  // Validate once here so a bad strategy fails at load with a named field rather
  // than at the first failure, when the composition is already unhealthy.
  readArbiterOptions(options)
  return options
}

/**
 * Apply the plugin.
 *
 * @param {object} ctx - Composition context.
 * @param {unknown} [config] - `{ defaultStrategy?, maxDecisions?, selfEntryId? }`.
 * @returns {object} The service, also published as `compatConflictArbiter`.
 */
export function apply(ctx, config) {
  const service = createConflictArbiter(ctx, readOptions(config))
  try {
    ctx.provide(SERVICE_NAME, service)
  } catch {
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
