/**
 * dsh-compat-platform — intake and summary of *reported* runtime coexistence
 * evidence.
 *
 * SCOPE OF THIS MODULE
 * --------------------
 * This module is a pure, dependency-free validator plus summarizer for a JSON
 * document that some *other* process claims to have produced by running real
 * hosts. It is deliberately separate from the static declaration analysis in
 * `analyze.js`: nothing here is derived from declarations, and nothing in
 * `analyze.js` is derived from here.
 *
 * What it does:
 *   - accept an already-parsed JSON value (dense arrays, JSON-representable
 *     values only) and check it against the closed `coexistence-evidence/0.1`
 *     schema;
 *   - fail closed: any issue means `valid: false` and `summary: null`;
 *   - otherwise return a deterministic, frozen summary.
 *
 * What it does NOT do, by construction:
 *   - no dynamic code: no `eval`, no use of the Function constructor, no dynamic
 *     module loading, no subprocess, and no static module import at all (this
 *     file is import-free);
 *   - no filesystem access, no network access, no environment access;
 *   - no execution of anything described by the evidence, and no re-running of
 *     the runner that produced it.
 *
 * "NO DYNAMIC CODE" IS A STATEMENT ABOUT THIS MODULE, NOT ABOUT ITS INPUT
 * ----------------------------------------------------------------------
 * The supported input is *parsed JSON*: the output of `JSON.parse`, which
 * carries own data properties only. Such a value is inert to read.
 *
 * A JavaScript object that is not plain data can run code merely by being read:
 * an accessor (getter/setter) runs on property access, and a `Proxy` runs its
 * traps on `get`, `ownKeys`, `getOwnPropertyDescriptor`, `getPrototypeOf` and
 * `has`. This module therefore (a) refuses own accessor descriptors
 * structurally, without invoking them, wherever it inspects an object or an
 * array element, and (b) refuses the whole document if a read throws.
 *
 * That refusal is NOT a sandbox. A `Proxy` can run code in its own traps before
 * any check here sees anything, no pure function can prevent side effects in
 * code it is forced to call, and nothing here promises termination for hostile
 * JavaScript (a trap that never returns will not return). What is guaranteed is
 * narrower and still useful: an unreadable input yields one closed refusal with
 * a fixed message instead of an exception, and this module never inspects a
 * thrown value.
 *
 * EVIDENCE TIER IS A CLAIM, NOT A FACT
 * ------------------------------------
 * `evidenceTier` arrives inside the document, so it is a *string copied from an
 * untrusted receipt*. This module never authenticates it, never upgrades it and
 * never checks a signature: there is no way for a pure validator to know that a
 * string saying `"real-host"` came from a real host. `certification` is
 * therefore always `false`, and a valid summary means only "this document is
 * internally consistent and well formed" — never "these plugins are compatible
 * in general", and never "the static analysis is upgraded".
 *
 * @packageDocumentation
 */

/** The only accepted evidence schema version. */
export const SCHEMA_VERSION = 'coexistence-evidence/0.1';

/** The three required cases, in canonical (summary) order. */
export const CASE_IDS = Object.freeze([
  'same-name-conflict',
  'dependency-unload',
  'stale-cleanup',
]);

/** The only accepted case statuses. */
export const CASE_STATUSES = Object.freeze(['passed', 'failed', 'not-run']);

/**
 * The only accepted evidence tier. Accepting exactly one documented value keeps
 * a future tier from silently being read as if it were this one.
 */
export const EVIDENCE_TIERS = Object.freeze(['real-host']);

/** Stable issue codes. Never rename one; add a new code and bump the schema. */
export const ISSUE_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_INSPECTABLE: 'NOT_INSPECTABLE',
  UNEXPECTED_FIELD: 'UNEXPECTED_FIELD',
  MISSING_FIELD: 'MISSING_FIELD',
  WRONG_TYPE: 'WRONG_TYPE',
  SPARSE_ARRAY: 'SPARSE_ARRAY',
  EMPTY_STRING: 'EMPTY_STRING',
  INVALID_SCHEMA_VERSION: 'INVALID_SCHEMA_VERSION',
  INVALID_COMMIT: 'INVALID_COMMIT',
  UNKNOWN_CASE_ID: 'UNKNOWN_CASE_ID',
  DUPLICATE_CASE_ID: 'DUPLICATE_CASE_ID',
  MISSING_CASE_ID: 'MISSING_CASE_ID',
  INVALID_STATUS: 'INVALID_STATUS',
  EVIDENCE_TIER_NOT_SUPPORTED: 'EVIDENCE_TIER_NOT_SUPPORTED',
  INVALID_ASSERTION_ID: 'INVALID_ASSERTION_ID',
  DUPLICATE_ASSERTION_ID: 'DUPLICATE_ASSERTION_ID',
  STATUS_ASSERTION_MISMATCH: 'STATUS_ASSERTION_MISMATCH',
});

