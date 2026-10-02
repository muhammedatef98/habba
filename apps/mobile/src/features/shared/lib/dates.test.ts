import { describe, expect, it } from 'vitest';
import {
  formatAppointment,
  formatGregorianDate,
  formatTodayLine,
  formatMonthLabel,
  monthKey,
} from './dates.js';

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

describe('formatAppointment', () => {
  it('reads in Riyadh time whatever zone the device is in', () => {
    // 09:00Z is 12:00 in Riyadh (UTC+3, no daylight saving).
    expect(formatAppointment(ISO, 'en')).toMatch(/12:00/);
  });

  it('uses Latin digits in Arabic (§8)', () => {
    const arabic = formatAppointment(ISO, 'ar');
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(arabic).toMatch(/12:00/);
  });
});

describe('formatTodayLine', () => {
  // 21:30 UTC on the 1st is already the 2nd in Riyadh.
  const LATE = new Date('2026-10-01T21:30:00Z');

  it('states the weekday and date in Riyadh, in Latin digits', () => {
    const line = formatTodayLine(LATE, 'ar');
    expect(line).toMatch(/الجمعة/);
    expect(line).toMatch(/\b2\b/);
    expect(line).not.toMatch(/[٠-٩]/);
  });
});

describe('Gregorian only (2026-10-02)', () => {
  // Hijri month names and the year: none may appear in anything the app shows.
  const HIJRI = /محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو القعدة|ذو الحجة|14\d\d|هـ/;

  it('never shows a Hijri date, even for an ar-SA device locale', () => {
    for (const locale of ['ar', 'ar-SA']) {
      expect(formatGregorianDate(ISO, locale)).not.toMatch(HIJRI);
      expect(formatGregorianDate(ISO, locale)).toMatch(/2026/);
      expect(formatAppointment(ISO, locale)).not.toMatch(HIJRI);
      expect(formatMonthLabel(ISO, locale)).toMatch(/2026/);
      expect(formatTodayLine(new Date(ISO), locale)).not.toMatch(HIJRI);
    }
  });
});
