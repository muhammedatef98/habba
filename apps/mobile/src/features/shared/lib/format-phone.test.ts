import { describe, expect, it } from 'vitest';
import { formatPhone } from './format-phone.js';

describe('formatPhone', () => {
  it('groups a Saudi mobile the way it is said', () => {
    expect(formatPhone('+966501234567')).toBe('⁦+966 50 123 4567⁩');
  });

  it('isolates it left-to-right, so the + stays in front inside Arabic text', () => {
    const shown = formatPhone('+966501234567');
    expect(shown.startsWith('⁦')).toBe(true);
    expect(shown.endsWith('⁩')).toBe(true);
  });

  it('leaves any other number as it is, still isolated', () => {
    expect(formatPhone('+201001234567')).toBe('⁦+201001234567⁩');
  });
});
