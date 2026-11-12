/**
 * Tests for `pre-check.js` (A2) and its command line.
 *
 * What these tests are actually guarding:
 *   - a prediction and the live detector agree. The pre-check imports the detector's rules
 *     instead of restating them, so the risk is not a wrong rule but a wrong ADAPTER: an `inject`
 *     name that is not expressed in the detector's capability vocabulary, or a host requirement
 *     that trips C9 namespace pollution. Both are asserted directly.
 *   - "nothing predicted" is never confused with "nothing checked". Where a comparison could not
 *     run, a limitation must be present, and the specific `INJECT_REQUIREMENTS_NOT_COMPARED`
 *     marker must accompany a skipped C1.
 *   - a conflict that already existed is never billed to the candidate: `predicted` and
 *     `preexisting` are separate, and the exit code follows `predicted` only.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PRE_CHECK_CODES,
  PRE_CHECK_EXIT,
  PRE_CHECK_LIMITATIONS,
  PRE_CHECK_SCHEMA,
  PRE_CHECK_VERSION,
  preCheckExitCode,
  preCheckFailure,
  staticPreCheck,
} from '../src/pre-check.js';
import { main } from '../src/pre-check-cli.js';
import { CONFLICT_CODES, CONFLICT_LIMITATIONS, OCCUPANCY_KINDS } from '../src/conflict-detector.js';

const CLI = fileURLToPath(new URL('../src/pre-check-cli.js', import.meta.url));

/** Codes of the summary's input findings. */
function findingCodes(result) {
  return result.summary.findings.map((finding) => finding.code);
}

/** A minimal well-formed candidate manifest. */
function candidate(overrides = {}) {
  return { name: 'candidate-plugin', version: '1.0.0', ...overrides };
}

/** One occupancy claim, in the shape an A1 service reports. */
function claim(overrides) {
  return { owner: 'occupant', kind: 'row', key: 'alpha', scope: 'profile', ...overrides };
}

