#!/usr/bin/env node
/**
 * boot — a minimal cordis composition: the installed web carrier plus the
 * read-only diagnostics GUI plugin.
 *
 * WHY SO SMALL: the subject of this batch is one route pair on the carrier
 * contract. Booting the full `dsh web` profile would drag the SPA, the model
 * providers and dozens of third-party plugins into a run whose evidence is six
 * HTTP assertions. This composition therefore has exactly two plugins.
 *
 * WHY MODULES ARE RESOLVED BY PATH: the composition must use the INSTALLED
 * carrier, and the installed carriage lives in the global node_modules tree,
 * which is not on this script's resolution path. `createRequire` against a
 * caller-supplied modules root resolves the real package entry (honouring its
 * `exports` map), and the entry is then imported by file URL. Nothing is
 * installed, and the root is an argument rather than a hidden constant.
 *
 * USAGE: node boot.mjs --modules-root <dir> --envelope <file> --ready-file <file>
 *                     [--host 127.0.0.1] [--port 0]
 *
 * The process writes a small JSON file once the carrier is listening, then waits
 * for SIGTERM/SIGINT. Port 0 means the OS assigns one; the file reports it.
 */

import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { apply as guiApply, inject as guiInject, name as guiName } from '../../packages/host/src/index.js'

function readArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      out[key] = 'true'
      continue
    }
    out[key] = value
    i += 1
  }
  return out
}

const args = readArgs(process.argv.slice(2))
const modulesRoot = args['modules-root']
const envelopePath = args.envelope
const readyFile = args['ready-file']
const host = args.host ?? '127.0.0.1'
const port = Number(args.port ?? '0')

if (!modulesRoot || !envelopePath || !readyFile) {
  console.error('boot: --modules-root, --envelope and --ready-file are required')
  process.exit(70)
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`boot: --port must be an integer in 0..65535, got ${args.port}`)
  process.exit(70)
}

const require = createRequire(join(modulesRoot, 'boot-resolver.cjs'))
const cordisEntry = require.resolve('@deepseek-ai/cordis')
const webserverEntry = require.resolve('@deepseek-ai/dsh-host-webserver')

const { Context } = await import(pathToFileURL(cordisEntry).href)
const webserverModule = await import(pathToFileURL(webserverEntry).href)
const WebServer = webserverModule.default ?? webserverModule.WebServer

// A function's own `name` is read-only, so the plugin is handed to cordis as a
// fresh record that carries the same apply/name/inject triple.
const gui = { name: guiName, inject: guiInject, apply: guiApply }

const root = new Context()
let disposing = false

async function shutdown(signal) {
  if (disposing) return
  disposing = true
  console.error(`boot: ${signal} received, disposing the composition`)
  try {
    await root.fiber.dispose()
  } catch (error) {
    console.error(`boot: dispose failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await root.plugin(WebServer, { host, port })
  await root.plugin(gui, { envelopePath })
} catch (error) {
  console.error(`boot: composition failed: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(71)
}

// The carrier binds during service init; poll briefly rather than assume.
let origin = null
for (let attempt = 0; attempt < 100 && origin === null; attempt += 1) {
  try {
    origin = root.webServer.getOrigin()
  } catch {
    await new Promise((done) => setTimeout(done, 50))
  }
}
if (origin === null) {
  console.error('boot: the carrier never reported an origin')
  await root.fiber.dispose()
  process.exit(71)
}

const listening = root.webServer.port
await writeFile(
  readyFile,
  `${JSON.stringify({ origin, host: root.webServer.host, port: listening }, null, 2)}\n`,
  'utf8',
)
console.log(`boot: listening origin=${origin} envelope=${envelopePath}`)
