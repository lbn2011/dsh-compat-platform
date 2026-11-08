/**
 * dsh-compat-platform — platform diagnostics over an admission evidence
 * validator's *return value*.
 *
 * SCOPE OF THIS MODULE
 * --------------------
 * The admission evidence lane — `admission-evidence/0.1-draft.1`, specified in
 * `projects/dsh-compat-spec/spec/admission-evidence.md` — owns the document
 * grammar, the eight-case catalog, the per-case assertion sets and the closed
 * issue-code list. None of that is repeated here. This module is a **platform
 * wrapper**, the kind §6.7 explicitly leaves to the consumer:
 *
 *   - the validator is **injected** by the caller (`validateAdmissionEvidence`),
 *     exactly as `analyze()` takes `validateDeclaration`. This package does not
 *     import it, does not bundle it, and does not implement it;
 *   - the only structure checked here is the *shape of the validator's return*
 *     (§6.6) — closed members, `{ code, path }` issues, a summary present
 *     exactly when `valid` is true — plus the relations that summary states about
 *     itself: `coverage` against the reported case ids, and each case's status
 *     against its own counts;
 *   - **no case-id catalog, no assertion-id catalog and no issue-code catalog**
 *     is copied into this file. A module-level list of the eight case ids would
 *     be a second, silently stale copy of the protocol; the summary already
 *     carries `coverage` and `cases`, and findings are driven from those. The
 *     four status words are the single exception, because a status is what a
 *     finding is about: they are named once, privately, and never exported;
 *   - nothing is added to the root package exports, and neither the protocol
 *     draft nor the `coexistence-evidence/0.1` lane is edited by this module.
 *
 * WHAT IT ADDS
 * ------------
 * For a validator result the wrapper accepts, it returns the protocol issues and
 * the protocol summary unchanged, plus one finding per case whose reported
 * status is `failed`, `refused` or `not-run`, and one finding per id named in
 * `coverage.unknown`. A `passed` case produces no finding: a pass is the absence
 * of a problem, not a finding. A `refused` case is a **success of the
 * coordinator** — its finding says so in its own fixed text and must not be read
 * as a failure of the run.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * A validator that throws, returns a thenable, or returns something that is not
 * the §6.6 shape yields a **closed platform refusal**: `valid: false` with a
 * single fixed issue code and no summary. The same holds when the returned value
 * *throws while being read* — an accessor or a proxy trap can do that on a value
 * the validator handed back, and inspection is guarded for exactly that reason.
 * In every one of these cases nothing propagates except the documented
 * `TypeError`, and no finding is derived from a result that was not understood.
 * `VALIDATOR_THREW` means "the injected call did not return";
 * `VALIDATOR_RESULT_MALFORMED` means "it returned something that could not be
 * read as a §6.6 result". Neither distinguishes a validator defect from a hostile
 * object graph, and neither is a verdict about the document.
 *
 * The failure codes below are a **platform contract**, not protocol codes. They
 * are not in the protocol's closed §6.7 list and must never be reported as if
 * they were.
 *
 * WHAT IT NEVER CLAIMS
 * --------------------
 * `certification` is `false` in every result this module can produce, and the
 * protocol's own `summary.certification` must be the literal `false` or the
 * result is refused as malformed. A receipt is a self-report: the evidence tier,
 * if any, is an unauthenticated claim of the producer, and nothing here upgrades
 * it. `valid: true` means only "the validator returned a well-formed result";
 * `findings: []` means only "no reported case failed, was refused, or went
 * unrun", never "these plugins are compatible".
 *
 * INPUT AND EFFECT SCOPE
 * ----------------------
 * The supported input is a **parsed JSON value** plus a **trusted-by-injection**
 * validator function. That is a scope statement, not a sandbox claim: a
 * JavaScript object that is not plain data can run code merely by being read,
 * and this module cannot prevent that. It makes no filesystem, network,
 * environment, clock, randomness or host call, and keeps no state of its own: it
 * neither mutates its argument, nor the validator's result, nor the summary it
 * passes through. Determinism is therefore conditional on the injected function
 * being deterministic — with a deterministic validator the same document yields
 * deeply equal output on every call; with a validator that answers differently
 * per call (a counter, a clock, an internal cache) the output follows it, because
 * this module adds no memoisation of its own to hide the difference.
 *
 * @packageDocumentation
 */

