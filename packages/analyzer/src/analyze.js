/**
 * dsh-compat-platform — deterministic static declaration analysis.
 *
 * SCOPE OF THIS MODULE
 * --------------------
 * This module reads *declarations supplied by plugin authors* and reasons only
 * about what those declarations say. It is a pure library: it never imports a
 * plugin, never evaluates configuration or `!!js` expressions, never reads the
 * host profile, never scans the filesystem and never writes anything.
 *
 * The declaration contract itself is owned by dsh-compat-spec. This module
 * deliberately does NOT copy that contract's validation rules. Every caller
 * must inject a validator, so that a divergence between this analyzer and the
 * protocol shows up as a validator issue instead of a silently duplicated rule.
 * The analyzer reads *only* these published fields out of an accepted
 * declaration, and only to attribute findings and to compare resource tuples:
 *
 *   declaration.plugin.id             (string)     — attribution, duplicate id
 *   declaration.plugin.version        (string)     — duplicate-id message only
 *   declaration.capabilities.required (string[])   — requirement, never a provider
 *   declaration.capabilities.optional (string[])   — recorded, never scored
 *   declaration.resources[]           ({kind,name,scope}) — complete tuples
 *
 * Anything else in a declaration — `schemaVersion`, unknown fields,
 * executable-looking strings — is the validator's business and is ignored here.
 *
 * With the same deterministic validator, identical JSON inputs produce the
 * same output. Valid declaration batches are order-independent; invalid-input
 * messages include array positions and can change when declarations move.
 *
 * @packageDocumentation
 */

/** Protocol revision this analyzer is written against. Informational only. */
export const PROTOCOL_VERSION = '0.1.0-draft.1';

/** The only evidence level this release can produce. */
export const EVIDENCE_LEVEL = 'static-declaration';

/** Report format version, bumped on output shape changes. */
export const REPORT_VERSION = '0.1.0-draft.1';

/** Stable finding codes. */
export const FINDING_CODES = Object.freeze({
  INVALID_DECLARATION: 'INVALID_DECLARATION',
  DUPLICATE_PLUGIN_ID: 'DUPLICATE_PLUGIN_ID',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  MISSING_CAPABILITY: 'MISSING_CAPABILITY',
});

/** Stable limitation codes. */
export const LIMITATION_CODES = Object.freeze({
  NO_ACTIVATION_AUTHORITY: 'NO_ACTIVATION_AUTHORITY',
  MISSING_OBSERVATIONS_ARE_UNKNOWN: 'MISSING_OBSERVATIONS_ARE_UNKNOWN',
  SCOPE_LABEL_IS_NOT_CORDIS_SCOPE: 'SCOPE_LABEL_IS_NOT_CORDIS_SCOPE',
  VALIDATOR_DECIDES_DECLARATION_VALIDITY: 'VALIDATOR_DECIDES_DECLARATION_VALIDITY',
  PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS: 'PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS',
});

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });

/** Codes that make the analysis fail closed (no dependency-derived findings). */
const BLOCKING_CODES = Object.freeze(new Set([FINDING_CODES.INVALID_DECLARATION]));

/** Fixed emission order of limitations (not alphabetic). */
const LIMITATION_ORDER = Object.freeze([
  LIMITATION_CODES.NO_ACTIVATION_AUTHORITY,
  LIMITATION_CODES.MISSING_OBSERVATIONS_ARE_UNKNOWN,
  LIMITATION_CODES.SCOPE_LABEL_IS_NOT_CORDIS_SCOPE,
  LIMITATION_CODES.VALIDATOR_DECIDES_DECLARATION_VALIDITY,
  LIMITATION_CODES.PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS,
]);

