/**
 * The completeness check the capture screen shows and the server enforces.
 *
 * `submit_inspection_report` (0026) refuses a partial report and names the
 * missing keys. That refusal is correct and arrives at the worst possible
 * moment — after the inspector has walked the car and tapped submit. These
 * functions let the screen say the same thing while they are still standing
 * there, so the two must agree exactly.
 *
 * `supabase/tests/09_inspections.sql` covers the server half against real
 * Postgres; this covers the mirror.
 */

import { describe, expect, test } from 'vitest';
import {
  isInspectionComplete,
  sectionProgress,
  unansweredRequired,
  type InspectionResultEntry,
  type InspectionTemplateSection,
} from './inspection.js';

const SECTIONS: readonly InspectionTemplateSection[] = [
  {
    key: 'engine',
    title_ar: 'المحرّك',
    items: [
      { key: 'oil_leaks', label_ar: 'تسريب زيت', required: true, weight: 2 },
      { key: 'cold_start', label_ar: 'التشغيل البارد', required: true },
      // Not required — a template can ask about a sunroof the car may not have.
      { key: 'belts', label_ar: 'السيور' },
    ],
  },
  {
    key: 'brakes',
    title_ar: 'الفرامل',
    items: [{ key: 'pads', label_ar: 'الفحمات', required: true }],
  },
];

const rated = (rating: InspectionResultEntry['rating']): InspectionResultEntry => ({ rating });

describe('unansweredRequired', () => {
  test('an empty report is missing every required item, and only those', () => {
    expect(unansweredRequired(SECTIONS, {})).toEqual([
      'engine.oil_leaks',
      'engine.cold_start',
      'brakes.pads',
    ]);
  });

  test('an optional item never appears', () => {
    // A car with no sunroof must not block the report on the sunroof it does
    // not have — the same reasoning that excludes `na` from the score.
    const full = {
      engine: { oil_leaks: rated('pass'), cold_start: rated('pass') },
      brakes: { pads: rated('attention') },
    };
    expect(unansweredRequired(SECTIONS, full)).toEqual([]);
    expect(isInspectionComplete(SECTIONS, full)).toBe(true);
  });

  test('`na` counts as answered', () => {
    // It is a real answer: "this car does not have one". `rating_to_score`
    // excludes it from the average rather than scoring it zero.
    expect(
      unansweredRequired(SECTIONS, {
        engine: { oil_leaks: rated('na'), cold_start: rated('pass') },
        brakes: { pads: rated('pass') },
      }),
    ).toEqual([]);
  });

  // ⚠️ The case the two implementations could disagree on. The server tests
  // `->> 'rating' is null`, so an entry that exists carrying only a note is
  // NOT answered. A mirror that checked for the entry's presence would show a
  // complete report and then be refused on submit.
  test('a note without a rating is not an answer', () => {
    const noteOnly = {
      engine: {
        oil_leaks: { note: 'أراجعها لاحقاً' } as unknown as InspectionResultEntry,
        cold_start: rated('pass'),
      },
      brakes: { pads: rated('pass') },
    };
    expect(unansweredRequired(SECTIONS, noteOnly)).toEqual(['engine.oil_leaks']);
    expect(isInspectionComplete(SECTIONS, noteOnly)).toBe(false);
  });

  test('a section absent from the results is missing, not skipped', () => {
    expect(
      unansweredRequired(SECTIONS, {
        engine: { oil_leaks: rated('pass'), cold_start: rated('pass') },
      }),
    ).toEqual(['brakes.pads']);
  });

  test('keys are `section.item`, which is what the server reports', () => {
    expect(unansweredRequired(SECTIONS, {})[0]).toBe('engine.oil_leaks');
  });
});

describe('sectionProgress', () => {
  test('counts every answered item, required or not', () => {
    const section = SECTIONS[0]!;
    expect(
      sectionProgress(section, { engine: { oil_leaks: rated('pass'), belts: rated('na') } }),
    ).toEqual({ answered: 2, total: 3, requiredMissing: 1 });
  });

  test('an untouched section reports its required count', () => {
    expect(sectionProgress(SECTIONS[1]!, {})).toEqual({
      answered: 0,
      total: 1,
      requiredMissing: 1,
    });
  });

  test('a finished section has nothing outstanding', () => {
    expect(sectionProgress(SECTIONS[1]!, { brakes: { pads: rated('fail') } })).toEqual({
      answered: 1,
      total: 1,
      requiredMissing: 0,
    });
  });
});
