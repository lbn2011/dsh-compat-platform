/**
 * dsh-compat-platform — types for platform diagnostics over an admission
 * evidence validator's *return value*.
 *
 * Scope, repeated because it is the whole point of this module: the admission
 * evidence grammar, the eight-case catalog, the per-case assertion sets and the
 * closed issue-code list belong to
 * `projects/dsh-compat-spec/spec/admission-evidence.md` (§4–§6.7). This module
 * re-checks only the **return shape** of §6.6, takes the validator by injection,
 * and adds per-case findings. It adds nothing to the root package exports and
 * defines no admission schema of its own.
 *
 * @packageDocumentation
 */

/**
 * The four status words of the lane (§5).
 *
 * Declared here because a finding is derived from a status. The module does not
 * export a runtime list: the vocabulary is the protocol's, not the platform's.
 */
export type AdmissionCaseStatus = 'passed' | 'refused' | 'failed' | 'not-run';

/**
 * Stable finding codes about a *reported status* or *reported coverage*.
 *
 * Never renamed. None of them is a compatibility verdict:
 * `ADMISSION_CASE_REFUSED` in particular records an observed refusal, which is
 * the **expected** outcome of its case and not a failure of the run.
 */
export type DiagnosticCode =
  | 'ADMISSION_CASE_FAILED'
  | 'ADMISSION_CASE_REFUSED'
  | 'ADMISSION_CASE_NOT_RUN'
  | 'ADMISSION_COVERAGE_UNKNOWN';

export declare const DIAGNOSTIC_CODES: Readonly<{
  ADMISSION_CASE_FAILED: 'ADMISSION_CASE_FAILED';
  ADMISSION_CASE_REFUSED: 'ADMISSION_CASE_REFUSED';
  ADMISSION_CASE_NOT_RUN: 'ADMISSION_CASE_NOT_RUN';
  ADMISSION_COVERAGE_UNKNOWN: 'ADMISSION_COVERAGE_UNKNOWN';
}>;

/**
 * Platform refusal codes, used only when the injected validator did not return a
 * §6.6-shaped result.
 *
 * These are a **platform** contract. They are not protocol codes, are not members
 * of the protocol's closed §6.7 list, and must not be reported as if they were.
 */
export type WrapperIssueCode =
  | 'VALIDATOR_THREW'
  | 'VALIDATOR_ASYNC'
  | 'VALIDATOR_RESULT_MALFORMED'
  | 'VALIDATOR_RESULT_INCONSISTENT';

export declare const WRAPPER_ISSUE_CODES: Readonly<{
  VALIDATOR_THREW: 'VALIDATOR_THREW';
  VALIDATOR_ASYNC: 'VALIDATOR_ASYNC';
  VALIDATOR_RESULT_MALFORMED: 'VALIDATOR_RESULT_MALFORMED';
  VALIDATOR_RESULT_INCONSISTENT: 'VALIDATOR_RESULT_INCONSISTENT';
}>;

/**
 * One protocol issue, exactly as the validator reported it.
 *
 * Passed through by reference and never rewritten: `code` is one of the protocol's
 * closed codes and `path` is a protocol location, both of which this module
 * declines to re-state. Note that a `code` or `path` string is still
 * validator-produced text and may carry anything the validator put there.
 */
export interface ProtocolIssue {
  code: string;
  path: string;
}

/** One platform issue, which this module built itself. */
export interface WrapperIssue {
  code: WrapperIssueCode;
  /** A location built from fixed key names and array indices, never from input text. */
  path: string;
}

/** One reported case, as the protocol's summary carries it (§6.6). */
export interface AdmissionCasePortion {
  id: string;
  status: AdmissionCaseStatus;
  /**
   * Non-negative integer count of assertions the case recorded.
   *
   * Tied to `status` (an accepted summary satisfies exactly one row):
   * `passed` / `refused` — positive and no failed assertion; `failed` — positive
   * with at least one failed assertion; `not-run` — zero, with no failed assertion
   * and at least one limitation.
   */
  assertionCount: number;
  /** Unique ids of the assertions that came out false; at most `assertionCount` of them, and none unless `status` is `failed`. */
  failedAssertions: readonly string[];
  /** Producer-written sentences, preserved verbatim and never rendered into finding text. Required non-empty for `not-run`. */
  limitations: readonly string[];
}

