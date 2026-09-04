import { describe, expect, it } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { formatSarDisplay } from './money-format.js';

describe('formatSarDisplay', () => {
  it('drops hundredths only when both digits are zero', () => {
    expect(formatSarDisplay(sarOrThrow('450.00'))).toBe('450');
    expect(formatSarDisplay(sarOrThrow('0.00'))).toBe('0');
  });

  it('keeps a trailing zero that follows a non-zero digit', () => {
    // 22.4 would read as a truncated number rather than as a price.
    expect(formatSarDisplay(sarOrThrow('22.40'))).toBe('22.40');
  });

  it('leaves real halalas alone', () => {
    expect(formatSarDisplay(sarOrThrow('67.50'))).toBe('67.50');
    expect(formatSarDisplay(sarOrThrow('22.43'))).toBe('22.43');
  });

  it('keeps the sign on a negative amount', () => {
    expect(formatSarDisplay(sarOrThrow('-30.00'))).toBe('-30');
  });
});
