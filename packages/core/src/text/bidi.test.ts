import { describe, expect, test } from 'vitest';
import { ltrIsolate } from './bidi.js';

describe('ltrIsolate', () => {
  test('wraps the span in an isolate pair', () => {
    expect(ltrIsolate('+966')).toBe('⁦+966⁩');
  });

  test('leaves the visible characters untouched', () => {
    const masked = '05• •••• •67';
    expect(ltrIsolate(masked)).toContain(masked);
    expect(ltrIsolate(masked).replace(/[⁦⁩]/g, '')).toBe(masked);
  });

  test('is a no-op on an empty string, so an optional value is safe to pass', () => {
    expect(ltrIsolate('')).toBe('');
  });

  test('uses isolates rather than marks, so the span cannot leak direction', () => {
    // U+200E would not close the span; the characters after it would still be
    // influenced by the Latin run.
    expect(ltrIsolate('123')).not.toContain('‎');
  });
});
