/**
 * The repair routes against the REAL `dsh-compat-repair` package (R1/R3/R5).
 *
 * Every test works in its own `mkdtemp` directory: a repair root holding one
 * allow-listed copy of `examples/repair/profile.yml`, and a separate approvals
 * directory. Nothing in the repository is written. The approval is never sent in
 * a request; it is a file an operator would write into `approvalsDir`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_APPROVAL_FILE_BYTES,
  REPAIR_APPLY_PATH,
  REPAIR_MODULE_SOURCES,
  REPAIR_PREVIEW_PATH,
  REPAIR_TARGETS_PATH,
  createHostApi,
  loadRepairPackage,
  readRepairConfig,
} from '../src/api.js';
import { planDigest } from '../../repair/src/repair-plan.js';
import { textDigest } from '../../repair/src/repair-preview.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/repair/profile.yml', import.meta.url));
const REPAIR_SRC = new URL('../../repair/src/', import.meta.url);
const NAME = 'profile.yml';

/** Map a package specifier onto the monorepo sibling, the way an installed copy resolves. */
const packageImporter = (specifier) => {
  const prefix = 'dsh-compat-repair/';
  if (!specifier.startsWith(prefix)) throw new Error(`unexpected specifier ${specifier}`);
  return import(new URL(`${specifier.slice(prefix.length)}.js`, REPAIR_SRC).href);
};

function fakeConnection() {
  const routes = [];
  return {
    routes,
    fetch: {
      register(route) {
        routes.push(route);
        return () => routes.splice(routes.indexOf(route), 1);
      },
    },
  };
}

/** A fresh repair root + approvals dir with one allow-listed document. */
function workspace(t, { applyEnabled = true, approvals = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'host-repair-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'root');
  const approvalsDir = join(base, 'approvals');
  mkdirSync(root);
  mkdirSync(approvalsDir);
  copyFileSync(EXAMPLE, join(root, NAME));
  writeFileSync(join(root, 'other.yml'), '- id: other\n', 'utf8');
  const repair = { root, documents: [NAME], applyEnabled };
  if (approvals) repair.approvalsDir = approvalsDir;
  return { base, root, approvalsDir, repair, before: readFileSync(join(root, NAME), 'utf8') };
}

function mount(repair, extra = {}) {
  const connection = fakeConnection();
  const errors = [];
  createHostApi({ on: () => () => {} }, {
    connection,
    repair,
    repairImporter: packageImporter,
    onError: (code, error) => errors.push({ code, error }),
    ...extra,
  });
  const call = async (path, body) => {
    const route = connection.routes.find((entry) => entry.path === path);
    assert.ok(route, `route ${path} is mounted`);
    const init = body === undefined
      ? {}
      : { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) };
    const response = await route.fetch(new Request(`http://127.0.0.1${path}`, init));
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) };
  };
  return { connection, call, errors };
}

/** A v0.2 plan for one operation, with digests computed from the real preview. */
function planFor(beforeText, operation, afterDigest) {
  return {
    planVersion: 'repair-plan/0.2-draft.1',
    operation,
    precondition: { documentSha256: textDigest(beforeText), revision: 'test@1' },
    expectedPostcondition: { documentSha256: afterDigest ?? '0'.repeat(64) },
  };
}

const SET_FLAG = { kind: 'set-entry-flag', entryIndex: 1, field: 'disabled', value: true };
const DISABLE = { kind: 'disable-conflicting', disableIndex: 3, keepIndex: 1, conflictId: 'C2|tool|grep|a#-,b#-' };

/** A plan whose postcondition is the real after-digest, i.e. a `ready` plan. */
async function readyPlan(call, beforeText, operation = SET_FLAG) {
  const draft = planFor(beforeText, operation);
  const first = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan: draft });
  assert.equal(first.status, 200);
  assert.equal(first.body.verdict, 'mismatch');
  return planFor(beforeText, operation, first.body.afterDigest);
}

function writeApproval(approvalsDir, plan, overrides = {}) {
  const digest = planDigest(plan);
  const approval = {
    approvalVersion: 'repair-approval/0.1-draft.1',
    planDigest: digest,
    decision: 'allow',
    approver: 'host-operator',
    expiresAtMs: Date.now() + 60_000,
    note: 'test approval',
    ...overrides,
  };
  writeFileSync(join(approvalsDir, `${digest}.json`), JSON.stringify(approval), 'utf8');
  return digest;
}

// ---- config -------------------------------------------------------------------

