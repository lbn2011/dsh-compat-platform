// Type declarations for the engine adapter.

export type FormatAssertion = 'asserted' | 'not-asserted';

export interface EngineError {
  keyword: string;
  instancePath: readonly (string | number)[];
  keywordPath: readonly (string | number)[];
}

export interface ConfigCheckEngine {
  readonly formatAssertion?: FormatAssertion;
  check(input: { schema: unknown; instance: unknown }): Promise<{
    valid: boolean;
    errors: readonly EngineError[];
  }>;
}

export function shortKeyword(uri: unknown): string;
export function pointerTokens(location: unknown): readonly string[];
export function mapError(error: unknown): EngineError;
export function engineFromModule(
  moduleNamespace: unknown,
  options?: { formatsNamespace?: unknown },
): ConfigCheckEngine;
export function createEngine(options?: {
  loadModule?: (specifier: string) => Promise<unknown>;
  specifier?: string;
  formatsSpecifier?: string;
}): Promise<ConfigCheckEngine>;