/** The only accepted input field names; anything else is a caller bug. */
const INPUT_FIELDS = Object.freeze(['declarations', 'availableCapabilities']);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Deterministic string ordering: code-unit order of the UTF-16 form. Intl and
 * locale collation are never used, so the same bytes give the same order on
 * every machine.
 */
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const order = compareStrings(left[index], right[index]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/**
 * A total, injective key for a complete resource claim `[kind, name, scope]`.
 * JSON encoding of the triple keeps the components unambiguous, so two
 * distinct claims can never collide and no resource object is ever coerced to
 * a string with the implicit `[object Object]` form.
 */
function resourceKey(claim) {
  return JSON.stringify([claim.kind, claim.name, claim.scope]);
}

function compareFindings(left, right) {
  const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
  if (bySeverity !== 0) return bySeverity;
  const byCode = compareStrings(left.code, right.code);
  if (byCode !== 0) return byCode;
  const byPlugins = compareStringArrays(left.pluginIds, right.pluginIds);
  if (byPlugins !== 0) return byPlugins;
  const byResource = compareStrings(
    left.resource === undefined ? '' : resourceKey(left.resource),
    right.resource === undefined ? '' : resourceKey(right.resource),
  );
  if (byResource !== 0) return byResource;
  return compareStrings(left.message, right.message);
}

function ownKeys(value) {
  return Object.getOwnPropertyNames(value).sort(compareStrings);
}

/**
 * Sanitize an arbitrary thrown value into a short, single-line diagnostic.
 * Nothing from the error is executed or re-thrown; only a string is kept.
 */
function describeThrown(error) {
  let text;
  if (error instanceof Error) {
    text = `${error.name || 'Error'}: ${error.message || ''}`;
  } else if (typeof error === 'string') {
    text = error;
  } else {
    text = `non-Error value of type ${describeValue(error)}`;
  }
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').slice(0, 500).trim();
}

function formatPath(path) {
  return path === '' ? '<root>' : path;
}

/**
 * Normalize whatever a validator returned into `{ valid, issues }`.
 *
 * The contract is dsh-compat-spec's `validateDeclaration(value) ->
 * { valid, issues: [{ code, path, message }] }`. Anything that does not match
 * the contract is converted into `VALIDATOR_CONTRACT_VIOLATION` issues so the
 * caller fails closed instead of inferring from a half-understood result.
 */
function normalizeValidation(raw) {
  const violations = [];
  const violation = (path, message) =>
    violations.push({ code: 'VALIDATOR_CONTRACT_VIOLATION', path, message });

  if (!isPlainObject(raw)) {
    violation('', `validator must return an object, got ${describeValue(raw)}.`);
    return { valid: false, issues: violations };
  }
  if (typeof raw.valid !== 'boolean') {
    violation('valid', 'validator result must contain a boolean "valid".');
  }
  if (!Array.isArray(raw.issues)) {
    violation('issues', 'validator result must contain an "issues" array.');
    return { valid: false, issues: violations };
  }

  const issues = [];
  for (let index = 0; index < raw.issues.length; index += 1) {
    const entry = raw.issues[index];
    if (!isPlainObject(entry)) {
      violation(`issues[${index}]`, 'each validator issue must be an object.');
      continue;
    }
    if (typeof entry.code !== 'string' || entry.code.length === 0) {
      violation(`issues[${index}].code`, 'each validator issue must have a non-empty string "code".');
      continue;
    }
    const path = typeof entry.path === 'string' ? entry.path : '';
    const message = typeof entry.message === 'string' ? entry.message : '';
    issues.push({ code: entry.code, path, message });
  }

  if (violations.length > 0) return { valid: false, issues: violations };

  // `valid` is authoritative only when it is consistent with the issue list.
  if (raw.valid !== (issues.length === 0)) {
    return {
      valid: false,
      issues: [
        ...issues,
        {
          code: 'VALIDATOR_CONTRACT_VIOLATION',
          path: 'valid',
          message: `validator returned valid=${String(raw.valid)} with ${issues.length} issue(s); valid must be true iff issues is empty.`,
        },
      ],
    };
  }
  return { valid: issues.length === 0, issues };
}

function readPluginId(value) {
  if (!isPlainObject(value)) return null;
  if (!hasOwn(value, 'plugin') || !isPlainObject(value.plugin)) return null;
  const id = value.plugin.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readPluginVersion(value) {
  if (!isPlainObject(value)) return null;
  if (!hasOwn(value, 'plugin') || !isPlainObject(value.plugin)) return null;
  const version = value.plugin.version;
  return typeof version === 'string' ? version : null;
}

/** Read one capability list (`required` or `optional`) as plain strings. */
function readCapabilityList(value, key) {
  if (!isPlainObject(value)) return [];
  if (!hasOwn(value, 'capabilities') || !isPlainObject(value.capabilities)) return [];
  const list = value.capabilities[key];
  if (!Array.isArray(list)) return [];
  const names = [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.length > 0) names.push(entry);
  }
  return names;
}

/** Read every complete `[kind, name, scope]` resource tuple in a declaration. */
function readResources(value) {
  if (!isPlainObject(value) || !hasOwn(value, 'resources')) return [];
  const resources = value.resources;
  if (!Array.isArray(resources)) return [];
  const claims = [];
  for (const entry of resources) {
    if (!isPlainObject(entry)) continue;
    const { kind, name, scope } = entry;
    if (typeof kind !== 'string' || typeof name !== 'string' || typeof scope !== 'string') continue;
    claims.push({ kind, name, scope });
  }
  return claims;
}

function label(pluginIds) {
  return pluginIds.map((id) => JSON.stringify(id)).join(', ');
}

function limitation(code, message) {
  return { code, message };
}

/**
 * Deterministically analyze a batch of author declarations.
 *
 * @param {{ declarations: unknown[], availableCapabilities: string[] }} input
 *   The fixed input envelope. `declarations[i]` is a *raw declaration value*,
 *   handed to the validator unchanged — there is no wrapper object and no
 *   caller-supplied index. `availableCapabilities` is required and is the set
 *   of capability names the caller declares to be available.
 * @param {{ validateDeclaration: (value: unknown) => { valid: boolean, issues: Array<{ code: string, path: string, message: string }> } }} options
 *   The injected validator. Its provenance is the caller's responsibility:
 *   importing it is the only code this process runs besides this module.
 * @returns {object} A frozen report `{ evidenceLevel, findings, limitations, summary }`.
 * @throws {TypeError} For an unusable *input envelope* or *options* (not for an
 *   unusable declaration, which is reported as INVALID_DECLARATION).
 * @throws {Error} `ANALYZER_VALIDATOR_THREW` when the injected validator throws;
 *   the analysis never silently continues past a validator failure.
 */
export function analyze(input, options) {
  const validateDeclaration = readValidator(options);
  const { declarations, availableCapabilities } = readInput(input);
  return run(declarations, availableCapabilities, validateDeclaration);
}

function readValidator(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'analyze(input, options) requires an options object with { validateDeclaration }. No built-in validator is bundled: declaration validity belongs to dsh-compat-spec.',
    );
  }
  for (const key of ownKeys(options)) {
    if (key !== 'validateDeclaration') {
      throw new TypeError(
        `options has unexpected field ${JSON.stringify(key)}; expected only "validateDeclaration". The available capability set belongs to the input, not the options.`,
      );
    }
  }
  const validateDeclaration = options.validateDeclaration;
  if (typeof validateDeclaration !== 'function') {
    throw new TypeError(
      `options.validateDeclaration must be a function, got ${describeValue(validateDeclaration)}. The validator is not imported implicitly; inject it (for the CLI, pass --validator <path>).`,
    );
  }
  return validateDeclaration;
}

