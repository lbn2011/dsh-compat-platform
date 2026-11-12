/**
 * Read one plugin's `package.json` `dsh.client.assets` declaration.
 *
 * WHAT THIS FIELD IS: a PROPOSED extension, not an existing host capability.
 * The installed host's client manifest type (`DshClientManifest` in
 * `@deepseek-ai/dsh-package-manifest`) carries exactly `platform`, `inject`,
 * `immediately`, and `external`. No package in the installed host declares
 * `assets`; the only `assets` strings in `package.json` files are entries in
 * `files` arrays. So a plugin that declares `dsh.client.assets` is asking THIS
 * plugin to inject assets — the host itself reads nothing here, and dropping
 * this plugin removes the whole capability.
 *
 * THE SHAPE ACCEPTED: either a bare array of paths, or an object with `scripts`
 * and/or `styles` arrays. A bare path is classified by extension, because the
 * array form carries no kind.
 *
 * THE FENCE: every path must be same-origin and root-relative (`/…`). A scheme
 * (`https:`, `data:`, `javascript:`), a protocol-relative `//host/…`, a control
 * character, or a character that could break out of the attribute we render
 * (`"`, `'`, `<`, `>`, `` ` ``, `\`) is refused. The refusal is reported, never
 * silently dropped: a plugin author who wrote a full URL needs to know why
 * nothing was injected.
 *
 * WHY THIS IS A PURE FUNCTION: it takes a parsed manifest and returns a plan.
 * It reads no file, resolves no directory, and knows nothing about the host.
 */

/** Version of this declaration reader, for records. */
export const ASSET_DECLARATION_VERSION = 'asset-declaration/0.1-draft.1'

/** The two asset kinds this plugin knows how to inject. */
export const ASSET_KINDS = Object.freeze(['script', 'style'])

/** Bounds, chosen so one plugin cannot dominate the boot HTML. */
export const ASSET_LIMITS = Object.freeze({
  maxAssetsPerPlugin: 32,
  maxAssetPathLength: 2048,
})

/** Closed set of refusal/report codes. */
export const ASSET_DECLARATION_CODES = Object.freeze({
  ASSETS_NOT_ARRAY_OR_OBJECT: 'ASSETS_NOT_ARRAY_OR_OBJECT',
  ASSETS_UNKNOWN_KEY: 'ASSETS_UNKNOWN_KEY',
  ASSETS_LIST_NOT_ARRAY: 'ASSETS_LIST_NOT_ARRAY',
  ASSET_NOT_STRING: 'ASSET_NOT_STRING',
  ASSET_EMPTY: 'ASSET_EMPTY',
  ASSET_TOO_LONG: 'ASSET_TOO_LONG',
  ASSET_SCHEME_NOT_ALLOWED: 'ASSET_SCHEME_NOT_ALLOWED',
  ASSET_NOT_ROOT_RELATIVE: 'ASSET_NOT_ROOT_RELATIVE',
  ASSET_PROTOCOL_RELATIVE: 'ASSET_PROTOCOL_RELATIVE',
  ASSET_CONTROL_CHARACTER: 'ASSET_CONTROL_CHARACTER',
  ASSET_UNSAFE_CHARACTER: 'ASSET_UNSAFE_CHARACTER',
  ASSET_EXTENSION_UNKNOWN: 'ASSET_EXTENSION_UNKNOWN',
  ASSET_LIMIT_EXCEEDED: 'ASSET_LIMIT_EXCEEDED',
})

/** Facts a caller must carry alongside any injection built from a declaration. */
export const ASSET_DECLARATION_LIMITATIONS = Object.freeze([
  'ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE',
  'ASSET_EXISTENCE_IS_NOT_CHECKED_AT_DECLARATION_TIME',
  'ASSET_CONTENT_IS_NEVER_READ_OR_DIGESTED',
])

const CODES = ASSET_DECLARATION_CODES
const OBJECT_KEYS = Object.freeze(['scripts', 'styles'])

