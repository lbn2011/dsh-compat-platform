/**
 * dsh-compat-platform — public types.
 *
 * The declaration analyzer in §1 only *reads author declarations*. It never
 * imports a plugin, evaluates configuration, reads the DSH profile or writes
 * files. §2 below additionally re-exports the admission diagnostics layer, which
 * is a presentation surface over a validator's return value and is never merged
 * with the declaration analysis.
 *
 * @packageDocumentation
 */

/** Protocol revision this analyzer is written against (informational). */
export declare const PROTOCOL_VERSION: '0.1.0-draft.1';

/** The only evidence level this release can produce. */
export declare const EVIDENCE_LEVEL: 'static-declaration';

/** Report format version. */
export declare const REPORT_VERSION: '0.1.0-draft.1';

export type FindingCode =
  | 'INVALID_DECLARATION'
  | 'DUPLICATE_PLUGIN_ID'
  | 'RESOURCE_CONFLICT'
  | 'MISSING_CAPABILITY';

export type LimitationCode =
  | 'NO_ACTIVATION_AUTHORITY'
  | 'MISSING_OBSERVATIONS_ARE_UNKNOWN'
  | 'SCOPE_LABEL_IS_NOT_CORDIS_SCOPE'
  | 'VALIDATOR_DECIDES_DECLARATION_VALIDITY'
  | 'PARTIAL_EVIDENCE_UNDER_INVALID_DECLARATIONS';

export type Severity = 'error' | 'warning' | 'info';

export declare const FINDING_CODES: Readonly<Record<string, FindingCode>>;
export declare const LIMITATION_CODES: Readonly<Record<string, LimitationCode>>;

export declare const EXIT_CODES: Readonly<{
  OK: 0;
  FINDINGS: 1;
  MANIFEST_INVALID: 2;
  USAGE: 3;
  VALIDATOR_FAILED: 4;
  INTERNAL: 5;
}>;

/**
 * The fixed analysis input. No other field is accepted, and
 * `availableCapabilities` is **required** — there is no "unknown availability"
 * state an omitted field could express.
 */
export interface AnalyzeInput {
  /**
   * Raw declaration values, in the protocol's fixed shape. Each element is
   * handed to the injected validator **unchanged**: no `{ value }` wrapper and
   * no caller-supplied index exists at this layer.
   */
  declarations: unknown[];
  /**
   * The capability names the caller declares to be available.
   *
   * - Every entry must be a non-empty, already-trimmed string; a non-array, a
   *   non-string entry, an empty/whitespace-only entry or a non-trimmed entry
   *   throws `TypeError`.
   * - `[]` is an **explicit empty set**: every `required` capability in every
   *   declaration is then reported as missing.
   * - The list is deduplicated and sorted internally; order is not significant.
   */
  availableCapabilities: string[];
}

/** A validator supplied by the caller, e.g. `validateDeclaration` from dsh-compat-spec. */
export interface DeclarationValidator {
  (value: unknown): {
    valid: boolean;
    issues: Array<{ code: string; path: string; message: string }>;
  };
}

/** Options are exactly one field: the injected validator. */
export interface AnalyzeOptions {
  /** Injected validator. Never imported implicitly, never defaulted, never wrapped. */
  validateDeclaration: DeclarationValidator;
}

/** A complete resource claim. Two claims conflict only when all three fields are equal. */
export interface ResourceRef {
  /** `tool` or `service`, as declared. */
  kind: string;
  name: string;
  /**
   * The author's own static label. It is an arbitrary non-empty string — never
   * a closed enum and never an observed Cordis scope.
   */
  scope: string;
}

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** Plugins the finding is attributed to; empty when it cannot be attributed. */
  pluginIds: string[];
  /** Present only on `RESOURCE_CONFLICT`; always carries `scope`. */
  resource?: ResourceRef;
  message: string;
}

export interface Limitation {
  code: LimitationCode;
  message: string;
}

export interface AnalysisSummary {
  reportVersion: string;
  protocolVersion: string;
  declarations: { total: number; valid: number; invalid: number };
  /** Size of the explicit available capability set. Never null: the set is always declared. */
  availableCapabilities: number;
  /** False when analysis failed closed (an invalid declaration blocked derivation). */
  analysisComplete: boolean;
}

export interface AnalysisReport {
  evidenceLevel: 'static-declaration';
  findings: Finding[];
  limitations: Limitation[];
  summary: AnalysisSummary;
}

export interface AnalyzerError extends Error {
  code: 'ANALYZER_VALIDATOR_THREW';
  /** Position of the offending declaration in `input.declarations`. */
  declarationIndex: number;
}

/**
 * Analyze declarations. Throws `TypeError` for an unusable input envelope
 * (including a missing or malformed `availableCapabilities`), for an options
 * object with any field other than `validateDeclaration`, and when no validator
 * is injected. Throws an error with `code: 'ANALYZER_VALIDATOR_THREW'` when the
 * injected validator throws (fail closed).
 */
export declare function analyze(input: AnalyzeInput, options: AnalyzeOptions): AnalysisReport;

export declare function formatReportJson(report: AnalysisReport): string;

export declare function exitCodeFor(report: AnalysisReport): 0 | 1;

/**
 * §2 — Admission diagnostics.
 *
 * A presentation layer over the **return value** of an injected canonical
 * admission validator: findings for `failed`, `refused` and `not-run` cases plus
 * `coverage.unknown`, with `certification` always `false`. The validator is
 * injected, never imported; the protocol keeps the grammar, the catalog and the
 * issue vocabulary. Nothing here changes the declaration analysis above.
 */
export {
  diagnoseAdmissionEvidence,
  DIAGNOSTIC_CODES,
  WRAPPER_ISSUE_CODES,
} from './admission-diagnostics.js';

export type {
  AdmissionCaseStatus,
  DiagnosticCode,
  WrapperIssueCode,
  ProtocolIssue,
  WrapperIssue,
  AdmissionCasePortion,
  AdmissionCoveragePortion,
  AdmissionSummary,
  AdmissionCaseFinding,
  AdmissionCoverageFinding,
  AdmissionFinding,
  AdmissionDiagnosticsValid,
  AdmissionDiagnosticsInvalid,
  AdmissionDiagnostics,
  AdmissionEvidenceValidator,
} from './admission-diagnostics.js';
