import { describe, expect, it } from 'vitest';
import {
  costCategoryFor,
  gradeFor,
  riyadhDay,
  scoreVehicleHealth,
  summariseCosts,
  type HealthInputs,
} from './insights.js';

const clean: HealthInputs = {
  careItems: 2,
  careOverdue: 0,
  careSnoozed: 0,
  careSoon: 0,
  documents: 1,
  documentsExpired: 0,
  documentsExpiring: 0,
  services: 0,
  documentedServices: 0,
  monthsSinceLastService: null,
  warrantyActive: false,
};

describe('scoreVehicleHealth — the same rule as 0097', () => {
  it('does not judge a car with nothing recorded', () => {
    expect(scoreVehicleHealth({ ...clean, careItems: 0, documents: 0 })).toEqual({
      score: null,
      grade: 'unknown',
      factors: [],
    });
  });

  it('is 100 and excellent with everything in date, and has nothing to explain', () => {
    expect(scoreVehicleHealth(clean)).toEqual({ score: 100, grade: 'excellent', factors: [] });
  });

  it('takes 15 per overdue item, capped at 45', () => {
    expect(scoreVehicleHealth({ ...clean, careOverdue: 2 }).score).toBe(70);
    expect(scoreVehicleHealth({ ...clean, careOverdue: 5 }).score).toBe(55);
  });

  it('takes 15 for an expired document, 5 for one expiring', () => {
    const health = scoreVehicleHealth({ ...clean, documentsExpired: 1, documentsExpiring: 1 });
    expect(health.score).toBe(80);
    expect(health.factors.map((factor) => factor.key)).toEqual([
      'documents_expired',
      'documents_expiring',
    ]);
  });

  it('takes up to 10 for undocumented services, by share', () => {
    const health = scoreVehicleHealth({ ...clean, services: 4, documentedServices: 1 });
    expect(health.factors).toEqual([{ key: 'undocumented', count: 3, impact: -8 }]);
  });

  it('notices a long gap since the last service', () => {
    const health = scoreVehicleHealth({
      ...clean,
      services: 2,
      documentedServices: 2,
      monthsSinceLastService: 20,
    });
    expect(health.score).toBe(90);
  });

  it('adds 5 for a live warranty, never past 100, never below 0', () => {
    expect(scoreVehicleHealth({ ...clean, warrantyActive: true }).score).toBe(100);
    expect(scoreVehicleHealth({ ...clean, careSoon: 1, warrantyActive: true }).score).toBe(100);
    expect(
      scoreVehicleHealth({
        ...clean,
        careOverdue: 9,
        careSnoozed: 9,
        careSoon: 9,
        documentsExpired: 3,
        documentsExpiring: 3,
      }).score,
    ).toBe(0);
  });

  it('grades at 85, 70 and 50', () => {
    expect([
      gradeFor(85),
      gradeFor(84),
      gradeFor(70),
      gradeFor(69),
      gradeFor(50),
      gradeFor(49),
    ]).toEqual(['excellent', 'good', 'good', 'fair', 'fair', 'attention']);
  });
});

describe('costCategoryFor — the same buckets as cost_bucket', () => {
  it('sorts orders by category and owner entries by the type they picked', () => {
    expect(costCategoryFor('emergency', null)).toBe('emergency');
    expect(costCategoryFor('periodic', null)).toBe('maintenance');
    expect(costCategoryFor(null, 'oil_change')).toBe('maintenance');
    expect(costCategoryFor(null, 'bodywork')).toBe('bodywork');
    expect(costCategoryFor(null, 'other')).toBe('other');
    expect(costCategoryFor(null, null)).toBe('other');
  });
});

describe('summariseCosts — the same arithmetic as vehicle_cost_summary', () => {
  const lines = [
    { day: '2026-09-12', halalas: 25_000, category: 'maintenance' as const },
    { day: '2026-01-03', halalas: 10_050, category: 'emergency' as const },
    { day: '2024-08-01', halalas: 120_050, category: 'bodywork' as const },
  ];

  it('totals all time, the 12 months, and this year', () => {
    const summary = summariseCosts(lines, '2026-10-02', 0);
    expect([summary.total, summary.last12Months, summary.thisYear, summary.entries]).toEqual([
      '1551.00',
      '350.50',
      '350.50',
      3,
    ]);
  });

  it('gives twelve months ending this one, which add up to the 12-month total', () => {
    const summary = summariseCosts(lines, '2026-10-02', 0);
    expect(summary.months).toHaveLength(12);
    expect(summary.months[0]?.month).toBe('2025-11');
    expect(summary.months[11]?.month).toBe('2026-10');
    expect(summary.months.find((m) => m.month === '2026-09')?.amount).toBe('250.00');
  });

  it('splits the 12 months by category, largest first', () => {
    expect(summariseCosts(lines, '2026-10-02', 0).categories).toEqual([
      { category: 'maintenance', amount: '250.00' },
      { category: 'emergency', amount: '100.50' },
    ]);
  });

  it('gives a cost per 1,000 km only once the car has moved 500 km', () => {
    expect(summariseCosts(lines, '2026-10-02', 499).per1000Km).toBeNull();
    expect(summariseCosts(lines, '2026-10-02', 1500).per1000Km).toBe('233.67');
  });

  it('reads the day in Riyadh', () => {
    expect(riyadhDay(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01-01');
  });
});
