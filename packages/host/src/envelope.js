/**
 * envelope — read one diagnostic envelope from disk and decide whether it may
 * be served.
 *
 * WHAT THIS MODULE IS: a bounded reader plus a shape gate. It reads exactly one
 * configured file, at most {@link ENVELOPE_BYTE_CEILING} bytes, parses it, and
 * refuses anything that is not a diagnostic envelope. It performs no analysis,
 * imports no caller code, spawns nothing and writes nothing.
 *
 * WHY THE REFUSAL VOCABULARY IS CLOSED: the response body quotes a reason, and
 * a reason is shown to whoever looks at the page. A closed set of codes cannot
 * carry a file path, a filesystem error string or any other host detail out of
 * the process, so a refused read leaks nothing about the machine.
 *
 * WHY THE LIBRARY IS CONSULTED TOO: `diagnoseExitCode` from the analyzer is the
 * canonical shape contract. The explicit checks below exist so the refusal
 * names a field; the library call exists so this module can never serve a
 * document its own exit mapper would throw on. If they ever disagree, the
 * document is refused, not rendered.
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { diagnoseExitCode } from '../../analyzer/src/diagnose.js'

/** Refuse to read past one MiB: the same ceiling the analyzer puts on inputs. */
export const ENVELOPE_BYTE_CEILING = 1024 * 1024

/**
 * Refusal reasons. Every served refusal carries exactly one of these, never a
 * filesystem message.
 */
export const ENVELOPE_REASONS = Object.freeze({
  missing: 'ENVELOPE_MISSING',
  unreadable: 'ENVELOPE_UNREADABLE',
  tooLarge: 'ENVELOPE_TOO_LARGE',
  notJson: 'ENVELOPE_NOT_JSON',
  shape: 'ENVELOPE_SHAPE',
})

/** Top-level fields the shape gate inspects, in the order it reports them. */
export const ENVELOPE_FIELDS = Object.freeze([
  'diagnoseVersion',
  'certification',
  'correlation',
  'profile',
  'combinedReport',
  'provenance',
  'nextSteps',
])

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check the fields this page depends on, naming the first one that fails.
 *
 * @param {unknown} report - Parsed envelope candidate.
 * @returns {null | { field: string }} null when acceptable.
 */
export function checkEnvelopeShape(report) {
  if (!isPlainRecord(report)) return { field: 'report' }
  if (typeof report.diagnoseVersion !== 'string' || report.diagnoseVersion === '') {
    return { field: 'diagnoseVersion' }
  }
  // A UI must never be the place the certification literal is dropped: the
  // envelope says false, so the gate demands exactly false.
  if (report.certification !== false) return { field: 'certification' }
  if (typeof report.correlation !== 'string' || report.correlation === '') {
    return { field: 'correlation' }
  }
  if (!Object.hasOwn(report, 'profile') || !isPlainRecord(report.profile)) {
    return { field: 'profile' }
  }
  if (!Object.hasOwn(report, 'combinedReport')) return { field: 'combinedReport' }
  if (report.combinedReport !== null && !isPlainRecord(report.combinedReport)) {
    return { field: 'combinedReport' }
  }
  // The projection is what stops a reader assuming a baseline exists, so a page
  // that dropped it would be worse than one that never showed it.
  if (!Array.isArray(report.provenance)) return { field: 'provenance' }
  if (!Array.isArray(report.nextSteps)) return { field: 'nextSteps' }
  return null
}

/**
 * Read and gate one envelope file.
 *
 * @param {string} filePath - Absolute path of the configured envelope.
 * @returns {Promise<
 *   | { ok: true, body: Buffer, digest: string, report: object }
 *   | { ok: false, reason: string, field?: string }
 * >} The bytes to serve verbatim, or the refusal.
 */
export async function readEnvelope(filePath) {
  let info
  try {
    info = await stat(filePath)
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    return {
      ok: false,
      reason: code === 'ENOENT' ? ENVELOPE_REASONS.missing : ENVELOPE_REASONS.unreadable,
    }
  }
  if (!info.isFile()) return { ok: false, reason: ENVELOPE_REASONS.unreadable }
  if (info.size > ENVELOPE_BYTE_CEILING) {
    return { ok: false, reason: ENVELOPE_REASONS.tooLarge }
  }

  let body
  try {
    body = await readFile(filePath)
  } catch {
    return { ok: false, reason: ENVELOPE_REASONS.unreadable }
  }
  // Re-check after reading: a file that grew between stat and read must not
  // smuggle bytes past the ceiling.
  if (body.length > ENVELOPE_BYTE_CEILING) {
    return { ok: false, reason: ENVELOPE_REASONS.tooLarge }
  }

  let report
  try {
    report = JSON.parse(body.toString('utf8'))
  } catch {
    return { ok: false, reason: ENVELOPE_REASONS.notJson }
  }

  const shape = checkEnvelopeShape(report)
  if (shape !== null) return { ok: false, reason: ENVELOPE_REASONS.shape, field: shape.field }

  try {
    diagnoseExitCode(report)
  } catch {
    return { ok: false, reason: ENVELOPE_REASONS.shape, field: 'contract' }
  }

  return {
    ok: true,
    body,
    digest: createHash('sha256').update(body).digest('hex'),
    report,
  }
}
