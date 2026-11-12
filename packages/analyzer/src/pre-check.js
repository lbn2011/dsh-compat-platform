/**
 * dsh-compat-platform — pre-check: predict install-time conflicts before a plugin is installed.
 *
 * WHAT THIS MODULE IS
 * -------------------
 * A pure comparison. It receives the candidate plugin's manifest (a decoded `package.json` or its
 * text), the occupancy that already exists (the claims an A1 `conflict-detector` service reports),
 * and the two environment facts it is allowed to know (`platform`, `hostVersion`). It builds the
 * claims the candidate would add and asks the SAME detector that serves the live host for its
 * conflicts. There is no second rule engine here: C1–C11, their severities, their ids and the
 * limitation vocabulary are imported, not re-implemented, so a prediction cannot disagree with the
 * live answer about the same table.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *   - It does not install, download, resolve or read anything. No filesystem, no network, no
 *     module loading. The caller owns every read.
 *   - It does not decide that a plugin is safe. A clean result means "no C1–C11 conflict is
 *     visible from these inputs", not "this plugin will load".
 *   - It does not invent providers. Unless `providerSetComplete` is true, `inject` requirements are
 *     NOT compared against the occupancy: a host service table has no reverse provider
 *     attribution, so "nobody provides X" would be a claim about the collector, not about X.
 *     That omission is stated as a limitation, never as a clean result.
 *   - It does not parse bundle patches. Rows inserted by `dsh.bundle.patch` are only visible once
 *     someone (the profile dump, or the plugin itself) reports them as occupancy.
 *
 * REQUIREMENT RULES (mirroring the host, not invented)
 * ---------------------------------------------------
 * The host's `unmetRequirements()` decides compatibility from the manifest alone: an own
 * `engines.dsh` range decides by itself and peerDependencies are then ignored; otherwise every
 * `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` peer must be satisfied, with `workspace:^`,
 * `workspace:~` and `workspace:*` meaning "the running version". This module reproduces exactly
 * that, expresses each unmet requirement as a `hostRange` claim so C7 reports it, and records a
 * limitation instead of guessing when a range falls outside the supported range subset.
 */

import {
  CONFLICT_CODES,
  CONFLICT_LIMITATIONS,
  CONFLICT_TYPES,
  CONFLICT_DETECTOR_VERSION,
  OCCUPANCY_KINDS,
  createConflictDetector,
} from './conflict-detector.js';

/** Version of this module's contract. */
export const PRE_CHECK_VERSION = 'pre-check/0.1-draft.1';

/** Format identifier of the summary document this module produces. */
export const PRE_CHECK_SCHEMA = 'pre-check-summary/0.1-draft.1';

/**
 * Findings this module can report **about its own inputs**.
 *
 * These are not conflict codes: a manifest that is not JSON is not a C-code, and inventing a
 * C-code for it would put a non-conflict into a list a caller reads as conflicts. Everything that
 * *is* a conflict comes from `CONFLICT_CODES`, unchanged.
 */
export const PRE_CHECK_CODES = Object.freeze({
  MANIFEST_NOT_JSON: 'MANIFEST_NOT_JSON',
  MANIFEST_NOT_OBJECT: 'MANIFEST_NOT_OBJECT',
  MANIFEST_NAME_MISSING: 'MANIFEST_NAME_MISSING',
  MANIFEST_DSH_NOT_OBJECT: 'MANIFEST_DSH_NOT_OBJECT',
  ENTRY_NOT_OBJECT: 'ENTRY_NOT_OBJECT',
  ENTRY_INJECT_NOT_STRING_ARRAY: 'ENTRY_INJECT_NOT_STRING_ARRAY',
  ENTRY_PLATFORM_NOT_STRING: 'ENTRY_PLATFORM_NOT_STRING',
  ENGINES_DSH_NOT_STRING: 'ENGINES_DSH_NOT_STRING',
  PEER_RANGE_NOT_STRING: 'PEER_RANGE_NOT_STRING',
  OCCUPANCY_NOT_ARRAY: 'OCCUPANCY_NOT_ARRAY',
  OCCUPANCY_ENTRY_REJECTED: 'OCCUPANCY_ENTRY_REJECTED',
  DECLARATIONS_NOT_ARRAY: 'DECLARATIONS_NOT_ARRAY',
  HOST_VERSION_INVALID: 'HOST_VERSION_INVALID',
  // Input-reading failures. They belong here rather than in the CLI so a refusal document has the
  // same shape and the same closed vocabulary as a successful one.
  INPUT_OPEN_FAILED: 'INPUT_OPEN_FAILED',
  INPUT_STAT_FAILED: 'INPUT_STAT_FAILED',
  INPUT_NOT_REGULAR: 'INPUT_NOT_REGULAR',
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',
  INPUT_READ_FAILED: 'INPUT_READ_FAILED',
  INPUT_NOT_UTF8: 'INPUT_NOT_UTF8',
  INPUT_NOT_JSON: 'INPUT_NOT_JSON',
  INPUT_NOT_ARRAY: 'INPUT_NOT_ARRAY',
  USAGE: 'USAGE',
  INTERNAL: 'INTERNAL',
});

