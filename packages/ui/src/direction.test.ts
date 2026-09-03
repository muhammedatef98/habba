import { describe, expect, test } from 'vitest';
import { readingOrder, rowDirectionFor } from './direction.js';

/**
 * The state these guard is the first launch after install: the app boots
 * Arabic, `forceRTL` stages the flip for the next process start, and that whole
 * session runs with a left-to-right Yoga. Both of the pairs below have to put
 * Arabic content on the right in either state.
 */
describe('row direction', () => {
  test('lets the platform lay the row out once it agrees with the locale', () => {
    // Reversing on top of Yoga's own reversal is the double-flip that mirrors
    // a screen back to left-to-right.
    expect(rowDirectionFor('rtl', 'rtl')).toBe('row');
    expect(rowDirectionFor('ltr', 'ltr')).toBe('row');
  });

  test('reverses the row while the platform is a restart behind', () => {
    expect(rowDirectionFor('rtl', 'ltr')).toBe('row-reverse');
    expect(rowDirectionFor('ltr', 'rtl')).toBe('row-reverse');
  });

  test('an explicit reverse composes with that rather than overriding it', () => {
    expect(rowDirectionFor('rtl', 'rtl', true)).toBe('row-reverse');
    expect(rowDirectionFor('rtl', 'ltr', true)).toBe('row');
  });
});

describe('reading order', () => {
  const tabs = ['home', 'orders', 'account'] as const;

  test('الرئيسية first, حسابي last — in both direction states', () => {
    // "First" is a reading position, not a screen coordinate: the right edge
    // in Arabic. Both branches below have to mean the same thing on screen.
    expect(readingOrder(tabs, 'rtl', 'rtl')).toEqual(['home', 'orders', 'account']);
    expect(readingOrder(tabs, 'rtl', 'ltr')).toEqual(['account', 'orders', 'home']);
  });

  test('English keeps Home on the left in both states', () => {
    expect(readingOrder(tabs, 'ltr', 'ltr')).toEqual(['home', 'orders', 'account']);
    expect(readingOrder(tabs, 'ltr', 'rtl')).toEqual(['account', 'orders', 'home']);
  });

  test('never drops or duplicates an item', () => {
    for (const locale of ['rtl', 'ltr'] as const) {
      for (const native of ['rtl', 'ltr'] as const) {
        expect([...readingOrder(tabs, locale, native)].sort()).toEqual([
          'account',
          'home',
          'orders',
        ]);
      }
    }
  });

  test('does not mutate the caller’s array', () => {
    const original = [...tabs];
    readingOrder(original, 'rtl', 'ltr');
    expect(original).toEqual(['home', 'orders', 'account']);
  });
});
