import { describe, expect, test } from 'vitest';
import {
  inspectionProgress,
  missingRequiredItems,
  recommendationFor,
  scoreInspection,
  sectionProgress,
  type InspectionResults,
} from './inspection-scoring.js';
import type { InspectionTemplateSection } from './inspection.js';

/**
 * A miniature of `pre_purchase_v1`: one heavy section with a critical item,
 * one light one, and a mix of required and optional. The shapes that matter
 * are all here — the full template adds forty more rows of the same two kinds.
 */
const SECTIONS: readonly InspectionTemplateSection[] = [
  {
    key: 'engine',
    title_ar: 'المحرك',
    weight: 3,
    items: [
      { key: 'oil_leaks', label_ar: 'تسريب زيت', weight: 2, required: true },
      { key: 'idle', label_ar: 'ثبات الدوران', required: true },
      { key: 'belts', label_ar: 'السيور' },
    ],
  },
  {
    key: 'interior',
    title_ar: 'الفرش الداخلي',
    weight: 1,
    items: [
      { key: 'seats', label_ar: 'المقاعد', required: true },
      { key: 'odour', label_ar: 'الروائح' },
    ],
  },
  {
    key: 'history',
    title_ar: 'تاريخ الحوادث',
    weight: 4,
    items: [
      {
        key: 'accident_evidence',
        label_ar: 'آثار حوادث',
        weight: 4,
        required: true,
        critical: true,
      },
    ],
  },
];

/** Every item answered `pass`, as the baseline to perturb. */
function allPass(): InspectionResults {
  const results: Record<string, Record<string, { rating: 'pass' }>> = {};
  for (const section of SECTIONS) {
    results[section.key] = {};
    for (const item of section.items) {
      results[section.key]![item.key] = { rating: 'pass' };
    }
  }
  return results;
}

function withRating(
  base: InspectionResults,
  sectionKey: string,
  itemKey: string,
  rating: 'pass' | 'attention' | 'fail' | 'na',
): InspectionResults {
  return {
    ...base,
    [sectionKey]: { ...base[sectionKey], [itemKey]: { rating } },
  };
}

describe('scoreInspection', () => {
  test('a car with nothing wrong scores 100', () => {
    expect(scoreInspection(SECTIONS, allPass())).toBe(100);
  });

  test('nothing answered is null, which is not zero', () => {
    // Zero is a verdict — "this car is worthless". An empty form is the
    // absence of one, and the difference has to survive all the way to the UI.
    expect(scoreInspection(SECTIONS, {})).toBeNull();
  });

  test('`na` is excluded from the denominator rather than scored as zero', () => {
    // A car with no sunroof must not be marked down for the sunroof it does
    // not have. Every remaining item passes, so the score stays 100.
    const results = withRating(allPass(), 'interior', 'odour', 'na');
    expect(scoreInspection(SECTIONS, results)).toBe(100);
  });

  test('weights make a heavy section count for more than a light one', () => {
    const engineFail = withRating(allPass(), 'engine', 'oil_leaks', 'fail');
    const interiorFail = withRating(allPass(), 'interior', 'seats', 'fail');

    const engineScore = scoreInspection(SECTIONS, engineFail);
    const interiorScore = scoreInspection(SECTIONS, interiorFail);

    expect(engineScore).not.toBeNull();
    expect(interiorScore).not.toBeNull();
    expect(engineScore!).toBeLessThan(interiorScore!);
  });

  test('a critical failure caps the score instead of being averaged away', () => {
    // This is the whole argument of the cap (0026). Weighted averaging alone
    // put a car with confirmed accident repair at 92% and `buy`, because one
    // failure among forty sound items barely moves a mean — which is the kind
    // of number that sends a buyer into a bad purchase feeling reassured.
    const results = withRating(allPass(), 'history', 'accident_evidence', 'fail');
    const score = scoreInspection(SECTIONS, results);

    expect(score).toBeLessThanOrEqual(45);
    expect(recommendationFor(score)).toBe('avoid');
  });

  test('a critical item needing attention caps lower but not to `avoid`', () => {
    const results = withRating(allPass(), 'history', 'accident_evidence', 'attention');
    const score = scoreInspection(SECTIONS, results);

    expect(score).toBeLessThanOrEqual(70);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(recommendationFor(score)).toBe('negotiate');
  });

  test('the cap is a ceiling, never a floor', () => {
    // A critical `fail` on a car that is otherwise a wreck must not be lifted
    // UP to 45 by the cap. `least()` server-side; `Math.min` here.
    let results = withRating(allPass(), 'history', 'accident_evidence', 'fail');
    for (const item of SECTIONS[0]!.items) {
      results = withRating(results, 'engine', item.key, 'fail');
    }
    for (const item of SECTIONS[1]!.items) {
      results = withRating(results, 'interior', item.key, 'fail');
    }

    expect(scoreInspection(SECTIONS, results)).toBe(0);
  });

  test('rounds half up, in integers, the way numeric does', () => {
    // Two items of equal weight, one `pass` and one `attention`: 160/2 = 80.
    // The case that matters is the one that lands on a half — computed in
    // floating point, a .5 can arrive as .49999999999999 and lose a point,
    // and on the 80 boundary that point changes `buy` into `negotiate`.
    const halfway: readonly InspectionTemplateSection[] = [
      {
        key: 's',
        title_ar: 'قسم',
        items: [
          { key: 'a', label_ar: 'أ' },
          { key: 'b', label_ar: 'ب' },
          { key: 'c', label_ar: 'ج' },
        ],
      },
    ];
    // (100 + 100 + 60) / 3 = 86.666… → 87
    expect(
      scoreInspection(halfway, {
        s: { a: { rating: 'pass' }, b: { rating: 'pass' }, c: { rating: 'attention' } },
      }),
    ).toBe(87);

    // (100 + 0) / 2 = 50 exactly.
    expect(scoreInspection(halfway, { s: { a: { rating: 'pass' }, b: { rating: 'fail' } } })).toBe(
      50,
    );

    // (60 + 0) / 2 = 30, and (100 + 60 + 0) / 3 = 53.33… → 53.
    expect(
      scoreInspection(halfway, { s: { a: { rating: 'attention' }, b: { rating: 'fail' } } }),
    ).toBe(30);
    expect(
      scoreInspection(halfway, {
        s: { a: { rating: 'pass' }, b: { rating: 'attention' }, c: { rating: 'fail' } },
      }),
    ).toBe(53);
  });
});