/**
 * Limitations this module adds to the ones the detector already reports.
 *
 * The detector's eight codes are reused verbatim (they are about the same table); these three are
 * about the inputs of a *prediction*, which the detector cannot know about.
 */
export const PRE_CHECK_LIMITATIONS = Object.freeze([
  'PROVIDER_SET_COMPLETENESS_UNKNOWN',
  'BUNDLE_PATCH_ROWS_NOT_READ',
  'PREDICTION_IS_NOT_AN_INSTALL',
]);

/** Exit codes for the `dsh-compat-pre-check` command. */
export const PRE_CHECK_EXIT = Object.freeze({
  OK: 0,
  CONFLICTS: 1,
  UNUSABLE: 2,
  INTERNAL: 5,
  USAGE: 64,
});

/** Keys `staticPreCheck()` accepts. Anything else is a caller bug, not a document finding. */
const INPUT_KEYS = Object.freeze([
  'manifest',
  'manifestText',
  'occupancy',
  'declarations',
  'hostVersion',
  'platform',
  'providerSetComplete',
  'maxClaims',
]);

/** `dsh` fields that are not plugin entries. */
const RESERVED_DSH_KEYS = Object.freeze(new Set(['bundle']));

/** Peer names the host treats as DSH runtime requirements. */
function isDshPeer(name) {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');
}

/** Ranges the host resolves to "the running version" rather than a comparison. */
const WORKSPACE_RANGES = Object.freeze(new Set(['workspace:^', 'workspace:~', 'workspace:*']));

/** Whether a value is a plain object (not an array, not null). */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A closed-vocabulary finding: a code, and at most one field or entry name. */
function finding(code, detail = {}) {
  return {
    code,
    entry: typeof detail.entry === 'string' ? detail.entry : null,
    field: typeof detail.field === 'string' ? detail.field : null,
  };
}

/**
 * Compare a candidate plugin against existing occupancy.
 *
 * @param {object} input Inputs, all text or plain data.
 * @param {object} [input.manifest] Decoded candidate `package.json`.
 * @param {string} [input.manifestText] Candidate `package.json` text; parsed here, never evaluated.
 * @param {Array<object>} [input.occupancy] Existing claims, in the shape `claims()` returns
 *   (`{owner, kind, key, scope, …}`). Entries without an owner are reported, not guessed.
 * @param {Array<{owner?: string, declaration: object, extra?: object}>} [input.declarations]
 *   Protocol declarations to turn into occupancy through `report()`.
 * @param {string} [input.hostVersion] Running DSH version. Without it, C7 cannot fire.
 * @param {string} [input.platform] Running platform. Without it, C6 cannot fire.
 * @param {boolean} [input.providerSetComplete] Whether the occupancy is known to list every
 *   provider. Only then are `inject` requirements compared (C1).
 * @param {number} [input.maxClaims] Detector claim cap.
 * @returns {{ok: boolean, summary: object}} `ok` is false only when the input cannot be used.
 * @throws {TypeError} On a non-object input, an unknown key, or a wrongly typed option.
 */
