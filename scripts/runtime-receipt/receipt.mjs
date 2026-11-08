#!/usr/bin/env node
/**
 * Runtime resolution receipt — read-only.
 *
 * Records which copy of each runtime package a DSH installation actually
 * resolves, plus the sha256 of the file that copy loads. It exists because two
 * Cordis versions can be present on one host (a global one and the nested one
 * inside the installation); a receipt that names only a version string does not
 * say which bytes will run.
 *
 * Trust boundary: reads package metadata and module files under --installation
 * only, plus this Node's own version. Writes nothing, imports nothing from the
 * installation, starts no process, opens no socket. A path that escapes the
 * installation is refused rather than hashed.
 *
 * Usage: receipt.mjs --installation <dir-of-@deepseek-ai/dsh>
 * Exit: 0 complete receipt · 2 incomplete or escaped · 5 internal · 64 usage
 */

import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'

export const RECEIPT_VERSION = 'runtime-receipt/0.1-draft.1'

/** Modules whose resolved bytes decide how a profile boots. */
export const RECEIPT_MODULES = Object.freeze([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-official-bundles',
])

/** Files inside the installation that are not reachable through a package export. */
export const RECEIPT_FILES = Object.freeze(['lib/bin.js', 'lib/profile-boot-e2mS45fC.js'])

const USAGE = 'usage: receipt.mjs --installation <dir-of-@deepseek-ai/dsh>'

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function inside(installation, file) {
  const root = installation.endsWith(sep) ? installation : installation + sep
  return file === installation || file.startsWith(root)
}

/** @returns {{ok: true, receipt: object} | {ok: false, reason: string}} */
export function buildReceipt(installationArg) {
  let installation
  try {
    installation = realpathSync(resolve(installationArg))
  } catch {
    return { ok: false, reason: 'INSTALLATION_NOT_FOUND' }
  }
  if (!statSync(installation).isDirectory()) return { ok: false, reason: 'INSTALLATION_NOT_DIRECTORY' }

  const manifestPath = join(installation, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { ok: false, reason: 'INSTALLATION_MANIFEST_UNREADABLE' }
  }

  const requireFrom = createRequire(join(installation, 'lib', 'bin.js'))
  const rows = []
  const unresolved = []

  for (const name of RECEIPT_MODULES) {
    let manifestFile
    try {
      manifestFile = requireFrom.resolve(name + '/package.json')
    } catch {
      unresolved.push({ module: name, reason: 'NOT_RESOLVED' })
      continue
    }
    const meta = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const packageDir = resolve(manifestFile, '..')
    let entry
    try {
      entry = requireFrom.resolve(name)
    } catch {
      const main = typeof meta.main === 'string' ? meta.main : undefined
      if (main === undefined) {
        unresolved.push({ module: name, reason: 'NO_ENTRY_FILE' })
        continue
      }
      entry = resolve(packageDir, main)
    }
    const real = realpathSync(entry)
    if (!inside(installation, real)) {
      unresolved.push({ module: name, reason: 'ENTRY_OUTSIDE_INSTALLATION' })
      continue
    }
    rows.push({
      module: name,
      version: typeof meta.version === 'string' ? meta.version : 'unknown',
      file: real.slice(installation.length + 1),
      bytes: statSync(real).size,
      sha256: sha256File(real),
    })
  }

  const own = []
  for (const relative of RECEIPT_FILES) {
    const file = join(installation, relative)
    try {
      own.push({ module: null, version: manifest.version ?? 'unknown', file: relative, bytes: statSync(file).size, sha256: sha256File(file) })
    } catch {
      unresolved.push({ module: relative, reason: 'NOT_READABLE' })
    }
  }

  const receipt = {
    receiptVersion: RECEIPT_VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    installation: {
      package: typeof manifest.name === 'string' ? manifest.name : 'unknown',
      version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
      manifestSha256: sha256File(manifestPath),
    },
    rows: [...rows, ...own],
    unresolved,
    certification: false,
    limitations: [
      'NAMES_THE_RESOLVED_BYTES_ONLY',
      'DOES_NOT_PROVE_THE_PROCESS_USED_THEM',
      'NOT_A_DEPENDENCY_CLOSURE',
      'NOT_A_LOADABILITY_OR_CERTIFICATION_RESULT',
    ],
  }
  return unresolved.length === 0 ? { ok: true, receipt } : { ok: false, reason: 'INCOMPLETE_RECEIPT', receipt }
}

export function main(argv) {
  let installation
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--installation') installation = argv[++index]
    else {
      process.stderr.write(USAGE + '\n')
      return 64
    }
  }
  if (installation === undefined || installation === '') {
    process.stderr.write(USAGE + '\n')
    return 64
  }
  let built
  try {
    built = buildReceipt(installation)
  } catch (error) {
    process.stderr.write('receipt.mjs: internal error: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    return 5
  }
  if (built.receipt !== undefined) process.stdout.write(JSON.stringify(built.receipt, null, 2) + '\n')
  if (!built.ok) {
    process.stderr.write('receipt.mjs: refused: ' + built.reason + '\n')
    return 2
  }
  return 0
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2))
}
