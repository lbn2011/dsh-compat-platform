#!/usr/bin/env node
/**
 * verify-real-apis.mjs — verify real conflict/repair APIs by calling them in-memory
 * with the actual createHostApi, bypassing the 3080 connection gate.
 */
import { createHostApi } from '../packages/host/src/api.js'
import { createConflictService } from '../packages/analyzer/src/conflict-service.js'
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'

const PLAN = JSON.parse(readFileSync('./examples/repair/plan.json', 'utf8'))

const TEST_ROOT = '/tmp/t3-repair-test.XKPvme'
const APPROVALS_DIR = '/tmp/t3-repair-approvals.dYgD1u'

// Mock webServer service
const mockWebServer = {
  host: '127.0.0.1',
  port: 3080,
}

// Mock ctx with logger
const mockCtx = {
  webServer: mockWebServer,
  logger: (name) => ({
    info: (...args) => console.log(`[${name}]`, ...args),
    warn: (...args) => console.warn(`[${name}]`, ...args),
    error: (...args) => console.error(`[${name}]`, ...args),
  }),
}

// Plugin config
const config = {
  envelopePath: '/dev/null', // not used in this test
  repair: {
    root: TEST_ROOT,
    documents: ['profile.yml'],
    applyEnabled: false,
    approvalsDir: APPROVALS_DIR,
  },
}

// Mock compatConflicts service
const compatConflicts = createConflictService({})
const compatRoot = '/root/dsh-ecosystem-spec/projects/dsh-compat-platform'
// Upsert plugin-a and plugin-b with grep tool, creating C2 conflicts
compatConflicts.upsert('plugin-a', [{ kind: 'tool', key: 'grep' }])
compatConflicts.upsert('plugin-b', [{ kind: 'tool', key: 'grep' }])

