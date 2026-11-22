// Real-browser E2E for UI Phase 3 (conflict dashboard) and Phase 4 (repair preview).
//
// Serves the real renderPage() HTML from a local temp server on an OS-assigned
// port (never 3080, never production). /api/* is answered by the REAL host routes
// from createHostApi(), backed by the real createConflictService() and the real
// dsh-compat-repair package working on a copy of examples/repair/profile.yml in a
// mkdtemp directory (removed at exit). Nothing in the repository is written.
// Two modes: "live" (service + repair configured) and "down" (neither), switched
// by this script between page loads. Prints one JSON line; exit 0 only when every
// check holds. Usage: node ui-e2e.mjs <run-dir>   (CHROME_PATH from the payload's env -i)
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPage } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/host/src/page.js'
import { createHostApi } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/host/src/api.js'
import { ChromeDriver } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/host/src/chrome-driver.js'
import { createConflictService } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/analyzer/src/conflict-service.js'
import { previewRepair, textDigest } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/repair/src/repair-preview.js'
import { planDigest } from '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/packages/repair/src/repair-plan.js'

const EXAMPLE = '/root/dsh-ecosystem-spec/projects/dsh-compat-platform/examples/repair/profile.yml'
const NAME = 'profile.yml'
const runDir = process.argv[2]
if (!runDir) { console.error('usage: ui-e2e.mjs <run-dir>'); process.exit(2) }

// ── fixtures ────────────────────────────────────────────────────────────────
const base = mkdtempSync(join(tmpdir(), 'ui-e2e-'))
const root = join(base, 'root')
const approvalsDir = join(base, 'approvals')
mkdirSync(root)
mkdirSync(approvalsDir)
copyFileSync(EXAMPLE, join(root, NAME))
const beforeText = readFileSync(join(root, NAME), 'utf8')

const conflicts = createConflictService({})
conflicts.upsert('plugin-a', [{ kind: 'tool', key: 'grep' }])
conflicts.upsert('plugin-b', [{ kind: 'tool', key: 'grep' }])

const operation = { kind: 'set-entry-flag', entryIndex: 1, field: 'disabled', value: true }
const planWith = (digest) => ({
  planVersion: 'repair-plan/0.2-draft.1',
  operation,
  precondition: { documentSha256: textDigest(beforeText), revision: 'ui-e2e@1' },
  expectedPostcondition: { documentSha256: digest },
})
const readyPlan = planWith(previewRepair({ plan: planWith('0'.repeat(64)), beforeText }).afterDigest)
const stalePlan = { ...readyPlan, precondition: { documentSha256: textDigest('- id: other\n'), revision: 'ui-e2e@1' } }

function mountApi(ctx, options) {
  const routes = []
  const connection = { fetch: { register(route) { routes.push(route); return () => {} } } }
  createHostApi({ on: () => () => {}, ...ctx }, { connection, onError: () => {}, ...options })
  return routes
}
const apis = {
  live: mountApi({ compatConflicts: conflicts }, { repair: { root, documents: [NAME], applyEnabled: true, approvalsDir } }),
  down: mountApi({}, {}),
}
let mode = 'live'
const counts = { conflict: 0, preview: 0, apply: 0 }

