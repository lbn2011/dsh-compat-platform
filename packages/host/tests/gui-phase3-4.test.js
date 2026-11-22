/**
 * Phase 3 (conflict dashboard) and Phase 4 (repair preview) UI tests.
 *
 * SCOPE: executes the page's real inline script in node:vm against a stub DOM
 * that supports event dispatch, and a fetch stub routed by URL. This proves the
 * script's behaviour (states, filtering, double-submit guard, text-only output);
 * it is NOT a browser rendering or visual acceptance.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { renderPage } from '../src/page.js'

function makeDom() {
  const byId = new Map()
  const makeNode = (tag) => {
    const listeners = {}
    const node = {
      tagName: tag, className: '', children: [], text: null,
      hidden: false, disabled: false, checked: true, open: false, value: '',
      appendChild(child) { node.children.push(child); node.text = null; return child },
      replaceChildren(...kids) { node.children = kids; node.text = null },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn) },
      removeEventListener() {},
      dispatch(type) { for (const fn of listeners[type] ?? []) fn({ type, target: node }) },
      get innerHTMLUsed() { return false },
      get textContent() {
        if (node.children.length > 0) return node.children.map((c) => c.textContent).join('')
        return node.text === null ? '' : node.text
      },
      set textContent(v) { node.text = String(v); node.children = [] },
    }
    Object.defineProperty(node, 'nodeType', { value: 1 })
    return node
  }
  const document = {
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => {
      if (!byId.has(id)) {
        const n = makeNode('div')
        // HTML defaults that matter to the script.
        if (id === 'conflictAutoPoll') n.checked = false
        if (id === 'btnRepairApply' || id === 'btnRepairPreview') n.disabled = true
        byId.set(id, n)
      }
      return byId.get(id)
    },
  }
  return { document, byId }
}

function respond(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) })
}

const tick = () => new Promise((r) => setTimeout(r, 15))

async function boot(routes) {
  const html = renderPage()
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1]
  const { document, byId } = makeDom()
  const calls = []
  const intervals = []
  const fetch = (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body })
    const handler = routes[url]
    if (handler) return handler(init, calls)
    return respond(404, { code: 'NOT_STUBBED' })
  }
  vm.runInNewContext(script, {
    document, fetch, JSON, Object, Array, String, Error, Date, Promise,
    window: { location: { protocol: 'http:', host: 'localhost' } },
    WebSocket: function () { return { close() {} } },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length },
    clearInterval: (id) => { if (intervals[id - 1]) intervals[id - 1].cleared = true },
  })
  await tick()
  return { $: (id) => document.getElementById(id), byId, calls, intervals }
}

const CONFLICTS = {
  claims: [{ kind: 'tool', key: 'grep', owner: 'a' }, { kind: 'tool', key: 'grep', owner: 'b' }],
  conflicts: [
    { id: 'C2|tool|grep', code: 'C2', severity: 'blocker', kind: 'tool', key: 'grep',
      owners: [{ owner: 'plugin-a', uid: 1 }, { owner: 'plugin-b', uid: 2 }], summary: 'two owners of grep' },
    { id: 'C4|slot|x', code: 'C4', severity: 'medium', kind: 'slot', key: 'x', owners: [], summary: 'slot x' },
  ],
  summary: { byKind: { tool: 2 }, bySeverity: { blocker: 1, medium: 1 } },
}

test('the page ships the dashboard and repair sections with their controls', () => {
  const html = renderPage()
  for (const id of ['btnConflictRefresh', 'conflictAutoPoll', 'sevBlocker', 'sevHigh', 'sevMedium', 'sevLow',
    'conflictList', 'conflictStatus', 'repairDocument', 'repairTargetsState', 'repairPlan', 'repairDigests', 'repairAfter', 'btnRepairPreview', 'btnRepairApply', 'repairOps', 'repairResult']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`)
  }
  assert.match(html, /<button id="btnRepairApply" disabled>/, 'apply starts disabled')
  assert.match(html, /<button id="btnRepairPreview" class="primary" disabled>/, 'preview waits for repair-targets')
  assert.doesNotMatch(html, /beforeText|"approval"/, 'the page offers no client-side document or approval field')
})

test('refresh renders every conflict with code, severity and owners', async () => {
  const page = await boot({ '/api/conflict-report': () => respond(200, CONFLICTS) })
  page.$('btnConflictRefresh').dispatch('click')
  await tick()
  const list = page.$('conflictList')
  assert.equal(list.children.length, 2)
  assert.equal(list.children[0].className, 'conflict sev-blocker')
  assert.match(list.children[0].textContent, /C2/)
  assert.match(list.children[0].textContent, /plugin-a, plugin-b/)
  assert.match(page.$('conflictStatus').textContent, /冲突 2 条 · 占用声明 2 条/)
  assert.equal(page.$('conflictState').hidden, true)
})

test('severity filters hide and restore conflicts without refetching', async () => {
  const page = await boot({ '/api/conflict-report': () => respond(200, CONFLICTS) })
  page.$('btnConflictRefresh').dispatch('click')
  await tick()
  const before = page.calls.filter((c) => c.url === '/api/conflict-report').length
  page.$('sevBlocker').checked = false
  page.$('sevBlocker').dispatch('change')
  assert.equal(page.$('conflictList').children.length, 1)
  page.$('sevMedium').checked = false
  page.$('sevMedium').dispatch('change')
  assert.equal(page.$('conflictList').children.length, 0)
  assert.match(page.$('conflictState').textContent, /都被严重度过滤隐藏/)
  page.$('sevBlocker').checked = true
  page.$('sevBlocker').dispatch('change')
  assert.equal(page.$('conflictList').children.length, 1)
  assert.equal(page.calls.filter((c) => c.url === '/api/conflict-report').length, before)
})

test('an empty conflict list says no conflicts; a 503 never does', async () => {
  const empty = await boot({ '/api/conflict-report': () => respond(200, { claims: [], conflicts: [], summary: {} }) })
  empty.$('btnConflictRefresh').dispatch('click')
  await tick()
  assert.match(empty.$('conflictState').textContent, /未检测到冲突/)
  assert.equal(empty.$('conflictState').className, 'state-msg good')

  const down = await boot({ '/api/conflict-report': () => respond(503, { code: 'CONFLICT_SERVICE_UNAVAILABLE' }) })
  down.$('btnConflictRefresh').dispatch('click')
  await tick()
  const state = down.$('conflictState').textContent
  assert.match(state, /未就绪/)
  assert.match(state, /CONFLICT_SERVICE_UNAVAILABLE/)
  assert.doesNotMatch(state, /未检测到冲突/)
  assert.equal(down.$('conflictList').children.length, 0)
})

test('auto-poll schedules a 5 s interval and clears it when switched off', async () => {
  const page = await boot({ '/api/conflict-report': () => respond(200, CONFLICTS) })
  page.$('conflictAutoPoll').checked = true
  page.$('conflictAutoPoll').dispatch('change')
  await tick()
  assert.equal(page.intervals.length, 1)
  assert.equal(page.intervals[0].ms, 5000)
  assert.equal(page.calls.filter((c) => c.url === '/api/conflict-report').length, 1)
  page.$('conflictAutoPoll').checked = false
  page.$('conflictAutoPoll').dispatch('change')
  assert.equal(page.intervals[0].cleared, true)
})

test('conflict text is inserted as text, never as markup', async () => {
  const hostile = { claims: [], summary: {}, conflicts: [{ code: '<img src=x onerror=alert(1)>', severity: 'high',
    kind: 'tool', key: '</script>', owners: [{ owner: '<b>x</b>' }], summary: '<script>alert(1)</script>' }] }
  const page = await boot({ '/api/conflict-report': () => respond(200, hostile) })
  page.$('btnConflictRefresh').dispatch('click')
  await tick()
  const item = page.$('conflictList').children[0]
  const texts = []
  const walk = (n) => { if (n.text !== null) texts.push(n.text); n.children.forEach(walk) }
  walk(item)
  assert.ok(texts.includes('<img src=x onerror=alert(1)>'), 'hostile code survives as literal text')
  assert.ok(texts.includes('<script>alert(1)</script>'))
  assert.ok(!('innerHTML' in item), 'no innerHTML was assigned')
})

test('a 500 or a network error never says "no conflicts" and updates the status bar (R2/R7)', async () => {
  const failed = await boot({ '/api/conflict-report': () => respond(500, { code: 'CONFLICT_SERVICE_ERROR' }) })
  failed.$('btnConflictRefresh').dispatch('click')
  await tick()
  assert.match(failed.$('conflictState').textContent, /HTTP 500 CONFLICT_SERVICE_ERROR/)
  assert.doesNotMatch(failed.$('conflictState').textContent, /未检测到冲突/)
  assert.match(failed.$('conflictStatus').textContent, /读取失败 · 最后检查/)

  const offline = await boot({ '/api/conflict-report': () => Promise.reject(new TypeError('Failed to fetch')) })
  offline.$('btnConflictRefresh').dispatch('click')
  await tick()
  assert.match(offline.$('conflictState').textContent, /请求出错/)
  assert.doesNotMatch(offline.$('conflictState').textContent, /未检测到冲突/)
  assert.match(offline.$('conflictStatus').textContent, /请求出错 · 最后检查/)
})

test('an auto-poll tick while a request is in flight does not send a second request (R7)', async () => {
  let release
  const page = await boot({
    '/api/conflict-report': () => new Promise((r) => { release = () => r(respond(200, CONFLICTS)) }),
  })
  page.$('conflictAutoPoll').checked = true
  page.$('conflictAutoPoll').dispatch('change')
  page.intervals[0].fn()
  page.intervals[0].fn()
  assert.equal(page.calls.filter((c) => c.url === '/api/conflict-report').length, 1)
  release()
  await tick()
  page.intervals[0].fn()
  await tick()
  assert.equal(page.calls.filter((c) => c.url === '/api/conflict-report').length, 2)
})

// ---- repair: real previewRepair shape, served by /api/repair-preview ----------------

const TARGETS = { documents: ['profile.yml', 'other.yml'], applyEnabled: true }
const PLAN = { planVersion: 'repair-plan/0.2-draft.1', operation: { kind: 'set-entry-flag', entryIndex: 1, field: 'disabled', value: true } }
const DIGESTS = { beforeDigest: 'b'.repeat(64), afterDigest: 'a'.repeat(64), planDigest: 'd'.repeat(64) }
// Exactly what the host returns for SET_FLAG on examples/repair/profile.yml (repair-api.test.js).
const READY = {
  name: 'profile.yml', verdict: 'ready', valid: true, issues: [], errors: [],
  operations: [{ kind: 'set-entry-flag', value: true, edit: { kind: 'set-entry-flag', line: 5 },
    diff: { line: 5, removed: '  disabled: false', added: '  disabled: true' } }],
  ...DIGESTS, afterText: '- id: alpha\n  disabled: true\n', afterTextWithheld: false, limitations: [],
}
const REORDER = {
  ...READY,
  operations: [{ kind: 'reorder', edit: { kind: 'reorder', fromLine: 9, toLine: 3 }, diff: null }],
}

function repairRoutes(extra = {}) {
  return { '/api/repair-targets': () => respond(200, TARGETS), '/api/repair-preview': () => respond(200, READY), ...extra }
}

async function previewed(routes) {
  const page = await boot(routes)
  page.$('repairPlan').value = JSON.stringify(PLAN)
  page.$('btnRepairPreview').dispatch('click')
  await tick()
  return page
}

test('repair targets fill the document list; the preview sends {name, plan} only', async () => {
  const page = await previewed(repairRoutes())
  const options = page.$('repairDocument').children
  assert.deepEqual(options.map((o) => o.value), ['profile.yml', 'other.yml'])
  const sent = page.calls.find((c) => c.url === '/api/repair-preview')
  assert.equal(sent.method, 'POST')
  assert.deepEqual(JSON.parse(sent.body), { name: 'profile.yml', plan: PLAN })
})

test('preview shows each operation with its edit line, diff and the digests (R5)', async () => {
  const page = await previewed(repairRoutes())
  const ops = page.$('repairOps').children
  assert.equal(ops.length, 1, 'one operation, not "2 项操作" from counting diff and edit')
  const text = ops[0].textContent
  assert.match(text, /set-entry-flag/)
  assert.match(text, /第 5 行/)
  assert.match(text, /-   disabled: false/)
  assert.match(text, /\+   disabled: true/)
  assert.match(page.$('repairState').textContent, /预览就绪：1 项操作/)
  const digests = page.$('repairDigests').textContent
  assert.match(digests, new RegExp(`before=${'b'.repeat(64)}`))
  assert.match(digests, new RegExp(`after=${'a'.repeat(64)}`))
  assert.match(digests, new RegExp(`planDigest=${'d'.repeat(64)}`))
  assert.equal(page.$('repairAfter').textContent, READY.afterText)
  assert.equal(page.$('btnRepairApply').disabled, false)
})

test('set-entry-flag value=true and disable-conflicting are red; set-entry-flag value=false and reorder are not (R5)', async () => {
  const cases = [
    [{ kind: 'set-entry-flag', value: true, edit: { line: 5 }, diff: { line: 5, removed: 'x', added: 'y' } }, 'op danger'],
    [{ kind: 'disable-conflicting', edit: { line: 11 }, diff: { line: 11, removed: null, added: '  disabled: true' } }, 'op danger'],
    [{ kind: 'set-entry-flag', value: false, edit: { line: 5 }, diff: { line: 5, removed: 'x', added: 'y' } }, 'op'],
    [REORDER.operations[0], 'op'],
  ]
  for (const [op, expected] of cases) {
    const page = await previewed(repairRoutes({ '/api/repair-preview': () => respond(200, { ...READY, operations: [op] }) }))
    assert.equal(page.$('repairOps').children[0].className, expected, `${op.kind} value=${op.value}`)
  }
  const reorder = await previewed(repairRoutes({ '/api/repair-preview': () => respond(200, REORDER) }))
  assert.match(reorder.$('repairOps').children[0].textContent, /第 9 行 → 第 3 行/)
})

test('applyEnabled=false keeps apply disabled after a ready preview and says so', async () => {
  const page = await previewed(repairRoutes({ '/api/repair-targets': () => respond(200, { ...TARGETS, applyEnabled: false }) }))
  assert.match(page.$('repairTargetsState').textContent, /执行已在服务端关闭/)
  assert.match(page.$('repairState').textContent, /执行已在服务端关闭/)
  assert.equal(page.$('btnRepairApply').disabled, true)
  page.$('btnRepairApply').dispatch('click')
  await tick()
  assert.equal(page.calls.filter((c) => c.url === '/api/repair-apply').length, 0)
})

test('repair targets 503 disables preview and shows 未就绪', async () => {
  const page = await boot({ '/api/repair-targets': () => respond(503, { code: 'REPAIR_NOT_CONFIGURED' }) })
  assert.match(page.$('repairTargetsState').textContent, /未就绪 REPAIR_NOT_CONFIGURED/)
  assert.equal(page.$('btnRepairPreview').disabled, true)
  page.$('repairPlan').value = JSON.stringify(PLAN)
  page.$('btnRepairPreview').dispatch('click')
  await tick()
  assert.equal(page.calls.filter((c) => c.url === '/api/repair-preview').length, 0)
})

test('an invalid preview, bad JSON or 503 keeps apply disabled', async () => {
  const refused = await previewed(repairRoutes({
    '/api/repair-preview': () => respond(200, { ...READY, verdict: 'stale', valid: false, issues: ['PREVIEW_STALE'], operations: [], afterText: null }),
  }))
  assert.equal(refused.$('btnRepairApply').disabled, true)
  assert.match(refused.$('repairState').textContent, /stale.*PREVIEW_STALE/)

  const badJson = await boot(repairRoutes())
  badJson.$('repairPlan').value = '{not json'
  badJson.$('btnRepairPreview').dispatch('click')
  await tick()
  assert.match(badJson.$('repairState').textContent, /解析失败/)
  assert.equal(badJson.calls.filter((c) => c.url === '/api/repair-preview').length, 0, 'bad JSON is never sent')

  const down = await previewed(repairRoutes({ '/api/repair-preview': () => respond(503, { code: 'REPAIR_PACKAGE_UNAVAILABLE' }) }))
  assert.match(down.$('repairState').textContent, /未就绪 REPAIR_PACKAGE_UNAVAILABLE/)
  assert.equal(down.$('btnRepairApply').disabled, true)
})

test('editing the plan or switching the document after a preview disables apply (R6)', async () => {
  const page = await previewed(repairRoutes())
  assert.equal(page.$('btnRepairApply').disabled, false)
  page.$('repairPlan').value = '{"planVersion":"edited"}'
  page.$('repairPlan').dispatch('input')
  assert.equal(page.$('btnRepairApply').disabled, true)
  assert.match(page.$('repairState').textContent, /计划已修改，请重新预览/)
  page.$('btnRepairApply').dispatch('click')
  await tick()
  assert.equal(page.calls.filter((c) => c.url === '/api/repair-apply').length, 0)

  const other = await previewed(repairRoutes())
  other.$('repairDocument').value = 'other.yml'
  other.$('repairDocument').dispatch('change')
  assert.equal(other.$('btnRepairApply').disabled, true)
  assert.match(other.$('repairState').textContent, /文档已切换/)
})

test('apply sends the previewed {name, plan} once, even on a double click', async () => {
  let release
  const page = await previewed(repairRoutes({
    '/api/repair-apply': () => new Promise((r) => { release = () => r(respond(200, { status: 'applied', reasons: [] })) }),
  }))
  page.$('btnRepairApply').dispatch('click')
  page.$('btnRepairApply').dispatch('click')
  assert.equal(page.$('btnRepairApply').disabled, true, 'disabled while in flight')
  assert.equal(page.$('btnRepairPreview').disabled, true)
  release()
  await tick()
  const applies = page.calls.filter((c) => c.url === '/api/repair-apply')
  assert.equal(applies.length, 1)
  assert.deepEqual(JSON.parse(applies[0].body), { name: 'profile.yml', plan: PLAN })
  assert.equal('approval' in JSON.parse(applies[0].body), false, 'the page never sends an approval')
  assert.match(page.$('repairState').textContent, /status=applied/)
  assert.equal(page.$('btnRepairApply').disabled, true, 'a finished plan cannot be applied twice')
})

test('a 409 shows the missing server approval with its planDigest and invalidates the preview', async () => {
  const page = await previewed(repairRoutes({
    '/api/repair-apply': () => respond(409, { code: 'REPAIR_APPROVAL_MISSING', planDigest: 'd'.repeat(64) }),
  }))
  page.$('btnRepairApply').dispatch('click')
  await tick()
  assert.match(page.$('repairState').textContent, new RegExp(`缺少服务端审批，planDigest=${'d'.repeat(64)}`))
  assert.equal(page.$('btnRepairApply').disabled, true)
})

test('a refused apply or a network error shows the outcome and invalidates the preview (R6)', async () => {
  const refused = await previewed(repairRoutes({
    '/api/repair-apply': () => respond(422, { status: 'refused', reasons: ['APPLY_APPROVAL_EXPIRED'] }),
  }))
  refused.$('btnRepairApply').dispatch('click')
  await tick()
  const state = refused.$('repairState').textContent
  assert.match(state, /HTTP 422/)
  assert.match(state, /status=refused/)
  assert.match(state, /APPLY_APPROVAL_EXPIRED/)
  assert.equal(refused.$('repairResultBox').open, true)
  assert.equal(refused.$('btnRepairApply').disabled, true, 'a refused result needs a fresh preview')

  const offline = await previewed(repairRoutes({ '/api/repair-apply': () => Promise.reject(new TypeError('Failed to fetch')) }))
  offline.$('btnRepairApply').dispatch('click')
  await tick()
  assert.match(offline.$('repairState').textContent, /请求出错/)
  assert.equal(offline.$('btnRepairApply').disabled, true)
})

test('repair output is text only: hostile names and diff lines survive literally', async () => {
  const hostile = { ...READY, operations: [{ kind: '<img src=x onerror=alert(1)>', edit: { line: 1 },
    diff: { line: 1, removed: '</pre><script>alert(1)</script>', added: '<b>x</b>' } }] }
  const page = await previewed(repairRoutes({
    '/api/repair-targets': () => respond(200, { documents: ['<i>doc</i>'], applyEnabled: true }),
    '/api/repair-preview': () => respond(200, hostile),
  }))
  const texts = []
  const walk = (n) => { if (n.text !== null) texts.push(n.text); n.children.forEach(walk) }
  walk(page.$('repairOps'))
  walk(page.$('repairDocument'))
  assert.ok(texts.includes('<img src=x onerror=alert(1)>'))
  assert.ok(texts.includes('- </pre><script>alert(1)</script>'))
  assert.ok(texts.includes('<i>doc</i>'))
})
