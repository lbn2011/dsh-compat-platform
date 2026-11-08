// Child-side isolation probe. Runs INSIDE the sandbox; reports what it can see.
//
// It writes only inside its own output directory. Every observation is a
// boolean, an error class or a number — never the content of a host file.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'

function parseArgs(argv) {
  const args = { out: null, supervisorPaths: [], sentinels: [], networkTarget: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--out') args.out = argv[(i += 1)]
    else if (flag === '--supervisor-path') args.supervisorPaths.push(argv[(i += 1)])
    else if (flag === '--sentinel') args.sentinels.push(argv[(i += 1)])
    else if (flag === '--network-target') args.networkTarget = argv[(i += 1)]
  }
  return args
}

function statusValue(status, key) {
  const match = status.match(new RegExp('^' + key + ':\\s*(\\S+)', 'm'))
  return match === null ? null : match[1]
}

function mounts() {
  return readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(' ')
      return { mountPoint: parts[4], fsType: parts[7] }
    })
}

function tryRead(path) {
  try {
    readFileSync(path)
    return { ok: true }
  } catch (error) {
    return { ok: false, code: error.code ?? 'UNKNOWN' }
  }
}

function tryWrite(path) {
  try {
    appendFileSync(path, 'probe')
    return { ok: true }
  } catch (error) {
    return { ok: false, code: error.code ?? 'UNKNOWN' }
  }
}

// One outbound attempt, bounded in time. The result is an error class, never a
// payload: the probe cannot see a listener outside the boundary, so the only
// honest observations are "the attempt failed with <code>" or "it connected".
function tryConnect(target) {
  return new Promise((settle) => {
    if (typeof target !== 'string' || target.length === 0) {
      settle({ label: 'network', target: null, attempted: false, ok: false, code: 'NOT-REQUESTED' })
      return
    }
    const cut = target.lastIndexOf(':')
    const host = target.slice(0, cut)
    const port = Number(target.slice(cut + 1))
    let settled = false
    const done = (row) => {
      if (settled) return
      settled = true
      settle(row)
    }
    const socket = connect({ host, port })
    socket.setTimeout(500)
    socket.on('connect', () => {
      socket.destroy()
      done({ label: 'network', target, attempted: true, ok: true, code: null })
    })
    socket.on('timeout', () => {
      socket.destroy()
      done({ label: 'network', target, attempted: true, ok: false, code: 'TIMEOUT' })
    })
    socket.on('error', (error) => {
      done({ label: 'network', target, attempted: true, ok: false, code: error.code ?? 'UNKNOWN' })
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.out === null) {
    process.stderr.write('child-probe: --out is required\n')
    process.exitCode = 64
    return
  }
  const status = readFileSync('/proc/self/status', 'utf8')
  const identity = {
    uid: process.getuid(),
    gid: process.getgid(),
    capEff: statusValue(status, 'CapEff'),
    capPrm: statusValue(status, 'CapPrm'),
    capBnd: statusValue(status, 'CapBnd'),
    noNewPrivs: Number(statusValue(status, 'NoNewPrivs') ?? -1),
  }
  writeFileSync(args.out + '/child-identity.json', JSON.stringify(identity, null, 2))
  writeFileSync(args.out + '/child-mounts.json', JSON.stringify(mounts(), null, 2))

  const attempts = []
  for (const path of args.supervisorPaths) {
    attempts.push({ label: 'supervisor:' + path, ...tryWrite(path) })
  }
  attempts.push({ label: 'own-write', ...tryWrite(args.out + '/own-write.txt') })
  writeFileSync(args.out + '/write-attempts.json', JSON.stringify(attempts, null, 2))

  const sentinelReads = args.sentinels.map((path) => ({ label: path, ...tryRead(path) }))
  writeFileSync(args.out + '/sentinel-reads.json', JSON.stringify(sentinelReads, null, 2))

  const network = await tryConnect(args.networkTarget)
  writeFileSync(args.out + '/network-attempt.json', JSON.stringify(network, null, 2))
  process.stdout.write('child-probe: ok\n')
}

await main()
