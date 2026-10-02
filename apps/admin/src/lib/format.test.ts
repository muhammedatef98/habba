import { describe, expect, test } from 'vitest';
import { count, money, phone, since } from './format';

describe('console formatting', () => {
  test('money is two decimals in Latin digits, with the riyal sign after it', () => {
    expect(money(1995)).toBe('1,995.00 ر.س');
    expect(money(172.5)).toBe('172.50 ر.س');
    expect(money(null)).toBe('—');
  });

  test('counts group thousands', () => {
    expect(count(1284)).toBe('1,284');
  });

  test('a Saudi mobile is written the way it is said', () => {
    expect(phone('+966501234567')).toBe('\u2066050 123 4567\u2069');
    expect(phone('+201001234567')).toBe('\u2066+201001234567\u2069');
    expect(phone(null)).toBe('—');
  });

  test('ages are in minutes, then hours, then days', () => {
    const from = Date.parse('2026-09-23T12:00:00Z');
    expect(since('2026-09-23T11:48:00Z', from)).toBe('12 دقيقة');
    expect(since('2026-09-23T07:00:00Z', from)).toBe('5 ساعة');
    expect(since('2026-09-19T12:00:00Z', from)).toBe('4 يوم');
  });
});