/** The closed field sets. Anything not listed is `UNEXPECTED_FIELD`. */
const ROOT_FIELDS = Object.freeze(['schemaVersion', 'baseline', 'cases', 'limitations']);
const BASELINE_FIELDS = Object.freeze(['commit', 'node']);
const CASE_FIELDS = Object.freeze(['id', 'status', 'evidenceTier', 'assertions', 'limitations']);
const ASSERTION_FIELDS = Object.freeze(['id', 'passed']);

/** A full 40-character hexadecimal git object name, in either case. */
const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;

/**
 * The one refusal used when a value cannot be read as data. The text is fixed on
 * purpose: describing the thrown value (`instanceof`, `.name`, `.message`, string
 * coercion) would itself run code chosen by whoever built the value, so no part
 * of it is ever inspected.
 */
const NOT_INSPECTABLE_MESSAGE =
  'The evidence value could not be inspected as plain JSON data (a read threw, or a property is an accessor instead of a value), so no summary is produced.';

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === null) return 'null-prototype object';
    const constructor = proto.constructor;
    const name = typeof constructor === 'function' ? constructor.name : '';
    return typeof name === 'string' && name !== '' && name !== 'Object'
      ? `object (${name})`
      : 'object';
  }
  return typeof value;
}

/**
 * Read every own key, nameless ones included, so a symbol-keyed field cannot
 * ride along unobserved.
 */
function ownKeys(value) {
  const names = Object.getOwnPropertyNames(value);
  const symbols = Object.getOwnPropertySymbols(value).map((symbol) => String(symbol));
  return [...names, ...symbols];
}

/** True when a property descriptor installs a getter or setter instead of a value. */
function isAccessorDescriptor(descriptor) {
  if (descriptor === undefined) return false;
  return descriptor.get !== undefined || descriptor.set !== undefined;
}

/**
 * Refuse own accessor properties before any field is read, so a getter is
 * rejected on its descriptor rather than being invoked. Where practical this is
 * cheaper and safer than catching the getter's throw: a getter that returns
 * quietly would otherwise be read twice (validation, then summary).
 *
 * Structural only, and not a sandbox: a `Proxy` can run code in
 * `getOwnPropertyDescriptor` / `ownKeys` before this helper sees anything. It
 * only means this validator never *asks* for an accessor's value.
 */
function rejectAccessors(object, path, add) {
  let inspectable = true;
  const check = (key, descriptor) => {
    if (!isAccessorDescriptor(descriptor)) return;
    inspectable = false;
    add(
      ISSUE_CODES.NOT_INSPECTABLE,
      joinPath(path, key),
      `field ${JSON.stringify(key)} is an accessor property; reading it would run code that did not arrive as data, so the value could not be inspected and no summary is produced.`,
    );
  };
  for (const name of Object.getOwnPropertyNames(object)) {
    check(name, Object.getOwnPropertyDescriptor(object, name));
  }
  for (const symbol of Object.getOwnPropertySymbols(object)) {
    check(String(symbol), Object.getOwnPropertyDescriptor(object, symbol));
  }
  return inspectable;
}

function joinPath(path, key) {
  return path === '' ? key : `${path}.${key}`;
}

function formatPath(path) {
  return path === '' ? '<root>' : path;
}

/** The single closed refusal for a value that could not be read as data. */
function notInspectableResult() {
  return Object.freeze({
    valid: false,
    issues: Object.freeze([
      Object.freeze({
        code: ISSUE_CODES.NOT_INSPECTABLE,
        path: '',
        message: NOT_INSPECTABLE_MESSAGE,
      }),
    ]),
    summary: null,
  });
}

