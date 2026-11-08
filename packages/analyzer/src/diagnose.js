/**
 * diagnose — the public, read-only envelope over one profile dump and up to
 * three explicitly named lane documents.
 *
 * WHAT THIS MODULE IS: a thin, synchronous facade. It validates that the caller
 * supplied real payloads, then hands them to `diagnose-internal.js`, which is not
 * reachable through package exports. It performs no I/O, imports no caller code,
 * spawns nothing and writes nothing.
 *
 * THERE IS NO FAILURE INPUT HERE. This surface accepts `{ text }` for the profile
 * and `{ document }` for a lane, and nothing else. A caller who has no document
 * simply leaves the key out, which reads as `absent` — not as a failure and not as
 * agreement. The failure vocabulary (`INPUT_READ_FAILED`, `INPUT_JSON_INVALID`,
 * `VALIDATOR_LOAD_FAILED`) is re-exported only as an **output** type: it appears in
 * `issues[].code`. The only caller that records a failure is the CLI, through the
 * internal module, because only the CLI has I/O to report on.
 *
 * PRESENCE IS OWN-KEY PRESENCE. A source is named when its own data property is
 * present. An own property holding `null`/`undefined` is refused as malformed
 * instead of being read as absence, and absence is only ever the absence of the
 * key. There is no separate `requested` list that could disagree with the data.
 *
 * UNREQUESTED IS NOT A FINDING. A source nobody named produces an `absent` block
 * with outcome `unknown` and does **not** move the exit code. That is the one
 * deliberate difference from `combinedReportExitCode`, which counts absent lanes as
 * attention: here, not being asked about a source says nothing about it.
 *
 * A NAMED SOURCE THAT ESTABLISHED NOTHING IS NEVER `clear`. `provided` with an
 * outcome of `unknown` maps to `invalid`. That cannot arise through these builders,
 * but a hand-built envelope must not pass as clear either.
 *
 * NO BRAND, NO PROOF. `buildCombinedReport` freezes its outer object and keeps
 * each lane's `result` by reference; it does not brand reports and there is no
 * hidden provenance check to lean on. Nothing here assumes one.
 *
 * WHAT THE ENVELOPE DOES NOT HIDE: the embedded combined report republishes each
 * lane's own result unchanged, and those may embed ids, capability names and paths
 * taken from the input documents. The profile block is a *summary* — counts,
 * limits, fixed diagnostics and fixed codes, never the dump's text and never a
 * plugin id. The envelope as a whole is therefore not a redacted document.
 *
 * @packageDocumentation
 */

import {
  DIAGNOSE_ENTRY_FAILURES,
  DIAGNOSE_EXIT_CODES,
  DIAGNOSE_LIMITATION_CODES,
  DIAGNOSE_NEXT_STEP_CODES,
  DIAGNOSE_SOURCES,
  DIAGNOSE_VERSION,
  LANE_NAMES,
  SOURCE_BY_NAME,
  buildFromPayloads,
} from './diagnose-internal.js';

export {
  DIAGNOSE_ENTRY_FAILURES,
  DIAGNOSE_EXIT_CODES,
  DIAGNOSE_LIMITATION_CODES,
  DIAGNOSE_NEXT_STEP_CODES,
  DIAGNOSE_SOURCES,
  DIAGNOSE_VERSION,
  LANE_NAMES,
  SOURCE_BY_NAME,
};

const OUTCOME_VALUES = Object.freeze(['unknown', 'clear', 'attention', 'invalid', 'error']);

const REPORT_TYPE_ERROR =
  'diagnoseExitCode(report): report does not have the documented diagnose shape.';

/** Same plain-record rule the assembler applies: prototypes are not read as maps. */
function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read one channel-like block for the exit-code mapper.
 *
 * This is a shape check, not a brand check: it confirms `state` and `outcome` are
 * in their closed sets so a typo cannot be silently skipped into an exit 0. It
 * proves nothing about where the block came from.
 */
function readBlockShape(block) {
  if (!isPlainRecord(block)) throw new TypeError(REPORT_TYPE_ERROR);

  if (block.state === 'absent') {
    // `absent` has exactly one legal outcome. Accepting a missing outcome would let
    // a typo (`outcom: 'unknown'`) read as absent, and accepting any other value
    // would silently discard the outcome the report claimed.
    if (block.outcome !== 'unknown') throw new TypeError(REPORT_TYPE_ERROR);
    if (block.issues !== undefined && !Array.isArray(block.issues)) throw new TypeError(REPORT_TYPE_ERROR);
    return { state: 'absent', outcome: 'unknown', issues: [] };
  }
  if (block.state !== 'provided') throw new TypeError(REPORT_TYPE_ERROR);
  if (!OUTCOME_VALUES.includes(block.outcome)) throw new TypeError(REPORT_TYPE_ERROR);
  if (block.issues !== undefined && !Array.isArray(block.issues)) throw new TypeError(REPORT_TYPE_ERROR);
  return { state: 'provided', outcome: block.outcome, issues: block.issues ?? [] };
}

