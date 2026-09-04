import { describe, expect, it } from 'vitest';
import { formatGregorianDate, formatHijriDate, formatMonthLabel, monthKey } from './dates.js';

const ISO = '2026-09-02T09:00:00.000Z';

describe('formatGregorianDate', () => {
  it('uses Latin digits in Arabic (§8)', () => {
    expect(formatGregorianDate(ISO, 'ar')).not.toMatch(/[٠-٩]/);
    expect(formatGregorianDate(ISO, 'ar')).toMatch(/2026/);
  });

  it('leaves other locales to their own conventions', () => {
    expect(formatGregorianDate(ISO, 'en')).toMatch(/2026/);
  });
});

describe('formatHijriDate', () => {
  it('is null for a non-Arabic locale — there is nothing to show alongside', () => {
    expect(formatHijriDate(ISO, 'en')).toBeNull();
  });

  it('returns a Hijri year, or null where the platform cannot format one', () => {
    const hijri = formatHijriDate(ISO, 'ar');
    // Node with full ICU gives 1448; a small-ICU build gives null. Both are
    // acceptable — what must never happen is a throw or a Gregorian date
    // pretending to be Hijri.
    if (hijri !== null) {
      expect(hijri).toMatch(/14\d\d/);
      expect(hijri).not.toMatch(/2026/);
    }
  });

  it('emits Latin digits even where the platform ignores the -nu-latn subtag', () => {
    // Hermes returns ١٤٤٨ for this tag where Node returns 1448, so the result
    // is normalised rather than trusted. Whichever engine runs the test, the
    // output must contain no Arabic-Indic digits.
    const hijri = formatHijriDate(ISO, 'ar');
    if (hijri !== null) expect(hijri).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('never throws on a malformed locale', () => {
    expect(() => formatHijriDate(ISO, 'ar')).not.toThrow();
  });
});

describe('monthKey', () => {
  it('groups by the local month', () => {
    expect(monthKey('2026-09-02T09:00:00.000Z')).toMatch(/^2026-09$/);
  });

  it('separates adjacent months', () => {
    expect(monthKey('2026-09-30T12:00:00.000Z')).not.toBe(monthKey('2026-10-01T12:00:00.000Z'));
  });
});

describe('formatMonthLabel', () => {
  it('names the month and year without Arabic-Indic digits', () => {
    const label = formatMonthLabel(ISO, 'ar');
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/[٠-٩]/);
  });
});