test('readRepairConfig: absent section is "not configured", malformed fields throw naming the field', () => {
  assert.equal(readRepairConfig(undefined).configured, false);
  assert.equal(readRepairConfig({ root: '/tmp/x', documents: [] }).configured, false);
  assert.equal(readRepairConfig({ documents: ['a.yml'] }).configured, false);
  const ok = readRepairConfig({ root: '/tmp/x', documents: ['a.yml'] });
  assert.equal(ok.configured, true);
  assert.equal(ok.applyEnabled, false, 'apply is off by default');
  assert.throws(() => readRepairConfig({ root: 'relative' }), /config\.repair\.root/);
  assert.throws(() => readRepairConfig({ root: '/tmp/x', documents: ['../escape.yml'] }), /config\.repair\.documents/);
  assert.throws(() => readRepairConfig({ root: '/tmp/x', documents: ['sub/a.yml'] }), /config\.repair\.documents/);
  assert.throws(() => readRepairConfig({ root: '/tmp/x', documents: ['a.yml'], applyEnabled: 'yes' }), /applyEnabled/);
  assert.throws(() => readRepairConfig({ root: '/tmp/x', documents: ['a.yml'], applyEnabled: true }), /approvalsDir/);
  assert.throws(() => readRepairConfig({ root: '/tmp/x', documents: ['a.yml'], beforeText: 'x' }), /beforeText/);
});

// ---- not configured / targets ----------------------------------------------------

test('every repair route answers 503 REPAIR_NOT_CONFIGURED without a config.repair section', async () => {
  const { call } = mount(undefined);
  for (const [path, body] of [
    [REPAIR_TARGETS_PATH, undefined],
    [REPAIR_PREVIEW_PATH, { name: NAME, plan: {} }],
    [REPAIR_APPLY_PATH, { name: NAME, plan: {} }],
  ]) {
    const response = await call(path, body);
    assert.equal(response.status, 503, path);
    assert.deepEqual(response.body, { code: 'REPAIR_NOT_CONFIGURED' }, path);
  }
});

test('repair-targets lists the allowed names and applyEnabled, and never a path', async (t) => {
  const ws = workspace(t, { applyEnabled: false });
  const { call } = mount(ws.repair);
  const response = await call(REPAIR_TARGETS_PATH);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { documents: [NAME], applyEnabled: false });
  assert.equal(response.text.includes(ws.base), false);
  assert.equal(response.text.includes('/'), false);
});

// ---- preview ---------------------------------------------------------------------

test('repair-preview: a name outside the allow-list is 400 and reads nothing', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  for (const name of ['other.yml', '../root/profile.yml', join(ws.root, NAME), 42]) {
    const response = await call(REPAIR_PREVIEW_PATH, { name, plan: planFor(ws.before, SET_FLAG) });
    assert.equal(response.status, 400, String(name));
    assert.equal(response.body.code, 'REPAIR_DOCUMENT_NOT_ALLOWED');
  }
});

test('repair-preview: a client beforeText is refused; the server reads the document itself', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const response = await call(REPAIR_PREVIEW_PATH, {
    name: NAME, plan: planFor(ws.before, SET_FLAG), beforeText: ws.before,
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'BODY_UNKNOWN_FIELD');
});

test('repair-preview: body errors are 400 BODY_NOT_JSON / BODY_NOT_RECORD', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  assert.equal((await call(REPAIR_PREVIEW_PATH, '[not json')).body.code, 'BODY_NOT_JSON');
  assert.equal((await call(REPAIR_PREVIEW_PATH, '[]')).body.code, 'BODY_NOT_RECORD');
});

test('repair-preview: a ready plan returns the real previewRepair shape, one entry per operation', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  const response = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan });
  assert.equal(response.status, 200);
  const body = response.body;
  assert.equal(body.verdict, 'ready');
  assert.equal(body.valid, true);
  assert.deepEqual(body.issues, []);
  assert.equal(body.operations.length, 1, 'one plan carries exactly one operation');
  assert.deepEqual(body.operations[0], {
    kind: 'set-entry-flag',
    value: true,
    edit: { kind: 'set-entry-flag', line: 5 },
    diff: { line: 5, removed: '  disabled: false', added: '  disabled: true' },
  });
  assert.equal(body.beforeDigest, textDigest(ws.before));
  assert.equal(body.afterDigest, plan.expectedPostcondition.documentSha256);
  assert.equal(body.planDigest, planDigest(plan));
  assert.equal(textDigest(body.afterText), body.afterDigest);
  assert.equal(body.afterTextWithheld, false);
  // A preview never writes.
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
  assert.equal(existsSync(join(ws.root, `${NAME}.before`)), false);
});

test('repair-preview: disable-conflicting is reported with its real edit and diff', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before, DISABLE);
  const { body } = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan });
  assert.equal(body.verdict, 'ready');
  assert.deepEqual(body.operations, [{
    kind: 'disable-conflicting',
    edit: { kind: 'disable-conflicting', line: 11 },
    diff: { line: 11, removed: null, added: '  disabled: true' },
  }]);
});