const html = renderPage()
const srv = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    try {
      const path = new URL(req.url, 'http://127.0.0.1').pathname
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(html)
      }
      if (path === '/api/conflict-report') counts.conflict++
      if (path === '/api/repair-preview') counts.preview++
      if (path === '/api/repair-apply') counts.apply++
      const route = apis[mode].find((r) => r.path === path && (!r.methods || r.methods.includes(req.method)))
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{"code":"NOT_MOUNTED"}')
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body })
      // Hold apply for 300 ms so the double click lands while it is in flight.
      if (path === '/api/repair-apply') await new Promise((r) => setTimeout(r, 300))
      const response = await route.fetch(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'E2E_SERVER_ERROR', detail: String(error) }))
    }
  })
})
await new Promise((ok, fail) => srv.listen(0, '127.0.0.1', (e) => (e ? fail(e) : ok())))
const url = `http://127.0.0.1:${srv.address().port}/`

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
const screenshot = join(runDir, 'ui-phase3-4.png')
let driver
try {
  driver = await ChromeDriver.launch(process.env.CHROME_PATH)
  // Every wait is a check: a timeout is a failure, not something to read past.
  const waitFor = async (name, fn, arg) => {
    const ok = await driver.evaluate(async (src, a) => {
      const f = new Function('a', 'return (' + src + ')(a)')
      for (let i = 0; i < 100; i++) { if (f(a)) return true; await new Promise((r) => setTimeout(r, 50)) }
      return false
    }, fn.toString(), arg)
    check(`wait: ${name}`, ok === true, ok)
    return ok === true
  }
  const text = (id) => driver.evaluate((i) => document.getElementById(i).textContent, id)
  const disabled = (id) => driver.evaluate((i) => document.getElementById(i).disabled, id)

  // ── "down": no conflict service, no repair config ────────────────────────────
  mode = 'down'
  await driver.navigate(url)
  await driver.evaluate(() => document.getElementById('btnConflictRefresh').click())
  await waitFor('down conflict state shown', () => /未就绪/.test(document.getElementById('conflictState').textContent))
  const downState = await text('conflictState')
  check('503 conflict says 未就绪', /未就绪/.test(downState) && /CONFLICT_SERVICE_UNAVAILABLE/.test(downState), downState)
  check('503 conflict never says 未检测到冲突', !/未检测到冲突/.test(downState), downState)
  await waitFor('down repair targets state shown', () => /未就绪/.test(document.getElementById('repairTargetsState').textContent))
  const downTargets = await text('repairTargetsState')
  check('503 repair-targets says 未就绪', /未就绪 REPAIR_NOT_CONFIGURED/.test(downTargets), downTargets)
  check('preview disabled without repair config', (await disabled('btnRepairPreview')) === true)

  // ── "live": real service, real repair package ────────────────────────────────
  mode = 'live'
  await driver.navigate(url)
  await driver.evaluate(() => document.getElementById('btnConflictRefresh').click())
  await waitFor('live conflicts rendered', () => document.getElementById('conflictList').children.length === 1)
  const p3 = await driver.evaluate(() => {
    const list = document.getElementById('conflictList')
    const first = list.children[0]
    return {
      count: list.children.length,
      firstClass: first && first.className,
      firstText: first ? first.textContent : '',
      status: document.getElementById('conflictStatus').textContent,
    }
  })
  check('real C2 conflict rendered', p3.count === 1 && /C2/.test(p3.firstText) && /plugin-a, plugin-b/.test(p3.firstText), p3.firstText)
  check('high severity styled', p3.firstClass === 'conflict sev-high', p3.firstClass)
  check('status bar counts', /冲突 1 条 · 占用声明 2 条/.test(p3.status), p3.status)
  const afterFilter = await driver.evaluate(() => {
    document.getElementById('sevHigh').click()
    return { n: document.getElementById('conflictList').children.length, s: document.getElementById('conflictState').textContent }
  })
  check('severity filter hides high', afterFilter.n === 0 && /过滤隐藏/.test(afterFilter.s), afterFilter)
  await driver.evaluate(() => document.getElementById('sevHigh').click())

  await waitFor('repair targets loaded', () => document.getElementById('repairDocument').children.length === 1)
  check('preview enabled with repair config', (await disabled('btnRepairPreview')) === false)

  // valid:false (stale) keeps apply disabled.
  await driver.evaluate((plan) => {
    document.getElementById('repairPlan').value = plan
    document.getElementById('btnRepairPreview').click()
  }, JSON.stringify(stalePlan))
  await waitFor('stale preview reported', () => /PREVIEW_STALE/.test(document.getElementById('repairState').textContent))
  check('stale preview keeps apply disabled', (await disabled('btnRepairApply')) === true)

  // A ready preview of the real document.
  await driver.evaluate((plan) => {
    const ta = document.getElementById('repairPlan')
    ta.value = plan
    ta.dispatchEvent(new Event('input'))
    document.getElementById('btnRepairPreview').click()
  }, JSON.stringify(readyPlan))
  await waitFor('ready preview', () => document.getElementById('btnRepairApply').disabled === false)
  const p4 = await driver.evaluate(() => {
    const ops = document.getElementById('repairOps').children
    return {
      ops: ops.length,
      cls: ops[0] && ops[0].className,
      opText: ops[0] ? ops[0].textContent : '',
      digests: document.getElementById('repairDigests').textContent,
      after: document.getElementById('repairAfter').textContent,
    }
  })
  check('one real operation listed', p4.ops === 1, p4.ops)
  check('set-entry-flag value=true flagged red', p4.cls === 'op danger', p4.cls)
  check('edit line and diff shown', /第 5 行/.test(p4.opText) && /disabled: false/.test(p4.opText) && /disabled: true/.test(p4.opText), p4.opText)
  check('planDigest shown', p4.digests.includes(planDigest(readyPlan)), p4.digests)
  check('afterText shown', p4.after.includes('disabled: true'), p4.after.length)

  // Editing after the preview invalidates it.
  await driver.evaluate(() => {
    const ta = document.getElementById('repairPlan')
    ta.value = ta.value + ' '
    ta.dispatchEvent(new Event('input'))
  })
  check('edit disables apply', (await disabled('btnRepairApply')) === true)
  check('edit asks for a new preview', /计划已修改，请重新预览/.test(await text('repairState')))

  // No server approval yet: 409 with the planDigest; the document stays as it was.
  await driver.evaluate(() => document.getElementById('btnRepairPreview').click())
  await waitFor('re-preview ready', () => document.getElementById('btnRepairApply').disabled === false)
  await driver.evaluate(() => document.getElementById('btnRepairApply').click())
  await waitFor('409 reported', () => /缺少服务端审批/.test(document.getElementById('repairState').textContent))
  check('409 names the planDigest', (await text('repairState')).includes(planDigest(readyPlan)))
  check('409 left the document unchanged', readFileSync(join(root, NAME), 'utf8') === beforeText)

  // The operator writes the approval file; preview again, apply with a double click.
  writeFileSync(join(approvalsDir, `${planDigest(readyPlan)}.json`), JSON.stringify({
    approvalVersion: 'repair-approval/0.1-draft.1', planDigest: planDigest(readyPlan), decision: 'allow',
    approver: 'ui-e2e-operator', expiresAtMs: Date.now() + 120_000, note: 'ui-e2e',
  }))
  await driver.evaluate(() => document.getElementById('btnRepairPreview').click())
  await waitFor('preview after approval', () => document.getElementById('btnRepairApply').disabled === false)
  const appliesBefore = counts.apply
  await driver.evaluate(() => {
    const b = document.getElementById('btnRepairApply')
    b.click(); b.click()
  })
  await waitFor('apply result shown', () => /status=applied/.test(document.getElementById('repairState').textContent))
  check('double click sent one apply', counts.apply - appliesBefore === 1, counts.apply - appliesBefore)
  check('apply disabled after success', (await disabled('btnRepairApply')) === true)
  const written = readFileSync(join(root, NAME), 'utf8')
  check('document now matches the preview afterText', written === p4.after, written.length)
  check('.before copy kept', existsSync(join(root, `${NAME}.before`)) && readFileSync(join(root, `${NAME}.before`), 'utf8') === beforeText)

  await driver.screenshot(screenshot)
  let size = 0
  try { size = statSync(screenshot).size } catch { size = 0 }
  const magic = size > 8 ? readFileSync(screenshot).subarray(0, 8).toString('hex') : ''
  check('screenshot written as PNG', size > 1000 && magic === '89504e470d0a1a0a', { size, magic })
} catch (error) {
  check('no exception', false, String(error && error.stack || error))
} finally {
  if (driver) await driver.close().catch(() => {})
  srv.close()
  rmSync(base, { recursive: true, force: true })
}

const ok = checks.length > 0 && checks.every((c) => c.ok)
process.stdout.write(JSON.stringify({ ok, url, counts, checks }) + '\n')
process.exit(ok ? 0 : 1)
