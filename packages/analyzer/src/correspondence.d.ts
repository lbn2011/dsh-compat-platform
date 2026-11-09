/**
 * Type declarations for `correspondence.js`.
 *
 * The summary is a closed set of numbers, positions, fixed words and two digests. No identity
 * text appears anywhere in it: that is a property of the shape, not a convention, so none of
 * these types has a field that could carry an entry id, a plugin id, a note, a path, a key or a
 * value.
 */

/** Format identifier of the artifact this module verifies. */
export declare const CORRESPONDENCE_VERSION: 'profile-correspondence/0.1-draft.1';

/** Format identifier of the summary document. */
export declare const CORRESPONDENCE_SUMMARY: 'correspondence-summary/0.1-draft.1';

/** Exit codes for the command. */
export declare const CORRESPONDENCE_EXIT: Readonly<{
  OK: 0;
  FINDINGS: 1;
  REFUSED: 2;
  INTERNAL: 5;
  USAGE: 64;
}>;

/** Closed code set: every condition this module can report, and nothing else. */
export declare const CORRESPONDENCE_CODES: Readonly<{
  CORRESPONDENCE_NOT_AN_OBJECT: 'CORRESPONDENCE_NOT_AN_OBJECT';
  CORRESPONDENCE_UNEXPECTED_KEY: 'CORRESPONDENCE_UNEXPECTED_KEY';
  CORRESPONDENCE_MISSING_KEY: 'CORRESPONDENCE_MISSING_KEY';
  CORRESPONDENCE_VERSION_INVALID: 'CORRESPONDENCE_VERSION_INVALID';
  CORRESPONDENCE_BINDING_INVALID: 'CORRESPONDENCE_BINDING_INVALID';
  CORRESPONDENCE_PAIRS_EMPTY: 'CORRESPONDENCE_PAIRS_EMPTY';
  CORRESPONDENCE_PAIR_NOT_AN_OBJECT: 'CORRESPONDENCE_PAIR_NOT_AN_OBJECT';
  CORRESPONDENCE_PAIR_KEY_INVALID: 'CORRESPONDENCE_PAIR_KEY_INVALID';
  CORRESPONDENCE_ID_NOT_A_LABEL: 'CORRESPONDENCE_ID_NOT_A_LABEL';
  CORRESPONDENCE_ID_DUPLICATED: 'CORRESPONDENCE_ID_DUPLICATED';
  CORRESPONDENCE_STALE: 'CORRESPONDENCE_STALE';
  CORRESPONDENCE_PROFILE_UNREADABLE: 'CORRESPONDENCE_PROFILE_UNREADABLE';
  CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH: 'CORRESPONDENCE_PROFILE_ROW_COUNT_MISMATCH';
  CORRESPONDENCE_ENTRY_NOT_FOUND: 'CORRESPONDENCE_ENTRY_NOT_FOUND';
  CORRESPONDENCE_ENTRY_AMBIGUOUS: 'CORRESPONDENCE_ENTRY_AMBIGUOUS';
  CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT: 'CORRESPONDENCE_DECLARATION_NOT_AN_OBJECT';
  CORRESPONDENCE_PLUGIN_NOT_DECLARED: 'CORRESPONDENCE_PLUGIN_NOT_DECLARED';
  CORRESPONDENCE_DUPLICATE_PLUGIN_ID: 'CORRESPONDENCE_DUPLICATE_PLUGIN_ID';
  CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES: 'CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES';
  CORRESPONDENCE_INTERNAL: 'CORRESPONDENCE_INTERNAL';
}>;

/** Every code value, as a union. */
export type CorrespondenceCode = (typeof CORRESPONDENCE_CODES)[keyof typeof CORRESPONDENCE_CODES];

/**
 * Facts this artifact does not establish. `identity` is its own addition: the match is the
 * caller's assertion, so the identity relation is asserted, not derived.
 */
export declare const CORRESPONDENCE_NOT_DERIVED: readonly [
  'declarations',
  'availableCapabilities',
  'resources',
  'activation',
  'loadability',
  'dependencyResolution',
  'identity',
];