test('repair-preview: a stale plan is valid:false with the real reason and no operations', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = planFor('- id: something-else\n', SET_FLAG);
  const { status, body } = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan });
  assert.equal(status, 200);
  assert.equal(body.verdict, 'stale');
  assert.equal(body.valid, false);
  assert.deepEqual(body.issues, ['PREVIEW_STALE']);
  assert.deepEqual(body.operations, []);
  assert.equal(body.afterText, null);
});

test('repair-preview: an invalid plan is valid:false with the plan issue codes', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const { status, body } = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan: { planVersion: 'nope' } });
  assert.equal(status, 200);
  assert.equal(body.verdict, 'refused');
  assert.equal(body.valid, false);
  assert.equal(body.issues[0], 'PREVIEW_PLAN_INVALID');
});

test('repair-preview: an allow-listed name whose file is missing is 422 with a closed reason', async (t) => {
  const ws = workspace(t);
  rmSync(join(ws.root, NAME));
  const { call } = mount(ws.repair);
  const { status, body, text } = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan: planFor(ws.before, SET_FLAG) });
  assert.equal(status, 422);
  assert.deepEqual(body, { code: 'REPAIR_DOCUMENT_UNREADABLE', reason: 'FIXTURE_FILE_MISSING' });
  assert.equal(text.includes(ws.base), false);
});

test('repair-preview: afterText above the response cap is withheld, digests still reported', async (t) => {
  const ws = workspace(t);
  const padding = Array.from({ length: 3000 }, (_, i) => `  note${i}: padding-value-${i}-xxxxxxxxxxxxxxxx`).join('\n');
  const big = `${ws.before}- id: big\n${padding}\n`;
  writeFileSync(join(ws.root, NAME), big, 'utf8');
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, big);
  const { body } = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan });
  assert.equal(body.verdict, 'ready');
  assert.equal(body.afterText, null);
  assert.equal(body.afterTextWithheld, true);
  assert.equal(typeof body.afterDigest, 'string');
});

// ---- apply -----------------------------------------------------------------------

test('repair-apply: a body carrying approval is 400 and nothing is written', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  writeApproval(ws.approvalsDir, plan);
  const response = await call(REPAIR_APPLY_PATH, {
    name: NAME, plan, approval: { decision: 'allow', planDigest: planDigest(plan) },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'BODY_APPROVAL_NOT_ACCEPTED');
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
});

test('repair-apply: a name outside the allow-list is 400', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const response = await call(REPAIR_APPLY_PATH, { name: 'other.yml', plan: planFor(ws.before, SET_FLAG) });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'REPAIR_DOCUMENT_NOT_ALLOWED');
});

test('repair-apply: applyEnabled=false is 403 even with a valid approval file', async (t) => {
  const ws = workspace(t, { applyEnabled: false });
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  writeApproval(ws.approvalsDir, plan);
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { code: 'REPAIR_APPLY_DISABLED' });
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
});

test('repair-apply: no approval file is 409 REPAIR_APPROVAL_MISSING with the server planDigest', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { code: 'REPAIR_APPROVAL_MISSING', planDigest: planDigest(plan) });
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
});

test('repair-apply: an approval file over the size cap is 409 REPAIR_APPROVAL_UNREADABLE', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  const digest = planDigest(plan);
  writeFileSync(join(ws.approvalsDir, `${digest}.json`), ' '.repeat(MAX_APPROVAL_FILE_BYTES + 1), 'utf8');
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { code: 'REPAIR_APPROVAL_UNREADABLE', planDigest: digest });
});

test('repair-apply: with an operator approval file the document becomes afterText and a .before copy exists', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  const preview = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan });
  writeApproval(ws.approvalsDir, plan);
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'applied');
  assert.equal(response.body.wrote, true);
  assert.equal(response.body.receiptVersion, 'repair-receipt/0.1-draft.1');
  assert.equal(response.body.planDigest, planDigest(plan));
  assert.equal(response.body.approver, 'host-operator');
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), preview.body.afterText);
  assert.equal(readFileSync(join(ws.root, `${NAME}.before`), 'utf8'), ws.before);
});

test('repair-apply: an expired approval is 422 refused and nothing is written', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  writeApproval(ws.approvalsDir, plan, { expiresAtMs: Date.now() - 1000 });
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 422);
  assert.equal(response.body.status, 'refused');
  assert.ok(response.body.reasons.includes('APPLY_APPROVAL_EXPIRED'), response.body.reasons.join(','));
  assert.equal(response.body.wrote, false);
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
});