/**
 * Read and normalize the fixed input envelope. Only the envelope is strict: it
 * is the caller's own structure, and a malformed envelope would make the whole
 * run meaningless. Individual declarations stay untyped here so that a bad
 * declaration becomes a finding rather than an exception.
 *
 * @returns {{ declarations: unknown[], availableCapabilities: string[] }}
 *   `availableCapabilities` is deduplicated and sorted; `[]` is preserved as
 *   the explicit empty set.
 */
function readInput(input) {
  if (!isPlainObject(input)) {
    throw new TypeError(
      `analyze(input, options): input must be an object of the form { declarations, availableCapabilities }, got ${describeValue(input)}.`,
    );
  }
  for (const key of ownKeys(input)) {
    if (!INPUT_FIELDS.includes(key)) {
      throw new TypeError(
        `input has unexpected field ${JSON.stringify(key)}; expected only "declarations" and "availableCapabilities".`,
      );
    }
  }
  if (!hasOwn(input, 'declarations')) {
    throw new TypeError('input.declarations is required (an array of declaration values).');
  }
  if (!Array.isArray(input.declarations)) {
    throw new TypeError(
      `input.declarations must be an array, got ${describeValue(input.declarations)}.`,
    );
  }
  if (!hasOwn(input, 'availableCapabilities')) {
    throw new TypeError(
      'input.availableCapabilities is required. Pass an explicit array of the capability names that are available; pass [] to declare that none are available. Unknown availability is not a supported state.',
    );
  }
  return {
    declarations: input.declarations,
    availableCapabilities: normalizeAvailableCapabilities(input.availableCapabilities),
  };
}

