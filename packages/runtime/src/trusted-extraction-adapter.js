// Child-side profile observation adapter. Runs INSIDE the sandbox.
//
// Boots a synthetic profile with the official @deepseek-ai/dsh-app-boot `boot()`
// — which registers the builtin include/group, mounts the root config and runs
// the startup audit — then reads per-entry outcomes from the returned context's
// loader entries. Only `boot` and `auditStartupEntries` are exported by the
// installed app-boot; internal helpers seen in the source mirror are not, so
// this adapter uses only what the build actually exports.
//
// Phases describe the PIPELINE steps this adapter completed. Per-entry verdicts
// live in `entries`. A failed entry (import throw, activation throw) does not
// make a phase failed: the adapter observed it, which is the whole point.
//
// Output carries counts and closed state words only. Error messages, module
// specifiers of services and config values never cross this boundary.

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'

const ADAPTER_VERSION = 'trusted-extraction-adapter/0.1-draft.1'

// Fiber.state is a const enum in the type declarations and has no runtime
// export, so the integer-to-word mapping is restated here and pinned by a test
// against a live fiber where practical.
const STATE_WORDS = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' }

function resolveRuntime(installationRoot, modulesRoot) {
  const require = createRequire(modulesRoot + '/resolve.cjs')
  const one = (name) => pathToFileURL(require.resolve(name, { paths: [installationRoot] })).href
  return { appBoot: one('@deepseek-ai/dsh-app-boot') }
}

function entryState(entry) {
  try {
    if (entry.disabled) return 'disabled'
    if (entry.fiber === undefined) return 'failed'
    return STATE_WORDS[entry.fiber.state] ?? 'unknown'
  } catch {
    return 'failed'
  }
}

// The installed app-boot exports `boot` and `auditStartupEntries` only; the
// richer `inactiveEntries`/`importFailure` helpers seen in the source mirror are
// not exported by this build. A failed entry's own state cannot say whether the
// module threw on import or its apply() threw, so the adapter re-imports the
// entry's module the same way the internal helper does: a throw means the import
// failed, a resolution means the module was importable and activation failed.
// Re-importing runs module side effects a second time; that is acceptable here
// only because every target is a synthetic fixture in a throwaway sandbox, and
// the fact is recorded as a limitation rather than hidden.
async function failurePhase(entry) {
  try {
    await entry.parent.tree.import(entry.options.name)
    return 'activation'
  } catch {
    return 'import'
  }
}

function missingCount(entry) {
  try {
    const inject = entry.fiber?.inject
    if (inject === null || inject === undefined) return 0
    let count = 0
    for (const name of Object.keys(inject)) {
      if (entry.fiber?._checkImpl === undefined) count += 1
    }
    return count
  } catch {
    return 0
  }
}

async function observe({ installationRoot, modulesRoot, configPath }) {
  const { appBoot } = resolveRuntime(installationRoot, modulesRoot)
  const { boot } = await import(appBoot)

  const phases = {
    resolve: 'not-observed',
    import: 'not-observed',
    activate: 'not-observed',
    settle: 'not-observed',
    cleanup: 'not-observed',
  }

  phases.resolve = 'observed'
  let ctx = null
  let entries = []
  let bootError = null

  try {
    ctx = await boot('dsh', configPath, [], async () => {})
    phases.import = 'observed'
    phases.settle = 'observed'

    for (const entry of ctx.loader.entries()) {
      const state = entryState(entry)
      entries.push({
        id: String(entry.options?.id ?? ''),
        state,
        missingCount: missingCount(entry),
        failurePhase: state === 'failed' ? await failurePhase(entry) : null,
      })
    }
    phases.activate = 'observed'
  } catch (error) {
    // boot() throws StartupError when a REQUIRED entry is inactive (the root
    // include failed to mount, e.g. invalid YAML). That is an import failure,
    // reported as such without copying the error text.
    bootError = 'startup-refused'
    phases.import = 'failed'
  }

  if (ctx !== null) {
    try {
      await ctx.fiber.dispose()
      phases.cleanup = 'observed'
    } catch {
      phases.cleanup = 'interrupted'
    }
  } else {
    phases.cleanup = 'not-observed'
  }

  return {
    adapterVersion: ADAPTER_VERSION,
    status: phases.cleanup === 'observed' && bootError === null ? 'observed' : 'incomplete',
    bootError,
    phases,
    entries,
    certification: false,
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (key === '--installation') args.installationRoot = argv[i + 1]
    else if (key === '--modules-root') args.modulesRoot = argv[i + 1]
    else if (key === '--config') args.configPath = argv[i + 1]
    else if (key === '--out') args.out = argv[i + 1]
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.installationRoot || !args.modulesRoot || !args.configPath || !args.out) {
    process.stderr.write('adapter: --installation --modules-root --config --out are required\n')
    process.exitCode = 64
    return
  }
  const result = await observe(args)
  writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n')
  process.stdout.write('adapter: ' + result.status + '\n')
}

main()
