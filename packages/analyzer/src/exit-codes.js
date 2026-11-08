/**
 * Process exit codes for the CLI. The library itself never exits a process.
 */
export const EXIT_CODES = Object.freeze({
  /** Analysis ran, no error-severity finding. Warnings/info may be present. */
  OK: 0,
  /** Analysis ran and at least one error-severity finding exists. */
  FINDINGS: 1,
  /** Manifest unreadable/undecodable as a JSON document. */
  MANIFEST_INVALID: 2,
  /** Command line, trust boundary or injected validator setup failed. */
  USAGE: 3,
  /** The injected validator threw; analysis failed closed. */
  VALIDATOR_FAILED: 4,
  /** Internal/unexpected failure. */
  INTERNAL: 5,
});
