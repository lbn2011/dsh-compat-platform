/**
 * dsh-compat-platform — diagnostics over a *reported* runtime coexistence
 * evidence document.
 *
 * SCOPE OF THIS MODULE
 * --------------------
 * This module turns the outcome of `summarizeRuntimeEvidence` into per-case
 * findings a human can read. It is a thin, additive layer:
 *
 *   - it does NOT re-validate the document and does NOT restate the closed
 *     evidence schema, not even its version string. Every structural judgement,
 *     every issue code and every issue message belongs to `runtime-evidence.js`;
 *     this module imports that one function and reads its result;
 *   - it adds nothing to the root package exports, and it changes neither
 *     `summarizeRuntimeEvidence` nor the admitted schema;
 *   - no new admission schema is defined here. Until the protocol draft that
 *     describes admission is approved, there is nothing to admit: a finding is a
 *     presentation of an already-validated status, not a new claim about a
 *     plugin.
 *
 * What it does:
 *   - call `summarizeRuntimeEvidence(value)` once and rely on its documented
 *     contract, which is a local call to this package's own total function: the
 *     result is `{ valid, issues, summary }`, with `issues` empty exactly when
 *     `summary` is present;
 *   - an invalid result yields `{ valid: false, certification: false, issues:
 *     <the summarizer's own list, unchanged>, findings: [] }`;
 *   - a valid result yields one finding per case whose reported status is
 *     `failed` or `not-run`, read straight from `summary.cases`, which the
 *     summarizer already emits in canonical case order; a `passed` case produces
 *     no problem finding at all (a pass is the absence of a problem, not a
 *     finding).
 *
 * What it does NOT do, by construction:
 *   - no dynamic code, no `require`, no subprocess;
 *   - no filesystem, network, environment or host access of any kind;
 *   - no clock and no randomness: the same document always produces
 *     byte-identical output;
 *   - no mutation of the input value or of the summarizer's result;
 *   - no guard of its own around the summarizer. It catches nothing and repairs
 *     nothing: if that call ever broke its contract by throwing, the exception
 *     propagates, and a `summary` this code invented would only disguise the
 *     break. Turning an unreadable value into a closed refusal is the
 *     summarizer's job, and fabricating an issue here would be a second,
 *     unreviewed notion of what is wrong with a document.
 *
 * INPUT CONTRACT
 * --------------
 * The supported input is *parsed JSON*: the output of `JSON.parse`, which carries
 * own data properties only, and such a value is inert to read. That contract —
 * not a sandbox — is the scope of the purity and determinism claimed above. A
 * JavaScript object that is not plain data can run code merely by being read (an
 * accessor on access, a `Proxy` in its own traps), and no pure function can
 * promise termination for hostile JavaScript. See the note at the top of
 * `runtime-evidence.js`; the same limits apply here.
 *
 * EVIDENCE TIER IS A CLAIM, NOT A CERTIFICATION
 * ---------------------------------------------
 * `evidenceTier` inside the document is a string copied out of an untrusted
 * receipt. This module cannot authenticate it, so `certification` is hard-coded
 * `false` here as well, and no finding ever says a plugin is compatible. A
 * `valid: true` result means only "this document is internally consistent";
 * `findings: []` means "no case reported a failure or a missing run", never
 * "these plugins are certified to coexist".
 *
 * @packageDocumentation
 */

import { CASE_IDS, summarizeRuntimeEvidence } from './runtime-evidence.js';

/**
 * Stable finding codes.
 *
 * Fixed strings, never renamed: a downstream reader may key on them. They are
 * deliberately few and about *reported status*, never about compatibility, so
 * that a new outcome needs a new code rather than a reinterpretation of an old
 * one.
 */
export const DIAGNOSTIC_CODES = Object.freeze({
  /** The case was reported with status `failed`. */
  RUNTIME_CASE_FAILED: 'RUNTIME_CASE_FAILED',
  /** The case was reported with status `not-run`: unknown, not a pass. */
  RUNTIME_CASE_NOT_RUN: 'RUNTIME_CASE_NOT_RUN',
});

/**
 * The order findings are emitted in: the canonical case order, which is also the
 * order `summary.cases` already uses. Exported so a reader can rely on it without
 * importing a second module.
 */
export const DIAGNOSTIC_CASE_ORDER = CASE_IDS;

/**
 * Map a reported case status to the finding code it earns, or `null` when the
 * status is not a problem.
 *
 * Only the three statuses the schema already enforces are named here. No other
 * value can reach this function, because the summarizer refuses such a document
 * first; `null` is a fail-quiet default, not a guess about an unknown status.
 */
function codeForStatus(status) {
  if (status === 'failed') return DIAGNOSTIC_CODES.RUNTIME_CASE_FAILED;
  if (status === 'not-run') return DIAGNOSTIC_CODES.RUNTIME_CASE_NOT_RUN;
  return null;
}

/**
 * The fixed text for one finding. Built only from the case id and the counts the
 * summary already carries, so it is stable across runs and never quotes anything
 * the reporter could have phrased differently.
 */
function messageFor(entry) {
  if (entry.status === 'failed') {
    return `case ${entry.id} was reported as failed: ${entry.failedAssertionCount} of ${entry.assertionCount} recorded assertion(s) were false. A recorded failure is a reported outcome about one environment, not a general verdict.`;
  }
  return `case ${entry.id} was reported as not run: no assertion was recorded. A case that was not run is unknown and is never read as a pass.`;
}

/** Freeze one finding: a flat record of four strings, in a fixed key order. */
function makeFinding(entry) {
  return Object.freeze({
    code: codeForStatus(entry.status),
    caseId: entry.id,
    status: entry.status,
    message: messageFor(entry),
  });
}

/**
 * Diagnose a reported coexistence-evidence document.
 *
 * Delegates every structural decision to {@link summarizeRuntimeEvidence} — the
 * only validator for the evidence schema in this package — and adds per-case
 * findings on top of the accepted summary.
 *
 * Pure and deterministic for the supported input, an already-parsed JSON value;
 * it never mutates its argument. An invalid document comes back as the
 * summarizer refused it, with no finding derived from a document that was not
 * understood.
 *
 * @param {unknown} value The evidence document, already parsed from JSON.
 * @returns {{
 *   valid: boolean,
 *   certification: false,
 *   issues: ReadonlyArray<{ code: string, path: string, message: string }>,
 *   findings: ReadonlyArray<{ code: string, caseId: string, status: string, message: string }>,
 * }}
 *   For an invalid document `issues` is the summarizer's own list, unchanged,
 *   and `findings` is empty. For a valid document `issues` is empty and
 *   `findings` holds one entry per `failed` / `not-run` case in canonical case
 *   order; a `passed` case contributes nothing. `certification` is `false`
 *   unconditionally.
 */
export function diagnoseRuntimeEvidence(value) {
  const result = summarizeRuntimeEvidence(value);

  if (!result.valid) {
    return Object.freeze({
      valid: false,
      certification: false,
      issues: result.issues,
      findings: Object.freeze([]),
    });
  }

  const findings = [];
  // `summary.cases` is already in canonical case order, with exactly one entry
  // per required case, so its order is the order findings come out in.
  for (const entry of result.summary.cases) {
    if (codeForStatus(entry.status) === null) continue; // `passed` earns no problem finding.
    findings.push(makeFinding(entry));
  }

  return Object.freeze({
    valid: true,
    certification: false,
    issues: result.issues,
    findings: Object.freeze(findings),
  });
}