/**
 * Validate the caller-declared available capability set.
 *
 * `[]` is an explicit empty set, not "unknown": every `required` capability is
 * then reported missing. Anything else that is not a non-empty-string array is
 * a caller bug and throws rather than being coerced into a meaning.
 */
function normalizeAvailableCapabilities(value) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `input.availableCapabilities must be an array of capability names, got ${describeValue(value)}. Pass [] to declare that no capability is available.`,
    );
  }
  const names = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== 'string') {
      throw new TypeError(
        `input.availableCapabilities[${index}] must be a string, got ${describeValue(entry)}.`,
      );
    }
    if (entry.trim() === '') {
      throw new TypeError(
        `input.availableCapabilities[${index}] must be a non-empty, trimmed capability name, got ${JSON.stringify(entry)}.`,
      );
    }
    if (entry !== entry.trim()) {
      throw new TypeError(
        `input.availableCapabilities[${index}] has leading or trailing whitespace: ${JSON.stringify(entry)}. Capability names are compared exactly.`,
      );
    }
    names.push(entry);
  }
  return [...new Set(names)].sort(compareStrings);
}

/**
 * @param {unknown[]} declarations Raw declaration values, in input order.
 * @param {string[]} availableCapabilities Sorted unique available names.
 * @param {Function} validateDeclaration
 */
