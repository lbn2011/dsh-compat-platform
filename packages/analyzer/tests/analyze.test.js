import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateDeclaration } from './helpers/fake-validator.js';
import {
  analyze,
  EVIDENCE_LEVEL,
  FINDING_CODES,
  LIMITATION_CODES,
  PROTOCOL_VERSION,
  formatReportJson,
  exitCodeFor,
} from '../src/index.js';

/** Build a declaration in the fixed protocol shape (test data, not a rule). */
function declaration({ id, version = '1.0.0', required = [], optional = [], resources = [] }) {
  return {
    schemaVersion: PROTOCOL_VERSION,
    plugin: { id, version },
    capabilities: { required, optional },
    resources,
  };
}

const codes = (report) => report.findings.map((finding) => finding.code);

const toArray = (value) => (Array.isArray(value) ? [...value] : value);

const SENTINEL = Symbol('sentinel');

/** A validator that records every value it is handed, and accepts everything. */
function recordingValidator() {
  const seen = [];
  const validator = (value) => {
    seen.push(value);
    return { valid: true, issues: [] };
  };
  validator.seen = seen;
  return validator;
}

test('a clean combination produces no findings and exit code 0', () => {
  const report = analyze(
    {
      declarations: [
        declaration({
          id: 'plugin-a',
          required: ['svc:catalog'],
          resources: [{ kind: 'tool', name: 'search', scope: 'plugin' }],
        }),
        declaration({
          id: 'plugin-b',
          optional: ['svc:catalog'],
          resources: [{ kind: 'tool', name: 'open', scope: 'plugin' }],
        }),
      ],
      availableCapabilities: ['svc:catalog'],
    },
    { validateDeclaration },
  );

  assert.equal(report.evidenceLevel, EVIDENCE_LEVEL);
  assert.equal(report.evidenceLevel, 'static-declaration');
  assert.deepEqual(codes(report), []);
  assert.equal(exitCodeFor(report), 0);
  assert.deepEqual(
    report.limitations.map((entry) => entry.code),
    [
      LIMITATION_CODES.NO_ACTIVATION_AUTHORITY,
      LIMITATION_CODES.MISSING_OBSERVATIONS_ARE_UNKNOWN,
      LIMITATION_CODES.SCOPE_LABEL_IS_NOT_CORDIS_SCOPE,
      LIMITATION_CODES.VALIDATOR_DECIDES_DECLARATION_VALIDITY,
    ],
  );
  assert.equal(report.summary.declarations.valid, 2);
  assert.equal(report.summary.analysisComplete, true);
});

/* ------------------------------------------------------------------ *
 * 1. Input shape: raw declarations, no wrapper, no caller index.
 * ------------------------------------------------------------------ */

test('each declaration is handed to the injected validator completely unchanged', () => {
  const recording = recordingValidator();
  const first = declaration({ id: 'a', resources: [{ kind: 'tool', name: 't', scope: 'plugin' }] });
  const second = declaration({ id: 'b' });

  analyze({ declarations: [first, second], availableCapabilities: [] }, { validateDeclaration: recording });

  assert.equal(recording.seen.length, 2, 'the validator must be called once per declaration');
  // Identity, not mere deep equality: no wrapper, no clone, no added index.
  assert.equal(recording.seen[0], first);
  assert.equal(recording.seen[1], second);
});

test('a {value: ...} wrapper is not unwrapped: the raw record is what gets validated', () => {
  const inner = declaration({ id: 'wrapped' });
  const recording = recordingValidator();
  analyze({ declarations: [{ value: inner }], availableCapabilities: [] }, { validateDeclaration: recording });

  assert.equal(recording.seen.length, 1);
  assert.equal(recording.seen[0].value, inner, 'the wrapper itself was passed; it was not unwrapped');
  assert.equal(Object.hasOwn(recording.seen[0], 'plugin'), false);
});

