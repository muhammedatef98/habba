/**
 * Digit normalisation for Arabic input.
 *
 * Saudi users type numbers in three different scripts depending on keyboard and
 * device locale. All three must be accepted everywhere a number is entered —
 * plate, phone, mileage, national ID. Rejecting a plate because the customer's
 * keyboard produced ٤ instead of 4 is not an acceptable failure at the roadside.
 *
 * CLAUDE.md §5, ADR-0011: permissive on input, strict on storage.
 */

/** Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩ (U+0660–U+0669). */
const ARABIC_INDIC_ZERO = 0x0660;

/** Extended Arabic-Indic (Persian/Urdu) digits ۰۱۲۳۴۵۶۷۸۹ (U+06F0–U+06F9). */
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Converts any Arabic-Indic or extended Arabic-Indic digits in `input` to
 * Latin 0–9. Non-digit characters pass through untouched.
 */
export function toLatinDigits(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;

    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Converts Latin digits to Arabic-Indic. Display-only.
 *
 * Note: §8 of the build prompt specifies Latin numerals as the UI default —
 * Saudi users generally prefer `1234` on screen. This exists for the narrow
 * cases that genuinely want Arabic-Indic (printed report headers, Hijri dates)
 * and should not be reached for by default.
 */
export function toArabicIndicDigits(input: string): string {
  let out = '';
  for (const char of input) {
    const digit = char.charCodeAt(0) - 0x30;
    out += digit >= 0 && digit <= 9 ? String.fromCodePoint(ARABIC_INDIC_ZERO + digit) : char;
  }
  return out;
}

/** Strips every character that is not a Latin digit, after normalising scripts. */
export function digitsOnly(input: string): string {
  return toLatinDigits(input).replace(/\D/g, '');
}
