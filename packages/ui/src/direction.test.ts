import { describe, expect, test } from 'vitest';
import { alignStartFor, rowDirectionFor } from './direction.js';

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

describe('reading start in a column', () => {
  test('is the platform start once it agrees with the locale', () => {
    expect(alignStartFor('rtl', 'rtl')).toBe('flex-start');
    expect(alignStartFor('ltr', 'ltr')).toBe('flex-start');
  });

  test('is the far side while the platform is a restart behind', () => {
    expect(alignStartFor('rtl', 'ltr')).toBe('flex-end');
    expect(alignStartFor('ltr', 'rtl')).toBe('flex-end');
  });
});
