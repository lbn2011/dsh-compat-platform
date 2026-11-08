#!/usr/bin/env node
/**
 * probe — issue the HTTP assertions against a running GUI carrier and record
 * what actually came back.
 *
 * WHY THIS IS ITS OWN PROCESS: the shape of the response, not the fact that a
 * request succeeded, is the evidence. Every check records status, content type,
 * byte count and a sha256 of the body, so a later reader can tell a refused
 * request from a mis-served one without re-running anything.
 *
 * WHAT IT DOES NOT DO: it does not execute the page's script. No browser is
 * involved, and the record must say so — this probe establishes HTTP behaviour
 * only.
 *
 * USAGE: node probe.mjs --origin <http://127.0.0.1:PORT> --envelope-file <file>
 *                       --out <probe.json>
 *        node probe.mjs --origin <...> --expect-refusal --out <probe.json>
 *
 * Exit: 0 all checks passed; 3 a check failed; 70 bad arguments.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'

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
const origin = args.origin
const outFile = args.out
const envelopeFile = args['envelope-file']
const expectRefusal = args['expect-refusal'] === 'true'

if (!origin || !outFile) {
  console.error('probe: --origin and --out are required')
  process.exit(70)
}

/**
 * One request. Resolves with status, headers and the full body; a socket error
 * is a recorded failure rather than a thrown one, so the report still gets
 * written.
 */
function send({ method = 'GET', path = '/', authority = null }) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(path, origin)
    } catch (error) {
      resolve({ error: `bad url: ${String(error)}` })
      return
    }
    const headers = authority === null ? {} : { host: authority }
    const req = request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname, headers },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            status: res.statusCode,
            contentType: String(res.headers['content-type'] ?? ''),
            allow: res.headers.allow === undefined ? null : String(res.headers.allow),
            bodySha256: createHash('sha256').update(body).digest('hex'),
            bodyBytes: body.length,
            bodyText: body.toString('utf8'),
          })
        })
        res.on('error', (error) => resolve({ error: `response: ${String(error)}` }))
      },
    )
    req.on('error', (error) => resolve({ error: `request: ${String(error)}` }))
    req.setTimeout(10_000, () => {
      req.destroy(new Error('timeout after 10000 ms'))
    })
    req.end()
  })
}

function snippet(result) {
  if (result.error !== undefined) return result.error
  return result.bodyText.length > 400 ? `${result.bodyText.slice(0, 400)}…` : result.bodyText
}

const checks = []

function record(id, ok, detail) {
  checks.push({ id, ok, detail })
}

const envelopeDigest = expectRefusal || !envelopeFile
  ? null
  : createHash('sha256').update(await readFile(envelopeFile)).digest('hex')

if (expectRefusal) {
  // Refusal path: a carrier whose configured envelope is unreadable must answer
  // 503 on BOTH routes with a closed reason code, and must never serve the page.
  const page = await send({ path: '/compat-diagnostics' })
  const json = await send({ path: '/compat-diagnostics/envelope' })
  for (const [label, result] of [['page', page], ['envelope', json]]) {
    const body = result.error === undefined ? safeJson(result.bodyText) : null
    record(
      `${label}-503-closed-reason`,
      result.status === 503 &&
        result.contentType.startsWith('application/json') &&
        body !== null &&
        body.code === 'ENVELOPE_UNREADABLE' &&
        typeof body.reason === 'string',
      { status: result.status, contentType: result.contentType, body: body ?? snippet(result) },
    )
  }
  record(
    'refusal-does-not-serve-html',
    page.error === undefined && !page.contentType.startsWith('text/html'),
    { contentType: page.contentType },
  )
} else {
  const page = await send({ path: '/compat-diagnostics' })
  record(
    'page-200-html',
    page.status === 200 && page.contentType.startsWith('text/html') && page.bodyBytes > 0,
    { status: page.status, contentType: page.contentType, bodyBytes: page.bodyBytes },
  )
  record(
    'page-states-certification-false',
    page.error === undefined && page.bodyText.includes('certification: false'),
    { found: page.error === undefined && page.bodyText.includes('certification: false') },
  )
  record(
    'page-states-correlation-literal',
    page.error === undefined && page.bodyText.includes('correlation: not-established'),
    { found: page.error === undefined && page.bodyText.includes('correlation: not-established') },
  )

  const json = await send({ path: '/compat-diagnostics/envelope' })
  record(
    'envelope-200-json-verbatim',
    json.status === 200 &&
      json.contentType.startsWith('application/json') &&
      envelopeDigest !== null &&
      json.bodySha256 === envelopeDigest,
    {
      status: json.status,
      contentType: json.contentType,
      bodySha256: json.bodySha256,
      fileSha256: envelopeDigest,
      bodyBytes: json.bodyBytes,
    },
  )

  const posted = await send({ method: 'POST', path: '/compat-diagnostics' })
  record(
    'post-405-with-allow',
    posted.status === 405 && posted.allow === 'GET, HEAD',
    { status: posted.status, allow: posted.allow, body: snippet(posted) },
  )

  const foreign = await send({ path: '/compat-diagnostics', authority: 'example.test' })
  record(
    'foreign-host-403',
    foreign.status === 403,
    { status: foreign.status, body: snippet(foreign) },
  )

  const unknown = await send({ path: '/compat-diagnostics-not-a-route' })
  record(
    'unknown-path-404',
    unknown.status === 404,
    { status: unknown.status, body: snippet(unknown) },
  )
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const verdict = checks.every((check) => check.ok === true) ? 'pass' : 'fail'
await writeFile(
  outFile,
  `${JSON.stringify({ origin, expectRefusal, envelopeFile: envelopeFile ?? null, verdict, checks }, null, 2)}\n`,
  'utf8',
)
console.log(`probe: verdict=${verdict} checks=${checks.length} failed=${checks.filter((c) => !c.ok).length}`)
process.exit(verdict === 'pass' ? 0 : 3)
