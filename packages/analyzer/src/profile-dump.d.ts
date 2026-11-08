/** Format identifier of the profile-dump summary document. */
export const PROFILE_DUMP_SCHEMA: 'profile-dump-summary/0.1-draft.1';

/**
 * Fixed limits. These are policy limits on the **input** and on the walk this command performs;
 * they are not a claim about the parser's own memory or CPU cost.
 *
 * `maxBytes` and `maxLines` act before parsing, the rest act during the walk. None of them is
 * configurable at runtime.
 */
export const PROFILE_DUMP_LIMITS: {
  readonly maxBytes: 1048576;
  readonly maxLines: 20000;
  readonly maxDepth: 32;
  readonly maxNodes: 20000;
  readonly maxEntries: 5000;
  readonly maxDiagnostics: 64;
};

/** Every diagnostic code this module can emit. Closed set. */
export const PROFILE_DUMP_CODES: {
  readonly EMPTY_INPUT: 'EMPTY_INPUT';
  readonly EMPTY_INVENTORY: 'EMPTY_INVENTORY';
  readonly JS_EXPRESSION_NOT_EVALUATED: 'JS_EXPRESSION_NOT_EVALUATED';
  readonly ENTRY_ID_NOT_STRING: 'ENTRY_ID_NOT_STRING';
  readonly ENTRY_NAME_NOT_STRING: 'ENTRY_NAME_NOT_STRING';
  readonly DUPLICATE_ID: 'DUPLICATE_ID';
  readonly INPUT_OPEN_FAILED: 'INPUT_OPEN_FAILED';
  readonly INPUT_STAT_FAILED: 'INPUT_STAT_FAILED';
  readonly INPUT_READ_FAILED: 'INPUT_READ_FAILED';
  readonly INPUT_NOT_REGULAR: 'INPUT_NOT_REGULAR';
  readonly INPUT_NOT_UTF8: 'INPUT_NOT_UTF8';
  readonly INPUT_TOO_LARGE: 'INPUT_TOO_LARGE';
  readonly INPUT_TOO_MANY_LINES: 'INPUT_TOO_MANY_LINES';
  readonly MULTI_DOCUMENT: 'MULTI_DOCUMENT';
  readonly PARSE_ERROR: 'PARSE_ERROR';
  readonly UNEXPECTED_WARNING: 'UNEXPECTED_WARNING';
  readonly RESOURCE_EXHAUSTION_UNCAUGHT: 'RESOURCE_EXHAUSTION_UNCAUGHT';
  readonly ROOT_NOT_SEQUENCE: 'ROOT_NOT_SEQUENCE';
  readonly ENTRY_NOT_MAPPING: 'ENTRY_NOT_MAPPING';
  readonly UNSUPPORTED_TAG: 'UNSUPPORTED_TAG';
  readonly TAG_KEY_PRESENT: 'TAG_KEY_PRESENT';
  readonly ALIAS_PRESENT: 'ALIAS_PRESENT';
  readonly ANCHOR_PRESENT: 'ANCHOR_PRESENT';
  readonly MERGE_KEY: 'MERGE_KEY';
  readonly DEPTH_LIMIT: 'DEPTH_LIMIT';
  readonly NODE_LIMIT: 'NODE_LIMIT';
  readonly ENTRY_LIMIT: 'ENTRY_LIMIT';
  readonly USAGE: 'USAGE';
  readonly INTERNAL: 'INTERNAL';
};

/** Any fixed code this module can emit. */
export type ProfileDumpCode = (typeof PROFILE_DUMP_CODES)[keyof typeof PROFILE_DUMP_CODES];

/** Exit codes for the `dsh-compat-profile-dump` command. */
export const PROFILE_DUMP_EXIT: {
  readonly OK: 0;
  readonly ENTRY_DIAGNOSTICS: 1;
  readonly UNUSABLE: 2;
  readonly INTERNAL: 5;
  readonly USAGE: 64;
};

/** Codes that always mean "unusable". */
export const PROFILE_DUMP_REFUSAL_CODES: ReadonlySet<string>;

/**
 * The closed vocabulary of `detail` values.
 *
 * Tag details are **classes**, never the tag itself: an operator's `!SECRET_TAG` or
 * `!<https://internal.example/key>` is document content and is never copied out. Warning
 * details are likewise a fixed pair of words rather than the library's code. Parse-error
 * details follow the same rule: `DUPLICATE_KEY` is the one parser code this contract names,
 * and every other parse failure collapses to `PARSE_FAILURE` rather than publishing the
 * parser's internal enumeration.
 */
export type ProfileDumpDetail =
  | 'JS_COLLECTION'
  | 'CORE_NOT_ALLOWED'
  | 'EXTERNAL'
  | 'UNRESOLVED_TAG'
  | 'OTHER_WARNING'
  | 'DUPLICATE_KEY'
  | 'PARSE_FAILURE';

/** One diagnostic. `code` and `detail` come from closed sets; no document text is included. */
export interface ProfileDumpDiagnostic {
  readonly ordinal: number | null;
  readonly code: ProfileDumpCode;
  readonly line: number | null;
  readonly detail: ProfileDumpDetail | null;
}

/** Counts only. No identifier, name, key or value is ever included. */
export interface ProfileDumpCounts {
  entries: number;
  entryGroups: number;
  entriesWithId: number;
  entriesWithName: number;
  entriesWithConfig: number;
  entriesDisabled: number;
  jsScalars: number;
  distinctTags: number;
  nodes: number;
  scalars: number;
  maxDepth: number;
}

/** The summary document written to stdout. */
export interface ProfileDumpSummary {
  profileDumpSummary: string;
  /**
   * Measured by this module from the decoded text, or `null` when no document was read at all
   * (usage error, read failure). Never supplied by a caller.
   */
  input: { bytes: number; lines: number } | null;
  documents: number;
  inventory: 'present' | 'empty' | 'none';
  root: string;
  counts: ProfileDumpCounts | null;
  limits: {
    maxBytes: number;
    maxLines: number;
    maxDepth: number;
    maxNodes: number;
    maxEntries: number;
    maxDiagnostics: number;
  };
  diagnostics: ProfileDumpDiagnostic[];
  diagnosticsTruncated: boolean;
  completeness: 'unknown';
  runtimeValidation: 'not-performed';
  certification: false;
}

/**
 * The result of one summarization attempt.
 *
 * `entryDiagnostics` counts entry-level problems found, including any that did not fit in the
 * capped `diagnostics` list; the exit code is derived from it, never from the list.
 */
export interface ProfileDumpResult {
  ok: boolean;
  entryDiagnostics: number;
  summary: ProfileDumpSummary;
}

/**
 * Summarize one `dsh --dump-config` export. Never evaluates `!!js`, never resolves aliases
 * or merge keys, and never copies document content into the result.
 *
 * @throws {TypeError} When `text` is not a string. The message is fixed and never echoes the
 *   argument.
 */
export function summarizeProfileDumpText(text: string): ProfileDumpResult;

/** Exit code implied by a result: 0, 1 or 2. */
export function profileDumpExitCode(result: ProfileDumpResult): number;
