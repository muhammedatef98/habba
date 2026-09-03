import { describe, expect, test } from 'vitest';
import ar from './locales/ar.json' with { type: 'json' };

/**
 * Arabic copy is Modern Standard Arabic, not a dialect.
 *
 * Habba launches in Saudi Arabia and expands to Egypt and the GCC (§0), so
 * copy written in any one dialect reads as foreign to most of the market — and
 * a product that handles someone's car has to sound like it belongs to them.
 * MSA is the only register every reader shares.
 *
 * This test exists because six strings had already slipped through by hand:
 * "وش تحتاج؟", "بكرة", "مو متاح الحين", "عشان", "تقدر تضيف", "ما تقدر ترجع".
 * A review pass catches those once; this catches the next one.
 */

/** Dialect words with no place in MSA copy. Word-boundary matched. */
const DIALECT_WORDS = [
  // Levantine / Egyptian
  'عشان',
  'علشان',
  'دلوقتي',
  'كده',
  'كدا',
  'إزاي',
  'ازاي',
  'دي',
  'ده',
  'عايز',
  'عاوز',
  'بتاع',
  'بتاعة',
  'إحنا',
  'احنا',
  'مش',
  'اللي',
  // Gulf / Najdi
  'وش',
  'مو',
  'الحين',
  'بكرة',
  'زين',
  'شلون',
  'ابغى',
  'أبغى',
  'يبغى',
  'شفت',
  'تبي',
  'يبي',
  'وين',
  'ليش',
  'كيفك',
  // Second-person colloquial verb forms that read as speech, not interface copy
  'تقدر',
  'تقدرين',
  'خليك',
  'خلها',
  'خله',
];

function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('Arabic copy register', () => {
  test('no dialect words in any string', () => {
    // Matched on word boundaries: "دي" must not flag "لدي", and "وش" must not
    // flag "وشك" — the whole point is to catch the register, not the letters.
    const offenders: string[] = [];

    for (const [key, value] of leaves(ar)) {
      for (const word of DIALECT_WORDS) {
        const pattern = new RegExp(
          `(^|[\\s"'،.؛:!؟()\\[\\]{}«»-])${word}($|[\\s"'،.؛:!؟()\\[\\]{}«»-])`,
        );
        if (pattern.test(value)) offenders.push(`${key}: "${value}" (${word})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
