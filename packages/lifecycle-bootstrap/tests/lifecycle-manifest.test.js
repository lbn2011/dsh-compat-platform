import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  LIFECYCLE_CODES,
  LIFECYCLE_KEYS,
  LIFECYCLE_LIMITATIONS,
  LIFECYCLE_LIMITS,
  LIFECYCLE_MANIFEST_VERSION,
  POST_INSTALL_KEYS,
  SCRIPT_EXTENSIONS,
  lifecyclePlanKey,
  readLifecyclePlan,
  resolveScriptPath,
} from '../src/lifecycle-manifest.js';

const PKG_DIR = '/fixtures/example-plugin';

const plan = (declared, extra = {}) =>
  readLifecyclePlan(
    { name: 'example-plugin', dsh: { lifecycle: { postInstall: declared } }, ...extra },
    { packageDir: PKG_DIR },
  );

test('the vocabulary is closed and frozen', () => {
  assert.equal(LIFECYCLE_MANIFEST_VERSION, 'lifecycle-manifest/0.1-draft.1');
  assert.deepEqual([...LIFECYCLE_KEYS], ['postInstall']);
  assert.deepEqual([...POST_INSTALL_KEYS], ['script', 'args', 'timeoutMs']);
  assert.deepEqual([...SCRIPT_EXTENSIONS], ['.js', '.mjs', '.cjs']);
  assert.ok(Object.isFrozen(LIFECYCLE_LIMITS));
  assert.ok(Object.isFrozen(LIFECYCLE_CODES));
  assert.ok(Object.isFrozen(LIFECYCLE_LIMITATIONS));
  assert.equal(new Set(LIFECYCLE_CODES).size, LIFECYCLE_CODES.length);
  assert.ok(LIFECYCLE_LIMITATIONS.length >= 5);
  for (const limitation of LIFECYCLE_LIMITATIONS) {
    assert.equal(typeof limitation, 'string');
    assert.equal(limitation, limitation.toUpperCase());
  }
});

test('options must carry a package directory', () => {
  assert.throws(() => readLifecyclePlan({}, undefined), {
    name: 'TypeError',
    message: /must carry a string packageDir/,
  });
  assert.throws(() => readLifecyclePlan({}, { packageDir: 5 }), {
    name: 'TypeError',
  });
});

test('a package that declares no lifecycle is clean, not defective', () => {
  const bare = readLifecyclePlan({ name: 'bare' }, { packageDir: PKG_DIR });
  assert.deepEqual(bare, { plan: null, issues: [], limitations: [...LIFECYCLE_LIMITATIONS] });

  const noPostInstall = readLifecyclePlan(
    { name: 'x', dsh: { lifecycle: {} } },
    { packageDir: PKG_DIR },
  );
  assert.deepEqual(noPostInstall.issues, []);
  assert.equal(noPostInstall.plan, null);
});

test('a malformed manifest is refused with a code, never silently ignored', () => {
  assert.deepEqual(readLifecyclePlan(null, { packageDir: PKG_DIR }).issues, ['PKG_NOT_OBJECT']);
  assert.deepEqual(
    readLifecyclePlan({ dsh: 'nope' }, { packageDir: PKG_DIR }).issues,
    ['DSH_NOT_OBJECT'],
  );
  assert.deepEqual(
    readLifecyclePlan({ dsh: { lifecycle: 'nope' } }, { packageDir: PKG_DIR }).issues,
    ['LIFECYCLE_NOT_OBJECT'],
  );
  assert.deepEqual(plan(5).issues, ['POST_INSTALL_NOT_STRING_OR_OBJECT']);
});

test('an unknown lifecycle key is reported even when the declaration itself is usable', () => {
  const result = readLifecyclePlan(
    { dsh: { lifecycle: { postInstall: 'scripts/build.js', postBuild: 'x' } } },
    { packageDir: PKG_DIR },
  );
  assert.deepEqual(result.issues, ['LIFECYCLE_UNKNOWN_KEY']);
  assert.equal(result.plan.script, 'scripts/build.js');
});

test('a bare string declaration takes the defaults', () => {
  const result = plan('scripts/build.js');
  assert.deepEqual(result.issues, []);
  assert.equal(result.plan.script, 'scripts/build.js');
  assert.equal(result.plan.scriptPath, `${PKG_DIR}/scripts/build.js`);
  assert.deepEqual([...result.plan.args], []);
  assert.equal(result.plan.timeoutMs, LIFECYCLE_LIMITS.defaultTimeoutMs);
  assert.equal(result.plan.declaration, 'scripts/build.js');
  assert.ok(Object.isFrozen(result.plan));
  assert.ok(Object.isFrozen(result.plan.args));
});

test('an object declaration carries args and timeout', () => {
  const result = plan({ script: 'tools/setup.mjs', args: ['--fast', 'a b'], timeoutMs: 1500 });
  assert.deepEqual(result.issues, []);
  assert.deepEqual([...result.plan.args], ['--fast', 'a b']);
  assert.equal(result.plan.timeoutMs, 1500);
});

