import { describe, expect, test } from 'vitest';
import {
  addSar,
  applyRate,
  compareSar,
  halalasOf,
  sar,
  sarFromHalalas,
  sarOrThrow,
  subtractSar,
  sumSar,
} from './sar.js';

describe('sar construction', () => {
  test('normalises to exactly two decimal places', () => {
    expect(sarOrThrow('149')).toBe('149.00');
    expect(sarOrThrow('149.5')).toBe('149.50');
    expect(sarOrThrow('149.50')).toBe('149.50');
    expect(sarOrThrow('0')).toBe('0.00');
  });

  test('rejects more than two decimals rather than silently rounding', () => {
    // Silent truncation of a price is how a customer gets charged the wrong
    // amount and nobody notices. Fail loudly.
    expect(sar('149.999')).toMatchObject({ ok: false });
    expect(sar('abc')).toMatchObject({ ok: false, error: 'not_a_number' });
  });

  test('rejects amounts beyond numeric(12,2)', () => {
    expect(sar('9999999999.99').ok).toBe(true);
    expect(sar('10000000000.00')).toMatchObject({ ok: false, error: 'out_of_range' });
  });

  test('constructs from integer halalas', () => {
    expect(sarFromHalalas(14950)).toMatchObject({ ok: true, amount: '149.50' });
    expect(sarFromHalalas(1)).toMatchObject({ ok: true, amount: '0.01' });
  });
});

describe('sar arithmetic is exact', () => {
  test('the classic float failure does not occur', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754. Not here.
    expect(addSar(sarOrThrow('0.10'), sarOrThrow('0.20'))).toBe('0.30');
  });

  test('summing many small amounts does not drift', () => {
    const tenHalalas = Array.from({ length: 100 }, () => sarOrThrow('0.01'));
    expect(sumSar(tenHalalas)).toBe('1.00');

    const prices = Array.from({ length: 1000 }, () => sarOrThrow('0.07'));
    expect(sumSar(prices)).toBe('70.00');
  });

  test('addition, subtraction, and comparison', () => {
    expect(addSar(sarOrThrow('149.50'), sarOrThrow('25.75'))).toBe('175.25');
    expect(subtractSar(sarOrThrow('149.50'), sarOrThrow('149.50'))).toBe('0.00');
    expect(subtractSar(sarOrThrow('100.00'), sarOrThrow('150.00'))).toBe('-50.00');
    expect(compareSar(sarOrThrow('10.00'), sarOrThrow('9.99'))).toBe(1);
    expect(compareSar(sarOrThrow('10.00'), sarOrThrow('10.00'))).toBe(0);
  });

  test('sumSar of an empty list is zero, not NaN', () => {
    expect(sumSar([])).toBe('0.00');
  });
});

describe('applyRate — VAT rounding (ADR-0007)', () => {
  test('computes 15% VAT', () => {
    expect(applyRate(sarOrThrow('100.00'), '0.15')).toBe('15.00');
    expect(applyRate(sarOrThrow('149.50'), '0.15')).toBe('22.43'); // 22.425 → half up
  });

  test('rounds half away from zero, not to even', () => {
    // Banker's rounding would give 0.02 here. Postgres numeric round() gives
    // 0.03, and the database is the authority we must match.
    expect(applyRate(sarOrThrow('0.50'), '0.05')).toBe('0.03'); // 0.025 → 0.03
    expect(applyRate(sarOrThrow('1.50'), '0.05')).toBe('0.08'); // 0.075 → 0.08
  });

  test('line-level VAT sums to the document total', () => {
    // ADR-0007: VAT is computed and rounded per line, then summed. ZATCA
    // validates that printed line values reconcile with printed totals.
    const lines = [sarOrThrow('149.50'), sarOrThrow('75.25'), sarOrThrow('12.99')];
    const lineVat = lines.map((line) => applyRate(line, '0.15'));

    const net = sumSar(lines);
    const vat = sumSar(lineVat);
    const gross = addSar(net, vat);

    // 22.425→22.43, 11.2875→11.29, 1.9485→1.95
    expect(net).toBe('237.74');
    expect(vat).toBe('35.67');
    expect(gross).toBe('273.41');

    // The reconciliation the database check constraint will enforce.
    expect(subtractSar(gross, addSar(net, vat))).toBe('0.00');
  });
});

describe('halalasOf', () => {
  test('exposes exact integer halalas for PSP payloads', () => {
    expect(halalasOf(sarOrThrow('149.50'))).toBe(14950n);
    expect(halalasOf(sarOrThrow('0.01'))).toBe(1n);
  });
});