function run(declarations, availableCapabilities, validateDeclaration) {
  const findings = [];
  const limitations = [];
  const available = new Set(availableCapabilities);

  /** Declarations the validator accepted, grouped by plugin id. */
  const accepted = new Map();

  const perDeclaration = [];
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index];
    const result = normalizeValidation(invokeValidator(validateDeclaration, declaration, index));

    if (!result.valid) {
      const issueNote = result.issues
        .map((issue) => `${formatPath(issue.path)}: ${issue.code}`)
        .join('; ');
      const contractBroken = result.issues.some((issue) => issue.code === 'VALIDATOR_CONTRACT_VIOLATION');
      const readableId = readPluginId(declaration);
      findings.push({
        code: FINDING_CODES.INVALID_DECLARATION,
        severity: 'error',
        pluginIds: readableId === null ? [] : [readableId],
        message: contractBroken
          ? `The injected validator did not honor the validation contract for the declaration at input index ${index} (${issueNote}); its validity is unknown and no evidence is derived from it.`
          : `The declaration at input index ${index} is not valid per the injected validator (${issueNote}); no evidence is derived from it.`,
      });
      perDeclaration.push({ index, pluginId: readableId, status: 'invalid' });
      continue;
    }

    const pluginId = readPluginId(declaration);
    if (pluginId === null) {
      // The validator accepted a declaration whose id this analyzer cannot read.
      // Nothing is invented for it: it is reported and the batch fails closed,
      // because capability coverage for an unattributed declaration is unknown.
      findings.push({
        code: FINDING_CODES.INVALID_DECLARATION,
        severity: 'error',
        pluginIds: [],
        message: `The declaration at input index ${index} was accepted by the injected validator but has no usable string plugin.id, so it cannot be attributed to any plugin.`,
      });
      perDeclaration.push({ index, pluginId: null, status: 'invalid' });
      continue;
    }

    if (!accepted.has(pluginId)) accepted.set(pluginId, []);
    accepted.get(pluginId).push(declaration);
    perDeclaration.push({ index, pluginId, status: 'valid' });
  }

  limitations.push(limitation(
    LIMITATION_CODES.NO_ACTIVATION_AUTHORITY,
    'This report is derived from author declarations only. It is not evidence that any host accepted, loaded, activated or ran a plugin, and no runtime health, behavior or cross-version compatibility is certified.',
  ));
  limitations.push(limitation(
    LIMITATION_CODES.MISSING_OBSERVATIONS_ARE_UNKNOWN,
    'An empty finding list means "no conflict is visible in these declarations", not "these plugins are compatible". Capability names the caller did not list, and resources no declaration mentions, remain unknown.',
  ));
  limitations.push(limitation(
    LIMITATION_CODES.SCOPE_LABEL_IS_NOT_CORDIS_SCOPE,
    'A resource scope is an explicit author-declared static label. It is not an observed Cordis scope, service namespace or isolation boundary, and the analyzer applies no host matching semantics to it: two claims conflict only when kind, name and scope are all exactly equal.',
  ));
  limitations.push(limitation(
    LIMITATION_CODES.VALIDATOR_DECIDES_DECLARATION_VALIDITY,
    'Declaration validity is decided entirely by the injected validator. This analyzer does not re-implement protocol validation rules; a different or outdated validator changes which declarations are trusted.',
  ));

  const blocked = findings.some((finding) => BLOCKING_CODES.has(finding.code));

  if (blocked) {
    limitations.push(limitation(
      LIMITATION_CODES.PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS,
      'At least one declaration was rejected or could not be attributed, so no plugin-id, resource or capability evidence was derived from this batch. An invalid declaration is never treated as declaring nothing.',
    ));
  } else {
    const orderedIds = [...accepted.keys()].sort(compareStrings);
    deriveDuplicatePluginIds(orderedIds, accepted, findings);
    deriveResourceConflicts(orderedIds, accepted, findings);
    deriveMissingCapabilities(orderedIds, accepted, available, findings);
  }

  findings.sort(compareFindings);

  const rank = new Map(LIMITATION_ORDER.map((code, index) => [code, index]));
  limitations.sort((left, right) => rank.get(left.code) - rank.get(right.code));

  const statusCounts = { valid: 0, invalid: 0 };
  for (const entry of perDeclaration) statusCounts[entry.status] += 1;

  return Object.freeze({
    evidenceLevel: EVIDENCE_LEVEL,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    limitations: Object.freeze(limitations.map((entry) => Object.freeze(entry))),
    summary: Object.freeze({
      reportVersion: REPORT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      declarations: Object.freeze({
        total: declarations.length,
        valid: statusCounts.valid,
        invalid: statusCounts.invalid,
      }),
      availableCapabilities: availableCapabilities.length,
      analysisComplete: !blocked,
    }),
  });
}

/**
 * One comparison per distinct resource claim. Claims are grouped by the
 * complete tuple `[kind, name, scope]`: two plugins asserting the same kind and
 * name under *different* scopes do not assert the same claim, so they are not a
 * conflict. Reusing a claim inside a single plugin is never a cross-plugin
 * conflict either.
 */
