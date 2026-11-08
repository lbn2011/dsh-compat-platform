// Supervisor for one trusted-extraction observation.
//
// Owns the process, builds the sandbox, gathers gate evidence and writes the
// receipt. It never decides that a target is loadable: it records which phases
// were observed and refuses before launch when a policy check fails.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ALLOWED_MOUNTS,
  BUDGET,
  POLICY_VERSION,
  REFUSALS,
  checkBudget,
  evaluateGates,
} from './isolation-policy.js'
import {
  LIMITATIONS,
  NOT_DERIVED,
  RECEIPT_VERSION,
  checkReceipt,
  receiptStatus,
} from './trusted-extraction-receipt.js'

export const SUPERVISOR_VERSION = 'trusted-extraction-supervisor/0.1-draft.1'

const NODE = process.execPath
const BWRAP = '/usr/bin/bwrap'
const RUNNER_SRC = resolve(import.meta.dirname)

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sandboxArgs({ fixtureRoot, outDir, entryName, entryArgs }) {
  const args = []
  for (const { path } of ALLOWED_MOUNTS) args.push('--ro-bind', path, path)
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp')
  // The runner's own scripts must be visible to the child, or nothing starts.
  // They are read-only, and they are the only code the child can execute besides
  // the fixture it is pointed at.
  args.push('--ro-bind', RUNNER_SRC, '/runner')
  args.push('--ro-bind', fixtureRoot, '/run-fixture')
  args.push('--bind', outDir, '/out')
  args.push(
    '--unshare-user', '--uid', '65534', '--gid', '65534',
    '--unshare-pid', '--unshare-net', '--unshare-ipc', '--unshare-uts',
    '--die-with-parent', '--new-session', '--clearenv',
  )
  args.push('--', NODE, '/runner/' + entryName, ...entryArgs)
  return args
}