test('there is no declarationIndex: a wrapper record cannot bring one in', () => {
  const recording = recordingValidator();
  analyze(
    { declarations: [{ declarationIndex: 7, ...declaration({ id: 'p' }) }], availableCapabilities: [] },
    { validateDeclaration: recording },
  );
  // The index field travels with the declaration as inert data; the analyzer
  // never reads it and never renumbers messages from it.
  assert.equal(recording.seen[0].declarationIndex, 7);

  // A rejected declaration is identified by its position in input.declarations.
  const report = analyze(
    { declarations: [declaration({ id: 'ok' }), declaration({ id: 'bad', version: '' })], availableCapabilities: [] },
    { validateDeclaration },
  );
  assert.match(report.findings[0].message, /input index 1/);
});

/* ------------------------------------------------------------------ *
 * 2. availableCapabilities is required and typed.
 * ------------------------------------------------------------------ */

test('availableCapabilities is required: leaving it out is a TypeError, never "unknown"', () => {
  const declarations = [declaration({ id: 'needs', required: ['svc:x'] })];
  assert.throws(() => analyze({ declarations }, { validateDeclaration }), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /availableCapabilities is required/);
    assert.match(error.message, /pass \[\]/);
    return true;
  });
});

test('an explicit empty availableCapabilities set means "nothing is available"', () => {
  const report = analyze(
    { declarations: [declaration({ id: 'needs', required: ['svc:x', 'svc:y'] })], availableCapabilities: [] },
    { validateDeclaration },
  );

  const missing = report.findings.filter((finding) => finding.code === FINDING_CODES.MISSING_CAPABILITY);
  assert.equal(missing.length, 2, 'every required capability is reported, since the set is explicitly empty');
  assert.deepEqual(missing.map((finding) => finding.pluginIds), [['needs'], ['needs']]);
  assert.equal(report.summary.availableCapabilities, 0);
  assert.equal(exitCodeFor(report), 1);
});

test('malformed availableCapabilities values are TypeErrors, not silently reinterpreted', () => {
  const declarations = [];
  const bad = [
    ['a bare string', 'svc:x', /must be an array/],
    ['a number', 42, /must be an array/],
    ['a boolean', true, /must be an array/],
    ['an object', { 'svc:x': true }, /must be an array/],
    ['null', null, /must be an array/],
    ['a non-string entry', ['ok', 1], /availableCapabilities\[1\] must be a string/],
    ['a null entry', [null], /availableCapabilities\[0\] must be a string/],
    ['an empty string entry', [''], /must be a non-empty, trimmed capability name/],
    ['a whitespace-only entry', ['   '], /must be a non-empty, trimmed capability name/],
    ['a non-trimmed entry', [' svc:x'], /leading or trailing whitespace/],
    ['a trailing-space entry', ['svc:x '], /leading or trailing whitespace/],
  ];

  for (const [label, value, pattern] of bad) {
    assert.throws(
      () => analyze({ declarations, availableCapabilities: value }, { validateDeclaration }),
      (error) => {
        assert.ok(error instanceof TypeError, `${label}: must be a TypeError`);
        assert.match(error.message, pattern, label);
        return true;
      },
      label,
    );
  }
});

test('availableCapabilities is normalized (deduplicated, sorted) without losing the empty set', () => {
  const report = analyze(
    { declarations: [declaration({ id: 'p', required: ['b', 'a'] })], availableCapabilities: ['a', 'b', 'a'] },
    { validateDeclaration },
  );
  assert.deepEqual(codes(report), []);
  assert.equal(report.summary.availableCapabilities, 2);
});

test('availability cannot be smuggled in through options or a declaration-count field', () => {
  const declarations = [declaration({ id: 'needs', required: ['svc:x'] })];

  assert.throws(
    () => analyze({ declarations, availableCapabilities: [] }, { validateDeclaration, availableCapabilities: ['svc:x'] }),
    /options has unexpected field "availableCapabilities"/,
  );
  assert.throws(
    () => analyze({ declarations, availableCapabilities: [], declaredCapabilities: ['svc:x'] }, { validateDeclaration }),
    /unexpected field "declaredCapabilities"/,
  );
});

/* ------------------------------------------------------------------ *
 * 3. Resource conflicts compare the complete [kind, name, scope] tuple.
 * ------------------------------------------------------------------ */