/** A temporary directory that is removed after `body` runs. */
function withTempDir(body) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-pre-check-'));
  try {
    return body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Run the CLI in a child process and return its outcome. */
function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A writable fake stream that records what was written. */
function fakeStream() {
  return {
    chunks: [],
    write(text, callback) {
      this.chunks.push(text);
      if (typeof callback === 'function') callback(null);
      return true;
    },
    once() {},
    removeListener() {},
    text() {
      return this.chunks.join('');
    },
  };
}

// ---------------------------------------------------------------------------
// the closed vocabularies
// ---------------------------------------------------------------------------

test('the pre-check vocabulary is closed and shares the conflict taxonomy', () => {
  assert.equal(PRE_CHECK_VERSION, 'pre-check/0.1-draft.1');
  assert.equal(PRE_CHECK_SCHEMA, 'pre-check-summary/0.1-draft.1');
  assert.equal(Object.isFrozen(PRE_CHECK_CODES), true);
  assert.equal(Object.isFrozen(PRE_CHECK_LIMITATIONS), true);
  assert.equal(Object.isFrozen(PRE_CHECK_EXIT), true);
  assert.deepEqual(PRE_CHECK_LIMITATIONS, [
    'PROVIDER_SET_COMPLETENESS_UNKNOWN',
    'BUNDLE_PATCH_ROWS_NOT_READ',
    'PREDICTION_IS_NOT_AN_INSTALL',
  ]);
  // The conflict codes come from the detector, not from a copy: a prediction cannot use a code
  // the live answer does not know.
  const result = staticPreCheck({ manifest: candidate() });
  assert.deepEqual(result.summary.codes, [...CONFLICT_CODES]);
  assert.deepEqual(result.summary.kinds, [...OCCUPANCY_KINDS]);
  assert.equal(result.summary.conflictLimitations.REQUIREMENT_MATCHING_IS_EXACT, 'REQUIREMENT_MATCHING_IS_EXACT');
});

test('the summary has every key, in a fixed order, for a refused input too', () => {
  const refused = preCheckFailure(PRE_CHECK_CODES.USAGE);
  const clean = staticPreCheck({ manifest: candidate() }).summary;
  assert.deepEqual(Object.keys(refused), Object.keys(clean));
  assert.equal(refused.certification, false);
  assert.equal(refused.completeness, 'unknown');
  assert.equal(refused.runtimeValidation, 'not-performed');
  // A refusal reports no comparison, not an empty one.
  assert.deepEqual(refused.predicted, []);
  assert.deepEqual(refused.conflicts, []);
  assert.equal(refused.manifest.name, null);
  assert.equal(refused.totals.claimsAccepted, 0);
  for (const kind of OCCUPANCY_KINDS) assert.deepEqual(refused.occupancy[kind], []);
});

// ---------------------------------------------------------------------------
// argument discipline
// ---------------------------------------------------------------------------

test('an unknown input key, a bad option type and a non-object input are refused', () => {
  assert.throws(() => staticPreCheck({ manifest: candidate(), extra: true }), /unknown key/);
  assert.throws(() => staticPreCheck('nope'), /input must be an object/);
  assert.throws(() => staticPreCheck({ manifest: candidate(), platform: '' }), /platform must be a non-empty string/);
  assert.throws(() => staticPreCheck({ manifest: candidate(), platform: 7 }), /platform must be a non-empty string/);
  assert.throws(
    () => staticPreCheck({ manifest: candidate(), providerSetComplete: 'yes' }),
    /providerSetComplete must be a boolean/,
  );
  assert.throws(() => staticPreCheck({ manifest: candidate(), maxClaims: 0 }), /maxClaims must be a positive integer/);
  assert.throws(() => staticPreCheck({ manifest: candidate(), manifestText: 5 }), /manifestText must be a string/);
});

test('a claim cap smaller than the candidate is an error, not a truncation', () => {
  const manifest = candidate({ dsh: { a: {}, b: {}, c: {} } });
  assert.throws(() => staticPreCheck({ manifest, maxClaims: 2 }), RangeError);
});

// ---------------------------------------------------------------------------
// input findings
// ---------------------------------------------------------------------------

test('a manifest that is not JSON, or not an object, produces a refusal', () => {
  const broken = staticPreCheck({ manifestText: '{not json' });
  assert.equal(broken.ok, false);
  assert.deepEqual(findingCodes(broken), ['MANIFEST_NOT_JSON']);
  assert.equal(preCheckExitCode(broken), PRE_CHECK_EXIT.UNUSABLE);

  const array = staticPreCheck({ manifestText: '[]' });
  assert.equal(array.ok, false);
  assert.deepEqual(findingCodes(array), ['MANIFEST_NOT_OBJECT']);

  const missing = staticPreCheck({});
  assert.equal(missing.ok, false);
  assert.deepEqual(findingCodes(missing), ['MANIFEST_NOT_OBJECT']);
});

test('a manifest without a name is still compared, and says so', () => {
  const result = staticPreCheck({ manifest: { version: '1.0.0', dsh: { alpha: {} } } });
  assert.equal(result.ok, true);
  assert.deepEqual(findingCodes(result), ['MANIFEST_NAME_MISSING']);
  assert.equal(result.summary.manifest.name, null);
  // The owner falls back to a constant, so repeated runs still replace rather than accumulate.
  assert.equal(result.summary.totals.claimsAccepted, 1);
});

test('a malformed entry, inject, platform, engines and peer range are reported, not thrown', () => {
  const result = staticPreCheck({
    manifest: candidate({
      dsh: { good: {}, bad: 7, listy: { inject: 'tools' }, platy: { platform: 9 } },
      engines: { dsh: 12 },
      peerDependencies: { '@deepseek-ai/dsh-tools': 3 },
    }),
  });
  assert.deepEqual(findingCodes(result).sort(), [
    'ENGINES_DSH_NOT_STRING',
    'ENTRY_INJECT_NOT_STRING_ARRAY',
    'ENTRY_NOT_OBJECT',
    'ENTRY_PLATFORM_NOT_STRING',
    'PEER_RANGE_NOT_STRING',
  ]);
  // A finding about one entry does not stop the others from being compared.
  assert.equal(result.summary.totals.claimsAccepted, 2); // `good` and `listy`
});

test('the reserved dsh.bundle key is not an entry', () => {
  const result = staticPreCheck({ manifest: candidate({ dsh: { bundle: { patch: [] }, alpha: {} } }) });
  assert.equal(result.summary.manifest.entries, 1);
  assert.equal(result.summary.totals.claimsAccepted, 1);
});

// ---------------------------------------------------------------------------
// C2 — duplicate occupancy
// ---------------------------------------------------------------------------

test('a candidate row that duplicates an existing row key is a predicted blocker', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: {} } }),
    occupancy: [claim({ owner: 'other-plugin' })],
  });
  assert.equal(result.summary.predicted.length, 1);
  const [conflict] = result.summary.predicted;
  assert.equal(conflict.code, 'C2');
  assert.equal(conflict.severity, 'blocker');
  assert.equal(conflict.key, 'alpha');
  assert.deepEqual(
    conflict.owners.map((owner) => owner.owner),
    ['other-plugin', 'plugin:candidate-plugin'],
  );
  assert.equal(result.summary.preexisting.length, 0);
  assert.equal(preCheckExitCode(result), PRE_CHECK_EXIT.CONFLICTS);
});

