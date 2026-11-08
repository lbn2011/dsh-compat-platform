/**
 * dsh-compat-platform — deterministic, zero-execution static declaration analysis.
 *
 * Pure library. No host access, no plugin imports, no configuration evaluation,
 * no filesystem writes, no network. See analyze() and the README for scope and
 * trust boundaries.
 *
 * The root additionally re-exports the admission diagnostics *presentation* layer
 * (§2 of the README / §11). That layer judges only the return value of a validator
 * the caller injects; it does not widen this package's own access, and it is never
 * merged with the declaration analysis below.
 *
 * @packageDocumentation
 */

export {
  analyze,
  EVIDENCE_LEVEL,
  FINDING_CODES,
  LIMITATION_CODES,
  PROTOCOL_VERSION,
  REPORT_VERSION,
} from './analyze.js';

export { formatReportJson, exitCodeFor } from './report.js';

export { EXIT_CODES } from './exit-codes.js';

// Admission diagnostics: a *presentation* layer over the return value of an
// injected canonical admission validator. Exporting it does not wire it into the
// static lane: `analyze()` still answers only the declaration question, and the
// two reports are never merged. The validator is still injected, never imported.
export { diagnoseAdmissionEvidence, DIAGNOSTIC_CODES, WRAPPER_ISSUE_CODES } from './admission-diagnostics.js';