test('an identical [kind, name, scope] claimed by two plugins is a conflict', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'plugin-a', resources: [{ kind: 'service', name: 'store', scope: 'shared' }] }),
        declaration({ id: 'plugin-b', resources: [{ kind: 'service', name: 'store', scope: 'shared' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  const conflicts = report.findings.filter((finding) => finding.code === FINDING_CODES.RESOURCE_CONFLICT);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].pluginIds, ['plugin-a', 'plugin-b']);
  assert.deepEqual(conflicts[0].resource, { kind: 'service', name: 'store', scope: 'shared' });
  assert.equal(conflicts[0].severity, 'warning');
  assert.match(conflicts[0].message, /scope="shared"/);
});

test('the same kind and name under different scopes is NOT a conflict', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'plugin-a', resources: [{ kind: 'service', name: 'store', scope: 'tenant:acme' }] }),
        declaration({ id: 'plugin-b', resources: [{ kind: 'service', name: 'store', scope: 'tenant:globex' }] }),
        declaration({ id: 'plugin-c', resources: [{ kind: 'service', name: 'store', scope: 'plugin' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  assert.deepEqual(codes(report), [], 'differing scope labels assert different claims');
});

test('a conflict resource reports its scope, and scope alone can distinguish findings', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'a', resources: [{ kind: 'tool', name: 'search', scope: 'plugin' }] }),
        declaration({ id: 'b', resources: [{ kind: 'tool', name: 'search', scope: 'plugin' }] }),
        declaration({ id: 'c', resources: [{ kind: 'tool', name: 'search', scope: 'shared' }] }),
        declaration({ id: 'd', resources: [{ kind: 'tool', name: 'search', scope: 'shared' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  const conflicts = report.findings.filter((finding) => finding.code === FINDING_CODES.RESOURCE_CONFLICT);
  assert.equal(conflicts.length, 2, 'two distinct tuples conflict independently');
  assert.deepEqual(
    conflicts.map((finding) => finding.resource),
    [
      { kind: 'tool', name: 'search', scope: 'plugin' },
      { kind: 'tool', name: 'search', scope: 'shared' },
    ],
  );
  for (const finding of conflicts) {
    assert.deepEqual(Object.keys(finding.resource), ['kind', 'name', 'scope']);
  }
});

test('scope labels are open strings, not a plugin|shared enum', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'x', resources: [{ kind: 'service', name: 'bus', scope: 'tenant:acme' }] }),
        declaration({ id: 'y', resources: [{ kind: 'service', name: 'bus', scope: 'some arbitrary label' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );
  assert.deepEqual(codes(report), [], 'an arbitrary static label is valid and simply differs');
  assert.equal(report.summary.analysisComplete, true);
});

test('a plugin re-claiming its own identical tuple is not a cross-plugin conflict', () => {
  const resources = [
    { kind: 'tool', name: 'search', scope: 'plugin' },
    { kind: 'tool', name: 'search', scope: 'plugin' },
  ];
  const report = analyze(
    { declarations: [declaration({ id: 'solo', resources })], availableCapabilities: [] },
    { validateDeclaration },
  );
  assert.deepEqual(codes(report), []);
});

test('differing kinds with the same name and scope never conflict', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'a', resources: [{ kind: 'tool', name: 'x', scope: 'plugin' }] }),
        declaration({ id: 'b', resources: [{ kind: 'service', name: 'x', scope: 'plugin' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );
  assert.deepEqual(codes(report), []);
});

/* ------------------------------------------------------------------ *
 * 4. Requirements are not providers; invalid input blocks derivation.
 * ------------------------------------------------------------------ */

test('optional requirements are never reported and never treated as providers', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'a', optional: ['svc:cache'] }),
        declaration({ id: 'b', optional: ['svc:cache'] }),
        declaration({ id: 'c', optional: ['svc:cache'] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  assert.deepEqual(codes(report), [], 'an unfulfilled optional requirement is the anticipated fallback');
  assert.equal(exitCodeFor(report), 0);
});

test('a required capability is never inferred from what other declarations provide', () => {
  // 'provider' declares the capability name in its own optional list; that is a
  // wish, not a provision, so 'needs' must still be reported as missing.
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'needs', required: ['svc:store'] }),
        declaration({ id: 'provider', optional: ['svc:store'] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  const missing = report.findings.filter((finding) => finding.code === FINDING_CODES.MISSING_CAPABILITY);
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].pluginIds, ['needs'], 'only the requester is named');
});

