/**
 * Unit tests for 'chrome-driver'.
 *
 * SCOPE: no real browser. Methods are exercised on a ChromeDriver constructed
 * around fake Browser/Page objects. launch() is exercised through its
 * 'importModule' seam (third argument), which replaces the dynamic
 * import('puppeteer-core') with a fake module or a rejecting import, so both
 * the PuppeteerNotAvailable path and the launch-option merge are real calls of
 * the shipped launch(). The live Chromium launch is covered separately by
 * scripts/e2-chrome-batch (chrome-live and ui-e2e) inside the bounded runner.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

// We import the actual exports; the PuppeteerNotAvailable class can be tested
// directly without a real browser.
import { BASE_LAUNCH_ARGS, ChromeDriver, PuppeteerNotAvailable } from '../src/chrome-driver.js'

// ---------------------------------------------------------------------------
// Helpers: build a fake puppeteer-core mock and a ChromeDriver without launch()
// ---------------------------------------------------------------------------

/**
 * Build a fake puppeteer Page mock.
 *
 * @param {object} [overrides] Per-method overrides.
 * @returns {object} Page mock.
 */
function fakePage(overrides = {}) {
  return {
    _url: 'about:blank',
    _navLog: [],
    _screenshots: [],
    title: overrides.title ?? (() => Promise.resolve('Test Page')),
    url: overrides.url ?? function () { return this._url },
    goto: overrides.goto ?? async function (url) { this._url = url; this._navLog.push(url) },
    evaluate: overrides.evaluate ?? (async (fn) => fn()),
    screenshot: overrides.screenshot ?? async function (opts) { this._screenshots.push(opts) },
  }
}

/**
 * Build a fake puppeteer Browser mock.
 *
 * @param {object} [pageOverrides] Per-method overrides for the page.
 * @returns {object} Browser mock.
 */
function fakeBrowser(pageOverrides = {}) {
  const page = fakePage(pageOverrides)
  return {
    _page: page,
    _closed: false,
    pages: async function () { return [this._page] },
    newPage: async function () { return this._page },
    close: async function () { this._closed = true },
  }
}

/**
 * Directly construct a ChromeDriver bypassing launch() — uses the same
 * internal constructor that ChromeDriver.launch() uses after creating
 * the puppeteer browser.
 *
 * @param {object} [pageOverrides] Per-method overrides for the fake page.
 * @returns {{driver: ChromeDriver, browser: object, page: object}}
 */
function makeDriver(pageOverrides = {}) {
  const browser = fakeBrowser(pageOverrides)
  const page = browser._page
  // The constructor is `constructor(browser, page)` — call it directly.
  const driver = new ChromeDriver(browser, page)
  return { driver, browser, page }
}

// ---------------------------------------------------------------------------
// Tests: PuppeteerNotAvailable
// ---------------------------------------------------------------------------

test('PuppeteerNotAvailable is an Error subclass', () => {
  const err = new PuppeteerNotAvailable()
  assert.ok(err instanceof Error)
  assert.ok(err instanceof PuppeteerNotAvailable)
})

test('PuppeteerNotAvailable has correct name', () => {
  const err = new PuppeteerNotAvailable()
  assert.equal(err.name, 'PuppeteerNotAvailable')
})

test('PuppeteerNotAvailable has correct code', () => {
  const err = new PuppeteerNotAvailable()
  assert.equal(err.code, 'PUPPETEER_NOT_AVAILABLE')
})

test('PuppeteerNotAvailable message mentions puppeteer-core', () => {
  const err = new PuppeteerNotAvailable()
  assert.ok(err.message.includes('puppeteer-core'))
})

// ---------------------------------------------------------------------------
// Tests: ChromeDriver constructor / isOpen
// ---------------------------------------------------------------------------

test('ChromeDriver isOpen returns true after construction', () => {
  const { driver } = makeDriver()
  assert.equal(driver.isOpen, true)
})

test('ChromeDriver isOpen returns false after close', async () => {
  const { driver } = makeDriver()
  await driver.close()
  assert.equal(driver.isOpen, false)
})

// ---------------------------------------------------------------------------
// Tests: navigate
// ---------------------------------------------------------------------------