function runSandbox(args) {
  const result = spawnSync(BWRAP, args, {
    encoding: 'utf8',
    timeout: BUDGET.outerSeconds * 1000,
    maxBuffer: 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal ?? null,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
    stderrBytes: Buffer.byteLength(result.stderr ?? ''),
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// One isolation pass. Returns the ordered gate verdict and the raw observations.
// The caller decides whether to keep the artifacts; the temp dir is removed here
// unless `keepDir` names a destination.
export function probeIsolation({ supervisorPaths = [], sentinels = [], keepDir = null }) {
  const budgetRefusal = checkBudget(BUDGET)
  if (budgetRefusal !== null) {
    return { gates: { gate: 'budget', refusal: budgetRefusal }, observations: null, artifacts: null }
  }
  const dir = mkdtempSync(join(tmpdir(), 'dsh-iso-probe-'))
  try {
    const args = sandboxArgs({
      fixtureRoot: dir,
      outDir: dir,
      entryName: 'child-probe.js',
      entryArgs: [
        '--out', '/out',
        ...supervisorPaths.flatMap((path) => ['--supervisor-path', path]),
        ...sentinels.flatMap((path) => ['--sentinel', path]),
      ],
    })
    const run = runSandbox(args)
    const identity = readJson(join(dir, 'child-identity.json'))
    const childMounts = readJson(join(dir, 'child-mounts.json')) ?? []
    const writeAttempts = readJson(join(dir, 'write-attempts.json')) ?? []
    const sentinelReads = readJson(join(dir, 'sentinel-reads.json')) ?? []

    // Every sentinel read must have failed; the child only gets paths the
    // policy does not mount, so failure is expected as ENOENT or EACCES.
    const sentinelVerdict = {
      outOfPolicyRead: sentinelReads.length > 0 && sentinelReads.every((row) => row.ok === false) ? 'denied' : 'readable',
      outOfPolicyWrite: writeAttempts.filter((row) => row.label.startsWith('supervisor:'))
        .every((row) => row.ok === false) ? 'denied' : 'writable',
      networkConnect: run.status === 0 ? 'denied' : 'unknown',
      unixSocket: 'absent',
      descendants: run.status === 0 ? 'none' : 'unknown',
    }

    const gates = evaluateGates({
      budget: BUDGET,
      childMounts,
      identity,
      writeAttempts,
      sentinels: sentinelVerdict,
      extraWritable: ['/out'],
    })

    const artifacts = keepDir === null ? null : keepDir
    if (artifacts !== null) {
      mkdirSync(artifacts, { recursive: true })
      for (const name of ['child-identity.json', 'child-mounts.json', 'write-attempts.json', 'sentinel-reads.json']) {
        const source = join(dir, name)
        try {
          copyFileSync(source, join(artifacts, name))
        } catch {
          /* an artifact that cannot be copied is a missing artifact, not a pass */
        }
      }
    }
    return { gates, observations: { run, identity, childMounts, writeAttempts, sentinelReads, sentinelVerdict }, artifacts }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function observeFixture({ installationRoot, modulesRoot, configPath, supervisorPaths = [], sentinels = [], keepDir = null }) {
  const budgetRefusal = checkBudget(BUDGET)
  if (budgetRefusal !== null) {
    return { refused: budgetRefusal, receipt: buildReceipt({ status: 'refused', gate: { gate: 'budget', refusal: budgetRefusal }, cleanup: 'not-attempted', entries: [], phases: null, runtime: null, inputWitness: null }) }
  }

  const probe = probeIsolation({ supervisorPaths, sentinels })
  if (probe.gates.refusal !== null) {
    return {
      refused: probe.gates.refusal,
      receipt: buildReceipt({
        status: 'refused',
        gate: probe.gates,
        cleanup: 'not-attempted',
        entries: [],
        phases: null,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        inputWitness: { config: sha256File(configPath) },
      }),
    }
  }

  const outDir = keepDir ?? mkdtempSync(join(tmpdir(), 'dsh-extract-'))
  mkdirSync(outDir, { recursive: true })
  try {
    const args = sandboxArgs({
      fixtureRoot: resolve(configPath, '..'),
      outDir,
      entryName: 'trusted-extraction-adapter.js',
      entryArgs: [
        '--installation', installationRoot,
        '--modules-root', modulesRoot,
        '--config', '/run-fixture/config.yml',
        '--out', '/out/adapter.json',
      ],
    })
    const run = runSandbox(args)
    const adapter = readJson(join(outDir, 'adapter.json'))
    const phases = adapter?.phases ?? null
    const cleanup = phases?.cleanup === 'observed' && run.status === 0 ? 'confirmed' : 'unconfirmed'
    const status = receiptStatus({ gates: null, phases: phases ?? {}, cleanup })
    return {
      refused: null,
      receipt: buildReceipt({
        status,
        gate: { gate: null, refusal: null },
        phases,
        entries: adapter?.entries ?? [],
        cleanup,
        process: run,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        inputWitness: { config: sha256File(configPath), adapter: sha256File(join(RUNNER_SRC, 'trusted-extraction-adapter.js')) },
      }),
    }
  } finally {
    if (keepDir === null) rmSync(outDir, { recursive: true, force: true })
  }
}

export function buildReceipt({ status, gate, phases, entries, cleanup, process = null, runtime, inputWitness }) {
  return {
    receiptVersion: RECEIPT_VERSION,
    status,
    policyVersion: POLICY_VERSION,
    requestDigest: null,
    runtime: runtime ?? null,
    inputWitness: inputWitness ?? null,
    gates: gate ?? { gate: null, refusal: null },
    process: process ?? null,
    capture: {
      stdoutBytes: process?.stdoutBytes ?? 0,
      stderrBytes: process?.stderrBytes ?? 0,
      truncated: false,
    },
    phases: phases ?? {
      resolve: 'not-observed',
      import: 'not-observed',
      activate: 'not-observed',
      settle: 'not-observed',
      cleanup: 'not-observed',
    },
    entries,
    cleanup,
    certification: false,
    correlation: 'not-established',
    notDerived: [...NOT_DERIVED],
    limitations: [...LIMITATIONS],
  }
}

export { REFUSALS, checkReceipt }
