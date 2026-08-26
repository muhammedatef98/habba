/**
 * Saudi National ID (هوية) and Iqama (إقامة) validation.
 *
 * 10 digits. Leading 1 = Saudi national, leading 2 = resident (Iqama).
 * A check digit protects against typos.
 *
 * CLAUDE.md §5, ADR-0011. Stored encrypted, never logged (build prompt §11).
 */

import { digitsOnly } from './digits.js';

export type IdentityKind = 'national' | 'iqama';

export type NationalIdError = 'empty' | 'bad_length' | 'bad_prefix' | 'bad_checksum';

export type NationalIdResult =
  | { readonly ok: true; readonly id: string; readonly kind: IdentityKind }
  | { readonly ok: false; readonly error: NationalIdError };

/**
 * Luhn-style check digit over the first nine digits.
 *
 * Odd positions (1st, 3rd, …) are doubled and their digits summed; even
 * positions are added as-is. The check digit makes the total a multiple of ten.
 *
 * ⚠️ ADR-0011 open item: this is the widely-used published algorithm, but it
 * has not been confirmed against an authoritative specification. It must be
 * validated against a set of known-valid IDs before it gates provider payouts
 * in Phase 3. Until then it is a typo filter, not proof of a real identity —
 * Nafath is what establishes identity (build prompt §3).
 */
function computeCheckDigit(firstNine: string): number {
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    const digit = firstNine.charCodeAt(i) - 0x30;
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }

  return (10 - (sum % 10)) % 10;
}

export function validateNationalId(input: string): NationalIdResult {
  const id = digitsOnly(input);

  if (id.length === 0) return { ok: false, error: 'empty' };
  if (id.length !== 10) return { ok: false, error: 'bad_length' };

  const prefix = id[0];
  if (prefix !== '1' && prefix !== '2') return { ok: false, error: 'bad_prefix' };

  if (computeCheckDigit(id.slice(0, 9)) !== id.charCodeAt(9) - 0x30) {
    return { ok: false, error: 'bad_checksum' };
  }

  return { ok: true, id, kind: prefix === '1' ? 'national' : 'iqama' };
}

export function isValidNationalId(input: string): boolean {
  return validateNationalId(input).ok;
}

/** `1••••••••7` — the only form permitted in logs, errors, or notifications. */
export function maskNationalId(input: string): string {
  const id = digitsOnly(input);
  if (id.length !== 10) return '••••••••••';
  return `${id[0]}${'•'.repeat(8)}${id[9]}`;
}
