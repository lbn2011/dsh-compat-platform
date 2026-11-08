/**
 * dsh-compat-platform — one envelope over three independent evidence lanes.
 *
 * ## What this module is for
 *
 * The static analyzer (`analyze`), the runtime-evidence summarizer
 * (`summarizeRuntimeEvidence`) and the admission diagnostics
 * (`diagnoseAdmissionEvidence`) each answer their own question and each report in
 * their own shape. This module gives a caller *one* place to read three answers
 * side by side, without deciding anything on the caller's behalf.
 *
 * ## What it deliberately does not do
 *
 * - **No merging.** Each lane keeps its own full result object in
 *   `channels.<lane>.result`. Findings are never flattened into one list, no
 *   score is computed, and no lane is allowed to soften another.
 * - **No certification.** `certification` is the literal `false`. Nothing here
 *   authenticates a producer, a host, or a run.
 * - **No correlation.** `correlation` is the literal `'not-established'`. Two
 *   lanes carrying the same `source` alias are still two unrelated documents;
 *   the alias is a caller-chosen label, never an identity and never a join key.
 * - **No protocol rules.** Static classification is whatever `analyze` already
 *   decides; runtime statuses are read off the summary; admission findings are
 *   whatever the injected validator returned, inspected only for *which* codes
 *   are present. No protocol vocabulary is copied here.
 * - **No I/O.** Callers pass parsed JSON. This module reads no file, imports no
 *   validator, and resolves no specifier.
 *
 * ## Input boundary
 *
 * Two different boundaries, stated separately because they are not the same
 * promise:
 *
 * - `document` is **parsed JSON data**. A value that arrived through
 *   `JSON.parse` cannot be a `Proxy` or carry accessors.
 * - Envelope fields (`input.static` and friends) and option fields
 *   (`validateDeclaration`, `validateAdmissionEvidence`) are read through their
 *   own property descriptors: an accessor there is refused with a `TypeError`
 *   rather than invoked, and a lane entry that is not a plain data record is
 *   `invalid` rather than executed. Validators are **trusted functions** by
 *   construction — this module calls them.
 *
 * None of this is a sandbox. A `Proxy` handed in as `input` can still run code
 * while its keys are enumerated, and this module makes no attempt to prevent
 * that; the promise is about what this module *itself* does with a value, not
 * about containing a hostile one.
 *
 * @packageDocumentation
 */

import { analyze } from './analyze.js';
import {
  DIAGNOSTIC_CODES as ADMISSION_DIAGNOSTIC_CODES,
  WRAPPER_ISSUE_CODES,
  diagnoseAdmissionEvidence,
} from './admission-diagnostics.js';
import { DIAGNOSTIC_CODES as RUNTIME_DIAGNOSTIC_CODES } from './evidence-diagnostics.js';
import { summarizeRuntimeEvidence } from './runtime-evidence.js';

/**
 * Version of the envelope this module emits. Fixed string, never negotiated.
 *
 * This is the single source of the literal: a CLI that has to emit a
 * same-schema report when the whole input could not be read imports this
 * constant instead of restating the string.
 */
export const COMBINED_REPORT_VERSION = 'combined-report/0.1-draft.1';

/** Alias of {@link COMBINED_REPORT_VERSION}; same value, kept for early readers. */
export const REPORT_VERSION = COMBINED_REPORT_VERSION;

/** The three lanes, in the fixed order every read-out below uses. */
export const LANE_IDS = Object.freeze(['static', 'runtime', 'admission']);

/** `state` is either `'absent'` or `'provided'`; there is no third case. */
export const CHANNEL_STATES = Object.freeze(['absent', 'provided']);

/** Channel outcomes, ordered from "least established" to "most broken". */
export const CHANNEL_OUTCOMES = Object.freeze([
  'unknown',
  'clear',
  'attention',
  'invalid',
  'error',
]);

/**
 * Codes this module invents.
 *
 * None of them is a protocol issue code: they describe what *this* wrapper could
 * or could not do with a lane, so a reader can tell "the document is wrong" apart
 * from "no verdict was produced here". The lane's own codes are passed through
 * alongside them, never rewritten.
 */