test('the same key in another scope is not a duplicate', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: {} } }),
    occupancy: [claim({ owner: 'other-plugin', scope: 'bundle' })],
  });
  assert.deepEqual(result.summary.predicted, []);
  assert.equal(preCheckExitCode(result), PRE_CHECK_EXIT.OK);
});

test('a conflict the candidate is not part of is reported as pre-existing, and does not raise the code', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: {} } }),
    occupancy: [
      claim({ owner: 'first', key: 'beta' }),
      claim({ owner: 'second', key: 'beta' }),
    ],
  });
  assert.deepEqual(result.summary.predicted, []);
  assert.equal(result.summary.preexisting.length, 1);
  assert.equal(result.summary.preexisting[0].code, 'C2');
  // `conflicts` is both lists, so a caller that wants the whole table still gets it.
  assert.equal(result.summary.conflicts.length, 1);
  assert.equal(preCheckExitCode(result), PRE_CHECK_EXIT.OK);
});

// ---------------------------------------------------------------------------
// C1 — inject requirements, and the flag that gates them
// ---------------------------------------------------------------------------

test('inject requirements are compared only when the provider set is vouched for', () => {
  const manifest = candidate({ dsh: { alpha: { inject: ['tools'] } } });

  const skipped = staticPreCheck({ manifest });
  assert.deepEqual(skipped.summary.predicted, []);
  assert.equal(skipped.summary.providerSetComplete, false);
  assert.ok(skipped.summary.limitations.includes('PROVIDER_SET_COMPLETENESS_UNKNOWN'));
  assert.ok(skipped.summary.limitations.includes('INJECT_REQUIREMENTS_NOT_COMPARED'));

  const compared = staticPreCheck({ manifest, providerSetComplete: true });
  assert.equal(compared.summary.predicted.length, 1);
  assert.equal(compared.summary.predicted[0].code, 'C1');
  assert.equal(compared.summary.predicted[0].detail.requirement, 'service:tools');
  assert.equal(compared.summary.limitations.includes('INJECT_REQUIREMENTS_NOT_COMPARED'), false);
});

test('an inject name is satisfied by a service claim of that name', () => {
  // This is the adapter risk: `inject: ['tools']` must become the capability `service:tools`,
  // because that is what a `{kind:'service', key:'tools'}` claim provides.
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: { inject: ['tools'] } } }),
    occupancy: [claim({ owner: 'dsh-tools', kind: 'service', key: 'tools', scope: 'host' })],
    providerSetComplete: true,
  });
  assert.deepEqual(result.summary.predicted, []);
});

test('an explicitly provided capability name also satisfies an inject requirement', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: { inject: ['tools'] } } }),
    occupancy: [
      claim({
        owner: 'provider',
        kind: 'row',
        key: 'provider-row',
        scope: 'profile',
        provides: ['service:tools'],
      }),
    ],
    providerSetComplete: true,
  });
  assert.deepEqual(result.summary.predicted, []);
});

// ---------------------------------------------------------------------------
// C6, C7, C9 — environment rules
// ---------------------------------------------------------------------------

