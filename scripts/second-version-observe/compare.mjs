#!/usr/bin/env node
// Compare two adapter observations of the same fixture.
//
// One question: do the two runtimes reach the *same* per-entry verdicts for the same
// three fixtures? A difference is a result, not a failure — this script exits 0 whether
// the verdicts agree or not, and records which it was. Only an unreadable observation
// is an error (exit 64).
//
// It compares only what the adapter reports: per-entry state and, for a failed entry,
// the phase. It never compares timings, and it never compares log text.

import { readFileSync, writeFileSync } from 'node:fs'

const [leftPath, rightPath, outPath] = process.argv.slice(2)
if (!leftPath || !rightPath || !outPath) {
  process.stderr.write('usage: compare.mjs LEFT.json RIGHT.json OUT.json\n')
  process.exitCode = 64
} else {
  main()
}

function read(path) {
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`compare: cannot read ${path}: ${error.code ?? error.message}\n`)
    process.exitCode = 64
    return null
  }
  if (!doc || !Array.isArray(doc.entries)) {
    process.stderr.write(`compare: ${path} has no entries array\n`)
    process.exitCode = 64
    return null
  }
  return doc
}

function shape(doc) {
  const rows = doc.entries.map((entry) => ({
    id: String(entry.id),
    state: String(entry.state),
    // A failed entry may name the phase; anything else must not carry one.
    failurePhase: entry.state === 'failed' ? String(entry.failurePhase ?? 'unreported') : null,
  }))
  rows.sort((a, b) => a.id.localeCompare(b.id))
  return rows
}

function main() {
  const left = read(leftPath)
  const right = read(rightPath)
  if (!left || !right) return

  const a = shape(left)
  const b = shape(right)
  const ids = [...new Set([...a.map((r) => r.id), ...b.map((r) => r.id)])].sort()

  const rows = ids.map((id) => {
    const one = a.find((r) => r.id === id) ?? null
    const two = b.find((r) => r.id === id) ?? null
    const agree = one !== null && two !== null && one.state === two.state && one.failurePhase === two.failurePhase
    return { id, left: one, right: two, agree }
  })

  const differences = rows.filter((row) => !row.agree)
  const doc = {
    comparisonVersion: 'second-version-comparison/0.1-draft.1',
    left: { status: left.status, bootError: left.bootError ?? null, phases: left.phases },
    right: { status: right.status, bootError: right.bootError ?? null, phases: right.phases },
    entries: rows,
    agree: differences.length === 0,
    differences: differences.length,
    // Stated so no reader has to infer it from an empty list.
    notCompared: ['timings', 'log text', 'module identity', 'the bytes each runtime loaded'],
    certification: false,
  }
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n')
  process.stdout.write(
    `compare: agree=${doc.agree} differences=${doc.differences} entries=${rows.length}\n`,
  )
}