export function staticPreCheck(input = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('pre-check: input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.includes(key)) {
      throw new TypeError('pre-check: input carries an unknown key');
    }
  }
  const platform = optionalString(input.platform, 'platform');
  const hostVersion = optionalString(input.hostVersion, 'hostVersion');
  const providerSetComplete = optionalBoolean(input.providerSetComplete, 'providerSetComplete');
  if (input.maxClaims !== undefined && (!Number.isInteger(input.maxClaims) || input.maxClaims < 1)) {
    throw new TypeError('pre-check: maxClaims must be a positive integer');
  }

  const findings = [];

  // --- manifest -----------------------------------------------------------
  // Shape discipline applies to the argument itself, not to whether another form was also given:
  // a non-string manifestText is a caller bug even when `manifest` is present.
  if (input.manifestText !== undefined && typeof input.manifestText !== 'string') {
    throw new TypeError('pre-check: manifestText must be a string');
  }
  let manifest = input.manifest;
  if (manifest === undefined && input.manifestText !== undefined) {
    try {
      manifest = JSON.parse(input.manifestText);
    } catch {
      findings.push(finding(PRE_CHECK_CODES.MANIFEST_NOT_JSON));
      return { ok: false, summary: buildSummary(platform, hostVersion, providerSetComplete, findings, null) };
    }
  }
  if (!isPlainObject(manifest)) {
    findings.push(finding(PRE_CHECK_CODES.MANIFEST_NOT_OBJECT));
    return { ok: false, summary: buildSummary(platform, hostVersion, providerSetComplete, findings, null) };
  }

  const name = typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : null;
  if (name === null) findings.push(finding(PRE_CHECK_CODES.MANIFEST_NAME_MISSING));
  // The owner is derived from the manifest, so a re-run with the same candidate replaces the same
  // claims instead of accumulating duplicates.
  const owner = `plugin:${name ?? 'unknown'}`;

  // --- entries ------------------------------------------------------------
  const candidateClaims = [];
  const dsh = manifest.dsh;
  let entries = 0;
  if (dsh !== undefined && dsh !== null) {
    if (!isPlainObject(dsh)) {
      findings.push(finding(PRE_CHECK_CODES.MANIFEST_DSH_NOT_OBJECT, { field: 'dsh' }));
    } else {
      for (const entryId of Object.keys(dsh)) {
        if (RESERVED_DSH_KEYS.has(entryId)) continue;
        const entry = dsh[entryId];
        entries += 1;
        if (!isPlainObject(entry)) {
          findings.push(finding(PRE_CHECK_CODES.ENTRY_NOT_OBJECT, { entry: entryId }));
          continue;
        }

        const claim = { kind: 'row', key: entryId, scope: 'profile' };

        if (entry.inject !== undefined) {
          const inject = entry.inject;
          if (!Array.isArray(inject) || inject.some((item) => typeof item !== 'string')) {
            findings.push(finding(PRE_CHECK_CODES.ENTRY_INJECT_NOT_STRING_ARRAY, { entry: entryId, field: 'inject' }));
          } else if (providerSetComplete && inject.length > 0) {
            // Only with a provider set the caller vouches for. Otherwise C1 would report the
            // collector's blind spot as the plugin's missing dependency.
            //
            // A host `inject` name is a SERVICE name, and the detector's capability vocabulary is
            // prefixed: a service claim `{kind:'service', key:'tools'}` provides `service:tools`
            // (plus `svc:tools`). So the requirement is written in that vocabulary — passing the
            // bare name would make every inject look unmet, because no claim provides "tools".
            claim.requires = inject.map((name) => `service:${name}`);
          }
        }

        let platformUsable = true;
        if (entry.platform !== undefined) {
          if (typeof entry.platform !== 'string' || entry.platform === '') {
            // A platform we cannot read is not a platform we can compare: the entry's claim is
            // withheld rather than compared with a silently missing constraint. `inject` is
            // different — a malformed requirement only withholds the requirement.
            findings.push(finding(PRE_CHECK_CODES.ENTRY_PLATFORM_NOT_STRING, { entry: entryId, field: 'platform' }));
            platformUsable = false;
          } else {
            claim.platforms = [entry.platform];
          }
        }
        if (!platformUsable) continue;

        candidateClaims.push(claim);
      }
    }
  }

  // --- host requirements (the host's own rule, expressed as C7 claims) -----
  const engines = isPlainObject(manifest.engines) ? manifest.engines : null;
  const enginesHasDsh = engines !== null && Object.prototype.hasOwnProperty.call(engines, 'dsh');
  if (enginesHasDsh) {
    const range = engines.dsh;
    if (typeof range !== 'string') {
      findings.push(finding(PRE_CHECK_CODES.ENGINES_DSH_NOT_STRING, { field: 'engines.dsh' }));
    } else {
      // An own engines.dsh range decides alone: peerDependencies are ignored, exactly as the
      // host's unmetRequirements() ignores them. The claim is stated even when no host version is
      // known: the detector then records HOST_VERSION_UNKNOWN (its own vocabulary) and does not
      // fire C7, which is the honest answer — silently dropping the claim would look compatible.
      candidateClaims.push({
        kind: 'service',
        key: '@deepseek-ai/dsh',
        scope: 'engines',
        hostRange: range,
        // The host's own requirement is stated with a reserved prefix. Without this
        // acknowledgement C9 would report the requirement itself as namespace pollution.
        reservedAck: true,
      });
    }
  }
  // Reading the peer block for *shape* is independent of the comparison rule: a peer range that is
  // not a string is a malformed manifest no matter which requirement decides compatibility.
  if (isPlainObject(manifest.peerDependencies)) {
    for (const peer of Object.keys(manifest.peerDependencies)) {
      const range = manifest.peerDependencies[peer];
      if (typeof range !== 'string') {
        findings.push(finding(PRE_CHECK_CODES.PEER_RANGE_NOT_STRING, { field: `peerDependencies.${peer}` }));
        continue;
      }
      if (enginesHasDsh) continue; // an own engines.dsh range decides alone; peers are not compared
      if (!isDshPeer(peer)) continue;
      // A workspace range means "whatever runs", so it can never be drift.
      if (WORKSPACE_RANGES.has(range)) continue;
      candidateClaims.push({
        kind: 'service',
        key: peer,
        scope: 'peer',
        hostRange: range,
        reservedAck: true,
      });
    }
  }

  // --- existing occupancy -------------------------------------------------
  const detector = createConflictDetector({
    platform: platform ?? undefined,
    hostVersion: hostVersion ?? undefined,
    maxClaims: input.maxClaims,
  });

  if (input.occupancy !== undefined) {
    if (!Array.isArray(input.occupancy)) {
      findings.push(finding(PRE_CHECK_CODES.OCCUPANCY_NOT_ARRAY, { field: 'occupancy' }));
    } else {
      const byOwner = new Map();
      for (const claim of input.occupancy) {
        if (!isPlainObject(claim) || typeof claim.owner !== 'string' || claim.owner === '') {
          findings.push(finding(PRE_CHECK_CODES.OCCUPANCY_ENTRY_REJECTED, { field: 'occupancy' }));
          continue;
        }
        if (!byOwner.has(claim.owner)) byOwner.set(claim.owner, []);
        byOwner.get(claim.owner).push(claim);
      }
      for (const [occupant, claims] of byOwner) detector.upsert(occupant, claims);
    }
  }

  // Claims this run contributes: the manifest's and each declaration's. Pre-existing occupancy is
  // deliberately excluded — it is the table that was already there, not something this run asserts.
  let contributedAccepted = 0;
  let contributedRejected = 0;

  if (input.declarations !== undefined) {
    if (!Array.isArray(input.declarations)) {
      findings.push(finding(PRE_CHECK_CODES.DECLARATIONS_NOT_ARRAY, { field: 'declarations' }));
    } else {
      for (const item of input.declarations) {
        if (!isPlainObject(item) || !isPlainObject(item.declaration)) {
          findings.push(finding(PRE_CHECK_CODES.DECLARATIONS_NOT_ARRAY, { field: 'declarations' }));
          continue;
        }
        const declared = detector.report(
          typeof item.owner === 'string' && item.owner !== '' ? item.owner : 'declaration',
          item.declaration,
          isPlainObject(item.extra) ? item.extra : {},
        );
        contributedAccepted += declared.accepted;
        contributedRejected += declared.rejected;
      }
    }
  }

  // --- the candidate ------------------------------------------------------
  const accepted = detector.upsert(owner, candidateClaims);
  contributedAccepted += accepted.accepted;
  contributedRejected += accepted.rejected;
  if (accepted.rejected > 0) {
    findings.push(finding(PRE_CHECK_CODES.OCCUPANCY_ENTRY_REJECTED, { field: 'manifest' }));
  }

  const snapshot = detector.snapshot();
  const predicted = [];
  const preexisting = [];
  for (const conflict of snapshot.conflicts) {
    // A conflict the candidate takes part in is a prediction about this install; anything else
    // was already true and is reported separately so it cannot be read as the candidate's fault.
    // `owners` entries are `{owner, uid}` objects (see conflict-detector), not strings: comparing
    // them with `includes(owner)` is always false, which made every prediction look pre-existing.
    if (conflict.owners.some((entry) => entry.owner === owner)) predicted.push(conflict);
    else preexisting.push(conflict);
  }

  const limitations = [...snapshot.limitations, ...PRE_CHECK_LIMITATIONS];
  if (!providerSetComplete) {
    // Already implied by the PRE_CHECK_LIMITATIONS entry above; kept as a separate statement of
    // *why* it matters, because skipping C1 changes what a clean result means.
    limitations.push('INJECT_REQUIREMENTS_NOT_COMPARED');
  }

  return {
    ok: true,
    summary: buildSummary(platform, hostVersion, providerSetComplete, findings, {
      owner,
      manifestName: name,
      entries,
      claims: candidateClaims.length,
      accepted: contributedAccepted,
      rejected: contributedRejected,
      predicted,
      preexisting,
      snapshot,
      limitations,
    }),
  };
}

