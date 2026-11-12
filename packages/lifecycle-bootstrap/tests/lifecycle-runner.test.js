import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  RUNNER_CODES,
  RUNNER_ENV_ALLOW_LIST,
  RUNNER_LIMITATIONS,
  RUNNER_VERSION,
  RUN_STATUSES,
  boundedEnv,
  renderOutput,
  runLifecycle,
} from '../src/lifecycle-runner.js';

/**
 * A child_process.spawn stand-in: records the call, then lets the test decide
 * when stdout/stderr data and the close event arrive.
 */
function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = [];
  child.kill = (signal) => {
    child.killed.push(signal);
    return true;
  };
  return child;
}

function spawnRecording(child) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
  return { spawn, calls };
}

const PLAN = { scriptPath: '/pkg/scripts/build.js', args: ['--fast'], timeoutMs: 50 };

test('the vocabulary is closed and frozen', () => {
  assert.equal(RUNNER_VERSION, 'lifecycle-runner/0.1-draft.1');
  assert.deepEqual([...RUN_STATUSES], [
    'ok',
    'failed',
    'timeout',
    'output-limit',
    'spawn-error',
    'refused',
  ]);
  assert.equal(new Set(RUNNER_CODES).size, RUNNER_CODES.length);
  assert.ok(Object.isFrozen(RUNNER_CODES));
  assert.ok(Object.isFrozen(RUNNER_LIMITATIONS));
  assert.ok(RUNNER_ENV_ALLOW_LIST.includes('PATH'));
  assert.ok(!RUNNER_ENV_ALLOW_LIST.includes('DSH_TOKEN'));
});

test('argument shapes are programming errors', async () => {
  await assert.rejects(() => runLifecycle({}, { cwd: '/pkg' }), {
    name: 'TypeError',
    message: /string scriptPath/,
  });
  await assert.rejects(() => runLifecycle(PLAN, null), { name: 'TypeError' });
  await assert.rejects(() => runLifecycle(PLAN, { cwd: '/pkg', maxOutputBytes: 0 }), {
    name: 'TypeError',
  });
  await assert.rejects(() => runLifecycle(PLAN, { cwd: '/pkg', spawn: 'nope' }), {
    name: 'TypeError',
  });
});

test('the child environment is an allow-list, never the whole host env', () => {
  const env = boundedEnv({ PATH: '/bin', HOME: '/root', DSH_TOKEN: 'secret' }, { EXTRA: '1' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/root', EXTRA: '1' });
  assert.equal(boundedEnv({ PATH: '/bin', HOME: 5 }).HOME, undefined);
});

test('a zero exit is ok and the call carries the bounded envelope', async () => {
  const child = fakeChild();
  const { spawn, calls } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn, env: { PATH: '/bin' } });

  child.stdout.emit('data', Buffer.from('building\n'));
  child.emit('close', 0, null);
  const result = await pending;

  assert.equal(result.status, 'ok');
  assert.equal(result.code, null);
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputTruncated, false);
  assert.deepEqual(result.chunks, [{ stream: 'stdout', text: 'building\n' }]);
  assert.equal(result.outputBytes, 9);
  assert.deepEqual(result.limitations, [...RUNNER_LIMITATIONS]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [PLAN.scriptPath, '--fast']);
  assert.equal(calls[0].options.cwd, '/pkg');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].options.env.DSH_COMPAT_LIFECYCLE, '1');
  assert.equal(calls[0].options.env.PATH, '/bin');
});

test('a non-zero exit is failed, and the code is still reported', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn });
  child.stderr.emit('data', Buffer.from('boom\n'));
  child.emit('close', 7, null);
  const result = await pending;

  assert.equal(result.status, 'failed');
  assert.equal(result.code, null);
  assert.equal(result.exitCode, 7);
  assert.deepEqual(result.chunks, [{ stream: 'stderr', text: 'boom\n' }]);
});

test('a signal death keeps the signal and is failed', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn });
  child.emit('close', null, 'SIGTERM');
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('a synchronous spawn failure is spawn-error, not a crash', async () => {
  const result = await runLifecycle(PLAN, {
    cwd: '/pkg',
    spawn: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(result.status, 'spawn-error');
  assert.equal(result.code, 'SPAWN_FAILED');
});

test('an error event is spawn-error as well', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn });
  child.emit('error', new Error('EACCES'));
  const result = await pending;
  assert.equal(result.status, 'spawn-error');
  assert.equal(result.code, 'CHILD_ERROR');
});

test('the deadline kills the child and reports timeout', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle({ ...PLAN, timeoutMs: 10 }, { cwd: '/pkg', spawn });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(child.killed, ['SIGKILL']);
  child.emit('close', null, 'SIGKILL');
  const result = await pending;
  assert.equal(result.status, 'timeout');
  assert.equal(result.code, 'DEADLINE_EXCEEDED');
});

test('a child that ignores SIGKILL cannot hang the host', async () => {
  const child = fakeChild();
  // Never emit close: only the grace timer can settle the promise.
  const { spawn } = spawnRecording(child);
  const result = await runLifecycle(
    { ...PLAN, timeoutMs: 10 },
    { cwd: '/pkg', spawn, killGraceMs: 20 },
  );
  assert.equal(result.status, 'timeout');
  assert.equal(result.code, 'DEADLINE_EXCEEDED');
  assert.deepEqual(child.killed, ['SIGKILL']);
});

test('the output ceiling truncates at the ceiling and kills the child', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn, maxOutputBytes: 10 });
  child.stdout.emit('data', Buffer.from('0123456789ABCDEF'));
  child.emit('close', null, 'SIGKILL');
  const result = await pending;

  assert.equal(result.status, 'output-limit');
  assert.equal(result.code, 'OUTPUT_CEILING_EXCEEDED');
  assert.equal(result.outputTruncated, true);
  assert.equal(result.outputBytes, 10);
  assert.equal(renderOutput(result.chunks), '0123456789');
  assert.deepEqual(child.killed, ['SIGKILL']);
});

test('the ceiling counts bytes, not characters', async () => {
  const child = fakeChild();
  const { spawn } = spawnRecording(child);
  const pending = runLifecycle(PLAN, { cwd: '/pkg', spawn, maxOutputBytes: 5 });
  // '你好' is 6 UTF-8 bytes; only 5 fit and the cut lands mid-character.
  child.stdout.emit('data', Buffer.from('你好', 'utf8'));
  child.emit('close', null, 'SIGKILL');
  const result = await pending;
  assert.equal(result.outputTruncated, true);
  assert.ok(result.outputBytes <= 5);
});

test('an already aborted signal refuses before spawning', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runLifecycle(PLAN, {
    cwd: '/pkg',
    spawn: () => {
      throw new Error('must not spawn');
    },
    signal: controller.signal,
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.code, 'ABORTED');
});

test('renderOutput keeps arrival order across both streams', () => {
  assert.equal(
    renderOutput([
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
      { stream: 'stdout', text: 'c' },
    ]),
    'abc',
  );
  assert.equal(renderOutput([]), '');
});
