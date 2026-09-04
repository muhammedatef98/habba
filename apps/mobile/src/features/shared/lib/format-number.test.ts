import { describe, expect, it } from 'vitest';
import { formatCount, formatShortDate } from './format-number.js';

describe('formatCount', () => {
  it('uses Latin digits for Arabic, whatever the platform ICU default is', () => {
    const formatted = formatCount(142380, 'ar');
    expect(formatted).toMatch(/^[0-9,٬, ]+$/);
    expect(formatted).not.toMatch(/[٠-٩]/);
    expect(formatted.replace(/\D/g, '')).toBe('142380');
  });

  it('groups thousands', () => {
    expect(formatCount(1000, 'en')).toBe('1,000');
  });

  it('leaves other locales to their own conventions', () => {
    expect(formatCount(142380, 'en').replace(/\D/g, '')).toBe('142380');
  });
});

describe('formatShortDate', () => {
  it('never emits Arabic-Indic digits', () => {
    expect(formatShortDate('2026-03-14T00:00:00.000Z', 'ar')).not.toMatch(/[٠-٩]/);
  });
});