/** Read an optional string option, refusing a wrongly typed one. */
function optionalString(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`pre-check: ${name} must be a non-empty string`);
  }
  return value;
}

/** Read an optional boolean option, refusing a wrongly typed one. */
function optionalBoolean(value, name) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') {
    throw new TypeError(`pre-check: ${name} must be a boolean`);
  }
  return value;
}

/**
 * Assemble the summary. Field order is fixed, and a refused input still produces every key, so a
 * consumer never has to branch on which fields exist.
 *
 * @param {string|null} platform Platform compared against.
 * @param {string|null} hostVersion Host version compared against.
 * @param {boolean} providerSetComplete Whether C1 was allowed to run.
 * @param {Array<object>} findings Input findings.
 * @param {object|null} result Detector result, or null when nothing was compared.
 * @returns {object} Summary document.
 */
function buildSummary(platform, hostVersion, providerSetComplete, findings, result) {
  const compared = result !== null;
  return {
    preCheckSummary: PRE_CHECK_SCHEMA,
    version: PRE_CHECK_VERSION,
    detector: CONFLICT_DETECTOR_VERSION,
    platform,
    hostVersion,
    providerSetComplete,
    manifest: compared
      ? { name: result.manifestName, entries: result.entries, claims: result.claims }
      : { name: null, entries: 0, claims: 0 },
    // Every conflict, kept together: a caller that wants "what breaks" reads `predicted`, and a
    // caller that wants the whole table reads `conflicts`.
    predicted: compared ? result.predicted : [],
    preexisting: compared ? result.preexisting : [],
    conflicts: compared ? [...result.predicted, ...result.preexisting] : [],
    totals: compared
      ? {
          predicted: result.predicted.length,
          preexisting: result.preexisting.length,
          claimsAccepted: result.accepted,
          claimsRejected: result.rejected,
        }
      : { predicted: 0, preexisting: 0, claimsAccepted: 0, claimsRejected: 0 },
    // The candidate's own table, so a caller can show what was assumed about it.
    occupancy: compared ? result.snapshot.occupancy : emptyOccupancy(),
    findings,
    limitations: compared ? result.limitations : [...PRE_CHECK_LIMITATIONS],
    codes: [...CONFLICT_CODES],
    types: { ...CONFLICT_TYPES },
    kinds: [...OCCUPANCY_KINDS],
    // The detector's vocabulary is re-exported rather than restated, so a consumer that switches on
    // the live answer also switches on this one.
    conflictLimitations: { ...CONFLICT_LIMITATIONS },
    completeness: 'unknown',
    runtimeValidation: 'not-performed',
    certification: false,
  };
}