test('an entry platform the environment does not match is a predicted C6', () => {
  const manifest = candidate({ dsh: { alpha: { platform: 'web' } } });

  const mismatched = staticPreCheck({ manifest, platform: 'cli' });
  assert.equal(mismatched.summary.predicted.length, 1);
  assert.equal(mismatched.summary.predicted[0].code, 'C6');

  const matched = staticPreCheck({ manifest, platform: 'web' });
  assert.deepEqual(matched.summary.predicted, []);

  // Without a platform the rule cannot run, and that is stated rather than assumed satisfied.
  const unknown = staticPreCheck({ manifest });
  assert.deepEqual(unknown.summary.predicted, []);
  assert.ok(unknown.summary.limitations.includes(CONFLICT_LIMITATIONS.PLATFORM_UNKNOWN));
});

test('engines.dsh decides alone, exactly as the host decides it', () => {
  const drifting = staticPreCheck({
    manifest: candidate({ engines: { dsh: '>=99.0.0' } }),
    hostVersion: '24.9.0',
  });
  assert.equal(drifting.summary.predicted.length, 1);
  assert.equal(drifting.summary.predicted[0].code, 'C7');
  assert.equal(drifting.summary.predicted[0].detail.hostRange, '>=99.0.0');

  const satisfied = staticPreCheck({
    manifest: candidate({ engines: { dsh: '>=24.0.0' } }),
    hostVersion: '24.9.0',
  });
  assert.deepEqual(satisfied.summary.predicted, []);

  // No host version, no C7 — and the detector says why.
  const unknown = staticPreCheck({ manifest: candidate({ engines: { dsh: '>=99.0.0' } }) });
  assert.deepEqual(unknown.summary.predicted, []);
  assert.ok(unknown.summary.limitations.includes(CONFLICT_LIMITATIONS.HOST_VERSION_UNKNOWN));
});

test('dsh peer ranges are compared, and a workspace range never is', () => {
  const drifting = staticPreCheck({
    manifest: candidate({ peerDependencies: { '@deepseek-ai/dsh-tools': '^1.0.0' } }),
    hostVersion: '24.9.0',
  });
  assert.equal(drifting.summary.predicted.length, 1);
  assert.equal(drifting.summary.predicted[0].code, 'C7');
  assert.equal(drifting.summary.predicted[0].key, '@deepseek-ai/dsh-tools');

  // The host treats a workspace range as "whatever runs", so it can never be drift.
  const workspace = staticPreCheck({
    manifest: candidate({ peerDependencies: { '@deepseek-ai/dsh-tools': 'workspace:*' } }),
    hostVersion: '24.9.0',
  });
  assert.deepEqual(workspace.summary.predicted, []);

  // A non-DSH peer is not a host requirement.
  const unrelated = staticPreCheck({
    manifest: candidate({ peerDependencies: { yaml: '^2.0.0' } }),
    hostVersion: '24.9.0',
  });
  assert.deepEqual(unrelated.summary.predicted, []);
});

test('a host requirement is not reported as namespace pollution', () => {
  // The requirement itself carries a reserved prefix. If the adapter forgot the acknowledgement,
  // every plugin with a DSH peer dependency would get a C9 instead of an answer.
  const result = staticPreCheck({
    manifest: candidate({ peerDependencies: { '@deepseek-ai/dsh-tools': '^24.0.0' } }),
    hostVersion: '24.9.0',
  });
  assert.deepEqual(
    result.summary.predicted.filter((conflict) => conflict.code === 'C9'),
    [],
  );

  // An entry that uses a reserved prefix is a real C9, and still is.
  const polluting = staticPreCheck({ manifest: candidate({ dsh: { 'dsh.internal': {} } }) });
  assert.equal(polluting.summary.predicted.length, 1);
  assert.equal(polluting.summary.predicted[0].code, 'C9');
});

// ---------------------------------------------------------------------------
// declarations and existing occupancy
// ---------------------------------------------------------------------------

test('declarations become occupancy with their own owner, so they are never blamed on the candidate', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: {} } }),
    declarations: [
      { owner: 'declared-plugin', declaration: { resources: [{ kind: 'row', name: 'beta' }] } },
    ],
  });
  assert.equal(result.summary.totals.claimsAccepted, 2);
  assert.deepEqual(result.summary.predicted, []);
  assert.equal(result.summary.occupancy.row.some((entry) => entry.owner === 'declared-plugin'), true);
});

