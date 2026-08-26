/**
 * Saudi VAT registration number (الرقم الضريبي).
 *
 * 15 digits, first and last both `3`. Digits 11–13 carry an entity/branch
 * identifier. Appears in every ZATCA invoice QR (ADR-0009).
 *
 * CLAUDE.md §5.
 */

import { digitsOnly } from './digits.js';

export type VatNumberError = 'empty' | 'bad_length' | 'bad_prefix' | 'bad_suffix';

export type VatNumberResult =
  | { readonly ok: true; readonly vatNumber: string }
  | { readonly ok: false; readonly error: VatNumberError };

export function validateVatNumber(input: string): VatNumberResult {
  const vat = digitsOnly(input);

  if (vat.length === 0) return { ok: false, error: 'empty' };
  if (vat.length !== 15) return { ok: false, error: 'bad_length' };
  if (!vat.startsWith('3')) return { ok: false, error: 'bad_prefix' };
  if (!vat.endsWith('3')) return { ok: false, error: 'bad_suffix' };

  // Structural validation beyond prefix/suffix/length is advisory only —
  // ZATCA is the authority on whether a number is actually registered.
  return { ok: true, vatNumber: vat };
}

export function isValidVatNumber(input: string): boolean {
  return validateVatNumber(input).ok;
}
