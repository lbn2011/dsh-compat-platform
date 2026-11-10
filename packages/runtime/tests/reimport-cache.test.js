// Pins the mechanism the adapter relies on when it separates "the module threw
// on import" from "the module imported and apply() threw".
//
// The adapter re-imports an entry's module (`failurePhase`), matching what the
// host's own `inactiveEntries(ctx, importNow = true)` does. The open question is
// whether that second import runs the module's top-level side effects again.
// Under this runtime it does not: an ECMAScript module is evaluated at most once
// per resolved URL, and a module that threw during evaluation is cached in its
// errored state and rethrows the same error object. These tests measure that
// rather than assuming it, so the limitation code stays honest.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-reimport-cache-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a second import of an evaluated module does not run its side effect again', async (t) => {
  const dir = scratch(t)
  const marker = join(dir, 'evaluations.txt')
  const target = join(dir, 'counter.mjs')
  writeFileSync(
    target,
    `import { appendFileSync } from 'node:fs'\n` +
      `appendFileSync(${JSON.stringify(marker)}, 'evaluated\\n')\n` +
      `export const value = 1\n`,
  )

  const url = pathToFileURL(target).href
  const first = await import(url)
  const second = await import(url)

  assert.equal(first.value, 1)
  assert.equal(second, first, 'both imports resolve to the same namespace object')
  assert.equal(readFileSync(marker, 'utf8'), 'evaluated\n', 'the side effect ran exactly once')
})

test('a second import of a module that threw rethrows the cached error, without re-running it', async (t) => {
  const dir = scratch(t)
  const marker = join(dir, 'attempts.txt')
  const target = join(dir, 'boom.mjs')
  writeFileSync(
    target,
    `import { appendFileSync } from 'node:fs'\n` +
      `appendFileSync(${JSON.stringify(marker)}, 'evaluating\\n')\n` +
      `throw new Error('fixture: evaluation refused')\n`,
  )

  const url = pathToFileURL(target).href
  const first = await import(url).then(() => null, (error) => error)
  const second = await import(url).then(() => null, (error) => error)

  assert.ok(first instanceof Error, 'the first import rejects')
  assert.ok(second instanceof Error, 'the second import rejects too')
  assert.equal(second, first, 'the cached error object is rethrown, not a fresh failure')
  assert.equal(readFileSync(marker, 'utf8'), 'evaluating\n', 'evaluation was attempted exactly once')
})

test('a module that imports and then throws from apply() resolves on re-import', async (t) => {
  const dir = scratch(t)
  const target = join(dir, 'plugin-activation-throw.mjs')
  writeFileSync(
    target,
    `export default {\n` +
      `  name: 'fixture-activation-throw',\n` +
      `  apply() { throw new Error('fixture: activation refused') },\n` +
      `}\n`,
  )

  const url = pathToFileURL(target).href
  const namespace = await import(url)
  assert.equal(typeof namespace.default.apply, 'function')

  // Import resolves, so the adapter reports the activation phase; the throw only
  // happens when the host calls apply().
  assert.throws(() => namespace.default.apply(), /activation refused/)
  assert.equal(await import(url).then(() => 'resolved', () => 'rejected'), 'resolved')
})