/**
 * Validate and summarize a reported coexistence-evidence document.
 *
 * Supported input is an already-parsed JSON value (own data properties only).
 * Within that contract the function is pure and total: it never mutates its
 * argument, and any structural problem yields `{ valid: false, issues, summary:
 * null }` — a partially understood document is never summarized, because a
 * summary of half-read evidence reads exactly like a summary of full evidence.
 *
 * Validation *and* summary construction run inside one guard: both read the
 * document, so a value that validates on the first read and throws on the second
 * (a stateful getter, a proxy) becomes the same closed refusal rather than an
 * exception. What the guard returns is a fixed message; the thrown value itself
 * is never inspected. It is not a sandbox and promises no termination for
 * hostile JavaScript — see the note at the top of this file.
 *
 * @param {unknown} value The evidence document, already parsed from JSON.
 * @returns {{ valid: boolean, issues: ReadonlyArray<{ code: string, path: string, message: string }>, summary: null | { cases: ReadonlyArray<{ id: string, status: string, evidenceTier: string, assertionCount: number, failedAssertionCount: number, limitations: ReadonlyArray<string> }>, baseline: { commit: string, node: string }, limitations: ReadonlyArray<string>, certification: false } }}
 *   `certification` is `false` unconditionally: the evidence tier is a claim
 *   this validator cannot authenticate.
 */
export function summarizeRuntimeEvidence(value) {
  try {
    const issues = collectIssues(value);
    if (issues.length > 0) {
      return Object.freeze({
        valid: false,
        issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
        summary: null,
      });
    }
    return Object.freeze({
      valid: true,
      issues: Object.freeze([]),
      summary: buildSummary(value),
    });
  } catch {
    // An exotic input (throwing getter, hostile proxy) is still a closed failure,
    // not an exception escaping to the caller. The error binding is deliberately
    // dropped: inspecting it would run attacker-chosen code.
    return notInspectableResult();
  }
}

/**
 * Collect every issue in document order. Structural checks never depend on the
 * order of `cases`, so a reordered but otherwise identical document produces the
 * same summary.
 */
function collectIssues(root) {
  const issues = [];
  const add = (code, path, message) => {
    issues.push({ code, path, message });
  };

  if (!isPlainObject(root)) {
    add(
      ISSUE_CODES.INVALID_INPUT,
      '',
      `evidence must be a plain JSON object with fields { schemaVersion, baseline, cases, limitations }, got ${describeValue(root)}.`,
    );
    return issues;
  }
  if (!rejectAccessors(root, '', add)) return issues;
  if (!checkFields(root, ROOT_FIELDS, '', add)) return issues;

  checkSchemaVersion(root.schemaVersion, add);
  checkBaseline(root.baseline, add);
  checkCases(root.cases, add);
  checkLimitations(root.limitations, 'limitations', add);

  return issues;
}

/**
 * Reject unknown keys and record missing ones. Returns `true` only when every
 * required key is present, so callers can stop before cascading type errors.
 */
function checkFields(object, allowed, path, add) {
  for (const key of ownKeys(object)) {
    if (!allowed.includes(key)) {
      add(
        ISSUE_CODES.UNEXPECTED_FIELD,
        joinPath(path, key),
        `unexpected field ${JSON.stringify(key)}; the schema is closed so that a new claim cannot drift in silently. Allowed fields here: ${allowed.map((name) => JSON.stringify(name)).join(', ')}.`,
      );
    }
  }
  let complete = true;
  for (const key of allowed) {
    if (!hasOwn(object, key)) {
      complete = false;
      add(
        ISSUE_CODES.MISSING_FIELD,
        joinPath(path, key),
        `required field ${JSON.stringify(key)} is missing; a partial evidence document is never summarized.`,
      );
    }
  }
  return complete;
}

function checkSchemaVersion(value, add) {
  if (typeof value !== 'string') {
    add(
      ISSUE_CODES.WRONG_TYPE,
      'schemaVersion',
      `schemaVersion must be the string ${JSON.stringify(SCHEMA_VERSION)}, got ${describeValue(value)}.`,
    );
    return;
  }
  if (value !== SCHEMA_VERSION) {
    add(
      ISSUE_CODES.INVALID_SCHEMA_VERSION,
      'schemaVersion',
      `schemaVersion is ${JSON.stringify(value)}; this validator implements only ${JSON.stringify(SCHEMA_VERSION)}. An unknown revision is refused rather than interpreted.`,
    );
  }
}