/**
 * Stable finding codes.
 *
 * Fixed strings, never renamed: a downstream reader may key on them. Each code
 * names an *observation the summary already carries*; none of them says a plugin
 * is compatible, incompatible or certified.
 */
export const DIAGNOSTIC_CODES = Object.freeze({
  /** The case was reported with status `failed`: the expected outcome was not observed. */
  ADMISSION_CASE_FAILED: 'ADMISSION_CASE_FAILED',
  /** The case was reported with status `refused`: the expected outcome *was* observed. */
  ADMISSION_CASE_REFUSED: 'ADMISSION_CASE_REFUSED',
  /** The case was reported with status `not-run`: unknown, never a pass. */
  ADMISSION_CASE_NOT_RUN: 'ADMISSION_CASE_NOT_RUN',
  /** An optional catalog case is absent from the document: unknown coverage, never a pass. */
  ADMISSION_COVERAGE_UNKNOWN: 'ADMISSION_COVERAGE_UNKNOWN',
});

/**
 * Platform-level refusal codes, used only when the injected validator did not
 * return a §6.6-shaped result.
 *
 * These are **not** protocol issue codes. They exist so a broken or hostile
 * validator becomes a closed refusal instead of an exception, and so a reader can
 * tell "the document is wrong" (protocol codes, passed through) from "the
 * validator did not answer" (these codes).
 */
export const WRAPPER_ISSUE_CODES = Object.freeze({
  /** The injected call threw. No result was produced. */
  VALIDATOR_THREW: 'VALIDATOR_THREW',
  /** The injected call returned a thenable. The validator must be synchronous. */
  VALIDATOR_ASYNC: 'VALIDATOR_ASYNC',
  /** The returned value is not the closed §6.6 shape. */
  VALIDATOR_RESULT_MALFORMED: 'VALIDATOR_RESULT_MALFORMED',
  /** The returned value is well-formed in isolation but contradicts itself. */
  VALIDATOR_RESULT_INCONSISTENT: 'VALIDATOR_RESULT_INCONSISTENT',
});

/**
 * The four status words of the admission lane, in the order §5 lists them.
 *
 * Private on purpose: exporting it would make this platform wrapper look like the
 * owner of the vocabulary. It is named here only because a finding must be
 * derived from a status, and an unrecognised status must fail closed rather than
 * silently earn no finding.
 */
const CASE_STATUSES = Object.freeze(['passed', 'refused', 'failed', 'not-run']);

/** Closed member sets, from the protocol's §6.6 return contract. */
const RESULT_KEYS_VALID = Object.freeze(['valid', 'issues', 'summary']);
const RESULT_KEYS_INVALID = Object.freeze(['valid', 'issues']);
const ISSUE_KEYS = Object.freeze(['code', 'path']);
const SUMMARY_KEYS = Object.freeze(['schemaVersion', 'certification', 'coverage', 'cases', 'limitations']);
const COVERAGE_KEYS = Object.freeze(['required', 'present', 'unknown']);
const CASE_KEYS = Object.freeze(['id', 'status', 'assertionCount', 'failedAssertions', 'limitations']);

/* ------------------------------------------------------------------ *
 * Small structural predicates. Pure, total over parsed JSON values.
 * ------------------------------------------------------------------ */

/** A non-array object, `null` excluded. */
function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Exactly these own keys, no more and no fewer.
 *
 * Closes on `Reflect.ownKeys`, not `Object.keys`: the latter reports only
 * enumerable string keys, so a returned object could carry a symbol-keyed or a
 * non-enumerable extra member and still look closed. JSON can express neither,
 * and the protocol's own driver closes on own keys, so a key that is not one of
 * the expected strings means "not this shape".
 */
function isClosedRecord(value, keys) {
  if (!isPlainRecord(value)) return false;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) return false;
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
  }
  return true;
}

/** An array with no holes, so that its length is a real count. */
function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) return false;
  }
  return true;
}

/** A dense list of non-empty strings. Repetition is allowed. */
function isTextList(value) {
  if (!isDenseArray(value)) return false;
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') return false;
  }
  return true;
}

/**
 * A dense list of non-empty, **unique** strings: a set of identifiers.
 *
 * Uniqueness is checked here rather than left to set arithmetic later, because a
 * duplicated identifier makes a count and a set membership disagree.
 */