describe('recommendationFor', () => {
  test('the thresholds are the ones the database publishes', () => {
    expect(recommendationFor(100)).toBe('buy');
    expect(recommendationFor(80)).toBe('buy');
    expect(recommendationFor(79)).toBe('negotiate');
    expect(recommendationFor(60)).toBe('negotiate');
    expect(recommendationFor(59)).toBe('avoid');
    expect(recommendationFor(0)).toBe('avoid');
  });

  test('no score is no recommendation — never `avoid` by default', () => {
    // An unfinished inspection must not read as a verdict against the car.
    expect(recommendationFor(null)).toBeNull();
  });
});

describe('missingRequiredItems', () => {
  test('an empty form is missing every required item and no optional one', () => {
    const missing = missingRequiredItems(SECTIONS, {});
    expect(missing).toEqual([
      'engine.oil_leaks',
      'engine.idle',
      'interior.seats',
      'history.accident_evidence',
    ]);
  });

  test('`na` counts as an answer — "does not apply" is a finding', () => {
    const results = withRating(allPass(), 'engine', 'idle', 'na');
    expect(missingRequiredItems(SECTIONS, results)).toEqual([]);
  });

  test('a note without a rating is not an answer', () => {
    // The server reads `->> 'rating'`, so an entry carrying only a note is
    // unanswered there too. If this disagreed, the app would let the inspector
    // file and the database would refuse it.
    const results: InspectionResults = { engine: { oil_leaks: { rating: 'pass' } } };
    expect(missingRequiredItems(SECTIONS, results)).toContain('engine.idle');
  });
});

describe('inspectionProgress', () => {
  test('counts answered against total, and required separately', () => {
    const results: InspectionResults = {
      engine: { oil_leaks: { rating: 'pass' }, belts: { rating: 'pass' } },
    };
    const progress = inspectionProgress(SECTIONS, results);

    expect(progress).toEqual({
      answered: 2,
      total: 6,
      requiredAnswered: 1,
      requiredTotal: 4,
      complete: false,
    });
  });

  test('complete means the server would accept it, not that the form is full', () => {
    // Optional items left blank are a finished inspection. Treating them as
    // outstanding would have the inspector chasing a progress bar the server
    // does not care about.
    const requiredOnly: InspectionResults = {
      engine: { oil_leaks: { rating: 'pass' }, idle: { rating: 'pass' } },
      interior: { seats: { rating: 'pass' } },
      history: { accident_evidence: { rating: 'pass' } },
    };

    const progress = inspectionProgress(SECTIONS, requiredOnly);
    expect(progress.complete).toBe(true);
    expect(progress.answered).toBeLessThan(progress.total);
    expect(missingRequiredItems(SECTIONS, requiredOnly)).toEqual([]);
  });
});

describe('sectionProgress', () => {
  test('scopes the same count to one section', () => {
    const results: InspectionResults = { engine: { oil_leaks: { rating: 'fail' } } };
    expect(sectionProgress(SECTIONS[0]!, results)).toMatchObject({
      answered: 1,
      total: 3,
      requiredAnswered: 1,
      requiredTotal: 2,
      complete: false,
    });
  });
});
