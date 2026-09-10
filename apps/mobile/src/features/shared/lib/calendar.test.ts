import { describe, expect, it } from 'vitest';
import { daysInMonth, serviceYears, toServiceDate } from './calendar.js';

describe('daysInMonth', () => {
  it('knows the short months', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('knows February in a common year and a leap year', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('handles the century rule', () => {
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe('serviceYears', () => {
  it('starts at the current year and counts back', () => {
    const years = serviceYears(new Date(2026, 5, 1), 3);
    expect(years).toEqual([2026, 2025, 2024]);
  });
});

describe('toServiceDate', () => {
  it('rejects a day the month does not have', () => {
    expect(toServiceDate(2026, 2, 30)).toBeNull();
    expect(toServiceDate(2026, 4, 31)).toBeNull();
  });

  it('rejects an impossible month', () => {
    expect(toServiceDate(2026, 0, 1)).toBeNull();
    expect(toServiceDate(2026, 13, 1)).toBeNull();
  });

  it('accepts 29 February in a leap year', () => {
    expect(toServiceDate(2024, 2, 29)).not.toBeNull();
  });

  it('lands at midday UTC, so a +03 read-back stays on the same day', () => {
    const date = toServiceDate(2026, 3, 14);
    expect(date?.toISOString()).toBe('2026-03-14T12:00:00.000Z');
    // The failure this guards: midnight UTC read in Riyadh is 03:00 the same
    // day, but midnight *local* stored as UTC is the previous day at 21:00.
    expect(date?.getUTCDate()).toBe(14);
  });
});
