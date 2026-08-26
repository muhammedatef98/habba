/**
 * Saudi vehicle plate handling.
 *
 * A plate is 1–3 letters plus 1–4 digits, rendered in both Arabic and Latin on
 * the physical plate. Matching a car to its own logbook depends entirely on
 * this module, so it is deliberately permissive on input and strict on storage.
 *
 * See ADR-0011. Two things there are worth repeating here:
 *
 *   1. The letter map is NOT phonetic. ص→X, م→Z, ي→V. It is a fixed set chosen
 *      so the Latin letters are visually distinct. Do not "fix" it by intuition.
 *
 *   2. Ordering is positional, not reversed. Arabic is stored in *logical*
 *      order (first character = first letter read = rightmost when displayed),
 *      and Latin is also logical order. The right-to-left appearance is the
 *      bidi algorithm's job at render time, not a data transformation. The
 *      build prompt's own example (`أ ب ج ١٢٣٤` / `A B J 1234`) is positional,
 *      which corroborates this.
 *
 * ⚠️ The build prompt's example uses ج, which is not in the official plate
 * alphabet — ح is the letter that maps to J. Treated as a typo in the spec.
 * The map below still needs confirmation against an official MOI/Absher source
 * before production seeding (ADR-0011, open item).
 */

import { toLatinDigits } from './digits.js';

/** The 17 letters used on Saudi plates, Arabic → Latin. */
export const PLATE_LETTERS_AR_TO_EN: ReadonlyMap<string, string> = new Map([
  ['ا', 'A'],
  ['ب', 'B'],
  ['ح', 'J'],
  ['د', 'D'],
  ['ر', 'R'],
  ['س', 'S'],
  ['ص', 'X'],
  ['ط', 'T'],
  ['ع', 'E'],
  ['ق', 'G'],
  ['ك', 'K'],
  ['ل', 'L'],
  ['م', 'Z'],
  ['ن', 'N'],
  ['ه', 'H'],
  ['و', 'U'],
  ['ي', 'V'],
]);

export const PLATE_LETTERS_EN_TO_AR: ReadonlyMap<string, string> = new Map(
  [...PLATE_LETTERS_AR_TO_EN].map(([ar, en]) => [en, ar]),
);

/**
 * Alef and heh have several Unicode forms that all mean the same plate letter.
 * Normalising them is required: أ (U+0623) and ا (U+0627) are the same letter
 * on a plate, and a customer's keyboard decides which one they get.
 */
const ARABIC_LETTER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['أ', 'ا'],
  ['إ', 'ا'],
  ['آ', 'ا'],
  ['ٱ', 'ا'],
  ['ة', 'ه'],
  ['ھ', 'ه'],
]);

const TATWEEL = /ـ/g; // ـ  as in هـ
const ARABIC_DIACRITICS = /[ً-ٰٟ]/g;

export interface ParsedPlate {
  /** Letters in Latin form, logical order, e.g. `ABJ`. */
  readonly lettersEn: string;
  /** Letters in Arabic form, logical order, e.g. `ابح`. */
  readonly lettersAr: string;
  /** Digits in Latin form, 1–4 characters, e.g. `1234`. */
  readonly digits: string;
  /** Canonical storage/search key: `ABJ1234`. Latin, uppercase, no spaces. */
  readonly normalised: string;
  /** Display form for Arabic UI, e.g. `ا ب ح ١٢٣٤` is built in the i18n layer. */
  readonly displayAr: string;
  /** Display form for Latin UI, e.g. `A B J 1234`. */
  readonly displayEn: string;
}

export type PlateParseError =
  | 'empty'
  | 'no_digits'
  | 'too_many_digits'
  | 'no_letters'
  | 'too_many_letters'
  | 'unknown_letter';

export type PlateParseResult =
  | { readonly ok: true; readonly plate: ParsedPlate }
  | { readonly ok: false; readonly error: PlateParseError; readonly offendingChar?: string };

/**
 * Parses a plate written in either script, in either order, with or without
 * separators.
 *
 * Accepts: `أ ب ح ١٢٣٤`, `ABJ1234`, `1234 ABJ`, `a-b-j 1234`, `ا ب ح 1234`.
 *
 * Digit count is 1–4, not exactly 4 — Saudi plates carry as few as one digit,
 * and low-number plates belong to exactly the customers worth keeping. The
 * build prompt's "3 letters + 4 digits" over-constrains this (ADR-0011).
 */
export function parsePlate(input: string): PlateParseResult {
  const cleaned = toLatinDigits(input)
    .replace(TATWEEL, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[\s\-_.·]/g, '')
    .toUpperCase();

  if (cleaned.length === 0) return { ok: false, error: 'empty' };

  const digits: string[] = [];
  const lettersEn: string[] = [];

  for (const rawChar of cleaned) {
    const char = ARABIC_LETTER_ALIASES.get(rawChar) ?? rawChar;

    if (char >= '0' && char <= '9') {
      digits.push(char);
      continue;
    }

    const fromArabic = PLATE_LETTERS_AR_TO_EN.get(char);
    if (fromArabic !== undefined) {
      lettersEn.push(fromArabic);
      continue;
    }

    if (PLATE_LETTERS_EN_TO_AR.has(char)) {
      lettersEn.push(char);
      continue;
    }

    return { ok: false, error: 'unknown_letter', offendingChar: rawChar };
  }

  if (digits.length === 0) return { ok: false, error: 'no_digits' };
  if (digits.length > 4) return { ok: false, error: 'too_many_digits' };
  if (lettersEn.length === 0) return { ok: false, error: 'no_letters' };
  if (lettersEn.length > 3) return { ok: false, error: 'too_many_letters' };

  const en = lettersEn.join('');
  const ar = lettersEn.map((letter) => PLATE_LETTERS_EN_TO_AR.get(letter) ?? letter).join('');
  const digitStr = digits.join('');

  return {
    ok: true,
    plate: {
      lettersEn: en,
      lettersAr: ar,
      digits: digitStr,
      normalised: `${en}${digitStr}`,
      displayAr: `${[...ar].join(' ')} ${digitStr}`,
      displayEn: `${[...en].join(' ')} ${digitStr}`,
    },
  };
}

/**
 * Canonical search key, or null if unparseable.
 *
 * Every plate lookup goes through this. Storing the raw input and searching it
 * directly would mean `ABJ1234` and `أ ب ح ١٢٣٤` fail to match the same car.
 */
export function normalisePlate(input: string): string | null {
  const result = parsePlate(input);
  return result.ok ? result.plate.normalised : null;
}
