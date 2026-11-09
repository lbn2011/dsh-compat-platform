// Type declarations for the configuration checker.

export type ConfigCheckSchemaStatus = 'checked' | 'not-checked' | 'refused';

export interface ConfigCheckCounts {
  readonly checked: number;
  readonly invalid: number;
  readonly findings: number;
  readonly findingsTruncated: boolean;
}

export interface ConfigExpectation {
  readonly type?: string;
  readonly types?: readonly string[];
  readonly format?: string;
  readonly enumSize?: number;
  readonly acceptsSingleValue?: boolean;
  readonly requiredCount?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minProperties?: number;
  readonly maxProperties?: number;
  readonly hasPattern?: boolean;
  readonly propertyCount?: number;
}

export interface ConfigCheckFinding {
  /** `config.a.b[2]` — a key path, never a value. */
  readonly path: string;
  readonly keyword: string;
  readonly expected: ConfigExpectation;
}

export interface ConfigCheckSummary {
  readonly configCheckSummary: 'config-check-summary/0.1-draft.1';
  readonly entryLabel: string | null;
  readonly schemaStatus: ConfigCheckSchemaStatus;
  readonly valid?: boolean;
  readonly refusal?: string;
  readonly notCheckedReason?: string;
  readonly notCheckedKeyword?: string;
  readonly findings: readonly ConfigCheckFinding[];
  readonly counts: ConfigCheckCounts;
  readonly certification: false;
  readonly notDerived: readonly string[];
  readonly limitations: readonly string[];
}

export interface ConfigCheckEngine {
  check(input: { schema: unknown; instance: unknown }): Promise<{
    valid: boolean;
    errors: readonly { keyword?: string; instancePath?: readonly (string | number)[]; keywordPath?: readonly (string | number)[] }[];
  }>;
}

export const CONFIG_CHECK_SUMMARY: 'config-check-summary/0.1-draft.1';
export const LITERAL_KEYWORDS: readonly string[];
export const IDENTIFIER_KEYS: readonly string[];
export const CONFIG_CHECK_REFUSALS: Readonly<Record<string, string>>;
export const CONFIG_CHECK_NOT_CHECKED: Readonly<Record<string, string>>;
export const CONFIG_CHECK_LIMITATIONS: readonly string[];
export const CONFIG_CHECK_NOT_DERIVED: readonly string[];
export const CONFIG_CHECK_EXIT: Readonly<{ VALID: 0; INVALID: 1; NOT_CHECKED: 2; INTERNAL: 5; USAGE: 64 }>;

export function findAffectedLiteral(schema: unknown): { found: boolean; keyword?: string; identifier?: string };
export function resolveKeywordPath(schema: unknown, path: readonly (string | number)[]): unknown;
export function summarizeExpectation(node: unknown): ConfigExpectation;
export function renderPath(path: readonly (string | number)[]): string;
export function checkConfiguration(input: {
  schema: unknown;
  instance: unknown;
  engine: ConfigCheckEngine;
  entryLabel?: string | null;
}): Promise<ConfigCheckSummary>;
export function configCheckExitCode(result: ConfigCheckSummary): 0 | 1 | 2;