/** `scheme:` prefix, matched before the root-relative check so the reason is precise. */
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/
/** Characters that could terminate the attribute or element we render. */
const UNSAFE_PATTERN = /["'<>`\\]/
/** C0/C1 controls plus DEL. */
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(code, field, index) {
  const record = { code, field }
  if (typeof index === 'number') record.index = index
  return record
}

/**
 * Classify a bare path by its extension.
 *
 * @param {string} src - A validated root-relative path.
 * @returns {'script'|'style'|null} The kind, or null when the extension is unknown.
 */
export function kindFromExtension(src) {
  const path = src.split(/[?#]/, 1)[0].toLowerCase()
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'script'
  if (path.endsWith('.css')) return 'style'
  return null
}

/**
 * Validate one declared path.
 *
 * @param {unknown} value - Declared value.
 * @param {string} field - Which declaration member carried it (`assets`, `scripts`, `styles`).
 * @param {number} index - Position inside the declaring list.
 * @returns {{ src: string|null, issue: object|null }} The accepted path, or the refusal.
 */
export function readAssetPath(value, field, index) {
  if (typeof value !== 'string') return { src: null, issue: issue(CODES.ASSET_NOT_STRING, field, index) }
  if (value === '') return { src: null, issue: issue(CODES.ASSET_EMPTY, field, index) }
  if (value.length > ASSET_LIMITS.maxAssetPathLength) {
    return { src: null, issue: issue(CODES.ASSET_TOO_LONG, field, index) }
  }
  if (CONTROL_PATTERN.test(value)) {
    return { src: null, issue: issue(CODES.ASSET_CONTROL_CHARACTER, field, index) }
  }
  if (SCHEME_PATTERN.test(value)) {
    // Checked before the leading-slash rule so `https://…` reports "scheme", not
    // "not root-relative": a plugin author who pasted a CDN URL needs the real
    // reason. This is also the check that refuses `javascript:` and `data:`.
    return { src: null, issue: issue(CODES.ASSET_SCHEME_NOT_ALLOWED, field, index) }
  }
  if (value.startsWith('//')) {
    return { src: null, issue: issue(CODES.ASSET_PROTOCOL_RELATIVE, field, index) }
  }
  if (!value.startsWith('/')) {
    return { src: null, issue: issue(CODES.ASSET_NOT_ROOT_RELATIVE, field, index) }
  }
  if (UNSAFE_PATTERN.test(value)) {
    return { src: null, issue: issue(CODES.ASSET_UNSAFE_CHARACTER, field, index) }
  }
  return { src: value, issue: null }
}

function readList(state, list, field, kind) {
  if (!Array.isArray(list)) {
    state.issues.push(issue(CODES.ASSETS_LIST_NOT_ARRAY, field))
    return
  }
  for (let index = 0; index < list.length; index += 1) {
    if (state.assets.length >= ASSET_LIMITS.maxAssetsPerPlugin) {
      // One report for the ceiling, not one per remaining entry.
      state.issues.push(issue(CODES.ASSET_LIMIT_EXCEEDED, field, index))
      return
    }
    const { src, issue: refusal } = readAssetPath(list[index], field, index)
    if (refusal) {
      state.issues.push(refusal)
      continue
    }
    const resolvedKind = kind ?? kindFromExtension(src)
    if (resolvedKind === null) {
      state.issues.push(issue(CODES.ASSET_EXTENSION_UNKNOWN, field, index))
      continue
    }
    state.assets.push({ kind: resolvedKind, src, field, index })
  }
}

/**
 * Read `dsh.client.assets` out of a parsed `package.json`.
 *
 * A manifest with no `dsh`, no `dsh.client`, or no `assets` member declares no
 * assets — that is not a defect, so `present` is false and `issues` is empty.
 * Anything that IS declared is validated strictly, and one bad entry refuses
 * that entry while the rest still load: a single typo must not cost a plugin
 * every asset it declared.
 *
 * @param {unknown} pkg - Parsed `package.json`.
 * @returns {{ present: boolean, assets: Array<{kind: string, src: string, field: string, index: number}>, issues: object[], limitations: readonly string[] }} The plan.
 */
export function readAssetDeclaration(pkg) {
  const state = { present: false, assets: [], issues: [], limitations: ASSET_DECLARATION_LIMITATIONS }
  if (!isPlainRecord(pkg)) return state
  const dsh = pkg.dsh
  if (!isPlainRecord(dsh)) return state
  const client = dsh.client
  if (!isPlainRecord(client)) return state
  if (!Object.hasOwn(client, 'assets')) return state

  state.present = true
  const assets = client.assets
  if (Array.isArray(assets)) {
    readList(state, assets, 'assets', null)
    return state
  }
  if (!isPlainRecord(assets)) {
    state.issues.push(issue(CODES.ASSETS_NOT_ARRAY_OR_OBJECT, 'assets'))
    return state
  }
  for (const key of Object.keys(assets)) {
    if (!OBJECT_KEYS.includes(key)) {
      state.issues.push(issue(CODES.ASSETS_UNKNOWN_KEY, `assets.${key}`))
    }
  }
  if (Object.hasOwn(assets, 'scripts')) readList(state, assets.scripts, 'assets.scripts', 'script')
  if (Object.hasOwn(assets, 'styles')) readList(state, assets.styles, 'assets.styles', 'style')
  return state
}