export const CHANNEL_ISSUE_CODES = Object.freeze({
  /** The lane was provided but its injected validator was not a function. */
  VALIDATOR_MISSING: 'VALIDATOR_MISSING',
  /** The lane's entry was not the closed `{ source, document }` shape, or the document was rejected structurally. */
  INPUT_INVALID: 'INPUT_INVALID',
  /** The lane's analyzer threw its own validator-contract error. */
  VALIDATOR_FAILED: 'VALIDATOR_FAILED',
  /** The lane threw something this wrapper does not classify. */
  LANE_FAILED: 'LANE_FAILED',
});

/**
 * The one fixed limitation list every report carries.
 *
 * Strings, not prose, and identical for every report: they state what the
 * envelope cannot establish, not what a particular document happened to contain.
 * A caller that cannot read any input at all still emits a report carrying these
 * same codes, so importing this array keeps the two paths from drifting.
 */
export const COMBINED_REPORT_LIMITATIONS = Object.freeze([
  'CORRELATION_NOT_ESTABLISHED',
  'LANES_NOT_MERGED',
  'ABSENT_CHANNEL_IS_UNKNOWN',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_JSON_NOT_A_SANDBOX',
]);

/** Alias of {@link COMBINED_REPORT_LIMITATIONS}; the same frozen array, never a copy. */
export const LIMITATION_CODES = COMBINED_REPORT_LIMITATIONS;

/** Longest accepted `source` alias, in UTF-16 code units. */
export const MAX_SOURCE_LENGTH = 128;

const INPUT_KEYS = LANE_IDS;
const OPTION_KEYS = Object.freeze(['validateDeclaration', 'validateAdmissionEvidence']);
const ENTRY_KEYS = Object.freeze(['source', 'document']);

const INPUT_TYPE_ERROR =
  'buildCombinedReport(input, options): input must be a plain object whose only fields are "static", "runtime" and "admission".';
const INPUT_KEY_TYPE_ERROR =
  'buildCombinedReport(input, options): input may only contain "static", "runtime" and "admission"; no other field is read.';
const INPUT_EMPTY_TYPE_ERROR =
  'buildCombinedReport(input, options): input must provide at least one of "static", "runtime" and "admission"; an absent lane is reported as unknown, never as clear.';
const OPTIONS_TYPE_ERROR =
  'buildCombinedReport(input, options): options must be a plain object whose only fields are "validateDeclaration" and "validateAdmissionEvidence".';
const OPTIONS_KEY_TYPE_ERROR =
  'buildCombinedReport(input, options): options may only contain "validateDeclaration" and "validateAdmissionEvidence"; no other option is read.';
const INPUT_VALUE_TYPE_ERROR =
  'buildCombinedReport(input, options): each provided lane must be an own data property; an accessor is not read.';
const OPTIONS_VALUE_TYPE_ERROR =
  'buildCombinedReport(input, options): an option must be an own data property; an accessor is not read.';
const REPORT_TYPE_ERROR =
  'combinedReportExitCode(report): report must be the value returned by buildCombinedReport(), with all three channels carrying a known outcome.';

/** Codes whose presence in an admission result means the *wrapper* broke. */
const WRAPPER_CODE_SET = new Set(Object.values(WRAPPER_ISSUE_CODES));

/** Admission diagnostic codes that mean "not established", never "clean". */
const ADMISSION_ATTENTION_SET = new Set([
  ADMISSION_DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED,
  ADMISSION_DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN,
  ADMISSION_DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN,
]);

/* ------------------------------------------------------------------ *
 * Small structural predicates, total over parsed JSON values.
 * ------------------------------------------------------------------ */

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Every own key, nameless ones included, so a symbol cannot ride along. */
function ownKeysOf(value) {
  return Reflect.ownKeys(value);
}