/**
 * Locate one block without filling anything in.
 *
 * The assembler's own `blockFor` substitutes an absent block for a missing lane,
 * which is right when reading a report it just built and wrong here: this entry
 * maps a report it did not build, so a missing lane must be an error rather than a
 * quiet "nothing to see". Only `combinedReport === null` — the documented way to say
 * no lane was named — makes the three lanes absent without looking at `channels`.
 */
function readChannel(report, source) {
  if (source === 'profile') {
    if (!Object.hasOwn(report, 'profile')) throw new TypeError(REPORT_TYPE_ERROR);
    return readBlockShape(report.profile);
  }

  const combined = report.combinedReport;
  if (combined === null) return { state: 'absent', outcome: 'unknown', issues: [] };

  const channels = combined.channels;
  if (!isPlainRecord(channels)) throw new TypeError(REPORT_TYPE_ERROR);
  if (!Object.hasOwn(channels, source)) throw new TypeError(REPORT_TYPE_ERROR);
  return readBlockShape(channels[source]);
}

/**
 * Build one diagnose envelope.
 *
 * @param {{
 *   profile?: { text: string },
 *   static?: { document: unknown },
 *   runtime?: { document: unknown },
 *   admission?: { document: unknown },
 * }} input Every entry is a payload. A source that is not named is simply absent;
 *   an own key holding `null`/`undefined` is refused rather than ignored.
 * @param {{ validateDeclaration?: Function, validateAdmissionEvidence?: Function }} [options]
 *   Passed to `buildCombinedReport` unchanged. Validated up front, whatever lanes
 *   were named, so identical options never mean different things across invocations.
 * @returns {Readonly<object>} The frozen envelope.
 * @throws {TypeError} With fixed text on a malformed input, entry or option.
 */
export function buildDiagnoseReport(input, options) {
  return buildFromPayloads(input, options);
}

/**
 * Map an envelope to a *processing* exit code.
 *
 * Precedence: 3 > 4 > 2 > 1 > 0. Code 5 is never returned here — this module does
 * no I/O, so it has nothing to fail at; the CLI adds 5 for serialization and output
 * failures.
 *
 * Only `provided` blocks count. A validator that would not load outranks everything
 * else with 3, matching the CLI contract, and it is recognized by its fixed issue
 * code rather than by a parallel flag that could disagree with the report.
 *
 * A MALFORMED REPORT THROWS; it never gets a code. There is no dedicated "bad
 * report" exit code here: the envelope is validated for the documented version,
 * flags and channel layout first, and a violation is a fixed `TypeError` for the
 * caller to surface as its own internal failure (the CLI maps it to 5).
 *
 * @param {object} report
 * @returns {0 | 1 | 2 | 3 | 4}
 * @throws {TypeError} With fixed text when the envelope shape is not the documented one.
 */
export function diagnoseExitCode(report) {
  if (!isPlainRecord(report)) throw new TypeError(REPORT_TYPE_ERROR);
  if (report.diagnoseVersion !== DIAGNOSE_VERSION) throw new TypeError(REPORT_TYPE_ERROR);
  if (report.certification !== false) throw new TypeError(REPORT_TYPE_ERROR);
  if (report.correlation !== 'not-established') throw new TypeError(REPORT_TYPE_ERROR);
  if (!Array.isArray(report.nextSteps)) throw new TypeError(REPORT_TYPE_ERROR);
  if (!Object.hasOwn(report, 'profile')) throw new TypeError(REPORT_TYPE_ERROR);
  if (report.combinedReport !== null && !isPlainRecord(report.combinedReport)) {
    throw new TypeError(REPORT_TYPE_ERROR);
  }

  const blocks = DIAGNOSE_SOURCES.map((source) => ({ source, block: readChannel(report, source) }));

  let validatorLoadFailed = false;
  for (const { block } of blocks) {
    if (block.state !== 'provided') continue;
    for (const issue of block.issues) {
      if (issue && issue.code === DIAGNOSE_ENTRY_FAILURES.VALIDATOR_LOAD_FAILED) validatorLoadFailed = true;
    }
  }
  if (validatorLoadFailed) return DIAGNOSE_EXIT_CODES.USAGE;

  let anyError = false;
  let anyInvalid = false;
  let anyAttention = false;
  for (const { block } of blocks) {
    if (block.state !== 'provided') continue;
    const outcome = block.outcome;
    if (outcome === 'error') anyError = true;
    else if (outcome === 'invalid') anyInvalid = true;
    else if (outcome === 'attention') anyAttention = true;
    else if (outcome === 'clear') continue;
    // `provided` + `unknown`: named but nothing established. Never clear.
    else anyInvalid = true;
  }

  if (anyError) return DIAGNOSE_EXIT_CODES.LANE_ERROR;
  if (anyInvalid) return DIAGNOSE_EXIT_CODES.INVALID;
  if (anyAttention) return DIAGNOSE_EXIT_CODES.ATTENTION;
  return DIAGNOSE_EXIT_CODES.OK;
}