/** Coverage as the protocol's summary carries it (§6.6). */
export interface AdmissionCoveragePortion {
  /** The catalog ids the lane requires: always a subset of `present` in an accepted summary. */
  required: readonly string[];
  /** The catalog ids the document reports. */
  present: readonly string[];
  /** Catalog ids the document does not report, i.e. absent optional coverage. */
  unknown: readonly string[];
}

/**
 * The protocol's summary (§6.6), described for callers.
 *
 * This module does not build it, copy it or freeze it: it passes the validator's
 * own object through by reference, so `Object.isFrozen(summary)` after a call is
 * whatever it was before.
 */
export interface AdmissionSummary {
  schemaVersion: string;
  /** Literal `false`, always. A summary that certifies is refused as malformed. */
  certification: false;
  coverage: AdmissionCoveragePortion;
  cases: readonly AdmissionCasePortion[];
  limitations: readonly string[];
}

/** A finding about one reported case. */
export interface AdmissionCaseFinding {
  code: 'ADMISSION_CASE_FAILED' | 'ADMISSION_CASE_REFUSED' | 'ADMISSION_CASE_NOT_RUN';
  /** The case id as reported, carried as data — never interpolated into `message`. */
  caseId: string;
  status: 'failed' | 'refused' | 'not-run';
  /** Fixed platform text derived from the case's counts only. */
  message: string;
}

/** A finding about an optional case the document does not report at all. */
export interface AdmissionCoverageFinding {
  code: 'ADMISSION_COVERAGE_UNKNOWN';
  caseId: string;
  status: null;
  /** Fixed platform text; no id and no limitation text is embedded. */
  message: string;
}

export type AdmissionFinding = AdmissionCaseFinding | AdmissionCoverageFinding;

/** Accepted: the validator returned the §6.6 shape, and `valid` was true. */
export interface AdmissionDiagnosticsValid {
  valid: true;
  /** Unconditionally `false`: a receipt is a self-report, never a certification. */
  certification: false;
  issues: readonly ProtocolIssue[];
  findings: readonly AdmissionFinding[];
  /** The validator's own summary object, by reference. */
  summary: AdmissionSummary;
}

/**
 * Not accepted: either the validator refused the document (`issues` are the
 * protocol's, unchanged), or it broke the §6.6 return contract (`issues` hold one
 * `VALIDATOR_*` code). There is no `summary` key in either case.
 */
export interface AdmissionDiagnosticsInvalid {
  valid: false;
  certification: false;
  issues: readonly (ProtocolIssue | WrapperIssue)[];
  findings: readonly [];
}

export type AdmissionDiagnostics = AdmissionDiagnosticsValid | AdmissionDiagnosticsInvalid;

/**
 * The injected validator's shape (§6.6): synchronous, pure, one argument.
 *
 * Supplied by the caller and trusted by injection, exactly as `analyze()` trusts
 * `validateDeclaration`. Its *return* is still checked here, fail-closed.
 */
export interface AdmissionEvidenceValidator {
  (value: unknown): { valid: boolean; issues: readonly ProtocolIssue[]; summary?: AdmissionSummary };
}

/**
 * Diagnose the result of an admission evidence validator.
 *
 * Pure for a parsed-JSON document and a well-behaved injected function: it
 * mutates neither its argument, nor the validator's result, nor the summary it
 * passes through, and makes no filesystem, process, clock, randomness or host
 * call. It keeps no state, so it is deterministic exactly to the extent the
 * injected function is — a validator that answers differently per call is
 * followed, not smoothed over. Plain data is not required for *typing*, only for
 * the purity statement above: an object whose reads run code can do so here too,
 * and this module is not a sandbox.
 *
 * A validator that throws, answers asynchronously, or returns something
 * unreadable produces a closed refusal (`valid: false` with a `VALIDATOR_*` code
 * and no `summary`); the error itself never propagates.
 *
 * @param value The admission evidence document, already parsed from JSON.
 * @param options Carries the injected validator.
 * @returns The validator's verdict and issues, plus findings for `failed`,
 *   `refused` and `not-run` cases and for `coverage.unknown`; `certification` is
 *   always `false`.
 * @throws TypeError only when `options.validateAdmissionEvidence` is not a
 *   function — a caller error, not an evidence verdict. Reading that property is
 *   the caller's own object access: a throwing getter on `options` propagates as
 *   the caller's exception rather than being converted into a verdict.
 */
export declare function diagnoseAdmissionEvidence(
  value: unknown,
  options: { validateAdmissionEvidence: AdmissionEvidenceValidator },
): AdmissionDiagnostics;
