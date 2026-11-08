/**
 * TEST DOUBLE — a validator that throws on purpose.
 *
 * Used by the CLI tests to prove that a validator failure fails closed
 * (exit code 4, no report on stdout) instead of producing a "no findings"
 * report. Not a protocol implementation.
 */
export function validateDeclaration() {
  throw new Error('exploding-validator: deliberate failure');
}

export default validateDeclaration;
