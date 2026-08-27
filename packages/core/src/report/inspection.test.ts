import { describe, expect, test } from 'vitest';
import {
  collectFindings,
  countByRating,
  renderInspectionReport,
  type InspectionReport,
} from './inspection.js';

const REPORT: InspectionReport = {
  report_version: 1,
  completed_at: '2026-08-27T10:00:00Z',
  subject: {
    vin: '1HGBH41JXMN109186',
    plate: 'ABJ3333',
    make_ar: 'تويوتا',
    model_ar: 'كامري',
    year: 2018,
    mileage: 120000,
  },
  overall_score: 64,
  recommendation: 'negotiate',
  template: {
    key: 'pre_purchase_v1',
    name_ar: 'فحص ما قبل الشراء',
    sections: [
      {
        key: 'engine',
        title_ar: 'المحرك',
        weight: 3,
        items: [
          { key: 'oil_leaks', label_ar: 'تسريب زيت', weight: 2 },
          { key: 'idle', label_ar: 'ثبات الدوران' },
        ],
      },
      {
        key: 'interior',
        title_ar: 'الفرش الداخلي',
        weight: 1,
        items: [{ key: 'seats', label_ar: 'المقاعد' }],
      },
      {
        key: 'history',
        title_ar: 'تاريخ الحوادث',
        weight: 4,
        items: [{ key: 'accident_evidence', label_ar: 'آثار حوادث', weight: 4 }],
      },
    ],
  },
  results: {
    engine: {
      oil_leaks: { rating: 'attention', note: 'تسريب بسيط من غطاء البلوف' },
      idle: { rating: 'pass' },
    },
    interior: { seats: { rating: 'fail' } },
    history: { accident_evidence: { rating: 'fail', note: 'إصلاح في الربع الأمامي الأيسر' } },
  },
};

const OPTIONS = { publicUrl: 'https://habba.sa/i/tok123' };

describe('collectFindings', () => {
  test('returns only problems, never the things that passed', () => {
    const findings = collectFindings(REPORT);
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.rating === 'fail' || f.rating === 'attention')).toBe(true);
  });

  test('orders by what it costs to fix, not by template order', () => {
    // Accident evidence (weight 4 × section 4, failing) must outrank a torn
    // seat (weight 1 × section 1) even though the seat comes first in the
    // template. A buyer reads the top of the list and stops.
    const findings = collectFindings(REPORT);
    expect(findings[0]?.section).toBe('تاريخ الحوادث');
    expect(findings.at(-1)?.label).toBe('المقاعد');
  });

  test('carries the inspector note through', () => {
    const findings = collectFindings(REPORT);
    expect(findings[0]?.note).toContain('الربع الأمامي');
  });

  test('is empty for a clean car', () => {
    const clean: InspectionReport = {
      ...REPORT,
      results: {
        engine: { oil_leaks: { rating: 'pass' }, idle: { rating: 'pass' } },
        interior: { seats: { rating: 'pass' } },
        history: { accident_evidence: { rating: 'pass' } },
      },
    };
    expect(collectFindings(clean)).toHaveLength(0);
  });
});

describe('countByRating', () => {
  test('counts every answered item', () => {
    expect(countByRating(REPORT)).toEqual({ pass: 1, attention: 1, fail: 2, na: 0 });
  });

  test('ignores items the template defines but the inspector left unanswered', () => {
    const partial: InspectionReport = {
      ...REPORT,
      results: { engine: { idle: { rating: 'pass' } } },
    };
    expect(countByRating(partial)).toEqual({ pass: 1, attention: 0, fail: 0, na: 0 });
  });
});

describe('renderInspectionReport', () => {
  const html = renderInspectionReport(REPORT, OPTIONS);

  test('is a self-contained Arabic RTL document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/src="http/);
    expect(html).toContain('noindex');
  });

  test('leads with the findings, not just the score', () => {
    // The buyer needs "what is wrong with this car" before "what did it
    // score" — a reassuring number invites them to stop reading.
    const findingsIndex = html.indexOf('الملاحظات والأعطال');
    const detailIndex = html.indexOf('بيانات السيارة');
    expect(findingsIndex).toBeGreaterThan(-1);
    expect(findingsIndex).toBeLessThan(detailIndex);
  });

  test('shows the score and the recommendation in words', () => {
    expect(html).toContain('64%');
    expect(html).toContain('قابلة للتفاوض');
  });

  test('states that the report describes the car at inspection time only', () => {
    // Without this, a report reads as a warranty. It is not one.
    expect(html).toContain('وقت الفحص فقط');
  });

  test('renders the car identity a buyer checks against', () => {
    expect(html).toContain('1HGBH41JXMN109186');
    expect(html).toContain('ABJ3333');
    expect(html).toContain('120,000');
  });

  test('escapes inspector-typed notes', () => {
    const hostile: InspectionReport = {
      ...REPORT,
      results: {
        ...REPORT.results,
        history: {
          accident_evidence: { rating: 'fail', note: '<img src=x onerror=alert(1)>' },
        },
      },
    };
    const rendered = renderInspectionReport(hostile, OPTIONS);
    expect(rendered).not.toContain('<img src=x');
    expect(rendered).toContain('&lt;img src=x');
  });

  test('handles a report with no score without printing NaN', () => {
    const unscored: InspectionReport = {
      ...REPORT,
      overall_score: null,
      recommendation: null,
    };
    const rendered = renderInspectionReport(unscored, OPTIONS);
    expect(rendered).not.toContain('NaN');
    expect(rendered).toContain('—');
  });

  test('never renders the buyer identity', () => {
    expect(html).not.toContain('+9665');
    expect(html).not.toContain('customer_id');
  });
});
