#!/usr/bin/env node
// Two questions about one *published* older release, answered without installing its
// whole dependency tree (which does not fit a 120 s envelope — see the record):
//
//   1. what does the release's own manifest say (version, dependencies)?
//   2. does the `@deepseek-ai/dsh-app-boot` version it depends on expose
//      `boot` and `auditStartupEntries` — the interface this repository's fixture
//      observation is built on?
//
// The second answer is read from the extracted tarball's own bytes, not from prose.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_EXPORTS = ['boot', 'auditStartupEntries']

export async function probeRelease({ manifestPath, appBootDir, out, requestedVersion = null }) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // `npm view <name>@<version> --json` answers with an array even for a single version.
  const manifest = Array.isArray(raw)
    ? (raw.find((entry) => entry && entry.version === requestedVersion) ?? raw[0] ?? {})
    : raw
  const depVersion = manifest.dependencies?.['@deepseek-ai/dsh-app-boot'] ?? null
  const result = {
    release: { name: manifest.name ?? null, version: manifest.version ?? null },
    dependencyCount: Object.keys(manifest.dependencies ?? {}).length,
    appBootDependency: depVersion,
    appBoot: { present: false },
  }

  const entry = join(appBootDir, 'package', 'lib', 'index.js')
  const appBootManifest = join(appBootDir, 'package', 'package.json')
  if (existsSync(entry)) {
    const own = JSON.parse(readFileSync(appBootManifest, 'utf8'))
    // The built file is read as text, not imported: importing it pulls in
    // `@deepseek-ai/cordis`, which is not present in a bare package tarball. So this
    // answers "which names does the built module export", not "which of them are
    // functions at runtime" — that distinction is recorded, not blurred.
    const source = readFileSync(entry, 'utf8')
    const names = new Set()
    for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of match[1].split(',')) {
        const pieces = part.trim().split(/\s+as\s+/)
        const name = (pieces[1] ?? pieces[0] ?? '').trim()
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name)
      }
    }
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      names.add(match[1])
    }
    const present = [...names].sort()
    result.appBoot = {
      present: true,
      version: own.version ?? null,
      method: 'export-statement-scan-of-lib/index.js',
      exportCount: present.length,
      exports: present.slice(0, 40),
      required: REQUIRED_EXPORTS.map((name) => ({ name, present: names.has(name) })),
      usable: REQUIRED_EXPORTS.every((name) => names.has(name)),
    }
  }

  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , manifestPath, appBootDir, out, requestedVersion = null] = process.argv
  if (!manifestPath || !appBootDir || !out) {
    process.stderr.write('usage: probe-release.mjs <manifest.json> <appboot-dir> <out.json>\n')
    process.exit(64)
  }
  const r = await probeRelease({ manifestPath, appBootDir, out, requestedVersion })
  process.stdout.write(
    `second-version: release=${r.release.version} appBoot=${r.appBoot.version ?? 'absent'} ` +
      `usable=${r.appBoot.usable ?? false} required=${JSON.stringify(r.appBoot.required ?? [])}\n`,
  )
  process.exit(0)
}
