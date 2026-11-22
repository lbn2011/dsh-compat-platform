/**
 * 'chrome-driver' — thin wrapper around puppeteer-core for the e2-chrome-batch slice.
 *
 * DESIGN.
 *   puppeteer-core is an optional peer dependency. This module never imports it at
 *   the top level: 'ChromeDriver.launch()' loads it lazily, so the host package
 *   still loads where it is absent. When the import fails (or the module has no
 *   launch()), launch() rejects with PuppeteerNotAvailable. Importing this module
 *   and constructing a ChromeDriver around existing Browser/Page objects never throws.
 *
 *   launch() always passes the caller's executablePath, headless:true and
 *   BASE_LAUNCH_ARGS (which include --no-sandbox); caller options cannot replace
 *   them, and options.args is appended.
 *
 * WHAT IS NOT HERE.
 *   No network listener and no shell-out. The host plugin does not mount any route
 *   that uses this module; it is only used by scripts/e2-chrome-batch inside the
 *   bounded runner. The only file it writes is the PNG at the path the caller
 *   passes to screenshot(). It never downloads a browser.
 *
 * @module chrome-driver
 */

/** Sentinel error thrown when puppeteer-core is not installed. */
export class PuppeteerNotAvailable extends Error {
  constructor() {
    super(
      'puppeteer-core is not installed. ' +
        'Install it as a peer dependency (npm install puppeteer-core) ' +
        'and set CHROME_PATH to the Chromium executable.'
    )
    this.name = 'PuppeteerNotAvailable'
    this.code = 'PUPPETEER_NOT_AVAILABLE'
  }
}

/** The real dynamic import; tests replace it through 'launch(path, options, { importModule })'. */
const defaultImportModule = (specifier) => import(specifier)

/**
 * Load puppeteer-core through 'importModule'.
 *
 * @param {(specifier: string) => Promise<object>} importModule
 * @returns {Promise<object>} The puppeteer-core module.
 * @throws {PuppeteerNotAvailable} When the import fails or has no launch().
 */
async function loadPuppeteer(importModule) {
  let mod
  try {
    mod = await importModule('puppeteer-core')
  } catch {
    throw new PuppeteerNotAvailable()
  }
  const puppeteer = mod && typeof mod.launch === 'function' ? mod : mod?.default
  if (!puppeteer || typeof puppeteer.launch !== 'function') throw new PuppeteerNotAvailable()
  return puppeteer
}

/** Arguments every launch carries; callers may add more but cannot remove these. */
export const BASE_LAUNCH_ARGS = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
])

/**
 * Headless Chrome DOM driver.
 *
 * Usage:
 *   const driver = await ChromeDriver.launch('/path/to/chrome')
 *   await driver.navigate('http://127.0.0.1:3080')
 *   const snap = await driver.captureDOM()
 *   await driver.screenshot('/tmp/page.png')
 *   await driver.close()
 */
export class ChromeDriver {
  /** @type {object|null} puppeteer Browser instance */
  #browser = null

  /** @type {object|null} puppeteer Page instance */
  #page = null

  /** @private — use ChromeDriver.launch() */
  constructor(browser, page) {
    this.#browser = browser
    this.#page = page
  }

  /**
   * Launch a headless Chromium instance.
   *
   * @param {string} executablePath Absolute path to the Chromium binary.
   * @param {object} [options] Extra launch options forwarded to puppeteer.launch;
   *   'options.args' is appended to BASE_LAUNCH_ARGS, and executablePath/headless
   *   cannot be overridden.
   * @param {{importModule?: (specifier: string) => Promise<object>}} [deps]
   *   Test seam for the dynamic import of puppeteer-core.
   * @returns {Promise<ChromeDriver>} A connected driver.
   * @throws {PuppeteerNotAvailable} When puppeteer-core is absent.
   */
  static async launch(executablePath, options = {}, { importModule = defaultImportModule } = {}) {
    if (typeof executablePath !== 'string' || executablePath.length === 0) {
      throw new TypeError('ChromeDriver.launch: executablePath must be a non-empty string')
    }
    const extraArgs = Array.isArray(options.args) ? options.args.map(String) : []
    const puppeteer = await loadPuppeteer(importModule)

    // Caller options come first so executablePath, headless and the base args
    // always win; options.args is appended, never substituted.
    const browser = await puppeteer.launch({
      ...options,
      executablePath,
      headless: true,
      args: [...BASE_LAUNCH_ARGS, ...extraArgs],
    })

    const pages = await browser.pages()
    const page = pages.length > 0 ? pages[0] : await browser.newPage()

    return new ChromeDriver(browser, page)
  }

  /**
   * Navigate to a URL and wait for the network to settle.
   *
   * @param {string} url Target URL.
   * @returns {Promise<void>}
   */
  async navigate(url) {
    this._assertOpen()
    await this.#page.goto(url, { waitUntil: 'networkidle2' })
  }

  /**
   * Capture a lightweight structural snapshot of the current page.
   *
   * Returns a plain object; never includes raw HTML to keep the payload bounded.
   *
   * @returns {Promise<{title: string, url: string, bodyText: string,
   *   elementCount: number, formCount: number}>} DOM snapshot.
   */
  async captureDOM() {
    this._assertOpen()

    const title = await this.#page.title()
    const url = this.#page.url()

    const { bodyText, elementCount, formCount } = await this.#page.evaluate(() => {
      const body = document.body
      const rawText = body ? (body.innerText || body.textContent || '') : ''
      // Cap at 2000 chars to keep the payload bounded.
      const bodyText = rawText.slice(0, 2000)
      const elementCount = document.querySelectorAll('*').length
      const formCount = document.querySelectorAll('form').length
      return { bodyText, elementCount, formCount }
    })

    return { title, url, bodyText, elementCount, formCount }
  }

  /**
   * Run a function inside the page and return its serialisable result.
   *
   * Used by the bounded E2 slice to drive the page (click, read state). The
   * function runs in the browser context, so it cannot close over Node values;
   * pass them as `args`.
   *
   * @param {Function} fn Page-side function.
   * @param {...unknown} args Serialisable arguments.
   * @returns {Promise<unknown>} The function's return value.
   */
  async evaluate(fn, ...args) {
    this._assertOpen()
    if (typeof fn !== 'function') throw new TypeError('ChromeDriver.evaluate: fn must be a function')
    return this.#page.evaluate(fn, ...args)
  }

  /**
   * Capture a PNG screenshot and write it to `outputPath`.
   *
   * @param {string} outputPath Absolute path to write the PNG to.
   * @returns {Promise<void>}
   */
  async screenshot(outputPath) {
    this._assertOpen()
    await this.#page.screenshot({ path: outputPath, fullPage: true })
  }

  /**
   * Close the browser and release all resources.
   *
   * Safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#browser === null) return
    try {
      await this.#browser.close()
    } finally {
      this.#browser = null
      this.#page = null
    }
  }

  /**
   * Whether the driver currently has an open browser.
   *
   * @returns {boolean}
   */
  get isOpen() {
    return this.#browser !== null
  }

  /** @private */
  _assertOpen() {
    if (this.#browser === null) {
      throw new Error('ChromeDriver: browser is not open (call launch() first or after close())')
    }
  }
}