function checkBaseline(value, add) {
  if (!isPlainObject(value)) {
    add(
      ISSUE_CODES.WRONG_TYPE,
      'baseline',
      `baseline must be a plain object { commit, node }, got ${describeValue(value)}.`,
    );
    return;
  }
  if (!rejectAccessors(value, 'baseline', add)) return;
  if (!checkFields(value, BASELINE_FIELDS, 'baseline', add)) return;

  const { commit, node } = value;
  if (typeof commit !== 'string') {
    add(
      ISSUE_CODES.WRONG_TYPE,
      'baseline.commit',
      `baseline.commit must be a string of 40 hexadecimal characters, got ${describeValue(commit)}.`,
    );
  } else if (!COMMIT_PATTERN.test(commit)) {
    add(
      ISSUE_CODES.INVALID_COMMIT,
      'baseline.commit',
      `baseline.commit must be exactly 40 hexadecimal characters (a full git object name, not an abbreviation); got ${JSON.stringify(commit)} of length ${commit.length}.`,
    );
  }

  if (typeof node !== 'string') {
    add(
      ISSUE_CODES.WRONG_TYPE,
      'baseline.node',
      `baseline.node must be a non-empty string such as "v24.21.0", got ${describeValue(node)}.`,
    );
  } else if (node.trim() === '') {
    add(
      ISSUE_CODES.EMPTY_STRING,
      'baseline.node',
      'baseline.node must be non-empty; an unknown runtime version is not a supported state.',
    );
  }
}

function checkCases(value, add) {
  if (!Array.isArray(value)) {
    add(
      ISSUE_CODES.WRONG_TYPE,
      'cases',
      `cases must be an array of the three required case records, got ${describeValue(value)}.`,
    );
    return;
  }
  if (!checkDense(value, 'cases', add)) return;

  const firstIndexById = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const id = checkCase(value[index], `cases[${index}]`, add);
    if (id === null) continue;
    if (firstIndexById.has(id)) {
      add(
        ISSUE_CODES.DUPLICATE_CASE_ID,
        `cases[${index}].id`,
        `case ${JSON.stringify(id)} also appears at cases[${firstIndexById.get(id)}]; each case must appear exactly once, so conflicting copies of one case cannot be silently merged or overridden.`,
      );
      continue;
    }
    firstIndexById.set(id, index);
  }

  for (const id of CASE_IDS) {
    if (!firstIndexById.has(id)) {
      add(
        ISSUE_CODES.MISSING_CASE_ID,
        'cases',
        `required case ${JSON.stringify(id)} is absent; all three cases must be reported, and a missing case is never treated as passed, failed or skipped.`,
      );
    }
  }
}

/**
 * Validate one case record and return its id when the id itself is usable, or
 * `null` otherwise. Cross-field rules (status versus assertions) run only when
 * both fields were structurally readable, so one defect is not reported five
 * times.
 */