/** An occupancy object with every kind present and empty. */
function emptyOccupancy() {
  const occupancy = {};
  for (const kind of OCCUPANCY_KINDS) occupancy[kind] = [];
  return occupancy;
}

/**
 * Exit code implied by a result: 0 predicted nothing, 1 predicted something, 2 unusable.
 *
 * A pre-existing conflict does not raise the code: this command answers "what would installing
 * this plugin add", and billing a caller for a table they already have would make the code lie.
 *
 * @param {{ok: boolean, summary: object}} result Result from {@link staticPreCheck}.
 * @returns {number} Exit code, without `INTERNAL` or `USAGE`.
 */
export function preCheckExitCode(result) {
  if (!result.ok) return PRE_CHECK_EXIT.UNUSABLE;
  return result.summary.predicted.length > 0 ? PRE_CHECK_EXIT.CONFLICTS : PRE_CHECK_EXIT.OK;
}

/**
 * A refusal document carrying exactly one finding and no comparison.
 *
 * It exists so the command can answer in the same shape when it never reached the comparison:
 * an unreadable manifest, a usage error, an internal failure. Every list is present and empty
 * rather than absent, and `limitations` states the prediction caveats even here, because a
 * refusal is still a document someone may read as "nothing found".
 *
 * @param {string} code One of {@link PRE_CHECK_CODES}.
 * @returns {object} Summary document with no conflicts.
 */
export function preCheckFailure(code) {
  return buildSummary(null, null, false, [finding(code)], null);
}
