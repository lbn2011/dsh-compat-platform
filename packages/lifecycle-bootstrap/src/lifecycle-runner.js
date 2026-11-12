/**
 * Runs one declared lifecycle script under bounded process constraints.
 *
 * The runner enforces what a process can actually be held to from the outside:
 * a wall-clock deadline, an output ceiling, one child at a time, and a small
 * environment allow-list. It does NOT sandbox the script — a child process
 * inherits the host process's identity and can touch anything the host can.
 * That gap is named in {@link RUNNER_LIMITATIONS} rather than papered over.
 *
 * `spawn` is injected so tests can drive the deadline and the output ceiling
 * without launching real processes; production passes `node:child_process`.
 *
 * @module dsh-compat-lifecycle-bootstrap/lifecycle-runner
 */

import { spawn as nodeSpawn } from 'node:child_process';

export const RUNNER_VERSION = 'lifecycle-runner/0.1-draft.1';

/** Terminal states. `refused` never spawns; `spawn-error` means no child ran. */
export const RUN_STATUSES = Object.freeze(['ok', 'failed', 'timeout', 'output-limit', 'spawn-error', 'refused']);

export const RUNNER_CODES = Object.freeze([
  'SPAWN_FAILED',
  'CHILD_ERROR',
  'DEADLINE_EXCEEDED',
  'OUTPUT_CEILING_EXCEEDED',
  'ABORTED',
]);

/**
 * Environment variable names a lifecycle script receives. Everything else in
 * the host environment — tokens, registry credentials, proxy URLs — is withheld,
 * because a lifecycle script authored by a package should not inherit them by
 * accident.
 */
export const RUNNER_ENV_ALLOW_LIST = Object.freeze([
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
]);

export const RUNNER_LIMITATIONS = Object.freeze([
  'CHILD_INHERITS_HOST_PRIVILEGES',
  'CHILD_MAY_OUTLIVE_THE_DEADLINE_IF_IT_IGNORES_SIGKILL',
  'OUTPUT_IS_TRUNCATED_AT_THE_CEILING_NOT_COMPLETE',
  'ENV_ALLOW_LIST_WITHHOLDS_VARIABLES_A_SCRIPT_MAY_NEED',
  'KILL_IS_NOT_A_SANDBOX',
]);

