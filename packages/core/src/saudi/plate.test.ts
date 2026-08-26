import { describe, expect, test } from 'vitest';
import { normalisePlate, parsePlate, PLATE_LETTERS_AR_TO_EN } from './plate.js';

describe('parsePlate', () => {
  test('parses the build prompt example, corrected from ج to ح', () => {
    // CLAUDE.md §5 gives `أ ب ج ١٢٣٤` / `A B J 1234`. ج is not in the plate
    // alphabet; ح is the letter that maps to J (ADR-0011).
    const result = parsePlate('أ ب ح ١٢٣٤');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plate.lettersEn).toBe('ABJ');
    expect(result.plate.digits).toBe('1234');
    expect(result.plate.normalised).toBe('ABJ1234');
  });

  test('Arabic and Latin spellings of the same plate normalise identically', () => {
    // This is the property the whole logbook depends on: a car must match
    // itself regardless of which script the customer typed.
    expect(normalisePlate('أ ب ح ١٢٣٤')).toBe(normalisePlate('A B J 1234'));
    expect(normalisePlate('ا ب ح 1234')).toBe('ABJ1234');
  });

  test('letter order is positional, not reversed', () => {
    // Arabic is stored in logical order, so position 1 maps to position 1.
    // The right-to-left appearance is bidi rendering, not a data transform.
    const arabic = parsePlate('ا ب ح 1234');
    const latin = parsePlate('ABJ 1234');
    expect(arabic.ok && latin.ok).toBe(true);
    if (!arabic.ok || !latin.ok) return;
    expect(arabic.plate.lettersEn).toBe(latin.plate.lettersEn);
  });

  test('accepts 1 to 4 digits — the spec\'s "exactly 4" over-constrains', () => {
    for (const input of ['ABJ 1', 'ABJ 12', 'ABJ 123', 'ABJ 1234']) {
      expect(parsePlate(input).ok, input).toBe(true);
    }
  });

  test('rejects more than 4 digits or more than 3 letters', () => {
    expect(parsePlate('ABJ 12345')).toMatchObject({ ok: false, error: 'too_many_digits' });
    expect(parsePlate('ABJD 1234')).toMatchObject({ ok: false, error: 'too_many_letters' });
  });

  test('requires both letters and digits', () => {
    expect(parsePlate('1234')).toMatchObject({ ok: false, error: 'no_letters' });
    expect(parsePlate('ABJ')).toMatchObject({ ok: false, error: 'no_digits' });
    expect(parsePlate('')).toMatchObject({ ok: false, error: 'empty' });
  });

  test('rejects letters outside the plate alphabet', () => {
    // ج is a real Arabic letter but not a plate letter.
    expect(parsePlate('ا ب ج 1234')).toMatchObject({ ok: false, error: 'unknown_letter' });
    // Q is not in the Latin plate set either.
    expect(parsePlate('ABQ 1234')).toMatchObject({ ok: false, error: 'unknown_letter' });
  });

  test('normalises alef and heh variants that keyboards produce differently', () => {
    expect(normalisePlate('أ ب ح 1234')).toBe('ABJ1234');
    expect(normalisePlate('إ ب ح 1234')).toBe('ABJ1234');
    expect(normalisePlate('آ ب ح 1234')).toBe('ABJ1234');
    expect(normalisePlate('ا ب ح 1234')).toBe('ABJ1234');
  });

  test('handles tatweel, separators, mixed case, and digits in either position', () => {
    expect(normalisePlate('هـ ب ح 1234')).toBe('HBJ1234');
    expect(normalisePlate('a-b-j 1234')).toBe('ABJ1234');
    expect(normalisePlate('1234 ABJ')).toBe('ABJ1234');
    expect(normalisePlate('  abj1234  ')).toBe('ABJ1234');
  });

  test('the letter map is the non-phonetic official set', () => {
    // Guards against a well-meaning "fix" toward phonetic transliteration.
    expect(PLATE_LETTERS_AR_TO_EN.get('ص')).toBe('X');
    expect(PLATE_LETTERS_AR_TO_EN.get('م')).toBe('Z');
    expect(PLATE_LETTERS_AR_TO_EN.get('ي')).toBe('V');
    expect(PLATE_LETTERS_AR_TO_EN.get('ح')).toBe('J');
    expect(PLATE_LETTERS_AR_TO_EN.size).toBe(17);
  });

  test('round-trips every letter in the alphabet', () => {
    for (const [arabic, latin] of PLATE_LETTERS_AR_TO_EN) {
      const result = parsePlate(`${arabic} 1`);
      expect(result.ok, arabic).toBe(true);
      if (!result.ok) continue;
      expect(result.plate.lettersEn).toBe(latin);
      expect(result.plate.lettersAr).toBe(arabic);
    }
  });
});