async function testApis() {
  console.log('[verify-real-apis] Creating host API with real repair package...')
  
  // Mock connection carrier (same shape as fakeConnection in api.test.js)
  const routes = []
  const connection = {
    routes,
    fetch: {
      register: function (route) {
        routes.push(route)
        return () => {
          routes.splice(routes.indexOf(route), 1)
        }
      },
    },
    admitConnection: () => ({ peer: {}, release: () => {} }),
  }
  
  const api = createHostApi({ connection, webServer: mockWebServer, on: () => () => {}, compatConflicts }, config)
  
  function findRoute(path) {
    const route = connection.routes.find((entry) => entry.path === path)
    if (!route) throw new Error(`Route not found: ${path}`)
    return route
  }
  
  // Test 1: GET /api/conflict-report
  console.log('\n[Test 1] GET /api/conflict-report')
  const conflictRoute = findRoute('/api/conflict-report')
  const conflictRes = await conflictRoute.fetch(new Request('http://127.0.0.1/api/conflict-report'))
  console.log('Status:', conflictRes.status)
  const conflictBody = await conflictRes.text()
  console.log('Body sample:', conflictBody.slice(0, 200))
  if (conflictRes.status !== 200) throw new Error('conflict-report failed')
  const conflicts = JSON.parse(conflictBody)
  if (!Array.isArray(conflicts.conflicts) || conflicts.conflicts.length === 0) {
    throw new Error('Expected at least one conflict (plugin-a/b both claim grep tool)')
  }
  console.log('✓ conflict-report: found', conflicts.conflicts.length, 'conflicts')
  
  // Test 2: GET /api/repair-targets
  console.log('\n[Test 2] GET /api/repair-targets')
  const targetsRoute = findRoute('/api/repair-targets')
  const targetsRes = await targetsRoute.fetch(new Request('http://127.0.0.1/api/repair-targets'))
  console.log('Status:', targetsRes.status)
  const targetsBody = await targetsRes.text()
  console.log('Body:', targetsBody)
  if (targetsRes.status !== 200) throw new Error('repair-targets failed')
  const targets = JSON.parse(targetsBody)
  if (!Array.isArray(targets.documents) || !targets.documents.includes('profile.yml')) {
    throw new Error('repair-targets: expected profile.yml in documents')
  }
  if (targets.applyEnabled !== false) {
    throw new Error('repair-targets: applyEnabled should be false')
  }
  console.log('✓ repair-targets:', targets)
  
  // Test 3: POST /api/repair-preview with valid plan
  console.log('\n[Test 3] POST /api/repair-preview')
  const previewRoute = findRoute('/api/repair-preview')
  const previewReq = new Request('http://127.0.0.1/api/repair-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'profile.yml', plan: PLAN }),
  })
  const previewRes = await previewRoute.fetch(previewReq)
  console.log('Status:', previewRes.status)
  const previewBody = await previewRes.text()
  console.log('Body sample:', previewBody.slice(0, 300))
  if (previewRes.status !== 200) {
    console.error('Preview failed:', previewBody)
    throw new Error('repair-preview failed')
  }
  const preview = JSON.parse(previewBody)
  if (!preview.operations || !preview.planDigest || !preview.afterText) {
    throw new Error('repair-preview: missing required fields')
  }
  console.log('✓ repair-preview: operations =', preview.operations.length, ', planDigest =', preview.planDigest.slice(0, 16))
  
  // Test 4: POST /api/repair-apply with applyEnabled=false (should 403)
  console.log('\n[Test 4] POST /api/repair-apply (applyEnabled=false, expect 403)')
  const applyRoute = findRoute('/api/repair-apply')
  const applyReq403 = new Request('http://127.0.0.1/api/repair-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'profile.yml', plan: PLAN }),
  })
  const applyRes403 = await applyRoute.fetch(applyReq403)
  console.log('Status:', applyRes403.status)
  const applyBody403 = await applyRes403.text()
  console.log('Body:', applyBody403)
  if (applyRes403.status !== 403) {
    throw new Error('repair-apply should return 403 when applyEnabled=false')
  }
  const apply403 = JSON.parse(applyBody403)
  if (apply403.code !== 'REPAIR_APPLY_DISABLED') {
    throw new Error('Expected code REPAIR_APPLY_DISABLED')
  }
  console.log('✓ repair-apply: correctly refused with 403')
  
  // Test 5: Enable apply and test without approval (expect 409)
  console.log('\n[Test 5] Enable applyEnabled and test without approval (expect 409)')
  // Clean approvals directory to ensure no leftover approval from previous test
  const existingApprovals = readdirSync(APPROVALS_DIR)
  for (const file of existingApprovals) {
    unlinkSync(`${APPROVALS_DIR}/${file}`)
  }
  config.repair.applyEnabled = true
  const routes2 = []
  const connection2 = {
    routes: routes2,
    fetch: {
      register: function (route) {
        routes2.push(route)
        return () => {
          routes2.splice(routes2.indexOf(route), 1)
        }
      },
    },
    admitConnection: () => ({ peer: {}, release: () => {} }),
  }
  createHostApi({ connection: connection2, webServer: mockWebServer, on: () => () => {}, compatConflicts }, config)
  const applyRoute2 = connection2.routes.find((entry) => entry.path === '/api/repair-apply')
  const applyReq409 = new Request('http://127.0.0.1/api/repair-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'profile.yml', plan: PLAN }),
  })
  const applyRes409 = await applyRoute2.fetch(applyReq409)
  console.log('Status:', applyRes409.status)
  const applyBody409 = await applyRes409.text()
  console.log('Body:', applyBody409)
  if (applyRes409.status !== 409) {
    throw new Error('repair-apply should return 409 when approval is missing')
  }
  const apply409 = JSON.parse(applyBody409)
  if (apply409.code !== 'REPAIR_APPROVAL_MISSING' || !apply409.planDigest) {
    throw new Error('Expected code REPAIR_APPROVAL_MISSING with planDigest')
  }
  console.log('✓ repair-apply: correctly returned 409 with planDigest =', apply409.planDigest.slice(0, 16))
  
  // Test 6: Write approval file and test apply (expect 200)
  console.log('\n[Test 6] Write approval file and apply (expect 200)')
  const approvalPath = `${APPROVALS_DIR}/${apply409.planDigest}.json`
  const approval = {
    approvalVersion: 'repair-approval/0.1-draft.1',
    planDigest: apply409.planDigest,
    decision: 'allow',
    approver: 't3-verifier',
    expiresAtMs: Date.now() + 300_000,
    note: 'Test approval for t3 verification',
  }
  writeFileSync(approvalPath, JSON.stringify(approval, null, 2), 'utf8')
  console.log('Wrote approval:', approvalPath)
  
  const applyReqOk = new Request('http://127.0.0.1/api/repair-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'profile.yml', plan: PLAN }),
  })
  const applyResOk = await applyRoute2.fetch(applyReqOk)
  console.log('Status:', applyResOk.status)
  const applyBodyOk = await applyResOk.text()
  console.log('Body:', applyBodyOk)
  if (applyResOk.status !== 200) {
    console.error('Apply failed:', applyBodyOk)
    throw new Error('repair-apply should return 200 after approval')
  }
  const applyOk = JSON.parse(applyBodyOk)
  if (applyOk.status !== 'applied') {
    throw new Error('Expected status=applied, got ' + applyOk.status)
  }
  console.log('✓ repair-apply: succeeded with status =', applyOk.status)
  
  // Verify document was modified
  const afterDoc = readFileSync(`${TEST_ROOT}/profile.yml`, 'utf8')
  console.log('Document after apply (first 200 chars):', afterDoc.slice(0, 200))
  if (!afterDoc.includes('disabled: true')) {
    throw new Error('Document should have "disabled: true" after disable-conflicting plan')
  }
  
  // Verify .before backup exists
  const beforeBackup = readFileSync(`${TEST_ROOT}/profile.yml.before`, 'utf8')
  console.log('.before backup exists:', beforeBackup.length, 'bytes')
  
  // Cleanup
  unlinkSync(approvalPath)
  console.log('Cleaned approval file')
  
  console.log('\n✅ All API tests passed with real repair package')
}

testApis().catch(err => {
  console.error('\n❌ Test failed:', err.message)
  process.exit(1)
})