/** Kept unique and in first-seen order: the lane's own order is already fixed. */
function dedupeCodes(values) {
  const seen = [];
  for (const value of values) {
    if (typeof value !== 'string' || value === '') continue;
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

/* ------------------------------------------------------------------ *
 * Envelope and entry reading.
 * ------------------------------------------------------------------ */

function readPresence(input) {
  if (!isPlainRecord(input)) throw new TypeError(INPUT_TYPE_ERROR);
  const present = { static: false, runtime: false, admission: false };
  const values = { static: undefined, runtime: undefined, admission: undefined };
  for (const key of ownKeysOf(input)) {
    if (typeof key !== 'string' || !INPUT_KEYS.includes(key)) {
      throw new TypeError(INPUT_KEY_TYPE_ERROR);
    }
    // Read the value through its descriptor: an accessor here would run code
    // chosen by the caller before any lane contract could be applied.
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(INPUT_VALUE_TYPE_ERROR);
    }
    present[key] = true;
    values[key] = descriptor.value;
  }
  if (!LANE_IDS.some((id) => present[id])) throw new TypeError(INPUT_EMPTY_TYPE_ERROR);
  return { present, values };
}

function readOptions(options) {
  if (options === undefined) {
    return Object.freeze({ validateDeclaration: undefined, validateAdmissionEvidence: undefined });
  }
  if (!isPlainRecord(options)) throw new TypeError(OPTIONS_TYPE_ERROR);
  const values = { validateDeclaration: undefined, validateAdmissionEvidence: undefined };
  for (const key of ownKeysOf(options)) {
    if (typeof key !== 'string' || !OPTION_KEYS.includes(key)) {
      throw new TypeError(OPTIONS_KEY_TYPE_ERROR);
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(OPTIONS_VALUE_TYPE_ERROR);
    }
    values[key] = descriptor.value;
  }
  return values;
}

/**
 * Read one lane entry.
 *
 * Returns `null` when the entry is not exactly `{ source, document }` with a
 * non-empty, already-trimmed `source` of at most `MAX_SOURCE_LENGTH` and a
 * defined `document`. `null` is deliberately *not* thrown: one unusable lane must
 * not stop another lane from being evaluated.
 */
function readLaneEntry(value) {
  if (!isPlainRecord(value)) return null;
  const keys = ownKeysOf(value);
  if (keys.length !== ENTRY_KEYS.length) return null;
  for (const key of keys) {
    if (typeof key !== 'string' || !ENTRY_KEYS.includes(key)) return null;
  }

  // Read descriptors first: an accessor property would run code on read, and a
  // parsed-JSON document can never contain one.
  for (const name of ENTRY_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined) return null;
    if (descriptor.get !== undefined || descriptor.set !== undefined) return null;
  }

  const { source, document } = value;
  if (typeof source !== 'string') return null;
  if (source === '' || source !== source.trim()) return null;
  if (source.length > MAX_SOURCE_LENGTH) return null;
  if (document === undefined) return null;
  return { source, document };
}

/* ------------------------------------------------------------------ *
 * Channel assembly.
 * ------------------------------------------------------------------ */

function absentChannel() {
  return Object.freeze({
    state: 'absent',
    source: null,
    outcome: 'unknown',
    result: null,
    issues: Object.freeze([]),
  });
}

function providedChannel(source, outcome, result, codes) {
  return Object.freeze({
    state: 'provided',
    source,
    outcome,
    // Passed through by reference: the lane owns its result and may keep it
    // frozen or not; this wrapper neither copies nor mutates nor re-freezes it.
    result: result === undefined ? null : result,
    issues: Object.freeze(dedupeCodes(codes).map((code) => Object.freeze({ code }))),
  });
}

/* ------------------------------------------------------------------ *
 * Lane adapters.
 * ------------------------------------------------------------------ */

/**
 * Static lane: reuse `analyze`, and keep its own classification.
 *
 * `analyze` raises an error carrying the **own data property**
 * `code === 'ANALYZER_VALIDATOR_THREW'` only when the injected validator
 * *throws*. A validator that returns a malformed or self-contradictory value is
 * normalized by `analyze` into `VALIDATOR_CONTRACT_VIOLATION` issues and then
 * into an `INVALID_DECLARATION` finding, which is the `invalid` path and never
 * an exception.
 *
 * This adapter reads that one own data property and nothing else: it never
 * inspects `message`, so a validator that fails with different prose is
 * classified the same way. The thrown value is an `Error` instance, so it is
 * deliberately not treated as a plain record.
 */
function staticChannel(value, validateDeclaration) {
  const entry = readLaneEntry(value);
  if (entry === null) {
    return providedChannel(null, 'invalid', null, [CHANNEL_ISSUE_CODES.INPUT_INVALID]);
  }
  if (typeof validateDeclaration !== 'function') {
    return providedChannel(entry.source, 'error', null, [CHANNEL_ISSUE_CODES.VALIDATOR_MISSING]);
  }

  let report;
  try {
    report = analyze(entry.document, { validateDeclaration });
  } catch (error) {
    return staticFailure(entry.source, error);
  }

  const errorCodes = dedupeCodes(
    report.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.code),
  );
  const summary = report.summary;
  const incomplete = isPlainRecord(summary) && summary.analysisComplete === false;

  if (incomplete) {
    return providedChannel(
      entry.source,
      'invalid',
      report,
      errorCodes.length > 0 ? errorCodes : [CHANNEL_ISSUE_CODES.INPUT_INVALID],
    );
  }
  if (errorCodes.length > 0) return providedChannel(entry.source, 'attention', report, errorCodes);
  return providedChannel(entry.source, 'clear', report, []);
}

