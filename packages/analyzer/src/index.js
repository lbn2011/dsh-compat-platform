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

// A1 — the live occupancy table and the C1–C11 rules.
//
// The engine is pure; the service is the only module here that subscribes to host
// events, and it derives nothing from an event payload (none of the four carries
// occupancy). `apply` and `name` stay on the `./conflict-service` subpath: they are
// Cordis plugin-entry names, and exporting them from the package root would put
// two very generic identifiers on the public surface.
export {
  createConflictDetector,
  satisfiesRange,
  CONFLICT_CODES,
  CONFLICT_DETECTOR_VERSION,
  CONFLICT_LIMITATIONS,
  CONFLICT_SEVERITIES,
  CONFLICT_TYPES,
  DEFAULT_SEVERITY,
  OCCUPANCY_KINDS,
} from './conflict-detector.js';

export {
  createConflictService,
  CONFLICT_EVENTS,
  CONFLICT_SERVICE_VERSION,
  OCCUPANCY_SIGNALS,
} from './conflict-service.js';

// A2 — static pre-check: predict what installing one plugin would add to the table.
//
// It reuses the detector above rather than restating C1–C11, so a prediction cannot disagree with
// the live answer about the same occupancy. `staticPreCheck` reads nothing: the command line
// (`./pre-check-cli`) is the only module that opens files, and it does so through the same
// bounded reader the other evidence commands use.
export {
  staticPreCheck,
  preCheckExitCode,
  preCheckFailure,
  PRE_CHECK_CODES,
  PRE_CHECK_EXIT,
  PRE_CHECK_LIMITATIONS,
  PRE_CHECK_SCHEMA,
  PRE_CHECK_VERSION,
} from './pre-check.js';