function deriveResourceConflicts(orderedIds, accepted, findings) {
  const claims = new Map(); // resourceKey -> { kind, name, scope, owners: string[] }
  for (const pluginId of orderedIds) {
    const seenForPlugin = new Set();
    for (const declaration of accepted.get(pluginId)) {
      for (const claim of readResources(declaration)) {
        const key = resourceKey(claim);
        if (seenForPlugin.has(key)) continue;
        seenForPlugin.add(key);
        if (!claims.has(key)) claims.set(key, { ...claim, owners: [] });
        claims.get(key).owners.push(pluginId);
      }
    }
  }

  const ordered = [...claims.entries()].sort((left, right) => compareStrings(left[0], right[0]));
  for (const [, claim] of ordered) {
    const pluginIds = [...claim.owners].sort(compareStrings);
    if (pluginIds.length < 2) continue;
    findings.push({
      code: FINDING_CODES.RESOURCE_CONFLICT,
      severity: 'warning',
      pluginIds,
      resource: { kind: claim.kind, name: claim.name, scope: claim.scope },
      message: `Plugins ${label(pluginIds)} all declare the same resource tuple kind=${JSON.stringify(claim.kind)} name=${JSON.stringify(claim.name)} scope=${JSON.stringify(claim.scope)}. This is a static declaration overlap, not an observed duplicate registration; no host has been asked whether it would accept both.`,
    });
  }
}

function deriveDuplicatePluginIds(orderedIds, accepted, findings) {
  for (const pluginId of orderedIds) {
    const declarations = accepted.get(pluginId);
    if (declarations.length < 2) continue;
    const versions = [
      ...new Set(declarations.map((declaration) => readPluginVersion(declaration)).filter((version) => version !== null)),
    ].sort(compareStrings);
    const versionNote =
      versions.length > 0
        ? ` with version(s) ${versions.map((version) => JSON.stringify(version)).join(', ')}`
        : '';
    findings.push({
      code: FINDING_CODES.DUPLICATE_PLUGIN_ID,
      severity: 'error',
      pluginIds: [pluginId],
      message: `Plugin id ${JSON.stringify(pluginId)} is declared ${declarations.length} times${versionNote}. Static analysis cannot decide which declaration is authoritative.`,
    });
  }
}

/**
 * A `required` capability is a requirement, never a provider claim. Absence from
 * the caller-declared available set — including the explicit empty set — is an
 * error naming only the requesting plugins. `optional` capabilities are never
 * reported: an absent optional capability is the fallback the declaration
 * already anticipates.
 */
function deriveMissingCapabilities(orderedIds, accepted, available, findings) {
  const missing = new Map(); // capability -> Set<pluginId>
  for (const pluginId of orderedIds) {
    for (const declaration of accepted.get(pluginId)) {
      for (const name of readCapabilityList(declaration, 'required')) {
        if (available.has(name)) continue;
        if (!missing.has(name)) missing.set(name, new Set());
        missing.get(name).add(pluginId);
      }
    }
  }
  for (const name of [...missing.keys()].sort(compareStrings)) {
    const pluginIds = [...missing.get(name)].sort(compareStrings);
    findings.push({
      code: FINDING_CODES.MISSING_CAPABILITY,
      severity: 'error',
      pluginIds,
      message: `Required capability ${JSON.stringify(name)} is absent from the caller-supplied availableCapabilities set for ${label(pluginIds)}. That set is caller-supplied: if it is incomplete, this finding over-states the problem rather than under-stating it.`,
    });
  }
}

function invokeValidator(validateDeclaration, declaration, index) {
  try {
    return validateDeclaration(declaration);
  } catch (error) {
    const failure = new Error(
      `The injected validator threw while validating the declaration at input index ${index}: ${describeThrown(error)}`,
    );
    failure.name = 'AnalyzerValidatorError';
    failure.code = 'ANALYZER_VALIDATOR_THREW';
    failure.declarationIndex = index;
    throw failure;
  }
}