test('a malformed occupancy entry is reported, and the rest of the table is still compared', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: {} } }),
    occupancy: [{ kind: 'row', key: 'alpha' }, claim({ owner: 'real', key: 'alpha' })],
  });
  assert.deepEqual(findingCodes(result), ['OCCUPANCY_ENTRY_REJECTED']);
  assert.equal(result.summary.predicted.length, 1);
});

test('occupancy and declarations that are not arrays are findings, not silent omissions', () => {
  const occupancy = staticPreCheck({ manifest: candidate(), occupancy: {} });
  assert.deepEqual(findingCodes(occupancy), ['OCCUPANCY_NOT_ARRAY']);

  const declarations = staticPreCheck({ manifest: candidate(), declarations: 'x' });
  assert.deepEqual(findingCodes(declarations), ['DECLARATIONS_NOT_ARRAY']);
});

test('re-running the pre-check replaces the candidate instead of duplicating it', () => {
  const manifest = candidate({ dsh: { alpha: {} } });
  const first = staticPreCheck({ manifest }, {});
  assert.equal(first.summary.totals.claimsAccepted, 1);

  // The same manifest against a table that already contains the previous run's answer: the
  // candidate's own previous claims must not count as a second occupant of its own keys.
  const previous = first.summary.occupancy;
  const claims = [];
  for (const kind of OCCUPANCY_KINDS) {
    for (const entry of previous[kind]) claims.push({ kind, ...entry, scope: 'profile' });
  }
  const second = staticPreCheck({ manifest, occupancy: claims });
  assert.deepEqual(second.summary.predicted, []);
});

// ---------------------------------------------------------------------------
// determinism and serialisability
// ---------------------------------------------------------------------------

test('the same input produces byte-identical output', () => {
  const input = {
    manifest: candidate({ dsh: { alpha: { inject: ['tools', 'config'] }, beta: {} } }),
    occupancy: [claim({ owner: 'z' }), claim({ owner: 'a' })],
    providerSetComplete: true,
    platform: 'web',
    hostVersion: '24.9.0',
  };
  assert.equal(
    JSON.stringify(staticPreCheck(input).summary),
    JSON.stringify(staticPreCheck(input).summary),
  );
});

test('the summary is JSON-serialisable and carries no Map', () => {
  const result = staticPreCheck({
    manifest: candidate({ dsh: { alpha: { inject: ['tools'] } } }),
    occupancy: [claim({ owner: 'other' })],
    providerSetComplete: true,
  });
  const text = JSON.stringify(result.summary);
  assert.equal(typeof text, 'string');
  assert.equal(text.includes('Map('), false);
  // The detector's own snapshot type is not leaked into the document.
  assert.equal(Object.prototype.hasOwnProperty.call(result.summary, 'failures'), false);
});

// ---------------------------------------------------------------------------
// the command line
// ---------------------------------------------------------------------------

test('the command line refuses an empty or unrecognised invocation with exit 64', () => {
  const empty = runCli([]);
  assert.equal(empty.status, PRE_CHECK_EXIT.USAGE);
  assert.match(empty.stderr, /Usage:/);
  const document = JSON.parse(empty.stdout);
  assert.deepEqual(document.findings.map((finding) => finding.code), ['USAGE']);
  assert.equal(document.preCheckSummary, PRE_CHECK_SCHEMA);

  const unknown = runCli(['--manifest', 'x.json', '--nope']);
  assert.equal(unknown.status, PRE_CHECK_EXIT.USAGE);

  const missingValue = runCli(['--manifest']);
  assert.equal(missingValue.status, PRE_CHECK_EXIT.USAGE);
});

