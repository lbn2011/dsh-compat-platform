import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSET_ROWS_CODES,
  ASSET_ROWS_LIMITATIONS,
  ASSET_ROWS_VERSION,
  collectRows,
  compareText,
  escapeAttribute,
  rowForAsset,
  SCRIPT_PLACEMENTS,
} from '../src/asset-rows.js'

describe('rows use the kinds the host actually has', () => {
  it('maps a script to script-src and never to inline text', () => {
    assert.deepEqual(rowForAsset({ kind: 'script', src: '/a.js' }), {
      kind: 'script-src',
      placement: 'head',
      src: '/a.js',
    })
  })

  it('honours the configured script placement', () => {
    assert.deepEqual(rowForAsset({ kind: 'script', src: '/a.js' }, { scriptPlacement: 'body' }), {
      kind: 'script-src',
      placement: 'body',
      src: '/a.js',
    })
    assert.deepEqual([...SCRIPT_PLACEMENTS], ['head', 'body'])
  })

  it('maps a style to an html link in the head, because no stylesheet row exists', () => {
    assert.deepEqual(rowForAsset({ kind: 'style', src: '/a.css' }), {
      kind: 'html',
      placement: 'head',
      html: '<link rel="stylesheet" href="/a.css">',
    })
  })

  it('always places the link in the head even when scripts go to the body', () => {
    const row = rowForAsset({ kind: 'style', src: '/a.css' }, { scriptPlacement: 'body' })
    assert.equal(row.placement, 'head')
  })
})

describe('the rendered attribute is escaped a second time', () => {
  it('escapes the five characters that matter in an attribute', () => {
    assert.equal(escapeAttribute('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })

  it('leaves a plain path untouched', () => {
    assert.equal(escapeAttribute('/assets/app.js'), '/assets/app.js')
  })
})

describe('order is load order', () => {
  it('sorts by plugin id, not by array position', () => {
    const result = collectRows([
      { id: 'zeta', assets: [{ kind: 'script', src: '/z.js' }] },
      { id: 'alpha', assets: [{ kind: 'script', src: '/a.js' }] },
    ])
    assert.deepEqual(result.rows.map((row) => row.src ?? row.html), ['/a.js', '/z.js'])
  })

  it('keeps a single plugin declaration order', () => {
    const result = collectRows([
      { id: 'one', assets: [{ kind: 'style', src: '/first.css' }, { kind: 'script', src: '/second.js' }] },
    ])
    assert.deepEqual(result.rows.map((row) => row.kind), ['html', 'script-src'])
  })

  it('compares by code unit so the host locale cannot reorder scripts', () => {
    assert.ok(compareText('A', 'a') < 0)
    assert.equal(compareText('same', 'same'), 0)
    assert.ok(compareText('b', 'a') > 0)
  })
})

describe('a repeated source loads once', () => {
  it('reports the duplicate and keeps the first row', () => {
    const result = collectRows([
      { id: 'alpha', assets: [{ kind: 'script', src: '/shared.js' }] },
      { id: 'beta', assets: [{ kind: 'script', src: '/shared.js' }] },
    ])
    assert.deepEqual(result.rows.map((row) => row.src), ['/shared.js'])
    assert.deepEqual(result.duplicates, ['/shared.js'])
  })

  it('does not treat the same path in two kinds as a duplicate', () => {
    const result = collectRows([
      { id: 'alpha', assets: [{ kind: 'script', src: '/same' }, { kind: 'style', src: '/same' }] },
    ])
    assert.equal(result.rows.length, 2)
    assert.deepEqual(result.duplicates, [])
  })
})

describe('the builder states its limits', () => {
  it('freezes a version, a code map, and its limitations', () => {
    assert.equal(ASSET_ROWS_VERSION, 'asset-rows/0.1-draft.1')
    assert.equal(ASSET_ROWS_CODES.DUPLICATE_ASSET_EMITTED_ONCE, 'DUPLICATE_ASSET_EMITTED_ONCE')
    assert.ok(Object.isFrozen(ASSET_ROWS_LIMITATIONS))
    assert.ok(ASSET_ROWS_LIMITATIONS.includes('A_RENDERED_ROW_DOES_NOT_PROVE_THE_ASSET_EXISTS_OR_LOADS'))
  })

  it('returns no rows for no plugins', () => {
    assert.deepEqual(collectRows([]), { rows: [], duplicates: [], limitations: ASSET_ROWS_LIMITATIONS })
  })
})
