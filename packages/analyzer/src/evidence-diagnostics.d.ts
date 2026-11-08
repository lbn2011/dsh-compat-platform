/**
 * dsh-compat-platform — types for diagnostics over a *reported* runtime
 * coexistence evidence document.
 *
 * This module re-validates nothing: it delegates to `summarizeRuntimeEvidence`
 * from `runtime-evidence.js` and only adds per-case findings. It does not extend
 * the root package exports, does not alter the admitted evidence schema, and
 * defines no admission schema.
 *
 * @packageDocumentation
 */

/** The three case ids, in canonical (summary and finding) order. */
export type DiagnosticCaseId = 'same-name-conflict' | 'dependency-unload' | 'stale-cleanup';

/** The only case statuses; anything else is refused by the summarizer, not here. */
export type DiagnosticCaseStatus = 'passed' | 'failed' | 'not-run';

/**
 * Stable finding codes about a *reported status*.
 *
 * Never renamed. `RUNTIME_CASE_FAILED` and `RUNTIME_CASE_NOT_RUN` are the only
 * codes this release can produce; a new outcome needs a new code.
 */
export type DiagnosticCode = 'RUNTIME_CASE_FAILED' | 'RUNTIME_CASE_NOT_RUN';

export declare const DIAGNOSTIC_CODES: Readonly<{
  RUNTIME_CASE_FAILED: 'RUNTIME_CASE_FAILED';
  RUNTIME_CASE_NOT_RUN: 'RUNTIME_CASE_NOT_RUN';
}>;

/** Canonical case order used when findings are emitted. */
export declare const DIAGNOSTIC_CASE_ORDER: ReadonlyArray<DiagnosticCaseId>;

/** One issue, exactly as `summarizeRuntimeEvidence` reported it (passed through, not restated). */
export interface DiagnosticIssue {
  code: string;
  path: string;
  message: string;
}

/**
 * One problem finding.
 *
 * `caseId` is the case id as reported and `status` is that case's reported
 * status; neither is inferred. `message` is fixed text derived from the case id
 * and the summary's counts, so it is stable across runs.
 */
export interface DiagnosticFinding {
  /** `RUNTIME_CASE_FAILED` for `failed`, `RUNTIME_CASE_NOT_RUN` for `not-run`. */
  code: DiagnosticCode;
  caseId: DiagnosticCaseId;
  status: 'failed' | 'not-run';
  message: string;
}

/**
 * The diagnostic result.
 *
 * - Invalid document: `valid: false`, `issues` is the summarizer's own issue
 *   list (non-empty), and `findings` is empty — no finding is invented for a
 *   document that was not understood.
 * - Valid document: `valid: true`, `issues` is empty, and `findings` holds one
 *   entry per `failed` / `not-run` case in canonical case order. A `passed` case
 *   contributes no problem finding, so `findings: []` means "no case reported a
 *   failure or a missed run", not "certified compatible".
 *
 * `certification` is `false` unconditionally: the document's `evidenceTier` is a
 * string copied from an untrusted receipt that a pure reader cannot
 * authenticate. A valid result means only that the document is internally
 * consistent.
 */
export interface DiagnosticsResult {
  valid: boolean;
  certification: false;
  issues: ReadonlyArray<DiagnosticIssue>;
  findings: ReadonlyArray<DiagnosticFinding>;
}

/**
 * Diagnose a reported coexistence-evidence document.
 *
 * Supported input is an already-parsed JSON value (own data properties only),
 * which is inert to read; purity and determinism are claimed for that input and
 * nothing wider has to be claimed, since an accessor or a `Proxy` can run code
 * merely by being read. For that input the function never mutates its argument
 * and returns a deeply frozen, deterministic result. Reads no files, starts no
 * process, calls no host.
 *
 * It catches nothing and repairs nothing around the summarizer: the summarizer
 * is what turns an unreadable value into a closed refusal, and a `summary` this
 * function had to invent would only hide a broken contract.
 *
 * @param value The evidence document, already parsed from JSON.
 */
export declare function diagnoseRuntimeEvidence(value: unknown): DiagnosticsResult;
