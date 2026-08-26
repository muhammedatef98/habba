/**
 * Saudi IBAN validation (ISO 13616 mod-97).
 *
 * This gates provider payouts, so a typo that passes validation becomes money
 * sent to the wrong account. Length and prefix checks alone are not enough —
 * mod-97 catches transpositions, which are the common human error.
 *
 * CLAUDE.md §5, ADR-0011. Stored encrypted at rest (build prompt §11).
 */

import { toLatinDigits } from './digits.js';

/** SA + 2 check digits + 2 bank code + 18 account = 24. */
export const SAUDI_IBAN_LENGTH = 24;

export type IbanError = 'empty' | 'bad_country' | 'bad_length' | 'bad_characters' | 'bad_checksum';

export type IbanResult =
  | { readonly ok: true; readonly iban: string; readonly bankCode: string }
  | { readonly ok: false; readonly error: IbanError };

/** Strips spaces and normalises case/script. IBANs are printed in groups of 4. */
export function normaliseIban(input: string): string {
  return toLatinDigits(input).replace(/[\s\-]/g, '').toUpperCase();
}

/**
 * ISO 7064 mod-97-10: move the first four characters to the end, map letters
 * to two-digit numbers (A=10 … Z=35), and require the result mod 97 === 1.
 *
 * Computed digit-by-digit rather than with BigInt: an IBAN expands to a ~48
 * digit number, and incremental remainder arithmetic keeps it in safe integer
 * range without a dependency.
 */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;

  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + (code - 48)) % 97;
    } else {
      // A=10 … Z=35, contributed as two decimal digits.
      const value = code - 55;
      remainder = (remainder * 100 + value) % 97;
    }
  }

  return remainder;
}

export function validateSaudiIban(input: string): IbanResult {
  const iban = normaliseIban(input);

  if (iban.length === 0) return { ok: false, error: 'empty' };
  if (!iban.startsWith('SA')) return { ok: false, error: 'bad_country' };
  if (iban.length !== SAUDI_IBAN_LENGTH) return { ok: false, error: 'bad_length' };
  if (!/^[A-Z0-9]+$/.test(iban)) return { ok: false, error: 'bad_characters' };
  if (mod97(iban) !== 1) return { ok: false, error: 'bad_checksum' };

  return { ok: true, iban, bankCode: iban.slice(4, 6) };
}

export function isValidSaudiIban(input: string): boolean {
  return validateSaudiIban(input).ok;
}

/** Groups of four for display: `SA03 8000 0000 6080 1016 7519`. */
export function formatIban(input: string): string {
  const iban = normaliseIban(input);
  return (iban.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * Masked form for UI and logs: `SA03 •••• •••• •••• •••• 7519`.
 *
 * An IBAN must never appear in full in a log line, an error message, or a push
 * notification (ADR-0010).
 */
export function maskIban(input: string): string {
  const iban = normaliseIban(input);
  if (iban.length < 8) return '••••';
  return `${iban.slice(0, 4)} ${'•••• '.repeat(4)}${iban.slice(-4)}`.trim();
}