/**
 * Read one own data property, or `undefined`.
 *
 * Deliberately does **not** walk the prototype chain and does **not** invoke an
 * accessor: a thrown `Error` carries `code` as its own data property, while an
 * inherited or computed `code` is not evidence about this failure.
 */
function ownDataValue(record, key) {
  if (record === null) return undefined;
  const kind = typeof record;
  if (kind !== 'object' && kind !== 'function') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (descriptor.get !== undefined || descriptor.set !== undefined) return undefined;
  return descriptor.value;
}

function staticFailure(source, error) {
  const code = ownDataValue(error, 'code');
  if (code === 'ANALYZER_VALIDATOR_THREW') {
    return providedChannel(source, 'error', null, [CHANNEL_ISSUE_CODES.VALIDATOR_FAILED]);
  }
  if (error instanceof TypeError) {
    return providedChannel(source, 'invalid', null, [CHANNEL_ISSUE_CODES.INPUT_INVALID]);
  }
  return providedChannel(source, 'error', null, [CHANNEL_ISSUE_CODES.LANE_FAILED]);
}

/**
 * Runtime lane: reuse `summarizeRuntimeEvidence` and keep its summary intact.
 *
 * `valid: false` means the document was not summarizable, so the lane is
 * `invalid` and its own issue codes travel through. A summarizable document is
 * `attention` as soon as one case is `failed` or `not-run`; a `not-run` case is
 * never read as a pass.
 */
function runtimeChannel(value) {
  const entry = readLaneEntry(value);
  if (entry === null) {
    return providedChannel(null, 'invalid', null, [CHANNEL_ISSUE_CODES.INPUT_INVALID]);
  }

  let result;
  try {
    result = summarizeRuntimeEvidence(entry.document);
  } catch {
    return providedChannel(entry.source, 'error', null, [CHANNEL_ISSUE_CODES.LANE_FAILED]);
  }

  if (!isPlainRecord(result) || result.valid !== true || !isPlainRecord(result.summary)) {
    const issueCodes = isPlainRecord(result) && Array.isArray(result.issues)
      ? dedupeCodes(result.issues.map((issue) => (isPlainRecord(issue) ? issue.code : '')))
      : [];
    return providedChannel(
      entry.source,
      'invalid',
      result,
      issueCodes.length > 0 ? issueCodes : [CHANNEL_ISSUE_CODES.INPUT_INVALID],
    );
  }

  const cases = Array.isArray(result.summary.cases) ? result.summary.cases : [];
  const attentionCodes = dedupeCodes(cases.map((entryCase) => {
    if (!isPlainRecord(entryCase)) return '';
    if (entryCase.status === 'failed') return RUNTIME_DIAGNOSTIC_CODES.RUNTIME_CASE_FAILED;
    if (entryCase.status === 'not-run') return RUNTIME_DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN;
    return '';
  }));

  return providedChannel(
    entry.source,
    attentionCodes.length > 0 ? 'attention' : 'clear',
    result,
    attentionCodes,
  );
}

/**
 * Admission lane: reuse `diagnoseAdmissionEvidence`.
 *
 * The injected validator owns the protocol vocabulary, so the profile issues are
 * passed through unchanged. What this adapter decides is only the outcome:
 * a wrapper code (`VALIDATOR_*`) is an `error`, because no verdict was produced;
 * otherwise `valid: false` is `invalid`; `failed` / `not-run` / unknown coverage
 * is `attention`; and a run whose only findings are `refused` stays `clear`.
 */