test('navigate calls page.goto with the given URL', async () => {
  const navLog = []
  const { driver, page } = makeDriver({
    goto: async function (url) { this._url = url; navLog.push(url) },
  })
  await driver.navigate('http://127.0.0.1:3080')
  assert.deepEqual(navLog, ['http://127.0.0.1:3080'])
  assert.ok(page) // confirm page reference is valid
})

test('navigate uses networkidle2 waitUntil by default', async () => {
  let capturedOpts = null
  const { driver } = makeDriver({
    goto: async function (url, opts) { capturedOpts = opts },
  })
  await driver.navigate('http://example.com')
  assert.equal(capturedOpts?.waitUntil, 'networkidle2')
})

test('navigate throws when browser is closed', async () => {
  const { driver } = makeDriver()
  await driver.close()
  await assert.rejects(() => driver.navigate('http://localhost'), /browser is not open/)
})

// ---------------------------------------------------------------------------
// Tests: captureDOM
// ---------------------------------------------------------------------------

test('captureDOM returns title from page.title()', async () => {
  const { driver } = makeDriver({
    title: () => Promise.resolve('My Title'),
    evaluate: async () => ({ bodyText: '', elementCount: 5, formCount: 1 }),
  })
  const snap = await driver.captureDOM()
  assert.equal(snap.title, 'My Title')
})

test('captureDOM returns url from page.url()', async () => {
  const { driver, page } = makeDriver({
    evaluate: async () => ({ bodyText: '', elementCount: 0, formCount: 0 }),
  })
  page._url = 'http://127.0.0.1:3080'
  const snap = await driver.captureDOM()
  assert.equal(snap.url, 'http://127.0.0.1:3080')
})

test('captureDOM returns bodyText from evaluate result', async () => {
  const { driver } = makeDriver({
    title: () => Promise.resolve('T'),
    evaluate: async () => ({ bodyText: 'hello world', elementCount: 2, formCount: 0 }),
  })
  const snap = await driver.captureDOM()
  assert.equal(snap.bodyText, 'hello world')
})

test('captureDOM returns elementCount', async () => {
  const { driver } = makeDriver({
    title: () => Promise.resolve(''),
    evaluate: async () => ({ bodyText: '', elementCount: 42, formCount: 3 }),
  })
  const snap = await driver.captureDOM()
  assert.equal(snap.elementCount, 42)
})

test('captureDOM returns formCount', async () => {
  const { driver } = makeDriver({
    title: () => Promise.resolve(''),
    evaluate: async () => ({ bodyText: '', elementCount: 10, formCount: 7 }),
  })
  const snap = await driver.captureDOM()
  assert.equal(snap.formCount, 7)
})

test('captureDOM throws when browser is closed', async () => {
  const { driver } = makeDriver()
  await driver.close()
  await assert.rejects(() => driver.captureDOM(), /browser is not open/)
})

// ---------------------------------------------------------------------------
// Tests: screenshot
// ---------------------------------------------------------------------------

test('screenshot calls page.screenshot with outputPath', async () => {
  const capturedOpts = []
  const { driver } = makeDriver({
    screenshot: async function (opts) { capturedOpts.push(opts) },
  })
  await driver.screenshot('/tmp/test.png')
  assert.equal(capturedOpts.length, 1)
  assert.equal(capturedOpts[0].path, '/tmp/test.png')
})

test('screenshot uses fullPage: true', async () => {
  const capturedOpts = []
  const { driver } = makeDriver({
    screenshot: async function (opts) { capturedOpts.push(opts) },
  })
  await driver.screenshot('/tmp/page.png')
  assert.equal(capturedOpts[0].fullPage, true)
})

test('screenshot throws when browser is closed', async () => {
  const { driver } = makeDriver()
  await driver.close()
  await assert.rejects(() => driver.screenshot('/tmp/x.png'), /browser is not open/)
})

// ---------------------------------------------------------------------------
// Tests: close
// ---------------------------------------------------------------------------

test('close calls browser.close()', async () => {
  const { driver, browser } = makeDriver()
  await driver.close()
  assert.equal(browser._closed, true)
})

test('close is idempotent — second call does not throw', async () => {
  const { driver } = makeDriver()
  await driver.close()
  await assert.doesNotReject(() => driver.close())
})

test('close sets isOpen to false', async () => {
  const { driver } = makeDriver()
  assert.equal(driver.isOpen, true)
  await driver.close()
  assert.equal(driver.isOpen, false)
})

