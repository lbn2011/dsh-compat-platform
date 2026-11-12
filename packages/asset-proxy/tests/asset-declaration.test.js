import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSET_DECLARATION_CODES,
  ASSET_DECLARATION_LIMITATIONS,
  ASSET_DECLARATION_VERSION,
  ASSET_KINDS,
  ASSET_LIMITS,
  kindFromExtension,
  readAssetDeclaration,
  readAssetPath,
} from '../src/asset-declaration.js'

/** Wrap assets in the manifest nesting the reader expects. */
function manifest(client) {
  return { name: 'example', dsh: { client } }
}

describe('the declaration vocabulary is closed', () => {
  it('names the two kinds it injects', () => {
    assert.deepEqual([...ASSET_KINDS], ['script', 'style'])
  })

  it('exposes one version and frozen limitations', () => {
    assert.equal(ASSET_DECLARATION_VERSION, 'asset-declaration/0.1-draft.1')
    assert.ok(Object.isFrozen(ASSET_DECLARATION_LIMITATIONS))
    assert.ok(ASSET_DECLARATION_LIMITATIONS.includes('ASSETS_FIELD_IS_A_PROPOSED_EXTENSION_NOT_A_HOST_FEATURE'))
  })

  it('keeps every code reachable from the frozen map', () => {
    for (const [key, value] of Object.entries(ASSET_DECLARATION_CODES)) {
      assert.equal(key, value)
    }
  })
})

describe('a manifest without an assets member declares nothing', () => {
  it('returns present=false and no issues', () => {
    const result = readAssetDeclaration(manifest({ platform: 'web' }))
    assert.equal(result.present, false)
    assert.deepEqual(result.assets, [])
    assert.deepEqual(result.issues, [])
  })

  it('treats a manifest with no dsh block the same way', () => {
    const result = readAssetDeclaration({ name: 'example' })
    assert.equal(result.present, false)
    assert.deepEqual(result.issues, [])
  })

  it('treats a non-object manifest as declaring nothing rather than as a defect', () => {
    assert.equal(readAssetDeclaration(null).present, false)
    assert.equal(readAssetDeclaration('nope').present, false)
    assert.deepEqual(readAssetDeclaration([]).issues, [])
  })
})

describe('the bare array form is classified by extension', () => {
  it('accepts scripts and styles in declaration order', () => {
    const result = readAssetDeclaration(manifest({
      platform: 'web',
      assets: ['/assets/a.js', '/assets/b.css', '/assets/c.mjs'],
    }))
    assert.equal(result.present, true)
    assert.deepEqual(result.assets.map((asset) => [asset.kind, asset.src]), [
      ['script', '/assets/a.js'],
      ['style', '/assets/b.css'],
      ['script', '/assets/c.mjs'],
    ])
    assert.deepEqual(result.issues, [])
  })

  it('reports an unknown extension instead of guessing a kind', () => {
    const result = readAssetDeclaration(manifest({ platform: 'web', assets: ['/assets/a.woff2'] }))
    assert.deepEqual(result.assets, [])
    assert.deepEqual(result.issues.map((issue) => issue.code), [ASSET_DECLARATION_CODES.ASSET_EXTENSION_UNKNOWN])
  })
})