/** Build the child environment from the allow-list. */
export function boundedEnv(source, extra = {}) {
  const env = {};
  for (const name of RUNNER_ENV_ALLOW_LIST) {
    const value = source?.[name];
    if (typeof value === 'string') env[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value === 'string') env[name] = value;
  }
  return env;
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Cut a byte buffer at `room` bytes without splitting a UTF-8 sequence.
 *
 * Decoding a partial sequence yields U+FFFD, which re-encodes to three bytes and
 * would push the recorded total past the ceiling — so the cut backs off a few
 * bytes until the decoded text re-encodes inside the room. The back-off is
 * bounded (UTF-8 sequences are at most four bytes) so a chunk full of invalid
 * bytes cannot turn this into a scan.
 *
 * @param {Buffer} bytes
 * @param {number} room
 * @returns {{text: string, bytes: number}}
 */
function truncateUtf8(bytes, room) {
  let cut = Math.min(bytes.length, room);
  for (let attempt = 0; attempt < 4 && cut > 0; attempt += 1) {
    const text = bytes.subarray(0, cut).toString('utf8');
    const size = Buffer.byteLength(text, 'utf8');
    if (size <= room && !text.endsWith('\uFFFD')) return { text, bytes: size };
    cut -= 1;
  }
  return { text: '', bytes: 0 };
}

/**
 * @typedef {object} RunLifecycleOptions
 * @property {string} cwd package directory the script runs in
 * @property {object} [spawn] child_process.spawn-compatible factory
 * @property {NodeJS.ProcessEnv} [env] host environment to filter (default process.env)
 * @property {number} [maxOutputBytes] output ceiling (default 65536)
 * @property {number} [killGraceMs] wait for `close` after SIGKILL before giving up
 * @property {AbortSignal} [signal] caller cancellation
 */

/**
 * Run one plan.
 *
 * @param {{scriptPath: string, args: readonly string[], timeoutMs: number}} plan
 * @param {RunLifecycleOptions} options
 * @returns {Promise<{status: string, code: string|null, exitCode: number|null,
 *   signal: string|null, durationMs: number, chunks: Array<{stream: string, text: string}>,
 *   outputBytes: number, outputTruncated: boolean, limitations: string[]}>}
 */
export async function runLifecycle(plan, options) {
  if (!isPlainObject(plan) || typeof plan.scriptPath !== 'string') {
    throw new TypeError('lifecycle-runner: plan must carry a string scriptPath');
  }
  if (!isPlainObject(options) || typeof options.cwd !== 'string') {
    throw new TypeError('lifecycle-runner: options must carry a string cwd');
  }
  const spawnImpl = options.spawn ?? nodeSpawn;
  if (typeof spawnImpl !== 'function') {
    throw new TypeError('lifecycle-runner: spawn must be a function');
  }
  const maxOutputBytes = options.maxOutputBytes ?? 65536;
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new TypeError('lifecycle-runner: maxOutputBytes must be a positive integer');
  }
  const timeoutMs = plan.timeoutMs ?? 60000;
  const killGraceMs = options.killGraceMs ?? 2000;
  const started = Date.now();

  const result = {
    status: 'failed',
    code: null,
    exitCode: null,
    signal: null,
    durationMs: 0,
    chunks: [],
    outputBytes: 0,
    outputTruncated: false,
    limitations: [...RUNNER_LIMITATIONS],
  };

  if (options.signal?.aborted) {
    result.status = 'refused';
    result.code = 'ABORTED';
    return result;
  }

  const args = Array.isArray(plan.args) ? [...plan.args] : [];
  let child;
  try {
    child = spawnImpl(process.execPath, [plan.scriptPath, ...args], {
      cwd: options.cwd,
      env: boundedEnv(options.env ?? process.env, {
        DSH_COMPAT_LIFECYCLE: '1',
      }),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    result.status = 'spawn-error';
    result.code = 'SPAWN_FAILED';
    result.durationMs = Date.now() - started;
    return result;
  }

  let settledResolve;
  const settled = new Promise((resolvePromise) => {
    settledResolve = resolvePromise;
  });
  let killedWhy = null;
  let deadlineTimer = null;
  let graceTimer = null;

  const finish = (status, code) => {
    if (result.settled) return;
    result.settled = true;
    result.status = status;
    result.code = code;
    result.durationMs = Date.now() - started;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (graceTimer) clearTimeout(graceTimer);
    if (options.signal) options.signal.removeEventListener?.('abort', onAbort);
    settledResolve();
  };

  const kill = (why) => {
    if (killedWhy) return;
    killedWhy = why;
    try {
      child.kill('SIGKILL');
    } catch {
      /* The child may already be gone; the close event still settles us. */
    }
    // A child that ignores SIGKILL keeps its pipes open. Stop waiting on it.
    graceTimer = setTimeout(() => {
      finish(why === 'timeout' ? 'timeout' : 'output-limit',
        why === 'timeout' ? 'DEADLINE_EXCEEDED' : 'OUTPUT_CEILING_EXCEEDED');
    }, killGraceMs);
    graceTimer.unref?.();
  };

  const onAbort = () => {
    kill('abort');
  };
  if (options.signal) options.signal.addEventListener?.('abort', onAbort, { once: true });

  const collect = (stream) => (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (bytes.length === 0) return;
    const room = maxOutputBytes - result.outputBytes;
    if (bytes.length > room) {
      const tail = truncateUtf8(bytes, Math.max(0, room));
      if (tail.text.length > 0) {
        result.chunks.push({ stream, text: tail.text });
        result.outputBytes += tail.bytes;
      }
      result.outputTruncated = true;
      kill('output');
      return;
    }
    const text = bytes.toString('utf8');
    result.chunks.push({ stream, text });
    result.outputBytes += bytes.length;
  };

  child.stdout?.on?.('data', collect('stdout'));
  child.stderr?.on?.('data', collect('stderr'));

  child.on?.('error', () => {
    if (killedWhy) return;
    finish('spawn-error', 'CHILD_ERROR');
  });

  child.on?.('close', (code, signal) => {
    result.exitCode = typeof code === 'number' ? code : null;
    result.signal = typeof signal === 'string' ? signal : null;
    if (killedWhy === 'timeout') finish('timeout', 'DEADLINE_EXCEEDED');
    else if (killedWhy === 'output') finish('output-limit', 'OUTPUT_CEILING_EXCEEDED');
    else if (killedWhy === 'abort') finish('refused', 'ABORTED');
    else if (result.exitCode === 0) finish('ok', null);
    else finish('failed', null);
  });

  deadlineTimer = setTimeout(() => kill('timeout'), timeoutMs);
  deadlineTimer.unref?.();

  await settled;
  const { settled: _settled, ...rest } = result;
  return rest;
}

/** Concatenate the collected chunks in arrival order, stdout and stderr interleaved. */
export function renderOutput(chunks) {
  return chunks.map((chunk) => chunk.text).join('');
}
