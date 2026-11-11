/**
 * Tests for the read-only diagnostics host route.
 *
 * SCOPE: the plugin's own contract. A fake carrier records the two registrations
 * and hands requests to the real handlers, so these tests exercise the method and
 * authority fence, the bounded reader and the shape gate against real files on
 * disk. They do NOT boot the carrier, listen on a socket, or render the page in a
 * browser — that is the launcher's job and the record's non-claim.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ENVELOPE_BYTE_CEILING, checkEnvelopeShape, readEnvelope } from '../src/envelope.js'
import {
  DEFAULT_ENVELOPE_PATH,
  DEFAULT_PAGE_PATH,
  allowedAuthorities,
  apply,
  readOptions,
} from '../src/index.js'

const DIAGNOSE_VERSION = 'dsh-compat-diagnose/0.2-draft.1'

function clearEnvelope() {
  return {
    diagnoseVersion: DIAGNOSE_VERSION,
    certification: false,
    correlation: 'not-established',
    profile: {
      state: 'provided',
      source: { name: 'profile-input', path: 'profile.yml' },
      outcome: 'clear',
      issues: [],
      summary: { entries: 2 },
      entryDiagnostics: 0,
    },
    combinedReport: null,
    // One entry per source, in the fixed order. The page shows these, so the
    // fixture carries the words a one-source envelope really has: the profile lane
    // was read but its summary holds no baseline, and nothing else was named.
    provenance: [
      { source: 'profile-input', baselineState: 'not-reflected', commit: null, node: null },
      { source: 'static-input', baselineState: 'not-provided', commit: null, node: null },
      { source: 'runtime-input', baselineState: 'not-provided', commit: null, node: null },
      { source: 'admission-input', baselineState: 'not-provided', commit: null, node: null },
    ],
    nextSteps: [{ code: 'CORRELATION_NOT_ESTABLISHED', source: 'report', message: 'one source only' }],
    limitations: ['CORRELATION_NOT_ESTABLISHED'],
  }
}

async function envelopeFile(t, value) {
  const dir = await mkdtemp(join(tmpdir(), 'compat-gui-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'envelope.json')
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(file, text, 'utf8')
  return { dir, file, text }
}

function makeSink() {
  const state = { status: 0, headers: null, body: Buffer.alloc(0) }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers ?? null
    },
    end(chunk) {
      state.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? '', 'utf8')
    },
  }
}

function makeRequest({ method = 'GET', host = '127.0.0.1:41234', path = '/' } = {}) {
  const headers = host === null ? {} : { host }
  return { method, url: path, headers }
}

function makeCarrier({ host = '127.0.0.1', port = 41234 } = {}) {
  const routes = new Map()
  const effects = []
  const ctx = {
    webServer: {
      host,
      port,
      register(route) {
        if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect(callback, label) {
      const dispose = callback()
      effects.push({ label, dispose })
      return dispose
    },
  }
  return { ctx, routes, effects }
}

async function call(route, request) {
  const sink = makeSink()
  await route.handler(request, sink)
  return sink.state
}

function bodyText(state) {
  return state.body.toString('utf8')
}

test('readOptions applies defaults and resolves the envelope path', () => {
  const settings = readOptions({ envelopePath: 'envelope.json' })
  assert.equal(settings.pagePath, DEFAULT_PAGE_PATH)
  assert.equal(settings.envelopeRoutePath, DEFAULT_ENVELOPE_PATH)
  assert.ok(settings.envelopePath.startsWith('/'), 'resolved to an absolute path')
  assert.ok(settings.envelopePath.endsWith('/envelope.json'))
})

test('readOptions refuses a config that cannot name an envelope', () => {
  for (const bad of [undefined, null, [], 'x', {}, { envelopePath: '' }, { envelopePath: 7 }]) {
    assert.throws(() => readOptions(bad), TypeError)
  }
  assert.throws(() => readOptions({ envelopePath: 'a.json', pagePath: 'relative' }), TypeError)
  assert.throws(() => readOptions({ envelopePath: 'a.json', pagePath: '/p/' }), TypeError)
  assert.throws(
    () => readOptions({ envelopePath: 'a.json', pagePath: '/p', envelopeRoutePath: '/p' }),
    TypeError,
  )
})

test('apply registers exactly two exact routes and disposes them', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  assert.deepEqual([...carrier.routes.keys()], [DEFAULT_PAGE_PATH, DEFAULT_ENVELOPE_PATH])
  for (const route of carrier.routes.values()) assert.equal(route.kind, 'exact')
  assert.equal(carrier.effects.length, 1)
  assert.match(carrier.effects[0].label, /routes/)

  carrier.effects[0].dispose()
  assert.equal(carrier.routes.size, 0)
})

test('the JSON route serves the envelope file byte for byte', async (t) => {
  const fixture = clearEnvelope()
  const { file, text } = await envelopeFile(t, fixture)
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_ENVELOPE_PATH), makeRequest())
  assert.equal(state.status, 200)
  assert.equal(state.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(state.headers['cache-control'], 'no-store')
  assert.equal(bodyText(state), text, 'verbatim: no re-serialisation')
  assert.equal(
    state.headers['x-envelope-sha256'],
    createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
  )
})

test('the page route serves HTML that states the two literals before any data', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_PAGE_PATH), makeRequest())
  assert.equal(state.status, 200)
  assert.equal(state.headers['content-type'], 'text/html; charset=utf-8')
  const html = bodyText(state)
  assert.match(html, /certification: false/)
  assert.match(html, /correlation: not-established/)
  assert.match(html, new RegExp(DEFAULT_ENVELOPE_PATH.replace('/', '\\/')))
  // 2026-11-11: the page prose was translated to Chinese for this installation's
  // operator. The literals and codes stay verbatim; only the prose moved.
  assert.match(html, /\u4e0d\u5f97\u88ab\u5f15\u7528\u4e3a\u517c\u5bb9\u6027\u3001\u53ef\u52a0\u8f7d\u6027\u6216\u8ba4\u8bc1\u7ed3\u8bba/)
  // The page must not re-run analysis or embed a second data source.
  assert.doesNotMatch(html, /child_process|spawn|execFile/)
})

test('the page carries a baseline section and explains every word it may print', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_PAGE_PATH), makeRequest())
  const html = bodyText(state)
  // Static furniture: the heading and the sentence that stops "not-reflected" from
  // being read as "this document had no baseline".
  assert.match(html, /\u5404\u6765\u6e90\u7684\u57fa\u7ebf/)
  assert.match(html, /\u8fd9\u7edd\u4e0d\u8868\u793a\u90a3\u4efd\u6587\u6863\u6ca1\u6709\u57fa\u7ebf/)
  // The two other words a one-source envelope cannot show are explained too, so a
  // reader who never opens the JSON still learns what each word excludes.
  assert.match(html, /\u6b64\u6765\u6e90\u672a\u6307\u5b9a\u4efb\u4f55\u6587\u6863/)
  assert.match(html, /\u6587\u6863\u5df2\u6307\u5b9a\uff0c\u4f46\u672a\u4ea7\u51fa\u53ef\u7528\u7ed3\u679c/)
})

test('both routes refuse methods other than GET and HEAD', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  for (const path of [DEFAULT_PAGE_PATH, DEFAULT_ENVELOPE_PATH]) {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const state = await call(carrier.routes.get(path), makeRequest({ method }))
      assert.equal(state.status, 405, `${method} ${path}`)
      assert.equal(state.headers.allow, 'GET, HEAD')
      assert.equal(JSON.parse(bodyText(state)).code, 'METHOD_NOT_ALLOWED')
    }
  }
})

test('both routes refuse a foreign or missing Host authority', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  for (const path of [DEFAULT_PAGE_PATH, DEFAULT_ENVELOPE_PATH]) {
    for (const host of ['example.test:41234', '127.0.0.1:3080', '127.0.0.1', null]) {
      const state = await call(carrier.routes.get(path), makeRequest({ host }))
      assert.equal(state.status, 403, `${path} host=${String(host)}`)
      assert.equal(JSON.parse(bodyText(state)).code, 'HOST_NOT_ALLOWED')
    }
  }
})

test('allowedAuthorities covers the bind address and the localhost name only', () => {
  // The bind authority always, plus `localhost` for a loopback bind. The other
  // loopback LITERAL is not admitted: the carrier does not listen on it, so a
  // request naming it cannot arrive here.
  assert.deepEqual(
    [...allowedAuthorities('127.0.0.1', 41234)].sort(),
    ['127.0.0.1:41234', 'localhost:41234'].sort(),
  )
  assert.deepEqual(
    [...allowedAuthorities('::1', 41234)].sort(),
    ['[::1]:41234', 'localhost:41234'].sort(),
  )
  assert.deepEqual([...allowedAuthorities('10.0.0.7', 41234)], ['10.0.0.7:41234'])
})

test('a missing envelope is refused on both routes with a closed reason', async (t) => {
  const { dir } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: join(dir, 'absent.json') })

  for (const path of [DEFAULT_PAGE_PATH, DEFAULT_ENVELOPE_PATH]) {
    const state = await call(carrier.routes.get(path), makeRequest())
    assert.equal(state.status, 503)
    assert.equal(state.headers['content-type'], 'application/json; charset=utf-8')
    assert.deepEqual(JSON.parse(bodyText(state)), {
      code: 'ENVELOPE_UNREADABLE',
      reason: 'ENVELOPE_MISSING',
    })
  }
})

test('a non-JSON envelope is refused, not rendered', async (t) => {
  const { file } = await envelopeFile(t, 'not json at all\n')
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_PAGE_PATH), makeRequest())
  assert.equal(state.status, 503)
  assert.equal(JSON.parse(bodyText(state)).reason, 'ENVELOPE_NOT_JSON')
})

test('a document that drops the certification literal is refused by field name', async (t) => {
  const fixture = clearEnvelope()
  fixture.certification = true
  const { file } = await envelopeFile(t, fixture)
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_ENVELOPE_PATH), makeRequest())
  assert.equal(state.status, 503)
  assert.deepEqual(JSON.parse(bodyText(state)), {
    code: 'ENVELOPE_UNREADABLE',
    reason: 'ENVELOPE_SHAPE',
    field: 'certification',
  })
})

test('a document the analyzer exit mapper rejects is refused as a contract violation', async (t) => {
  const fixture = clearEnvelope()
  fixture.correlation = 'established'
  const { file } = await envelopeFile(t, fixture)
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const direct = await readEnvelope(file)
  assert.equal(direct.ok, false)
  assert.equal(direct.reason, 'ENVELOPE_SHAPE')
  assert.equal(direct.field, 'contract')

  const state = await call(carrier.routes.get(DEFAULT_ENVELOPE_PATH), makeRequest())
  assert.equal(state.status, 503)
  assert.equal(JSON.parse(bodyText(state)).field, 'contract')
})

test('an envelope past the byte ceiling is refused before it is parsed', async (t) => {
  const padded = `${JSON.stringify(clearEnvelope(), null, 2)}\n${' '.repeat(ENVELOPE_BYTE_CEILING)}`
  const { file } = await envelopeFile(t, padded)
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_ENVELOPE_PATH), makeRequest())
  assert.equal(state.status, 503)
  assert.equal(JSON.parse(bodyText(state)).reason, 'ENVELOPE_TOO_LARGE')
})

test('HEAD answers headers only, never a body', async (t) => {
  const { file } = await envelopeFile(t, clearEnvelope())
  const carrier = makeCarrier()
  apply(carrier.ctx, { envelopePath: file })

  const state = await call(carrier.routes.get(DEFAULT_ENVELOPE_PATH), makeRequest({ method: 'HEAD' }))
  assert.equal(state.status, 200)
  assert.ok(Number(state.headers['content-length']) > 0)
})

test('the shape gate names the first failing top-level field', () => {
  assert.deepEqual(checkEnvelopeShape(null), { field: 'report' })
  assert.deepEqual(checkEnvelopeShape([]), { field: 'report' })
  assert.deepEqual(checkEnvelopeShape({}), { field: 'diagnoseVersion' })
  assert.deepEqual(checkEnvelopeShape({ diagnoseVersion: DIAGNOSE_VERSION }), { field: 'certification' })
  assert.deepEqual(
    checkEnvelopeShape({ diagnoseVersion: DIAGNOSE_VERSION, certification: false }),
    { field: 'correlation' },
  )
  assert.deepEqual(checkEnvelopeShape(clearEnvelope()), null)
})

test('the inline script prints words and glosses, never a DOM node as text', async () => {
  // Regression: the renderer once handed an already-built <span> to a helper that
  // assigned its argument to `textContent`, so the state and outcome cells showed
  // "[object HTMLSpanElement]". Only a rendered page reveals that, so this test
  // executes the shipped inline script inside a minimal DOM and reads the result.
  const { renderPage } = await import('../src/page.js')
  const vm = await import('node:vm')
  const html = renderPage()
  const script = /<script>([\s\S]*)<\/script>/.exec(html)
  assert.ok(script, 'the page carries exactly one inline script')

  const makeNode = (tag) => {
    const node = {
      tagName: tag,
      className: '',
      children: [],
      text: null,
      appendChild(child) {
        node.children.push(child)
        node.text = null
        return child
      },
      replaceChildren(...kids) {
        node.children = kids
        node.text = null
      },
      get lastChild() {
        return node.children[node.children.length - 1]
      },
      get textContent() {
        if (node.children.length > 0) return node.children.map((child) => child.textContent).join('')
        return node.text === null ? '' : node.text
      },
      set textContent(value) {
        node.text = String(value)
        node.children = []
      },
    }
    Object.defineProperty(node, 'nodeType', { value: 1 })
    return node
  }

  const byId = new Map()
  const document = {
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeNode('div'))
      return byId.get(id)
    },
  }
  const envelope = {
    diagnoseVersion: 'dsh-compat-diagnose/0.2-draft.1',
    certification: false,
    correlation: 'not-established',
    profile: { state: 'provided', outcome: 'clear', issues: [], entryDiagnostics: 0 },
    combinedReport: null,
    provenance: [],
    limitations: [],
    nextSteps: [
      {
        code: 'SOURCE_NOT_PROVIDED',
        source: 'static',
        message: 'No file was named for this source; the envelope says nothing about it.',
      },
    ],
  }
  const fetchStub = () =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(envelope)) })

  vm.runInNewContext(script[1], { document, fetch: fetchStub, JSON, Object, Array, String, Error })
  await new Promise((resolve) => setTimeout(resolve, 20))

  const seen = []
  const walk = (node) => {
    seen.push(node.textContent)
    for (const child of node.children) walk(child)
  }
  for (const node of byId.values()) walk(node)
  const rendered = seen.join('\n')

  assert.doesNotMatch(rendered, /\[object HTML/)
  // The machine word stays beside its gloss; the gloss never replaces it.
  assert.match(rendered, /provided\s*已提供/)
  assert.match(rendered, /clear\s*无异常/)
  assert.match(rendered, /认证\s*false/)
  // A next step keeps the envelope's own sentence verbatim and glosses only the
  // code, which is a closed word; the sentence is not ours to translate.
  assert.match(rendered, /SOURCE_NOT_PROVIDED\s*未提供该来源的文档/)
  assert.ok(
    rendered.includes('No file was named for this source; the envelope says nothing about it.'),
    'the envelope sentence survives verbatim',
  )
})