describe('the object form names its kinds', () => {
  it('reads scripts then styles', () => {
    const result = readAssetDeclaration(manifest({
      platform: 'web',
      assets: { scripts: ['/a.js'], styles: ['/b.css'] },
    }))
    assert.deepEqual(result.assets.map((asset) => [asset.field, asset.index, asset.kind]), [
      ['assets.scripts', 0, 'script'],
      ['assets.styles', 0, 'style'],
    ])
  })

  it('does not require the extension to match the named kind', () => {
    // A bundle URL without an extension is legal when the declaring key says what
    // it is; the extension rule only classifies the kind-less array form.
    const result = readAssetDeclaration(manifest({ platform: 'web', assets: { scripts: ['/boot'] } }))
    assert.deepEqual(result.assets.map((asset) => [asset.kind, asset.src]), [['script', '/boot']])
  })

  it('reports an unknown key', () => {
    const result = readAssetDeclaration(manifest({ platform: 'web', assets: { script: ['/a.js'] } }))
    assert.deepEqual(result.issues.map((issue) => [issue.code, issue.field]), [
      [ASSET_DECLARATION_CODES.ASSETS_UNKNOWN_KEY, 'assets.script'],
    ])
    assert.deepEqual(result.assets, [])
  })

  it('reports a member that is not an array', () => {
    const result = readAssetDeclaration(manifest({ platform: 'web', assets: { scripts: '/a.js' } }))
    assert.deepEqual(result.issues.map((issue) => issue.code), [ASSET_DECLARATION_CODES.ASSETS_LIST_NOT_ARRAY])
  })

  it('one bad entry does not discard the good ones', () => {
    const result = readAssetDeclaration(manifest({
      platform: 'web',
      assets: { scripts: ['/good.js', 42, '/also-good.js'] },
    }))
    assert.deepEqual(result.assets.map((asset) => asset.src), ['/good.js', '/also-good.js'])
    assert.deepEqual(result.issues.map((issue) => [issue.code, issue.index]), [
      [ASSET_DECLARATION_CODES.ASSET_NOT_STRING, 1],
    ])
  })
})

describe('the path fence refuses what it must', () => {
  it('refuses a scheme before complaining about the missing slash', () => {
    for (const value of ['https://cdn.example/a.js', 'data:text/javascript,1', 'javascript:alert(1)']) {
      assert.deepEqual(readAssetPath(value, 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_SCHEME_NOT_ALLOWED)
    }
  })

  it('refuses a protocol-relative path', () => {
    assert.equal(readAssetPath('//cdn.example/a.js', 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_PROTOCOL_RELATIVE)
  })

  it('refuses a relative path', () => {
    assert.equal(readAssetPath('assets/a.js', 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_NOT_ROOT_RELATIVE)
  })

  it('refuses a control character', () => {
    assert.equal(readAssetPath('/a\u0000.js', 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_CONTROL_CHARACTER)
  })

  it('refuses characters that could break out of the attribute', () => {
    for (const value of ['/a"b.js', "/a'b.js", '/a<b.js', '/a>b.js', '/a`b.js', '/a\\b.js']) {
      assert.equal(readAssetPath(value, 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_UNSAFE_CHARACTER, value)
    }
  })

  it('refuses an empty, over-long, or non-string path', () => {
    assert.equal(readAssetPath('', 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_EMPTY)
    assert.equal(readAssetPath(7, 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_NOT_STRING)
    const long = `/${'a'.repeat(ASSET_LIMITS.maxAssetPathLength)}`
    assert.equal(readAssetPath(long, 'assets', 0).issue.code, ASSET_DECLARATION_CODES.ASSET_TOO_LONG)
  })

  it('accepts a root-relative path with a query string', () => {
    assert.deepEqual(readAssetPath('/a.js?v=2', 'assets', 3), { src: '/a.js?v=2', issue: null })
  })
})

describe('per-plugin ceiling', () => {
  it('reports the ceiling once and stops reading', () => {
    const assets = Array.from({ length: ASSET_LIMITS.maxAssetsPerPlugin + 5 }, (_, index) => `/a${index}.js`)
    const result = readAssetDeclaration(manifest({ platform: 'web', assets }))
    assert.equal(result.assets.length, ASSET_LIMITS.maxAssetsPerPlugin)
    const limits = result.issues.filter((issue) => issue.code === ASSET_DECLARATION_CODES.ASSET_LIMIT_EXCEEDED)
    assert.equal(limits.length, 1)
    assert.equal(limits[0].index, ASSET_LIMITS.maxAssetsPerPlugin)
  })
})

describe('kind classification', () => {
  it('reads the extension before the query string', () => {
    assert.equal(kindFromExtension('/a.js?x=.css'), 'script')
    assert.equal(kindFromExtension('/a.CSS'), 'style')
    assert.equal(kindFromExtension('/a.txt'), null)
  })
})
