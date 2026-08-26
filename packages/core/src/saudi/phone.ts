/**
 * Saudi mobile number normalisation to E.164.
 *
 * `profiles.phone` is unique and is the login identity, so two spellings of the
 * same number must never become two accounts. Everything normalises to
 * `+9665XXXXXXXX` before it reaches the database.
 *
 * CLAUDE.md §6.1, ADR-0011.
 */

import { digitsOnly } from './digits.js';

export const SAUDI_COUNTRY_CODE = '966';

export type PhoneError = 'empty' | 'not_saudi_mobile' | 'bad_length';

export type PhoneResult =
  | { readonly ok: true; readonly e164: string; readonly national: string }
  | { readonly ok: false; readonly error: PhoneError };

/**
 * Accepts every form a Saudi user might type:
 *   0501234567, 501234567, +966501234567, 00966501234567, ٠٥٠١٢٣٤٥٦٧
 *
 * All Saudi mobile numbers are 9 national digits beginning with 5.
 */
export function parseSaudiPhone(input: string): PhoneResult {
  let digits = digitsOnly(input);

  if (digits.length === 0) return { ok: false, error: 'empty' };

  // Strip international prefixes: 00966… or 966…
  if (digits.startsWith(`00${SAUDI_COUNTRY_CODE}`)) {
    digits = digits.slice(2 + SAUDI_COUNTRY_CODE.length);
  } else if (digits.startsWith(SAUDI_COUNTRY_CODE) && digits.length > 9) {
    digits = digits.slice(SAUDI_COUNTRY_CODE.length);
  }

  // Strip the domestic trunk prefix: 05…
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (!digits.startsWith('5')) return { ok: false, error: 'not_saudi_mobile' };
  if (digits.length !== 9) return { ok: false, error: 'bad_length' };

  return {
    ok: true,
    e164: `+${SAUDI_COUNTRY_CODE}${digits}`,
    national: `0${digits}`,
  };
}

export function isValidSaudiPhone(input: string): boolean {
  return parseSaudiPhone(input).ok;
}

/** `05• •••• •67` — safe for logs and push notification bodies (ADR-0010). */
export function maskPhone(input: string): string {
  const parsed = parseSaudiPhone(input);
  if (!parsed.ok) return '••••••••••';
  const n = parsed.national;
  return `${n.slice(0, 3)}•••••${n.slice(-2)}`;
}
