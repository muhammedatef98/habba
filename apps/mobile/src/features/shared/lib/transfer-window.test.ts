import { describe, expect, test } from 'vitest';
import { daysUntil } from './transfer-window.js';

const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('daysUntil', () => {
  test('a fresh seven-day window reads as seven days', () => {
    expect(daysUntil(new Date(NOW + 7 * DAY).toISOString(), NOW)).toBe(7);
  });

  test('rounds UP, so a transfer with hours left has not run out', () => {
    // The screen turns to its expired state at 0. Rounding down would put it
    // there while the code the buyer is holding still works — the seller would
    // be told the transfer lapsed and the buyer would be able to accept it.
    expect(daysUntil(new Date(NOW + 6 * HOUR).toISOString(), NOW)).toBe(1);
    expect(daysUntil(new Date(NOW + 1 * DAY + 1 * HOUR).toISOString(), NOW)).toBe(2);
  });

  test('is zero at and past the expiry', () => {
    expect(daysUntil(new Date(NOW).toISOString(), NOW)).toBe(0);
    expect(daysUntil(new Date(NOW - DAY).toISOString(), NOW)).toBe(0);
  });

  test('an unparseable timestamp is treated as expired, never as NaN days', () => {
    // A NaN here would render as "expires in NaN days" on a screen about
    // someone's car, and would compare false against every threshold.
    expect(daysUntil('not a date', NOW)).toBe(0);
  });
});
