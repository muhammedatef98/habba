import { describe, expect, test } from 'vitest';
import { parsePlate, toArabicIndicDigits } from '@habba/core';

/**
 * The two lines `<PlateBadge>` renders, asserted at the level the component
 * builds them — the component itself imports react-native and cannot be loaded
 * here, but the formatting is the part worth pinning.
 *
 * CLAUDE.md §5 gives the exact shape: `أ ب ج ١٢٣٤` / `A B J 1234`.
 */
function lines(input: string): { arabic: string; latin: string } | null {
  const parsed = parsePlate(input);
  if (!parsed.ok) return null;

  const { lettersAr, lettersEn, digits } = parsed.plate;
  return {
    arabic: `${[...lettersAr].join(' ')} ${toArabicIndicDigits(digits)}`,
    latin: `${[...lettersEn].join(' ')} ${digits}`,
  };
}

describe('plate display', () => {
  test('renders both scripts, spaced, from any stored form', () => {
    // All three are the same car: what the customer typed, the Latin
    // equivalent, and the normalised search key the database stores.
    // ح transliterates to J on a Saudi plate, not H — the same pairing
    // CLAUDE.md §5 uses in its own example.
    for (const stored of ['أ ب ح ١٢٣٤', 'A B J 1234', 'ABJ1234']) {
      expect(lines(stored), stored).toEqual({ arabic: 'ا ب ح ١٢٣٤', latin: 'A B J 1234' });
    }
  });

  test('the Arabic line uses Arabic-Indic digits, the Latin line does not', () => {
    // The plate is being reproduced, not counted — the one case §8's
    // Latin-numerals default gives way to the object itself.
    const result = lines('ABH1234');
    expect(result?.arabic).toContain('١٢٣٤');
    expect(result?.latin).toContain('1234');
  });

  test('low-number plates keep their real width', () => {
    // Single-digit plates are real, and belong to exactly the customers worth
    // keeping (ADR-0011). Nothing pads them to four.
    expect(lines('ا ب ح ٧')).toEqual({ arabic: 'ا ب ح ٧', latin: 'A B J 7' });
  });

  test('an unparseable plate has no lines to render, so the badge shows it raw', () => {
    expect(lines('')).toBeNull();
    expect(lines('!!!!')).toBeNull();
  });
});
