/** Format identifier of the profile-dump summary document. */
export const PROFILE_DUMP_SCHEMA: 'profile-dump-summary/0.3-draft.1';

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
  readonly maxRows: 64;
};

/**
 * Things this summary does not establish. Copied verbatim from the profile-export observation
 * record (`NOT_DERIVED`), because the reasons are identical: a row is not a declaration, and an
 * absent row is ambiguous between "not configured" and "bundle skipped".
 */
export const PROFILE_DUMP_NOT_DERIVED: readonly [
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
];

/**
 * Fixed limitation codes, shaped like `COMBINED_REPORT_LIMITATIONS`: statements about this
 * artifact's envelope rather than about any particular document.
 */
export const PROFILE_DUMP_DISCLOSURE_LIMITATIONS: readonly string[];
export const PROFILE_DUMP_LIMITATIONS: readonly string[];

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

/**
 * One row: position, line and closed-vocabulary shape facts only.
 *
 * A row is **not** a declaration. It carries no id, name, config key or config value — the key
 * names in the source are compared against the five modelled names and never copied — so it can
 * answer "what does this row look like" and never "what will this profile load".
 *
 * The `group`/`disabled` distinction between `'false'`, `'null'` and `'other'`, and the `config`
 * distinction between `'absent'` and `'not-mapping'`, are deliberate: collapsing them would make a
 * legal form, a setting and a typo indistinguishable. `null` is its own word because
 * `EntryOptions` declares both fields as `boolean | null` (`vendor/loader/src/config/entry.ts`).
 */
export interface ProfileDumpRow {
  /** 1-based position in the root sequence. */
  index: number;
  /** 1-based line the row starts on, or `null` when the node carries no position. */
  line: number | null;
  /** Number of keys in the row mapping, modelled or not. */
  keyCount: number;
  idKind: 'absent' | 'string' | 'non-string';
  nameKind: 'absent' | 'string' | 'non-string';
  group: 'absent' | 'true' | 'false' | 'null' | 'other';
  disabled: 'absent' | 'true' | 'false' | 'null' | 'other';
  config: 'absent' | 'mapping' | 'not-mapping';
  /** Keys inside `config` when it is a mapping; `null` otherwise. Names are never emitted. */
  configKeyCount: number | null;
  /** Keys outside the modelled set. Counted only; `plugin.id` inside `config` is not a pointer. */
  unmodelledKeyCount: number;
  /**
   * The row's literal `id` text, or `null`. `null` means either "absent / not a literal string"
   * or "this summary was not asked for disclosure" — read `identityDisclosed` to tell which.
   * This is operator text from the dump, not a resolved package identity and not a version.
   */
  id: string | null;
  /** The row's literal `name` text, or `null`; same caveats as `id`. Never a config value. */
  name: string | null;
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
  /**
   * Whether this summary was produced with `{ discloseIdentity: true }`. When false, every row's
   * `id`/`name` is `null` and the disclosure limitations are absent from `limitations`.
   */
  identityDisclosed: boolean;
  counts: ProfileDumpCounts | null;
  /**
   * A capped display window over `counts.entries`, `null` wherever `counts` is `null` (a refused
   * document has no inventory to window over). Never an inventory: `rowsTruncated` says the
   * window is short, and `counts.entries` stays authoritative.
   */
  rows: ProfileDumpRow[] | null;
  rowsTruncated: boolean;
  limits: {
    maxBytes: number;
    maxLines: number;
    maxDepth: number;
    maxNodes: number;
    maxEntries: number;
    maxDiagnostics: number;
    maxRows: number;
  };
  diagnostics: ProfileDumpDiagnostic[];
  diagnosticsTruncated: boolean;
  completeness: 'unknown';
  runtimeValidation: 'not-performed';
  certification: false;
  /** The five names from `NOT_DERIVED`, verbatim. A per-summary copy, safe to adapt. */
  notDerived: string[];
  /** Fixed limitation codes, copied per summary. */
  limitations: string[];
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
export function summarizeProfileDumpText(
  text: string,
  options?: { discloseIdentity?: boolean },
): ProfileDumpResult;

/** Exit code implied by a result: 0, 1 or 2. */
export function profileDumpExitCode(result: ProfileDumpResult): number;
