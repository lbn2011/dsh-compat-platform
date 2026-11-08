/**
 * dsh-compat-diagnostics-ui — one read-only route pair on the host carrier
 * that displays an existing diagnostic envelope.
 *
 * WHAT THIS PLUGIN IS: a host plugin in the shapes the installed host uses —
 * `name`, `inject`, `apply(ctx, config)` — registering exactly two exact-path
 * routes on the composition's own `webServer` service. It analyses nothing,
 * reads exactly one configured file, and writes nothing.
 *
 * WHAT IT IS NOT: a second HTTP server, a Loader, a registry, or a client-UI
 * package. The page is a host route, and the record must say so: the native
 * client surface (a `dsh.client` bundle registering into UI slots) needs a
 * build step this repository does not have yet.
 *
 * THE FENCE: the route answers only for `GET`/`HEAD` on a loopback authority at
 * the carrier's actual port. Everything else is `405`, and a foreign `Host` is
 * `403`. This is deliberately a small fence, not an authentication story: when
 * this plugin is composed inside the shipped Web profile, the composition's
 * `connection` service owns the real Host/Origin and token gate, and this
 * plugin's fence sits behind it rather than replacing it.
 */

import { resolve } from 'node:path'

import { readEnvelope } from './envelope.js'
import { PAGE_CONTENT_TYPE, renderPage } from './page.js'

/** Plugin name, as the host composition records it. */
export const name = 'dsh-compat-diagnostics-ui'

/** The carrier service this plugin needs. Nothing else is injected. */
export const inject = ['webServer']

/** Default page path. */
export const DEFAULT_PAGE_PATH = '/compat-diagnostics'

/** Default envelope path. */
export const DEFAULT_ENVELOPE_PATH = '/compat-diagnostics/envelope'

/** The one refusal code the HTTP surface speaks. */
export const ENVELOPE_UNREADABLE = 'ENVELOPE_UNREADABLE'

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPathOption(value, field) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${name}: config.${field} must be a non-empty string`)
  }
  if (!value.startsWith('/') || value === '/' || value.endsWith('/')) {
    throw new TypeError(
      `${name}: config.${field} must be an absolute pathname without a trailing slash, got ${JSON.stringify(value)}`,
    )
  }
  return value
}

/**
 * Validate the plugin config.
 *
 * There is no schemastery `Config` on purpose: this package declares no
 * dependencies, and a schema object would buy coercion the page does not need.
 * A bad config fails at load with a TypeError that names the field.
 *
 * @param {unknown} config - Raw plugin config.
 * @returns {{ envelopePath: string, pagePath: string, envelopeRoutePath: string }} Resolved settings.
 */
export function readOptions(config) {
  if (!isPlainRecord(config)) {
    throw new TypeError(`${name}: config must be an object with an envelopePath`)
  }
  const envelopePath = resolve(process.cwd(), readPathFile(config.envelopePath))
  const pagePath = config.pagePath === undefined
    ? DEFAULT_PAGE_PATH
    : readPathOption(config.pagePath, 'pagePath')
  const envelopeRoutePath = config.envelopeRoutePath === undefined
    ? DEFAULT_ENVELOPE_PATH
    : readPathOption(config.envelopeRoutePath, 'envelopeRoutePath')
  if (pagePath === envelopeRoutePath) {
    throw new TypeError(`${name}: config.pagePath and config.envelopeRoutePath must differ`)
  }
  return { envelopePath, pagePath, envelopeRoutePath }
}

function readPathFile(value) {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${name}: config.envelopePath must be a non-empty string`)
  }
  return value
}

function isLoopbackLiteral(host) {
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  return bare === '::1' || bare === 'localhost' || /^127\./.test(bare)
}

/**
 * Authorities this plugin answers for: the carrier's own bind address at its
 * own port, plus the `localhost` name when the carrier is bound to loopback.
 *
 * @param {string} host - Carrier bind address.
 * @param {number} port - Carrier listening port.
 * @returns {Set<string>} Lower-case `host:port` authorities.
 */
export function allowedAuthorities(host, port) {
  const authorities = new Set()
  const bare = host.replace(/^\[(.*)\]$/, '$1')
  const own = bare.includes(':') ? `[${bare}]:${port}` : `${bare}:${port}`
  authorities.add(own.toLowerCase())
  if (isLoopbackLiteral(host)) {
    // A browser may spell a loopback bind as `localhost`, so that name is added.
    // The OTHER loopback literal is deliberately NOT added: the carrier is not
    // listening on it, so a request naming it cannot arrive at this bind and
    // admitting it would widen the fence without a reachable reason.
    authorities.add(`localhost:${port}`)
  }
  return authorities
}

function writeJson(res, status, value, extraHeaders) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(body)
}

function refuseMethod(res) {
  writeJson(res, 405, { code: 'METHOD_NOT_ALLOWED', allow: 'GET, HEAD' }, { allow: 'GET, HEAD' })
}

function refuseAuthority(res) {
  writeJson(res, 403, { code: 'HOST_NOT_ALLOWED' })
}

/** Method and authority gate shared by both routes. */
function admitted(ctx, req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return 'method'
  const port = ctx.webServer.port
  if (typeof port !== 'number') return 'authority'
  const host = ctx.webServer.host
  if (typeof host !== 'string') return 'authority'
  const header = typeof req.headers?.host === 'string' ? req.headers.host.toLowerCase() : ''
  return allowedAuthorities(host, port).has(header) ? 'ok' : 'authority'
}

function refusalBody(result) {
  const body = { code: ENVELOPE_UNREADABLE, reason: result.reason }
  if (typeof result.field === 'string') body.field = result.field
  return body
}

async function handleEnvelope(settings, ctx, req, res) {
  const gate = admitted(ctx, req)
  if (gate === 'method') return refuseMethod(res)
  if (gate === 'authority') return refuseAuthority(res)

  const result = await readEnvelope(settings.envelopePath)
  if (!result.ok) {
    // Never a half-rendered document, never a stale body: the refusal names a
    // closed reason code and nothing about the filesystem.
    return writeJson(res, 503, refusalBody(result))
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(result.body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-envelope-sha256': result.digest,
  })
  res.end(result.body)
}

async function handlePage(settings, ctx, req, res) {
  const gate = admitted(ctx, req)
  if (gate === 'method') return refuseMethod(res)
  if (gate === 'authority') return refuseAuthority(res)

  // The page is served only when the envelope it names is actually servable.
  // Answering the HTML while the JSON route refuses would produce a page whose
  // script reports a failure the server already knew about.
  const result = await readEnvelope(settings.envelopePath)
  if (!result.ok) return writeJson(res, 503, refusalBody(result))

  const body = Buffer.from(renderPage(), 'utf8')
  res.writeHead(200, {
    'content-type': PAGE_CONTENT_TYPE,
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * Register the two routes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Composition context.
 * @param {unknown} config - `{ envelopePath, pagePath?, envelopeRoutePath? }`.
 */
export function apply(ctx, config) {
  const settings = readOptions(config)
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: settings.pagePath,
        handler: (req, res) => handlePage(settings, ctx, req, res),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: settings.envelopeRoutePath,
        handler: (req, res) => handleEnvelope(settings, ctx, req, res),
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, `${name}: routes`)
}