function admissionChannel(value, validateAdmissionEvidence) {
  const entry = readLaneEntry(value);
  if (entry === null) {
    return providedChannel(null, 'invalid', null, [CHANNEL_ISSUE_CODES.INPUT_INVALID]);
  }
  if (typeof validateAdmissionEvidence !== 'function') {
    return providedChannel(entry.source, 'error', null, [CHANNEL_ISSUE_CODES.VALIDATOR_MISSING]);
  }

  let result;
  try {
    result = diagnoseAdmissionEvidence(entry.document, { validateAdmissionEvidence });
  } catch {
    // After the function check above, this lane is total: a throw here is not a
    // caller bug, so it is reported rather than propagated.
    return providedChannel(entry.source, 'error', null, [CHANNEL_ISSUE_CODES.LANE_FAILED]);
  }

  if (!isPlainRecord(result)) {
    return providedChannel(entry.source, 'error', null, [CHANNEL_ISSUE_CODES.LANE_FAILED]);
  }

  const issueCodes = Array.isArray(result.issues)
    ? dedupeCodes(result.issues.map((issue) => (isPlainRecord(issue) ? issue.code : '')))
    : [];

  if (result.valid !== true) {
    const wrapperBroke = issueCodes.some((code) => WRAPPER_CODE_SET.has(code));
    return providedChannel(
      entry.source,
      wrapperBroke ? 'error' : 'invalid',
      result,
      issueCodes.length > 0 ? issueCodes : [CHANNEL_ISSUE_CODES.INPUT_INVALID],
    );
  }

  const findings = Array.isArray(result.findings) ? result.findings : [];
  const blockingCodes = dedupeCodes(
    findings
      .map((finding) => (isPlainRecord(finding) ? finding.code : ''))
      .filter((code) => ADMISSION_ATTENTION_SET.has(code)),
  );

  return providedChannel(
    entry.source,
    blockingCodes.length > 0 ? 'attention' : 'clear',
    result,
    blockingCodes,
  );
}

/* ------------------------------------------------------------------ *
 * Public API.
 * ------------------------------------------------------------------ */

/**
 * Build one report over one or more lanes.
 *
 * Presence, not truthiness, decides whether a lane was provided: an own key whose
 * value is `null` is *provided but invalid*, while a missing key is *absent*
 * (`outcome: 'unknown'`). Neither is ever reported as `clear`.
 *
 * @param {{ static?: unknown, runtime?: unknown, admission?: unknown }} input
 * @param {{ validateDeclaration?: unknown, validateAdmissionEvidence?: unknown }} [options]
 * @returns {object} a frozen report; the lane results inside are the lanes' own
 *   objects, passed through by reference.
 * @throws {TypeError} when the envelope or the options are not the closed shape.
 */
export function buildCombinedReport(input, options = {}) {
  const { present, values } = readPresence(input);
  const settings = readOptions(options);

  const channels = Object.freeze({
    static: present.static
      ? staticChannel(values.static, settings.validateDeclaration)
      : absentChannel(),
    runtime: present.runtime ? runtimeChannel(values.runtime) : absentChannel(),
    admission: present.admission
      ? admissionChannel(values.admission, settings.validateAdmissionEvidence)
      : absentChannel(),
  });

  return Object.freeze({
    reportVersion: REPORT_VERSION,
    certification: false,
    correlation: 'not-established',
    channels,
    limitations: LIMITATION_CODES,
  });
}

/**
 * Map a report to a *processing* exit code.
 *
 * These numbers describe what the wrapper could establish about the documents it
 * was handed. They are not a compatibility verdict and not a certification:
 *
 * - `4` at least one lane produced no verdict (`error`);
 * - `2` at least one lane's document was unusable (`invalid`);
 * - `1` at least one lane needs attention, or a lane is absent (`unknown`);
 * - `0` every lane was provided and came out `clear`.
 *
 * @param {object} report the value returned by {@link buildCombinedReport}.
 * @returns {0 | 1 | 2 | 4}
 * @throws {TypeError} when `report` is not such a value.
 */
export function combinedReportExitCode(report) {
  if (!isPlainRecord(report) || !isPlainRecord(report.channels)) {
    throw new TypeError(REPORT_TYPE_ERROR);
  }

  const outcomes = LANE_IDS.map((id) => {
    const channel = report.channels[id];
    if (!isPlainRecord(channel) || !CHANNEL_OUTCOMES.includes(channel.outcome)) {
      throw new TypeError(REPORT_TYPE_ERROR);
    }
    return channel.outcome;
  });

  if (outcomes.includes('error')) return 4;
  if (outcomes.includes('invalid')) return 2;
  if (outcomes.some((outcome) => outcome === 'attention' || outcome === 'unknown')) return 1;
  return 0;
}
