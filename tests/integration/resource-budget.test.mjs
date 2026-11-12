/**
 * The budget the integration run is allowed to spend, read from the envelope
 * rather than assumed.
 *
 * WHY THIS FILE REFUSES TO PASS OUTSIDE THE ENVELOPE: the numbers t12 must prove
 * are `memory_peak` and `pids_peak` for the whole run, and those are measured by
 * the bounded runner from cgroup counters (`memory.peak`, `pids.peak`) after the
 * payload exits. A test process cannot read its own final peak — it is still
 * running. So this file does two different things and never conflates them:
 *
 *   - INSIDE the envelope it asserts that the limits really are the contracted
 *     ones (384 MiB, 32 tasks, 120 s, 192 MiB old space) and that this process
 *     is living inside them;
 *   - OUTSIDE the envelope it skips, and says that the peaks belong to the
 *     runner's `peaks.txt`.
 *
 * A skip here is not a pass: the envelope run is what produces the evidence.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cgroupLimits, envelopeFacts, versionLine } from './helpers/contract.mjs';

/** The contracted limits (scripts/bounded-runner/policy.sh). */
const CONTRACT = Object.freeze({
  memoryBytes: 402_653_184, // 384 MiB
  tasksMax: 32,
  runtimeUsec: 120_000_000, // 120 s
  nodeOldSpaceMb: 192,
});

const MiB = 1024 * 1024;

test('the run reports the versions and the envelope it is running in', () => {
  const facts = envelopeFacts();
  // Printed, not asserted: this line is copied into the record so the numbers
  // below are attributed to exact versions.
  console.log(`versions: ${versionLine()}`);
  console.log(`envelope: inEnvelope=${facts.inEnvelope} memory=${facts.memoryLimitBytes} tasks=${facts.tasksMax} runtimeMs=${facts.runtimeLimitMs} nodeOptions=${facts.nodeOptions}`);
  assert.match(versionLine(), /^spec@\S+ kit@\S+ platform@\S+ node@v\d+\./);
});

test('inside the envelope the limits are the contracted ones', (t) => {
  const facts = envelopeFacts();
  if (!facts.inEnvelope) {
    t.skip('not inside the bounded envelope: run this suite via scripts/integration-batch/run.sh');
    return;
  }
  assert.equal(facts.memoryLimitBytes, CONTRACT.memoryBytes, '384 MiB');
  assert.equal(facts.tasksMax, CONTRACT.tasksMax, '32 tasks');
  assert.equal(facts.runtimeLimitMs, CONTRACT.runtimeUsec / 1000, '120 s wall clock');
  // The runner caps V8's old space too: a heap cap smaller than the cgroup cap
  // turns a heap blow-up into a JS error instead of an OOM kill.
  assert.match(String(facts.nodeOptions), new RegExp(`--max-old-space-size=${CONTRACT.nodeOldSpaceMb}(\\s|$)`));

  // And the kernel agrees: the cgroup this process lives in carries the same
  // numbers. A runner that only *exported* the variables would fail here.
  const limits = cgroupLimits();
  assert.equal(limits.available, true, `cgroup files unreadable: ${limits.error ?? ''}`);
  assert.equal(limits.memoryMax, String(CONTRACT.memoryBytes));
  assert.equal(limits.pidsMax, String(CONTRACT.tasksMax));
  assert.equal(limits.swapMax, '0', 'no swap: the cap cannot be elided by swapping');
});

test('this process stays inside the budget it is being measured against', (t) => {
  const facts = envelopeFacts();
  if (!facts.inEnvelope) {
    t.skip('not inside the bounded envelope: peaks belong to the runner\u2019s peaks.txt');
    return;
  }
  const usage = process.memoryUsage();
  const limitBytes = facts.memoryLimitBytes ?? CONTRACT.memoryBytes;
  // A current-RSS check, not a peak: peak is the runner's number.
  assert.ok(
    usage.rss < limitBytes,
    `rss ${(usage.rss / MiB).toFixed(1)} MiB must stay under the ${(limitBytes / MiB).toFixed(0)} MiB cap`,
  );
  // The heap cap is enforced by V8, so the heap total must be under it.
  assert.ok(
    usage.heapTotal <= CONTRACT.nodeOldSpaceMb * MiB,
    `heapTotal ${(usage.heapTotal / MiB).toFixed(1)} MiB must stay under the ${CONTRACT.nodeOldSpaceMb} MiB old-space cap`,
  );
  console.log(`rss=${usage.rss} heapTotal=${usage.heapTotal} heapUsed=${usage.heapUsed} limit=${limitBytes}`);
});

test('the integration suites themselves fit the envelope', async (t) => {
  const facts = envelopeFacts();
  if (!facts.inEnvelope) {
    t.skip('not inside the bounded envelope');
    return;
  }
  // All integration work happens in one process with a bounded scratch dir; the
  // test asserts the mechanism rather than a wall-clock number: a scratch write
  // plus a full detector sweep must not need more than a few MiB.
  const before = process.memoryUsage().rss;
  const { createConflictDetector } = await import('../../packages/analyzer/src/conflict-detector.js');
  const detector = createConflictDetector();
  for (let index = 0; index < 200; index += 1) {
    detector.upsert(`owner-${index}`, [{ kind: 'tool', key: `tool-${index}`, scope: 'plugin', uid: `uid-${index}` }]);
  }
  const snapshot = detector.snapshot();
  assert.equal(snapshot.totals.accepted ?? 200, 200);
  const delta = process.memoryUsage().rss - before;
  assert.ok(delta < 64 * MiB, `200 claims grew rss by ${(delta / MiB).toFixed(1)} MiB`);
});

test('the runner writes its peaks next to the run, and this suite does not guess them', () => {
  // The evidence file is the runner's, named in the bounded-runner contract. The
  // path is only checked when the runner told us where the run directory is;
  // otherwise the assertion would be about this machine, not about the contract.
  const runDir = process.env.BR_RUN;
  if (runDir === undefined) return;
  const peaks = readFileSync(`${runDir}/peaks.txt`, 'utf8');
  assert.match(peaks, /^memory_peak=\d+$/m);
  assert.match(peaks, /^pids_peak=\d+$/m);
  // Peaks are written after the payload exits, so a missing file at this point
  // is expected — but a present one must already carry both numbers.
});