function isIdList(value) {
  if (!isDenseArray(value)) return false;
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/** A thenable result means the validator broke its synchronous contract. */
function isThenable(value) {
  if (value === null) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  return typeof value.then === 'function';
}

/* ------------------------------------------------------------------ *
 * Result assembly.
 * ------------------------------------------------------------------ */

/** One frozen platform issue. `path` is a location this module built itself. */
function platformIssue(code, path) {
  return Object.freeze({ code, path });
}

/**
 * A closed platform refusal: no summary, no findings, `valid: false`.
 *
 * `valid` is false rather than "unknown" because nothing was established: a
 * caller that treats a refusal as "not invalid" would read an unread receipt as
 * a clean one.
 */
function refuseWith(code, path) {
  return Object.freeze({
    valid: false,
    certification: false,
    issues: Object.freeze([platformIssue(code, path)]),
    findings: Object.freeze([]),
  });
}

/**
 * Inspect the validator's return value against §6.6 alone.
 *
 * Returns `{ ok: true, summary }` — with `summary` `null` for a validly reported
 * refusal — or `{ ok: false, code, path }`. The first deviation in a fixed
 * traversal order wins, so the same broken result always yields the same issue.
 *
 * Nothing here re-reads the document: a `summary` that satisfies these checks has
 * only been shown to be *well-shaped*, which is exactly what §6.6 entitles a
 * platform to check.
 */
function inspectResult(result) {
  if (!isPlainRecord(result)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'result' };
  }
  if (typeof result.valid !== 'boolean') {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'result.valid' };
  }

  const valid = result.valid;
  // "summary iff valid" is a presence rule, so it is checked before the closed
  // member set: otherwise a `summary: null` on a refusal would be reported as a
  // generic extra member instead of the specific violation it is.
  if (valid ? !hasOwn(result, 'summary') : hasOwn(result, 'summary')) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'result.summary' };
  }
  if (!isClosedRecord(result, valid ? RESULT_KEYS_VALID : RESULT_KEYS_INVALID)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'result' };
  }

  if (!isDenseArray(result.issues)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'result.issues' };
  }
  for (let index = 0; index < result.issues.length; index += 1) {
    const entry = result.issues[index];
    const at = `result.issues[${index}]`;
    // The issue code vocabulary belongs to the protocol and is deliberately not
    // copied here; only its closed two-member shape and string-ness are checked.
    if (!isClosedRecord(entry, ISSUE_KEYS)) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: at };
    }
    if (typeof entry.code !== 'string' || entry.code === '') {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.code` };
    }
    if (typeof entry.path !== 'string') {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.path` };
    }
  }

  if (!valid) {
    if (result.issues.length === 0) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'result.issues' };
    }
    return { ok: true, summary: null };
  }

  if (result.issues.length !== 0) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'result.issues' };
  }

  const summary = result.summary;
  if (!isClosedRecord(summary, SUMMARY_KEYS)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary' };
  }
  // The literal is checked for presence and string-ness only: pinning the draft
  // version here would make a protocol promotion a code change in this file.
  if (typeof summary.schemaVersion !== 'string' || summary.schemaVersion === '') {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary.schemaVersion' };
  }
  // A summary that certifies anything is refused, never quietly downgraded: this
  // module cannot authenticate a producer, so it will not launder a claim of one.
  if (summary.certification !== false) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary.certification' };
  }
  if (!isTextList(summary.limitations)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary.limitations' };
  }

  const coverage = summary.coverage;
  if (!isClosedRecord(coverage, COVERAGE_KEYS)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary.coverage' };
  }
  for (const name of COVERAGE_KEYS) {
    if (!isIdList(coverage[name])) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `summary.coverage.${name}` };
    }
  }

  if (!isDenseArray(summary.cases)) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: 'summary.cases' };
  }
  for (let index = 0; index < summary.cases.length; index += 1) {
    const entry = summary.cases[index];
    const at = `summary.cases[${index}]`;
    if (!isClosedRecord(entry, CASE_KEYS)) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: at };
    }
    if (typeof entry.id !== 'string' || entry.id === '') {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.id` };
    }
    if (!CASE_STATUSES.includes(entry.status)) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.status` };
    }
    if (!Number.isInteger(entry.assertionCount) || entry.assertionCount < 0) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.assertionCount` };
    }
    if (!isIdList(entry.failedAssertions)) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.failedAssertions` };
    }
    // A case cannot have failed more assertions than it recorded. Membership in
    // the case's assertion set is not checkable here — the summary does not carry
    // that set, and copying it in would duplicate the protocol's catalog — so the
    // length bound is the only invariant this layer can enforce.
    if (entry.failedAssertions.length > entry.assertionCount) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.failedAssertions` };
    }
    if (!isTextList(entry.limitations)) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, path: `${at}.limitations` };
    }

    // A reported status must agree with the counts in its own case entry, and each
    // status allows exactly one such agreement (§6.2, §6.5). This is a relation
    // inside the summary rather than a shape, so a violation is an inconsistency;
    // and it needs no catalog — everything below is read off the entry alone.
    if (entry.status === 'not-run') {
      // Nothing ran, so nothing was recorded and nothing failed; and a case that
      // produced no observation has to say why the outcome is unknown.
      if (entry.assertionCount !== 0) {
        return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.assertionCount` };
      }
      if (entry.failedAssertions.length !== 0) {
        return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.failedAssertions` };
      }
      if (entry.limitations.length === 0) {
        return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.limitations` };
      }
    } else if (entry.status === 'failed') {
      // A failure means assertions were evaluated and at least one came out false.
      if (entry.assertionCount === 0) {
        return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.assertionCount` };
      }
      if (entry.failedAssertions.length === 0) {
        return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.failedAssertions` };
      }
    } else if (entry.assertionCount === 0) {
      // `passed` and `refused` both observed something: a refusal is a rejection
      // the coordinator actually performed, not a case that never ran.
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.assertionCount` };
    } else if (entry.failedAssertions.length !== 0) {
      return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: `${at}.failedAssertions` };
    }
  }

  const caseIds = summary.cases.map((entry) => entry.id);
  if (new Set(caseIds).size !== caseIds.length) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'summary.cases' };
  }

  // Coverage and cases must describe one document: `present` is the set of
  // reported cases, `required` is a subset of it, and `unknown` is disjoint from
  // it. These are set relations between well-formed lists, so a violation is an
  // inconsistency rather than a malformed shape.
  const present = new Set(coverage.present);
  if (present.size !== caseIds.length || caseIds.some((id) => !present.has(id))) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'summary.coverage.present' };
  }
  if (coverage.required.some((id) => !present.has(id))) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'summary.coverage.required' };
  }
  if (coverage.unknown.some((id) => present.has(id))) {
    return { ok: false, code: WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_INCONSISTENT, path: 'summary.coverage.unknown' };
  }

  return { ok: true, summary };
}

/* ------------------------------------------------------------------ *
 * Findings.
 * ------------------------------------------------------------------ */

/**
 * The fixed text for one case finding.
 *
 * Built from the case's own counts and nothing else: no case id and no
 * `limitations` text is interpolated, because both are producer-written strings
 * and this module does not render them into prose it then presents as platform
 * text. The id travels in `caseId`, where it is data.
 */
function messageFor(entry) {
  if (entry.status === 'failed') {
    return `case reported failed: ${entry.failedAssertions.length} of ${entry.assertionCount} recorded assertion(s) were false. A reported failure is an outcome of one run, not a general verdict.`;
  }
  if (entry.status === 'not-run') {
    return 'case reported not run: no assertion was recorded, so the outcome is unknown and is never read as a pass.';
  }
  return 'case reported refused: the contender was rejected before any of its own code ran. A refusal is the expected outcome of this case, not a failure of the run.';
}

/** Map a reported status to its finding code, or `null` when it earns none. */
function codeForStatus(status) {
  if (status === 'failed') return DIAGNOSTIC_CODES.ADMISSION_CASE_FAILED;
  if (status === 'refused') return DIAGNOSTIC_CODES.ADMISSION_CASE_REFUSED;
  if (status === 'not-run') return DIAGNOSTIC_CODES.ADMISSION_CASE_NOT_RUN;
  return null; // `passed` earns no finding; no other value can reach here.
}

/**
 * Findings for an accepted summary, in a fixed order: reported cases in the
 * summary's own order (the protocol already emits catalog order), then one
 * finding per `coverage.unknown` id in that list's order.
 *
 * Order is preserved, never re-sorted: sorting by the catalog would require a
 * copy of the catalog, which this module refuses to keep.
 */
function findingsFor(summary) {
  const findings = [];

  for (const entry of summary.cases) {
    const code = codeForStatus(entry.status);
    if (code === null) continue;
    findings.push(Object.freeze({
      code,
      caseId: entry.id,
      status: entry.status,
      message: messageFor(entry),
    }));
  }

  for (const id of summary.coverage.unknown) {
    findings.push(Object.freeze({
      code: DIAGNOSTIC_CODES.ADMISSION_COVERAGE_UNKNOWN,
      caseId: id,
      status: null,
      message: 'optional case absent from the document: no observation was reported, so its coverage is unknown and is never read as a pass.',
    }));
  }

  return Object.freeze(findings);
}

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

/** Resolve the injected validator, or fail as the caller bug that it is. */
function resolveValidator(options) {
  const validator = options === null || typeof options !== 'object' ? undefined : options.validateAdmissionEvidence;
  if (typeof validator !== 'function') {
    throw new TypeError('diagnoseAdmissionEvidence requires options.validateAdmissionEvidence to be a function');
  }
  return validator;
}

/**
 * Diagnose the result of an admission evidence validator.
 *
 * The validator is called **once**, synchronously, with `value` unchanged. Its
 * result is checked only against the §6.6 return shape; the document grammar, the
 * case catalog and the issue vocabulary stay with the protocol.
 *
 * @param {unknown} value The admission evidence document, already parsed from JSON.
 * @param {{ validateAdmissionEvidence: (value: unknown) => unknown }} options
 *   The injected, trusted-by-injection validator.
 * @returns {{
 *   valid: boolean,
 *   certification: false,
 *   issues: ReadonlyArray<{ code: string, path: string }>,
 *   findings: ReadonlyArray<{ code: string, caseId: string, status: string | null, message: string }>,
 *   summary?: object,
 * }}
 *   Rejected by the validator: `valid: false`, its own issues unchanged, no
 *   findings, no `summary` key. Accepted: `valid: true`, `issues` empty, the
 *   summary passed through by reference, and findings for `failed`, `refused`,
 *   `not-run` cases plus `coverage.unknown`. The validator broke the §6.6
 *   contract: `valid: false` with one `VALIDATOR_*` issue. `certification` is
 *   `false` in every case.
 * @throws {TypeError} When `options.validateAdmissionEvidence` is not a function.
 *   That is a caller error, not an evidence verdict, and it is the only throw this
 *   module raises on its own. Reading that property is the caller's own object
 *   access: a throwing getter on `options` propagates as the caller's exception
 *   rather than being converted into a verdict, and a hostile return value that
 *   throws while being inspected is caught and reported as
 *   `VALIDATOR_RESULT_MALFORMED`.
 */
export function diagnoseAdmissionEvidence(value, options) {
  const validate = resolveValidator(options);

  let result;
  try {
    result = validate(value);
  } catch {
    // Deliberately swallowed: a validator that throws (or a hostile getter inside
    // `value` that runs during the call) produces no result to judge. Propagating
    // it would hand a caller an exception where a verdict was promised.
    return refuseWith(WRAPPER_ISSUE_CODES.VALIDATOR_THREW, '');
  }

  let thenable;
  try {
    thenable = isThenable(result);
  } catch {
    // Reading `.then` itself can run code on a hostile return value.
    return refuseWith(WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result');
  }
  if (thenable) {
    return refuseWith(WRAPPER_ISSUE_CODES.VALIDATOR_ASYNC, '');
  }

  let protocolIssues;
  let summary;
  let findings = null;
  try {
    const inspected = inspectResult(result);
    if (!inspected.ok) {
      return refuseWith(inspected.code, inspected.path);
    }
    // Read everything the accepted result needs here, once, inside the guard: a
    // returned object with an accessor or a proxy trap can throw on *any* later
    // read, including the ones the success path would otherwise do.
    protocolIssues = result.issues;
    summary = inspected.summary;
    if (summary !== null) {
      findings = findingsFor(summary);
    }
  } catch {
    // The validator returned, but inspecting the return value threw. That is not a
    // verdict about the document, and it is not the caller's exception to catch
    // either: it closes as an unreadable result.
    return refuseWith(WRAPPER_ISSUE_CODES.VALIDATOR_RESULT_MALFORMED, 'result');
  }

  if (summary === null) {
    return Object.freeze({
      valid: false,
      certification: false,
      issues: protocolIssues,
      findings: Object.freeze([]),
    });
  }

  return Object.freeze({
    valid: true,
    certification: false,
    issues: protocolIssues,
    findings,
    summary,
  });
}