// ---------------------------------------------------------------------------
// Tests: launch() through the injected importModule seam (R8)
// ---------------------------------------------------------------------------

/** A fake puppeteer-core module that records the launch options it received. */
function fakePuppeteer({ pages = 1 } = {}) {
  const seen = []
  const browser = fakeBrowser()
  if (pages === 0) browser.pages = async () => []
  return {
    seen,
    browser,
    module: { launch: async (opts) => { seen.push(opts); return browser } },
  }
}

test('launch rejects with PuppeteerNotAvailable when the import fails', async () => {
  let asked = null
  await assert.rejects(
    ChromeDriver.launch('/usr/bin/chromium', {}, {
      importModule: (specifier) => { asked = specifier; return Promise.reject(new Error('Cannot find package')) },
    }),
    (err) => err instanceof PuppeteerNotAvailable && err.code === 'PUPPETEER_NOT_AVAILABLE',
  )
  assert.equal(asked, 'puppeteer-core')
})

test('launch rejects with PuppeteerNotAvailable when the module has no launch()', async () => {
  await assert.rejects(
    ChromeDriver.launch('/usr/bin/chromium', {}, { importModule: async () => ({ default: {} }) }),
    PuppeteerNotAvailable,
  )
})

test('launch accepts a module whose launch() sits on the default export', async () => {
  const fake = fakePuppeteer()
  const driver = await ChromeDriver.launch('/usr/bin/chromium', {}, { importModule: async () => ({ default: fake.module }) })
  assert.equal(driver.isOpen, true)
  assert.equal(fake.seen.length, 1)
})

test('launch passes executablePath, headless:true and the base args', async () => {
  const fake = fakePuppeteer()
  const driver = await ChromeDriver.launch('/usr/bin/chromium', {}, { importModule: async () => fake.module })
  assert.equal(fake.seen[0].executablePath, '/usr/bin/chromium')
  assert.equal(fake.seen[0].headless, true)
  assert.deepEqual(fake.seen[0].args, [...BASE_LAUNCH_ARGS])
  assert.equal(driver.isOpen, true)
})

test('caller options cannot replace executablePath, headless or the base args; extra args are appended', async () => {
  const fake = fakePuppeteer()
  await ChromeDriver.launch('/usr/bin/chromium', {
    executablePath: '/tmp/evil', headless: false, args: ['--window-size=1280,900'], timeout: 5000,
  }, { importModule: async () => fake.module })
  const opts = fake.seen[0]
  assert.equal(opts.executablePath, '/usr/bin/chromium')
  assert.equal(opts.headless, true)
  assert.deepEqual(opts.args, [...BASE_LAUNCH_ARGS, '--window-size=1280,900'])
  assert.equal(opts.timeout, 5000, 'unrelated options are still forwarded')
})

test('launch opens a new page when the browser has none', async () => {
  const fake = fakePuppeteer({ pages: 0 })
  const driver = await ChromeDriver.launch('/usr/bin/chromium', {}, { importModule: async () => fake.module })
  await driver.navigate('http://127.0.0.1:1/')
  assert.deepEqual(fake.browser._page._navLog, ['http://127.0.0.1:1/'])
})

test('launch refuses an empty executablePath before importing anything', async () => {
  let imported = false
  await assert.rejects(
    ChromeDriver.launch('', {}, { importModule: async () => { imported = true; return fakePuppeteer().module } }),
    TypeError,
  )
  assert.equal(imported, false)
})

// ---------------------------------------------------------------------------
// Tests: evaluate()
// ---------------------------------------------------------------------------

test('evaluate forwards the function and its arguments to page.evaluate', async () => {
  const calls = []
  const { driver } = makeDriver({ evaluate: async (fn, ...args) => { calls.push({ fn, args }); return fn(...args) } })
  const add = (a, b) => a + b
  assert.equal(await driver.evaluate(add, 2, 3), 5)
  assert.equal(calls[0].fn, add)
  assert.deepEqual(calls[0].args, [2, 3])
})

test('evaluate rejects a non-function with TypeError', async () => {
  const { driver } = makeDriver()
  await assert.rejects(driver.evaluate('document.title'), /ChromeDriver\.evaluate: fn must be a function/)
})

test('evaluate throws when browser is closed', async () => {
  const { driver } = makeDriver()
  await driver.close()
  await assert.rejects(driver.evaluate(() => 1), /browser is not open/)
})