/** Fixed limitation codes describing this artifact's envelope. */
export declare const CORRESPONDENCE_LIMITATIONS: readonly [
  'IDENTITY_IS_CALLER_ASSERTED',
  'NO_VERSION_CORRESPONDENCE',
  'CONFIG_VALUES_NOT_COMPARED',
  'CAPABILITY_SATISFACTION_NOT_CHECKED',
  'ROW_SET_COMPLETENESS_UNKNOWN',
  'IDENTITY_TEXT_NEVER_EMITTED',
  'CERTIFICATION_NOT_CLAIMED',
  'INPUT_IS_PARSED_TEXT_NOT_A_SANDBOX',
];

/** The digests a correspondence is bound to. Both are 64 lowercase hex characters. */
export interface CorrespondenceBindings {
  readonly profileSha256: string;
  readonly declarationSha256: string;
}

/** One caller assertion: this profile entry id belongs to this plugin id. */
export interface CorrespondencePairInput {
  readonly entryId: string;
  readonly pluginId: string;
  readonly note?: string;
}

/** The artifact this module verifies. */
export interface Correspondence {
  readonly correspondenceVersion: 'profile-correspondence/0.1-draft.1';
  readonly bindings: CorrespondenceBindings;
  readonly pairs: readonly CorrespondencePairInput[];
}

/** Result of validating an artifact. A failure carries a code, never any input text. */
export type CorrespondenceValidation =
  | { readonly ok: true; readonly value: Correspondence }
  | { readonly ok: false; readonly code: CorrespondenceCode };

/** One finding, keyed by the pair's 1-based position in the correspondence file. */
export interface CorrespondenceFinding {
  readonly pair: number;
  readonly code:
    | 'CORRESPONDENCE_PLUGIN_NOT_DECLARED'
    | 'CORRESPONDENCE_DUPLICATE_PLUGIN_ID'
    | 'CORRESPONDENCE_ENTRY_DISABLED_WITH_CAPABILITIES';
}

/** Per-pair result. Every field is a count, a position or a fixed word. */
export interface CorrespondenceSummaryPair {
  readonly index: number;
  readonly line: number;
  readonly disabled: 'absent' | 'true' | 'false' | 'null' | 'other';
  readonly config: 'absent' | 'mapping' | 'not-mapping';
  readonly keyCount: number;
  readonly unmodelledKeyCount: number;
  readonly pluginDeclared: boolean;
  readonly capabilitiesRequired: number;
  readonly capabilitiesOptional: number;
  readonly resources: { readonly tool: number; readonly service: number };
  readonly findings: readonly CorrespondenceFinding['code'][];
}

/** The summary document of design §5. */
export interface CorrespondenceSummary {
  readonly correspondenceSummary: 'correspondence-summary/0.1-draft.1';
  readonly identitySource: 'caller-asserted';
  readonly bindings: CorrespondenceBindings;
  readonly pairs: readonly CorrespondenceSummaryPair[];
  readonly findings: readonly CorrespondenceFinding[];
  readonly counts: {
    readonly pairs: number;
    readonly matched: number;
    readonly refused: number;
    readonly findings: number;
  };
  readonly certification: false;
  readonly correlation: 'not-established';
  readonly identityDisclosed: false;
  readonly notDerived: readonly string[];
  readonly limitations: readonly string[];
}

/** A refusal. The code is one of `CORRESPONDENCE_CODES`, or a reader code from the CLI. */
export interface CorrespondenceRefusal {
  readonly refused: true;
  readonly code: string;
}

/**
 * Validate the artifact. Never throws and never echoes the argument.
 */
export declare function validateCorrespondence(value: unknown): CorrespondenceValidation;

/**
 * Check one asserted correspondence. Never throws for a malformed document: every failure is a
 * refusal with a code.
 */
export declare function checkCorrespondence(input: {
  readonly correspondence: unknown;
  readonly profileText: string;
  readonly declarationText: string;
}): CorrespondenceSummary | CorrespondenceRefusal;