test('a missing required capability names only the requesting plugin', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'needs', required: ['svc:redis'] }),
        declaration({ id: 'quiet', required: ['svc:catalog'] }),
      ],
      availableCapabilities: ['svc:catalog'],
    },
    { validateDeclaration },
  );

  const missing = report.findings.filter((finding) => finding.code === FINDING_CODES.MISSING_CAPABILITY);
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].pluginIds, ['needs']);
  assert.equal(missing[0].severity, 'error');
  assert.match(missing[0].message, /"svc:redis"/);
  assert.match(missing[0].message, /caller-supplied/);
});

test('duplicate plugin ids are reported once, with the distinct versions', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'dup', version: '2.0.0' }),
        declaration({ id: 'other' }),
        declaration({ id: 'dup', version: '1.0.0' }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  const duplicates = report.findings.filter((finding) => finding.code === FINDING_CODES.DUPLICATE_PLUGIN_ID);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].pluginIds, ['dup']);
  assert.equal(duplicates[0].severity, 'error');
  assert.match(duplicates[0].message, /declared 2 times/);
  assert.match(duplicates[0].message, /"1\.0\.0", "2\.0\.0"/);
  assert.equal(exitCodeFor(report), 1);
});

test('an invalid declaration fails closed: no dependency findings are derived at all', () => {
  const report = analyze(
    {
      declarations: [
        // Two valid declarations that WOULD produce a conflict and a missing
        // capability if they were analyzed.
        declaration({
          id: 'a',
          required: ['svc:missing'],
          resources: [{ kind: 'tool', name: 't', scope: 'plugin' }],
        }),
        declaration({
          id: 'b',
          required: ['svc:missing'],
          resources: [{ kind: 'tool', name: 't', scope: 'plugin' }],
        }),
        // ...plus one declaration the validator rejects.
        declaration({ id: 'broken', version: '' }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );

  assert.deepEqual(codes(report), [FINDING_CODES.INVALID_DECLARATION]);
  assert.deepEqual(report.findings[0].pluginIds, ['broken'], 'the rejected declaration is still attributable');
  assert.equal(report.summary.analysisComplete, false);
  assert.equal(report.summary.declarations.invalid, 1);
  assert.equal(report.summary.declarations.valid, 2);
  assert.ok(report.limitations.some((entry) => entry.code === LIMITATION_CODES.PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS));
  assert.equal(exitCodeFor(report), 1);
});

test('the injected validator decides validity; this module adds no rule of its own', () => {
  // A declaration this module could read perfectly well, but which the
  // validator rejects, must be rejected. And one that looks odd to this module
  // but is accepted must be accepted.
  const rejectsEverything = () => ({ valid: false, issues: [{ code: 'NOPE', path: 'plugin', message: 'no' }] });
  const report = analyze(
    { declarations: [declaration({ id: 'looks-fine', required: ['svc:x'] })], availableCapabilities: [] },
    { validateDeclaration: rejectsEverything },
  );
  assert.deepEqual(codes(report), [FINDING_CODES.INVALID_DECLARATION]);
  assert.match(report.findings[0].message, /not valid per the injected validator/);
  assert.match(report.findings[0].message, /plugin: NOPE/);
});

test('a declaration without a usable plugin id is reported, never silently dropped', () => {
  const accepted = { valid: true, issues: [] };
  const report = analyze(
    { declarations: [{ anything: true }], availableCapabilities: [] },
    { validateDeclaration: () => accepted },
  );

  assert.deepEqual(codes(report), [FINDING_CODES.INVALID_DECLARATION]);
  assert.deepEqual(report.findings[0].pluginIds, []);
  assert.match(report.findings[0].message, /input index 0/);
  assert.match(report.findings[0].message, /no usable string plugin\.id/);
  assert.equal(report.summary.analysisComplete, false);
});

test('validator results that violate the contract fail closed', () => {
  const cases = [
    ['undefined', () => undefined],
    ['null', () => null],
    ['string', () => 'valid'],
    ['missing valid', () => ({ issues: [] })],
    ['missing issues', () => ({ valid: true })],
    ['inconsistent', () => ({ valid: true, issues: [{ code: 'X', path: '', message: 'm' }] })],
    ['inconsistent the other way', () => ({ valid: false, issues: [] })],
    ['malformed issue', () => ({ valid: false, issues: [{ path: '' }] })],
  ];

  for (const [label, validator] of cases) {
    const report = analyze(
      { declarations: [declaration({ id: 'p' })], availableCapabilities: [] },
      { validateDeclaration: validator },
    );
    assert.deepEqual(codes(report), [FINDING_CODES.INVALID_DECLARATION], label);
    assert.match(report.findings[0].message, /did not honor the validation contract/, label);
    assert.equal(report.summary.analysisComplete, false, label);
  }
});

test('a throwing validator aborts the whole analysis (fail closed)', () => {
  const validator = () => {
    throw new Error('validator exploded');
  };

  assert.throws(
    () => analyze({ declarations: [declaration({ id: 'p' })], availableCapabilities: [] }, { validateDeclaration: validator }),
    (error) => {
      assert.equal(error.code, 'ANALYZER_VALIDATOR_THREW');
      assert.equal(error.declarationIndex, 0);
      assert.match(error.message, /validator exploded/);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * 5. The validator is injected and is the only trusted code path.
 * ------------------------------------------------------------------ */

test('no validator is ever assumed or imported implicitly', () => {
  const input = { declarations: [], availableCapabilities: [] };
  assert.throws(() => analyze(input, undefined), TypeError);
  assert.throws(() => analyze(input, {}), TypeError);
  assert.throws(() => analyze(input, { validateDeclaration: 'dsh-compat-spec' }), TypeError);
  assert.throws(() => analyze(input), /No built-in validator is bundled/);
  assert.throws(() => analyze(input, []), /requires an options object/);
});

test('the validator is called once per declaration and only for declarations', () => {
  const recording = recordingValidator();
  analyze(
    {
      declarations: [declaration({ id: 'a' }), declaration({ id: 'b' }), declaration({ id: 'c' })],
      availableCapabilities: ['svc:x'],
    },
    { validateDeclaration: recording },
  );
  assert.equal(recording.seen.length, 3);
});

/* ------------------------------------------------------------------ *
 * 6. Determinism.
 * ------------------------------------------------------------------ */

test('the same input produces byte-identical output on every run', () => {
  const input = {
    declarations: [
      declaration({ id: 'a', required: ['svc:z', 'svc:a'], resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
      declaration({ id: 'a', version: '1.0.0', resources: [{ kind: 'service', name: 'q', scope: 's' }] }),
      declaration({ id: 'b', resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
    ],
    availableCapabilities: ['svc:a'],
  };

  const first = formatReportJson(analyze(input, { validateDeclaration }));
  for (let run = 0; run < 5; run += 1) {
    assert.equal(formatReportJson(analyze(input, { validateDeclaration })), first);
  }
});

test('output is independent of the order of whole declarations in the input', () => {
  const all = [
    declaration({ id: 'alpha', required: ['svc:missing'], resources: [{ kind: 'tool', name: 'search', scope: 'plugin' }] }),
    declaration({ id: 'beta', required: ['svc:missing'], resources: [{ kind: 'tool', name: 'search', scope: 'plugin' }] }),
    declaration({ id: 'alpha', version: '0.0.1', resources: [{ kind: 'service', name: 'store', scope: 'shared' }] }),
    declaration({ id: 'gamma', optional: ['svc:cache'], resources: [{ kind: 'service', name: 'store', scope: 'shared' }] }),
    declaration({ id: 'gamma', optional: ['svc:cache'] }),
  ];
  const input = (order) => ({ declarations: order.map((index) => all[index]), availableCapabilities: [] });

  const render = (order) => formatReportJson(analyze(input(order), { validateDeclaration }));
  const first = render([0, 1, 2, 3, 4]);
  const permutations = [
    [4, 3, 2, 1, 0],
    [2, 0, 4, 1, 3],
    [3, 1, 0, 4, 2],
    [1, 4, 2, 3, 0],
  ];
  for (const order of permutations) {
    assert.equal(render(order), first, `order ${order.join(',')}`);
  }
});

test('declaration order does not change which findings exist (valid fixtures)', () => {
  const all = [
    declaration({ id: 'p1', required: ['svc:gone'], resources: [{ kind: 'service', name: 'r', scope: 'shared' }] }),
    declaration({ id: 'p2', resources: [{ kind: 'service', name: 'r', scope: 'shared' }] }),
    declaration({ id: 'p1', version: '2.0.0' }),
    declaration({ id: 'p3', optional: ['svc:gone'] }),
  ];
  const render = (order) =>
    formatReportJson(analyze({ declarations: order.map((i) => all[i]), availableCapabilities: ['svc:present'] }, { validateDeclaration }));

  const forward = render([0, 1, 2, 3]);
  const backward = render([3, 2, 1, 0]);
  assert.equal(forward, backward);
  const report = JSON.parse(forward);
  assert.deepEqual([...new Set(report.findings.map((f) => f.code))], [
    FINDING_CODES.DUPLICATE_PLUGIN_ID,
    FINDING_CODES.MISSING_CAPABILITY,
    FINDING_CODES.RESOURCE_CONFLICT,
  ]);
});

test('reordering mixed valid and invalid declarations is NOT promised to be order-invariant', () => {
  // Documented, tested limit: blockers make derivation all-or-nothing, and the
  // rejection findings necessarily name the *positions* that were rejected.
  const all = [
    declaration({ id: 'ok-a', resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
    declaration({ id: 'bad', version: '' }),
    declaration({ id: 'ok-b', resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
  ];
  const render = (order) =>
    formatReportJson(analyze({ declarations: order.map((i) => all[i]), availableCapabilities: [] }, { validateDeclaration }));

  assert.notEqual(render([0, 1, 2]), render([1, 0, 2]));
  // ...but each run is still byte-stable and each still fails closed.
  for (const order of [[0, 1, 2], [1, 0, 2]]) {
    const text = render(order);
    assert.equal(render(order), text);
    assert.equal(JSON.parse(text).summary.analysisComplete, false);
  }
});

/* ------------------------------------------------------------------ *
 * 7. Report shape and purity.
 * ------------------------------------------------------------------ */

test('the report shape is exactly the documented contract', () => {
  const report = analyze(
    { declarations: [declaration({ id: 'x' })], availableCapabilities: [] },
    { validateDeclaration },
  );

  assert.deepEqual(Object.keys(JSON.parse(formatReportJson(report))), [
    'evidenceLevel',
    'findings',
    'limitations',
    'summary',
  ]);
  assert.deepEqual(Object.keys(JSON.parse(formatReportJson(report)).summary), [
    'reportVersion',
    'protocolVersion',
    'declarations',
    'availableCapabilities',
    'analysisComplete',
  ]);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.findings));
  assert.ok(Object.isFrozen(report.limitations));

  const withResource = analyze(
    {
      declarations: [
        declaration({ id: 'a', resources: [{ kind: 'tool', name: 't', scope: 'plugin' }] }),
        declaration({ id: 'b', resources: [{ kind: 'tool', name: 't', scope: 'plugin' }] }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );
  const finding = JSON.parse(formatReportJson(withResource)).findings[0];
  assert.deepEqual(Object.keys(finding), ['code', 'severity', 'pluginIds', 'resource', 'message']);
  assert.deepEqual(Object.keys(finding.resource), ['kind', 'name', 'scope']);
});

test('only the documented finding codes are ever emitted', () => {
  const report = analyze(
    {
      declarations: [
        declaration({ id: 'dup' }),
        declaration({ id: 'dup' }),
        declaration({ id: 'c', required: ['svc:none'], optional: ['svc:cache'], resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
        declaration({ id: 'd', optional: ['svc:cache'], resources: [{ kind: 'tool', name: 't', scope: 's' }] }),
        declaration({ id: 'e', version: '' }),
      ],
      availableCapabilities: [],
    },
    { validateDeclaration },
  );
  const allowed = new Set(Object.values(FINDING_CODES));
  for (const finding of report.findings) {
    assert.ok(allowed.has(finding.code), `unexpected finding code ${finding.code}`);
  }
  assert.equal(allowed.has('DUPLICATE_CAPABILITY_PROVIDER'), false, 'that code does not exist');
});

test('the input envelope accepts no field other than declarations and availableCapabilities', () => {
  const opts = { validateDeclaration };
  assert.throws(() => analyze(null, opts), TypeError);
  assert.throws(() => analyze([], opts), TypeError);
  assert.throws(() => analyze(SENTINEL, opts), TypeError);
  assert.throws(() => analyze({}, opts), /input.declarations is required/);
  assert.throws(() => analyze({ declarations: {} }, opts), /must be an array/);
  assert.throws(() => analyze({ declarations: [], availableCapabilities: [] , other: 1 }, opts), /unexpected field "other"/);
  assert.throws(() => analyze({ declarations: [], availableCapabilities: [], declaredCapabilities: [] }, opts), /declaredCapabilities/);
  // A malformed *declaration* is not an envelope error: it is a finding.
  const report = analyze({ declarations: [null, 42, 'x'], availableCapabilities: [] }, opts);
  assert.equal(report.findings.length, 3);
  assert.ok(report.findings.every((finding) => finding.code === FINDING_CODES.INVALID_DECLARATION));
});

test('a frozen input object is not mutated', () => {
  const frozenDeclaration = Object.freeze(
    declaration({ id: 'p', resources: Object.freeze([Object.freeze({ kind: 'tool', name: 't', scope: 's' })]) }),
  );
  const input = Object.freeze({
    declarations: Object.freeze([frozenDeclaration]),
    availableCapabilities: Object.freeze(['svc:x']),
  });

  const report = analyze(input, { validateDeclaration });
  assert.deepEqual(report.summary.declarations, { total: 1, valid: 1, invalid: 0 });
  assert.deepEqual(input.availableCapabilities, ['svc:x']);
});

test('formatReportJson and exitCodeFor reject non-reports instead of guessing', () => {
  assert.throws(() => formatReportJson(null), TypeError);
  assert.throws(() => formatReportJson({}), TypeError);
  assert.equal(exitCodeFor(undefined), 1);
  assert.equal(exitCodeFor({ findings: [{ severity: 'warning' }] }), 0);
  assert.equal(exitCodeFor({ findings: [{ severity: 'error' }] }), 1);
});

test('the analysis module contains no dynamic execution or host-access primitive', async () => {
  // Static source assertion over the shipped analysis module: no dynamic
  // import, no eval, no child process, no fs/network, no host profile access.
  // Reading this source is a test-time action; the library itself never does it.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const source = await readFile(fileURLToPath(new URL('../src/analyze.js', import.meta.url)), 'utf8');

  const forbidden = [
    [/\bimport\s*\(/, 'dynamic import'],
    [/\bimport\s+[^'"]+from\s*['"]/, 'any static import'],
    [/\brequire\s*\(/, 'require'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\b/, 'new Function'],
    [/node:child_process/, 'child_process'],
    [/node:fs/, 'fs'],
    [/node:net|node:http|node:https|fetch\s*\(/, 'network'],
    [/process\./, 'process access'],
    [/writeFile|appendFile|mkdir|createWriteStream/, 'file writes'],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(source), false, `analyze.js must not contain ${label}`);
  }
  assert.equal(/(^|\n)\s*import\s/.test(source), false, 'analyze.js must be import-free');
  // No leftover inference machinery from the previous draft.
  assert.equal(source.includes('DUPLICATE_CAPABILITY_PROVIDER'), false);
  assert.equal(source.includes('declaredCapabilities'), false);
  assert.equal(source.includes('observedCapabilities'), false);
  // The caller-supplied declaration index is gone. The only surviving
  // occurrence is the metadata field on the thrown validator error, which
  // reports the *position in input.declarations*, not a caller-supplied value.
  const indexMentions = source.match(/declarationIndex/g) ?? [];
  assert.equal(indexMentions.length, 1, 'declarationIndex survives only on the thrown error');
});