function checkCase(value, path, add) {
  if (!isPlainObject(value)) {
    add(
      ISSUE_CODES.WRONG_TYPE,
      path,
      `each case must be a plain object { id, status, evidenceTier, assertions, limitations }, got ${describeValue(value)}.`,
    );
    return null;
  }
  if (!rejectAccessors(value, path, add)) return null;
  const complete = checkFields(value, CASE_FIELDS, path, add);
  const { id, status, evidenceTier, assertions, limitations } = value;

  // Read the id even from an incomplete record: a case that is otherwise broken
  // is already reported once and must not also look like a case that is absent.
  let usableId = null;
  if (hasOwn(value, 'id')) {
    if (typeof id !== 'string') {
      add(
        ISSUE_CODES.WRONG_TYPE,
        joinPath(path, 'id'),
        `case id must be one of ${CASE_IDS.map((name) => JSON.stringify(name)).join(', ')}, got ${describeValue(id)}.`,
      );
    } else if (!CASE_IDS.includes(id)) {
      add(
        ISSUE_CODES.UNKNOWN_CASE_ID,
        joinPath(path, 'id'),
        `case id ${JSON.stringify(id)} is not one of the three defined cases (${CASE_IDS.map((name) => JSON.stringify(name)).join(', ')}). An unrecognized case is refused, never counted as coverage.`,
      );
    } else {
      usableId = id;
    }
  }

  if (!complete) return usableId;

  let usableStatus = null;
  if (typeof status !== 'string') {
    add(
      ISSUE_CODES.WRONG_TYPE,
      joinPath(path, 'status'),
      `status must be one of ${CASE_STATUSES.map((name) => JSON.stringify(name)).join(', ')}, got ${describeValue(status)}.`,
    );
  } else if (!CASE_STATUSES.includes(status)) {
    add(
      ISSUE_CODES.INVALID_STATUS,
      joinPath(path, 'status'),
      `status ${JSON.stringify(status)} is not one of ${CASE_STATUSES.map((name) => JSON.stringify(name)).join(', ')}.`,
    );
  } else {
    usableStatus = status;
  }

  if (typeof evidenceTier !== 'string') {
    add(
      ISSUE_CODES.WRONG_TYPE,
      joinPath(path, 'evidenceTier'),
      `evidenceTier must be the string "real-host" (a claim copied from the receipt), got ${describeValue(evidenceTier)}.`,
    );
  } else if (!EVIDENCE_TIERS.includes(evidenceTier)) {
    add(
      ISSUE_CODES.EVIDENCE_TIER_NOT_SUPPORTED,
      joinPath(path, 'evidenceTier'),
      `evidenceTier ${JSON.stringify(evidenceTier)} is not the documented tier ${JSON.stringify('real-host')}; a tier this validator does not know is refused instead of being read as ${JSON.stringify('real-host')}.`,
    );
  }

  const usableAssertions = checkAssertions(assertions, joinPath(path, 'assertions'), add);
  checkLimitations(limitations, joinPath(path, 'limitations'), add);

  if (usableStatus !== null && usableAssertions !== null) {
    checkStatusConsistency(usableStatus, usableAssertions, path, add);
  }

  return usableId;
}

/**
 * Validate the assertion list and report contradictory ids inside one case.
 * Returns the readable assertion values, or `null` when the list is unusable.
 */
function checkAssertions(value, path, add) {
  if (!Array.isArray(value)) {
    add(
      ISSUE_CODES.WRONG_TYPE,
      path,
      `assertions must be an array of { id, passed } records, got ${describeValue(value)}.`,
    );
    return null;
  }
  if (!checkDense(value, path, add)) return null;

  const seen = new Map();
  const assertions = [];
  let usable = true;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const entryPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      add(
        ISSUE_CODES.WRONG_TYPE,
        entryPath,
        `each assertion must be a plain object { id, passed }, got ${describeValue(entry)}.`,
      );
      usable = false;
      continue;
    }
    if (!rejectAccessors(entry, entryPath, add)) {
      usable = false;
      continue;
    }
    if (!checkFields(entry, ASSERTION_FIELDS, entryPath, add)) {
      usable = false;
      continue;
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      add(
        ISSUE_CODES.INVALID_ASSERTION_ID,
        joinPath(entryPath, 'id'),
        `assertion id must be a non-empty string, got ${describeValue(entry.id)}. An unnamed assertion cannot be told apart from another one.`,
      );
      usable = false;
      continue;
    }
    if (seen.has(entry.id)) {
      add(
        ISSUE_CODES.DUPLICATE_ASSERTION_ID,
        joinPath(entryPath, 'id'),
        `assertion id ${JSON.stringify(entry.id)} also appears at assertions[${seen.get(entry.id)}]; two assertions with one id would make the count ambiguous.`,
      );
      usable = false;
      continue;
    }
    seen.set(entry.id, index);
    if (typeof entry.passed !== 'boolean') {
      add(
        ISSUE_CODES.WRONG_TYPE,
        joinPath(entryPath, 'passed'),
        `assertion passed must be a boolean, got ${describeValue(entry.passed)}. A truthy or string value is never coerced.`,
      );
      usable = false;
      continue;
    }
    assertions.push({ id: entry.id, passed: entry.passed });
  }
  return usable ? assertions : null;
}

function checkLimitations(value, path, add) {
  if (!Array.isArray(value)) {
    add(
      ISSUE_CODES.WRONG_TYPE,
      path,
      `${formatPath(path)} must be an array of limitation strings, got ${describeValue(value)}.`,
    );
    return;
  }
  if (!checkDense(value, path, add)) return;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== 'string') {
      add(
        ISSUE_CODES.WRONG_TYPE,
        `${path}[${index}]`,
        `each limitation must be a string, got ${describeValue(entry)}.`,
      );
      continue;
    }
    if (entry.trim() === '') {
      add(
        ISSUE_CODES.EMPTY_STRING,
        `${path}[${index}]`,
        'each limitation must be non-empty; an empty placeholder is not a stated limitation.',
      );
    }
  }
}