test('the command line reports a clean candidate, a predicted conflict, and an unreadable file', () => {
  withTempDir((directory) => {
    const clean = join(directory, 'clean.json');
    writeFileSync(clean, JSON.stringify(candidate({ dsh: { alpha: {} } })));

    const ok = runCli(['--manifest', clean]);
    assert.equal(ok.status, PRE_CHECK_EXIT.OK);
    assert.deepEqual(JSON.parse(ok.stdout).predicted, []);

    const occupancy = join(directory, 'occupancy.json');
    writeFileSync(occupancy, JSON.stringify([claim({ owner: 'other-plugin' })]));
    const conflicting = runCli(['--manifest', clean, '--occupancy', occupancy]);
    assert.equal(conflicting.status, PRE_CHECK_EXIT.CONFLICTS);
    assert.equal(JSON.parse(conflicting.stdout).predicted[0].code, 'C2');

    const missing = runCli(['--manifest', join(directory, 'absent.json')]);
    assert.equal(missing.status, PRE_CHECK_EXIT.UNUSABLE);
    assert.deepEqual(
      JSON.parse(missing.stdout).findings.map((finding) => finding.code),
      ['INPUT_OPEN_FAILED'],
    );
  });
});

test('the command line parses flags, refuses a JSON array where an object belongs, and reports C7', () => {
  withTempDir((directory) => {
    const manifestPath = join(directory, 'plugin.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(candidate({ engines: { dsh: '>=99.0.0' }, dsh: { alpha: {} } })),
    );

    const drifting = runCli(['--manifest', manifestPath, '--host-version', '24.9.0', '--platform', 'web']);
    assert.equal(drifting.status, PRE_CHECK_EXIT.CONFLICTS);
    assert.equal(JSON.parse(drifting.stdout).predicted[0].code, 'C7');

    const notJson = join(directory, 'broken.json');
    writeFileSync(notJson, 'nope');
    const broken = runCli(['--manifest', notJson]);
    assert.equal(broken.status, PRE_CHECK_EXIT.UNUSABLE);
    assert.deepEqual(
      JSON.parse(broken.stdout).findings.map((finding) => finding.code),
      ['INPUT_NOT_JSON'],
    );

    const notArray = join(directory, 'occupancy-object.json');
    writeFileSync(notArray, '{"owner":"x"}');
    const wrongShape = runCli(['--manifest', manifestPath, '--occupancy', notArray]);
    assert.equal(wrongShape.status, PRE_CHECK_EXIT.UNUSABLE);
    assert.deepEqual(
      JSON.parse(wrongShape.stdout).findings.map((finding) => finding.code),
      ['INPUT_NOT_ARRAY'],
    );
  });
});

test('the command line accepts a declaration file in either documented shape', () => {
  withTempDir((directory) => {
    const manifestPath = join(directory, 'plugin.json');
    writeFileSync(manifestPath, JSON.stringify(candidate({ dsh: { alpha: {} } })));

    const wrapped = join(directory, 'wrapped.json');
    writeFileSync(
      wrapped,
      JSON.stringify({ owner: 'declared', declaration: { resources: [{ kind: 'row', name: 'beta' }] } }),
    );
    const bare = join(directory, 'bare.json');
    writeFileSync(bare, JSON.stringify({ resources: [{ kind: 'row', name: 'gamma' }] }));

    const run = runCli(['--manifest', manifestPath, '--declaration', wrapped, '--declaration', bare]);
    assert.equal(run.status, PRE_CHECK_EXIT.OK);
    const document = JSON.parse(run.stdout);
    // `alpha` (candidate) plus one row per declaration.
    assert.equal(document.totals.claimsAccepted, 3);
  });
});

test('a failed stdout write is exit 5, never a clean code', async () => {
  const manifestPath = process.execPath; // any readable file; the manifest will be refused
  const stdout = {
    write(_text, callback) {
      if (typeof callback === 'function') callback(new Error('EPIPE'));
      return false;
    },
    once() {},
    removeListener() {},
  };
  const stderr = fakeStream();
  const code = await main(['--manifest', manifestPath], { stdout, stderr });
  assert.equal(code, PRE_CHECK_EXIT.INTERNAL);
});

test('the command line writes usage text to stderr and one JSON document to stdout', async () => {
  const stdout = fakeStream();
  const stderr = fakeStream();
  const code = await main(['--host-version', '24.9.0'], { stdout, stderr });
  assert.equal(code, PRE_CHECK_EXIT.USAGE);
  assert.match(stderr.text(), /dsh-compat-pre-check/);
  const document = JSON.parse(stdout.text());
  assert.deepEqual(document.findings.map((finding) => finding.code), ['USAGE']);
});
