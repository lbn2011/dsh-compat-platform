/**
 * Type declarations for `dependency-shape.js`.
 *
 * The summary is a closed set of counts and fixed words. No user text appears anywhere in it:
 * that is a property of the shape, not a convention, so none of these types has a field that
 * could carry an id, a name, a service name, a key or a value.
 */

/** Format identifier of the summary document. */
export declare const DEPENDENCY_SHAPE_SCHEMA: 'dependency-shape-summary/0.1-draft.1';

/** Fixed limits, identical to the ones `profile-dump` applies to the same kind of input. */
export declare const DEPENDENCY_SHAPE_LIMITS: Readonly<{
  maxBytes: 1048576;
  maxLines: 20000;
  maxDepth: 32;
  maxNodes: 20000;
  maxEntries: 5000;
  maxDiagnostics: 64;
}>;

/**
 * Facts this artifact does not establish: the five names carried by every accepted profile-export
 * observation, plus this artifact's own `dependencyResolution`.
 */
export declare const DEPENDENCY_SHAPE_NOT_DERIVED: readonly [
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
];

/** Fixed limitation codes describing this artifact's envelope. */
export declare const DEPENDENCY_SHAPE_LIMITATIONS: readonly [
  'DEPENDENCY_SHAPE_IS_NOT_RESOLUTION',
  'INJECT_ITEM_NAMES_NOT_EMITTED',
  'NO_ROW_WINDOW_IN_THIS_SUMMARY',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'NO_DEPENDENCY_CLOSURE_ESTABLISHED',
  'NO_LOADABILITY_OR_ACTIVATION_OBSERVED',
  'CONFIG_VALUES_NOT_INSPECTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
];

/** Closed diagnostic code set. */
export declare const DEPENDENCY_SHAPE_CODES: Readonly<{
  EMPTY_INPUT: 'EMPTY_INPUT';
  EMPTY_INVENTORY: 'EMPTY_INVENTORY';
  JS_EXPRESSION_NOT_EVALUATED: 'JS_EXPRESSION_NOT_EVALUATED';
  INJECT_SHAPE_NOT_MODELLED: 'INJECT_SHAPE_NOT_MODELLED';
  INJECT_ITEM_NOT_A_NAME: 'INJECT_ITEM_NOT_A_NAME';
  INPUT_OPEN_FAILED: 'INPUT_OPEN_FAILED';
  INPUT_STAT_FAILED: 'INPUT_STAT_FAILED';
  INPUT_READ_FAILED: 'INPUT_READ_FAILED';
  INPUT_NOT_REGULAR: 'INPUT_NOT_REGULAR';
  INPUT_NOT_UTF8: 'INPUT_NOT_UTF8';
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE';
  INPUT_TOO_MANY_LINES: 'INPUT_TOO_MANY_LINES';
  MULTI_DOCUMENT: 'MULTI_DOCUMENT';
  PARSE_ERROR: 'PARSE_ERROR';
  UNEXPECTED_WARNING: 'UNEXPECTED_WARNING';
  RESOURCE_EXHAUSTION_UNCAUGHT: 'RESOURCE_EXHAUSTION_UNCAUGHT';
  ROOT_NOT_SEQUENCE: 'ROOT_NOT_SEQUENCE';
  ENTRY_NOT_MAPPING: 'ENTRY_NOT_MAPPING';
  UNSUPPORTED_TAG: 'UNSUPPORTED_TAG';
  TAG_KEY_PRESENT: 'TAG_KEY_PRESENT';
  ALIAS_PRESENT: 'ALIAS_PRESENT';
  ANCHOR_PRESENT: 'ANCHOR_PRESENT';
  MERGE_KEY: 'MERGE_KEY';
  DEPTH_LIMIT: 'DEPTH_LIMIT';
  NODE_LIMIT: 'NODE_LIMIT';
  ENTRY_LIMIT: 'ENTRY_LIMIT';
  USAGE: 'USAGE';
  INTERNAL: 'INTERNAL';
}>;

/** Exit codes. `1` (entry-level) and `2` (unusable) mean different things on purpose. */
export declare const DEPENDENCY_SHAPE_EXIT: Readonly<{
  OK: 0;
  ENTRY_DIAGNOSTICS: 1;
  UNUSABLE: 2;
  INTERNAL: 5;
  USAGE: 64;
}>;

/** The five `inject` shapes this reader tells apart. */
export declare const INJECT_KIND: Readonly<{
  ABSENT: 'absent';
  NULL: 'null';
  SEQUENCE: 'sequence';
  MAPPING: 'mapping';
  OTHER: 'other';
}>;

/** One diagnostic. `detail` is a fixed word or null, never document text. */
export interface DependencyShapeDiagnostic {
  ordinal: number | null;
  code: string;
  line: number | null;
  detail: string | null;
}

/**
 * The counters.
 *
 * Two invariants hold on every present/empty inventory and are asserted by the tests and the
 * replay verifier:
 *
 *   rowsWithInject === injectNull + injectSequence + injectMapping + injectOther
 *   injectSequenceItems === injectNames + injectTaggedItems + injectNonScalarItems
 */
export interface DependencyShapeCounts {
  rows: number;
  rowsWithInject: number;
  injectAbsent: number;
  injectNull: number;
  injectSequence: number;
  injectMapping: number;
  injectOther: number;
  injectSequenceItems: number;
  injectNames: number;
  injectTaggedItems: number;
  injectNonScalarItems: number;
  injectMappingKeys: number;
  injectEmptyMappings: number;
  jsScalars: number;
  distinctTags: number;
  nodes: number;
  scalars: number;
  maxDepth: number;
}

/** The summary document. */
export interface DependencyShapeSummary {
  dependencyShapeSummary: typeof DEPENDENCY_SHAPE_SCHEMA;
  input: { bytes: number; lines: number } | null;
  documents: number;
  inventory: 'present' | 'empty' | 'none';
  root: 'sequence' | 'mapping' | 'scalar' | 'alias' | 'other' | 'null' | 'unknown';
  counts: DependencyShapeCounts | null;
  limits: typeof DEPENDENCY_SHAPE_LIMITS;
  diagnostics: DependencyShapeDiagnostic[];
  diagnosticsTruncated: boolean;
  /** Always `unknown`: a dump cannot establish that the row set is complete. */
  completeness: 'unknown';
  /** Always `not-performed`: nothing here runs a plugin or a host. */
  runtimeValidation: 'not-performed';
  /** Always `false`. */
  certification: false;
  notDerived: typeof DEPENDENCY_SHAPE_NOT_DERIVED;
  limitations: typeof DEPENDENCY_SHAPE_LIMITATIONS;
}

/** Result of one summarisation. */
export interface DependencyShapeResult {
  ok: boolean;
  entryDiagnostics: number;
  summary: DependencyShapeSummary;
}

/**
 * Describe the `inject` declarations in one dump document.
 * @throws TypeError when `text` is not a string (fixed message, argument never echoed).
 */
export declare function summarizeDependencyShapeText(text: string): DependencyShapeResult;

/** Exit code implied by a summary. */
export declare function dependencyShapeExitCode(result: DependencyShapeResult): number;

/** Codes that always mean "unusable". */
export declare const DEPENDENCY_SHAPE_REFUSAL_CODES: readonly string[];