test('repair-apply: an approval naming another plan digest is 422 APPLY_APPROVAL_PLAN_MISMATCH', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  // The file sits under this plan's digest, but its content approves a different plan.
  writeApproval(ws.approvalsDir, plan, { planDigest: 'f'.repeat(64) });
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 422);
  assert.equal(response.body.status, 'refused');
  assert.ok(response.body.reasons.includes('APPLY_APPROVAL_PLAN_MISMATCH'), response.body.reasons.join(','));
  assert.equal(readFileSync(join(ws.root, NAME), 'utf8'), ws.before);
});

test('repair-apply: a denied approval is 422 refused', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const plan = await readyPlan(call, ws.before);
  writeApproval(ws.approvalsDir, plan, { decision: 'deny' });
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 422);
  assert.equal(response.body.status, 'refused');
});

test('repair-apply: a non-record plan is 400 and no approval path is built', async (t) => {
  const ws = workspace(t);
  const { call } = mount(ws.repair);
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan: '../../etc/passwd' });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'REPAIR_PLAN_NOT_RECORD');
});

test('repair-apply: a throwing applier is 500 with the code only; the message goes to the sink', async (t) => {
  const ws = workspace(t);
  const importer = async (specifier) => {
    const real = await packageImporter(specifier);
    if (!specifier.endsWith('/fixture-applier')) return real;
    return { ...real, applyApproved: () => { throw new Error(`disk failure at ${ws.root}`); } };
  };
  const { call, errors } = mount(ws.repair, { repairImporter: importer });
  const plan = await readyPlan(call, ws.before);
  writeApproval(ws.approvalsDir, plan);
  const response = await call(REPAIR_APPLY_PATH, { name: NAME, plan });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { code: 'REPAIR_APPLY_THREW' });
  assert.equal(response.text.includes(ws.root), false);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0].error.message), /disk failure/);
});

// ---- package loading -------------------------------------------------------------

test('loadRepairPackage tries the package name first', async () => {
  const seen = [];
  const outcome = await loadRepairPackage((specifier) => {
    seen.push(specifier);
    return packageImporter(specifier);
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.source, 'package');
  assert.deepEqual(seen.sort(), [
    'dsh-compat-repair/fixture-applier', 'dsh-compat-repair/repair-plan', 'dsh-compat-repair/repair-preview',
  ]);
});

test('loadRepairPackage falls back to the monorepo sibling when the package name does not resolve', async () => {
  const seen = [];
  const outcome = await loadRepairPackage((specifier) => {
    seen.push(specifier);
    if (specifier.startsWith('dsh-compat-repair/')) {
      const error = new Error(`Cannot find package '${specifier}'`);
      error.code = 'ERR_MODULE_NOT_FOUND';
      return Promise.reject(error);
    }
    // The default importer resolves these against api.js; reproduce that here.
    return import(new URL(specifier, new URL('../src/api.js', import.meta.url)).href);
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.source, 'monorepo');
  assert.ok(seen.includes('../../repair/src/repair-preview.js'));
  assert.equal(typeof outcome.applyApproved, 'function');
});

test('loadRepairPackage with the default importer resolves in this checkout', async () => {
  const outcome = await loadRepairPackage();
  assert.equal(outcome.ok, true);
  assert.ok(REPAIR_MODULE_SOURCES.some((entry) => entry.source === outcome.source));
});

test('loadRepairPackage reports both failures when neither path resolves', async () => {
  const outcome = await loadRepairPackage(() => Promise.reject(new Error('not found')));
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.failures.map((f) => f.source), ['package', 'monorepo']);
});

test('loadRepairPackage refuses a module that lacks the needed exports', async () => {
  const outcome = await loadRepairPackage(async () => ({}));
  assert.equal(outcome.ok, false);
  assert.match(String(outcome.failures[0].error.message), /missing exports/);
});

test('without the package, repair routes are 503 REPAIR_PACKAGE_UNAVAILABLE and other routes still mount', async (t) => {
  const ws = workspace(t);
  const { call, connection } = mount(ws.repair, { repairImporter: () => Promise.reject(new Error('absent')) });
  const preview = await call(REPAIR_PREVIEW_PATH, { name: NAME, plan: planFor(ws.before, SET_FLAG) });
  assert.equal(preview.status, 503);
  assert.deepEqual(preview.body, { code: 'REPAIR_PACKAGE_UNAVAILABLE' });
  const apply = await call(REPAIR_APPLY_PATH, { name: NAME, plan: planFor(ws.before, SET_FLAG) });
  assert.equal(apply.status, 503);
  assert.deepEqual(apply.body, { code: 'REPAIR_PACKAGE_UNAVAILABLE' });
  // targets needs no package: it only echoes config names.
  assert.equal((await call(REPAIR_TARGETS_PATH)).status, 200);
  assert.ok(connection.routes.some((route) => route.path === '/api/conflict-report'));
});
