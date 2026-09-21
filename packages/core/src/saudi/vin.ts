/**
 * VIN — the seventeen characters the whole logbook is keyed to.
 *
 * `vehicles.vin` and `inspection_reports.subject_vin` both carry the same
 * check constraint, `^[A-HJ-NPR-Z0-9]{17}$` (migrations 0005 and 0026), and
 * both refuse anything else outright. This mirrors it so an inspector standing
 * at a car is told which character is wrong while they can still walk round to
 * the windscreen and re-read it.
 *
 * The excluded letters are not arbitrary and not a Habba rule: ISO 3779 leaves
 * I, O and Q out of the alphabet precisely because they are indistinguishable
 * from 1 and 0 stamped into metal. A VIN that appears to contain one has been
 * misread, every time.
 */

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Letters ISO 3779 excludes, and what they are almost always a misreading of. */
const AMBIGUOUS = /[IOQ]/;

export const VIN_LENGTH = 17;

/**
 * Upper-cases and strips the spaces and dashes people copy out of a
 * registration document. It does NOT substitute I→1 or O→0: guessing at a
 * character in the key the car's history hangs on is worse than refusing it.
 */
export function normaliseVin(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export type VinProblem = 'empty' | 'length' | 'ambiguous_letter' | 'charset';

/**
 * What is wrong with this VIN, or null if nothing is.
 *
 * Distinguishes the ambiguous letters from the rest of the charset because
 * they are a different mistake with a different remedy — "that is a one, not
 * an I" rather than "that character is not allowed".
 */
export function vinProblem(input: string): VinProblem | null {
  const vin = normaliseVin(input);

  if (vin.length === 0) return 'empty';
  if (AMBIGUOUS.test(vin)) return 'ambiguous_letter';
  if (vin.length !== VIN_LENGTH) return 'length';
  if (!VIN_PATTERN.test(vin)) return 'charset';

  return null;
}

export function isValidVin(input: string): boolean {
  return vinProblem(input) === null;
}
