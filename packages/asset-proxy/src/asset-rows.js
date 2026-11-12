/**
 * Turn validated asset declarations into `IndexInjection[]` rows.
 *
 * WHY ROWS AND NOT HTML STRINGS: the host's `webserver/index-inject` event hands
 * every listener the same `IndexInjection[]` table, and two renderers consume
 * it — the served form renders rows into `index.html`
 * (`renderIndexInjections`), and a static worker deployment ships the same rows
 * as JSON for a page-side interpreter. A plugin that pushed raw HTML would only
 * work on the served path, and its markup would be trusted markup.
 *
 * THE SIX ROW KINDS ARE ALL THERE IS: `global`, `script`, `script-src`,
 * `script-preload`, `style`, `html`. There is NO stylesheet row, so a `<link>`
 * has to be expressed as an `html` fragment. That is the only reason this
 * module builds markup, and the href it interpolates has already passed the
 * declaration gate (root-relative, no scheme, no quote or angle bracket); the
 * escaping below is a second fence, not the first.
 *
 * ORDER IS LOAD-BEARING: `script-src` rows execute in table order, so the rows
 * are sorted by plugin id and then by declaration index. Two identical
 * `kind|src` rows would load twice — a doubled side effect, not a doubled
 * declaration — so a repeated source is emitted once and reported.
 */

/** Version of this row builder, for records. */
export const ASSET_ROWS_VERSION = 'asset-rows/0.1-draft.1'

/** Where script rows land. Styles always land in the head. */
export const SCRIPT_PLACEMENTS = Object.freeze(['head', 'body'])
export const DEFAULT_SCRIPT_PLACEMENT = 'head'

/** Report codes for the row builder. */
export const ASSET_ROWS_CODES = Object.freeze({
  DUPLICATE_ASSET_EMITTED_ONCE: 'DUPLICATE_ASSET_EMITTED_ONCE',
})

/** What a caller may not infer from a rendered row. */
export const ASSET_ROWS_LIMITATIONS = Object.freeze([
  'ROW_ORDER_IS_PLUGIN_ID_ORDER_NOT_INSTALL_ORDER',
  'A_RENDERED_ROW_DOES_NOT_PROVE_THE_ASSET_EXISTS_OR_LOADS',
  'INLINE_SCRIPT_AND_STYLE_TEXT_IS_NEVER_EMITTED_BY_THIS_PLUGIN',
])

const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
})

/**
 * Escape text for use inside a double-quoted HTML attribute.
 *
 * @param {string} value - Text to escape.
 * @returns {string} Escaped text.
 */
export function escapeAttribute(value) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

/**
 * Build the row a single asset contributes.
 *
 * @param {{ kind: string, src: string }} asset - Validated asset.
 * @param {{ scriptPlacement?: string }} [options] - Placement for script rows.
 * @returns {object} One `IndexInjection` row.
 */
export function rowForAsset(asset, options = {}) {
  const scriptPlacement = options.scriptPlacement ?? DEFAULT_SCRIPT_PLACEMENT
  if (asset.kind === 'script') {
    // `script-src` is an EXTERNAL classic script: the host renders a
    // parser-blocking `<script src>` on the served path and an awaited
    // fetch-and-execute on the worker path. Inline text is never used, because a
    // declaration names a path, not code.
    return { kind: 'script-src', placement: scriptPlacement, src: asset.src }
  }
  // No stylesheet row kind exists, so the link is an `html` fragment. Self-closing
  // is omitted on purpose: the host renders this into an HTML document, not XHTML.
  return {
    kind: 'html',
    placement: 'head',
    html: `<link rel="stylesheet" href="${escapeAttribute(asset.src)}">`,
  }
}

/**
 * Collect rows for every plugin's declaration.
 *
 * @param {Array<{ id: string, assets: ReadonlyArray<{kind: string, src: string}> }>} plugins - Declarations, one entry per plugin.
 * @param {{ scriptPlacement?: string }} [options] - Placement for script rows.
 * @returns {{ rows: object[], duplicates: string[], limitations: readonly string[] }} Rows in load order, plus repeats that were dropped.
 */
export function collectRows(plugins, options = {}) {
  const ordered = [...plugins].sort((left, right) => compareText(left.id, right.id))
  const seen = new Set()
  const duplicates = []
  const rows = []
  for (const plugin of ordered) {
    for (const asset of plugin.assets) {
      const key = `${asset.kind}\u0000${asset.src}`
      if (seen.has(key)) {
        duplicates.push(asset.src)
        continue
      }
      seen.add(key)
      rows.push(rowForAsset(asset, options))
    }
  }
  return { rows, duplicates, limitations: ASSET_ROWS_LIMITATIONS }
}

/**
 * Compare two strings by UTF-16 code unit.
 *
 * `localeCompare` would make the injected order depend on the host locale, and
 * the order decides script execution order.
 *
 * @param {string} left - First string.
 * @param {string} right - Second string.
 * @returns {number} Negative, zero, or positive.
 */
export function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
