/**
 * The browser half, tested as a module-graph contribution.
 *
 * These tests do not run a browser. They execute the shipped file inside a
 * minimal loader stand-in and assert the three things that can be checked
 * without one: the module id matches the package name, the registration targets
 * the slot it claims, and the panel frames the host route rather than fetching
 * or re-rendering anything itself.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const CLIENT_FILE = join(PKG_ROOT, 'src', 'client.js')
const MANIFEST = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'))
const SOURCE = readFileSync(CLIENT_FILE, 'utf8')

/** Load the bundle into a stand-in loader and return what it registered. */
function loadBundle() {
  const loaded = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(descriptor) {
          loaded.push(descriptor)
        },
      },
    },
    Symbol,
    Object,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(SOURCE, sandbox, { filename: 'client.js' })
  assert.equal(loaded.length, 1, 'the bundle registers exactly one module')
  const descriptor = loaded[0]
  const exports = descriptor.factory((specifier) => {
    if (specifier === 'react') {
      return {
        createElement: (type, props) => ({ type, props }),
      }
    }
    throw new Error(`unexpected require(${specifier})`)
  })
  return { descriptor, exports }
}

test('the bundle registers under the package name, in the loader shape', () => {
  const { descriptor } = loadBundle()
  assert.equal(descriptor.id, MANIFEST.name)
  assert.equal(typeof descriptor.factory, 'function')
  // The manifest must advertise the client half, or nothing serves this file.
  assert.equal(MANIFEST.dsh.client.platform, 'web')
  assert.equal(MANIFEST.exports['./client'], './src/client.js')
})

test('the client half declares only the slots service and both client packages', () => {
  const { exports } = loadBundle()
  // Spread first: the bundle runs in its own vm realm, so its Array has that
  // realm's prototype and a deepStrictEqual against a local literal fails.
  assert.deepEqual([...exports.inject], ['slots'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.PAGE_URL, '/compat-diagnostics')
  // Only packages that actually exist in this installation belong here: the
  // `slots` client service comes from the core client runtime, which is not a
  // plugin package, so naming a slots package would point at nothing.
  assert.deepEqual(MANIFEST.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-settings'])
})

test('apply registers one settings section and nothing else', () => {
  const { exports } = loadBundle()
  const injected = []
  const registered = []
  const ctx = {
    slots: {
      inject(slotName, contribute) {
        injected.push(slotName)
        contribute()
      },
      register(descriptor, component) {
        registered.push({ descriptor, component })
        return descriptor
      },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registered.length, 1)
  const { descriptor, component } = registered[0]
  assert.equal(descriptor.name, 'settings.section')
  assert.equal(descriptor.id, 'compat-diagnostics')
  assert.equal(descriptor.order, 200)
  assert.equal(descriptor.label(), '兼容性诊断')
  assert.equal(component, exports.Panel)
})

test('the panel frames the host route instead of rendering data itself', () => {
  const { exports } = loadBundle()
  const element = exports.Panel()
  assert.equal(element.type, 'iframe')
  assert.equal(element.props.src, '/compat-diagnostics')
  assert.equal(element.props.referrerPolicy, 'no-referrer')
  assert.equal(element.props.title, '兼容性诊断（只读）')
})

test('the client half cannot fetch, spawn, or read a file', () => {
  // A framed page needs no data plumbing of its own. If one appears here, the
  // panel is rendering a second, possibly disagreeing, view of the envelope.
  assert.doesNotMatch(SOURCE, /\bfetch\s*\(/)
  assert.doesNotMatch(SOURCE, /XMLHttpRequest|WebSocket|EventSource/)
  assert.doesNotMatch(SOURCE, /child_process|spawn|execFile|readFileSync?/)
  assert.doesNotMatch(SOURCE, /\beval\s*\(|new Function\s*\(/)
})
