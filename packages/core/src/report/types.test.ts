import { describe, expect, test } from 'vitest';
import type { HabbaReport } from './types.js';
import { REPORT_PAYLOAD_VERSION, carriesWarrantyAndScore, verifiedRatio } from './types.js';

function reportAtVersion(version: number, extra: Partial<HabbaReport> = {}): HabbaReport {
  return {
    report_version: version,
    generated_at: '2026-09-06T00:00:00Z',
    vehicle: {
      make_ar: 'تويوتا',
      make_en: 'Toyota',
      model_ar: 'كامري',
      model_en: 'Camry',
      year: 2021,
      plate: 'ABJ 1234',
      vin: null,
      colour: null,
      current_mileage: 61200,
    },
    ownership: { months_on_habba: 18 },
    chain: { is_valid: true, length: 12 },
    coverage: {
      total: 10,
      habba_verified: 4,
      self_documented: 3,
      self_reported: 3,
      third_party: 0,
    },
    mileage_history: [],
    events: [],
    ...extra,
  };
}

describe('verifiedRatio', () => {
  test('is the share of the history Habba itself produced', () => {
    expect(verifiedRatio(reportAtVersion(2).coverage)).toBeCloseTo(0.4);
  });

  test('an empty history is 0%, not a division by zero', () => {
    expect(
      verifiedRatio({
        total: 0,
        habba_verified: 0,
        self_documented: 0,
        self_reported: 0,
        third_party: 0,
      }),
    ).toBe(0);
  });
});

describe('carriesWarrantyAndScore', () => {
  test('a version 1 payload never captured either, so the renderer must say nothing', () => {
    expect(carriesWarrantyAndScore(reportAtVersion(1))).toBe(false);
  });

  test('an EMPTY warranties array on a version 2 payload is a real answer', () => {
    // This is the whole reason the check is on the version and not on the
    // presence of the array: "nothing is under warranty" and "this report
    // predates warranty tracking" are different statements about the car, and
    // printing the first for the second would be a claim the data never made.
    expect(carriesWarrantyAndScore(reportAtVersion(2, { warranties: [], inspections: [] }))).toBe(
      true,
    );
  });

  test('a future version still carries them — the fields are additive', () => {
    expect(carriesWarrantyAndScore(reportAtVersion(REPORT_PAYLOAD_VERSION + 1))).toBe(true);
  });
});