/**
 * The status must be *consistent with its own assertions*. This catches the
 * cheap ways to over-claim: `passed` with nothing asserted, `failed` with nothing
 * observed as failing, and `not-run` carrying assertions it claims not to have
 * run. A failing outcome is always expressible as a recorded failed assertion, so
 * there is no exception that needs an assertion-less `failed`.
 */
function checkStatusConsistency(status, assertions, path, add) {
  const total = assertions.length;
  const failed = assertions.filter((entry) => entry.passed === false).length;

  if (status === 'passed') {
    if (total === 0) {
      add(
        ISSUE_CODES.STATUS_ASSERTION_MISMATCH,
        joinPath(path, 'status'),
        'status "passed" requires at least one recorded assertion; a pass with nothing asserted is not evidence of anything.',
      );
      return;
    }
    if (failed > 0) {
      add(
        ISSUE_CODES.STATUS_ASSERTION_MISMATCH,
        joinPath(path, 'status'),
        `status "passed" contradicts ${failed} failed assertion(s); a run that recorded a failure must be reported as "failed".`,
      );
    }
    return;
  }

  if (status === 'failed') {
    if (total === 0) {
      add(
        ISSUE_CODES.STATUS_ASSERTION_MISMATCH,
        joinPath(path, 'status'),
        'status "failed" requires at least one recorded assertion, at least one of which is false; the runner is expected to record the failing assertion rather than only a status.',
      );
      return;
    }
    if (failed === 0) {
      add(
        ISSUE_CODES.STATUS_ASSERTION_MISMATCH,
        joinPath(path, 'status'),
        'status "failed" requires at least one assertion with passed === false; every recorded assertion was true.',
      );
    }
    return;
  }

  if (status === 'not-run') {
    if (total > 0) {
      add(
        ISSUE_CODES.STATUS_ASSERTION_MISMATCH,
        joinPath(path, 'status'),
        `status "not-run" requires an empty assertion list, found ${total}. Assertions that were not run cannot have been evaluated.`,
      );
    }
  }
}

/**
 * Reject holes and accessor elements without coercing either: `undefined` is not
 * a value here, and reading an accessor element would run code that did not
 * arrive as data.
 */
function checkDense(value, path, add) {
  let dense = true;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      dense = false;
      add(
        ISSUE_CODES.SPARSE_ARRAY,
        `${path}[${index}]`,
        'array has a hole at this position; sparse arrays are not JSON, so a hole would silently shrink a count.',
      );
      continue;
    }
    if (isAccessorDescriptor(descriptor)) {
      dense = false;
      add(
        ISSUE_CODES.NOT_INSPECTABLE,
        `${path}[${index}]`,
        'array element at this position is an accessor property; reading it would run code that did not arrive as data, so the value could not be inspected and no summary is produced.',
      );
    }
  }
  return dense;
}

/**
 * Build the frozen summary of an already-validated document. Cases are emitted
 * in canonical {@link CASE_IDS} order so the summary never depends on the order
 * the reporter happened to use.
 */
function buildSummary(value) {
  const byId = new Map();
  for (const entry of value.cases) byId.set(entry.id, entry);

  const cases = CASE_IDS.map((id) => {
    const entry = byId.get(id);
    const assertions = entry.assertions;
    return Object.freeze({
      id,
      status: entry.status,
      evidenceTier: entry.evidenceTier,
      assertionCount: assertions.length,
      failedAssertionCount: assertions.filter((assertion) => assertion.passed === false).length,
      limitations: Object.freeze([...entry.limitations]),
    });
  });

  return Object.freeze({
    cases: Object.freeze(cases),
    baseline: Object.freeze({
      commit: value.baseline.commit,
      node: value.baseline.node,
    }),
    limitations: Object.freeze([...value.limitations]),
    // Always false. The tier above is a string copied out of an untrusted
    // receipt; this module has no way to authenticate it, and nothing here
    // upgrades the static declaration analysis or certifies compatibility.
    certification: false,
  });
}