test('the script must be a non-empty relative path inside the package', () => {
  assert.deepEqual(plan({}).issues, ['SCRIPT_MISSING']);
  assert.deepEqual(plan({ script: 5 }).issues, ['SCRIPT_NOT_STRING']);
  assert.deepEqual(plan({ script: '' }).issues, ['SCRIPT_EMPTY']);
  assert.deepEqual(plan({ script: '/usr/bin/node' }).issues, ['SCRIPT_ABSOLUTE']);
  assert.deepEqual(plan({ script: '../outside.js' }).issues, ['SCRIPT_OUTSIDE_PACKAGE']);
  assert.deepEqual(plan({ script: 'scripts/setup.sh' }).issues, ['SCRIPT_EXTENSION_UNSUPPORTED']);
  assert.deepEqual(plan({ script: 'scripts/setup' }).issues, ['SCRIPT_EXTENSION_UNSUPPORTED']);
});

test('a refusal never invents a plan', () => {
  for (const declared of [{}, { script: '' }, { script: '../x.js' }, { script: 'x.sh' }]) {
    const result = plan(declared);
    assert.ok(result.issues.length > 0);
    assert.equal(result.plan, null);
  }
});

test('args are bounded in count, type and length', () => {
  assert.deepEqual(plan({ script: 'a.js', args: 'nope' }).issues, ['ARGS_NOT_ARRAY']);
  assert.deepEqual(
    plan({ script: 'a.js', args: Array.from({ length: LIFECYCLE_LIMITS.maxArgs + 1 }, () => 'x') })
      .issues,
    ['ARGS_TOO_MANY'],
  );
  assert.deepEqual(plan({ script: 'a.js', args: ['ok', 7] }).issues, ['ARG_NOT_STRING']);
  assert.deepEqual(
    plan({ script: 'a.js', args: ['x'.repeat(LIFECYCLE_LIMITS.maxArgLength + 1)] }).issues,
    ['ARG_TOO_LONG'],
  );
  assert.deepEqual(plan({ script: 'a.js', args: [] }).issues, []);
});

test('the timeout is a finite number inside the window', () => {
  assert.deepEqual(plan({ script: 'a.js', timeoutMs: 'soon' }).issues, ['TIMEOUT_NOT_NUMBER']);
  assert.deepEqual(plan({ script: 'a.js', timeoutMs: Number.NaN }).issues, ['TIMEOUT_NOT_NUMBER']);
  assert.deepEqual(plan({ script: 'a.js', timeoutMs: Number.POSITIVE_INFINITY }).issues, [
    'TIMEOUT_NOT_NUMBER',
  ]);
  assert.deepEqual(
    plan({ script: 'a.js', timeoutMs: LIFECYCLE_LIMITS.minTimeoutMs - 1 }).issues,
    ['TIMEOUT_OUT_OF_RANGE'],
  );
  assert.deepEqual(
    plan({ script: 'a.js', timeoutMs: LIFECYCLE_LIMITS.maxTimeoutMs + 1 }).issues,
    ['TIMEOUT_OUT_OF_RANGE'],
  );
  assert.deepEqual(
    plan({ script: 'a.js', timeoutMs: LIFECYCLE_LIMITS.maxTimeoutMs }).issues,
    [],
  );
});

test('an unknown postInstall key is reported', () => {
  assert.deepEqual(plan({ script: 'a.js', cwd: '/' }).issues, ['POST_INSTALL_UNKNOWN_KEY']);
});

test('resolveScriptPath reports containment and extension separately', () => {
  assert.deepEqual(resolveScriptPath(PKG_DIR, 'scripts/a.js'), {
    ok: true,
    path: join(PKG_DIR, 'scripts', 'a.js'),
  });
  assert.deepEqual(resolveScriptPath(PKG_DIR, 'scripts/a.sh'), {
    ok: false,
    code: 'SCRIPT_EXTENSION_UNSUPPORTED',
  });
  assert.deepEqual(resolveScriptPath(PKG_DIR, '/etc/passwd.js'), {
    ok: false,
    code: 'SCRIPT_ABSOLUTE',
  });
  assert.deepEqual(resolveScriptPath(PKG_DIR, '../../etc/x.js'), {
    ok: false,
    code: 'SCRIPT_OUTSIDE_PACKAGE',
  });
  assert.deepEqual(resolveScriptPath(PKG_DIR, '.'), {
    ok: false,
    code: 'SCRIPT_RESOLVES_TO_PACKAGE_ROOT',
  });
});

test('the run identity changes with the script, the args or the timeout', () => {
  const a = plan({ script: 'a.js' }).plan;
  const same = plan({ script: 'a.js' }).plan;
  const otherScript = plan({ script: 'b.js' }).plan;
  const otherArgs = plan({ script: 'a.js', args: ['--x'] }).plan;
  const otherTimeout = plan({ script: 'a.js', timeoutMs: 2000 }).plan;

  assert.equal(lifecyclePlanKey(a), lifecyclePlanKey(same));
  assert.notEqual(lifecyclePlanKey(a), lifecyclePlanKey(otherScript));
  assert.notEqual(lifecyclePlanKey(a), lifecyclePlanKey(otherArgs));
  assert.notEqual(lifecyclePlanKey(a), lifecyclePlanKey(otherTimeout));
  assert.ok(lifecyclePlanKey(a).includes('\u0000'));
});
