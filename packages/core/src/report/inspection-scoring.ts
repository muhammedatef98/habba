/**
 * The inspection score, mirrored from the database.
 *
 * `score_inspection`, `score_to_recommendation` and the completeness check
 * inside `submit_inspection_report` (migration 0026) are the authority
 * (CLAUDE.md §2.2). Nothing here decides anything: the number the buyer reads
 * is always the one Postgres computed and stored.
 *
 * The mirror exists because of what the inspector is doing while they fill the
 * form. They are standing next to a car with the seller watching, working
 * through forty-three items, and the two questions they need answered
 * continuously are "how much is left" and "what is this car scoring". Sending
 * a partial form to the server for each keystroke is not an option at a
 * roadside on a weak signal, and filing a report only to have Postgres reject
 * it for one unanswered item — after the car has been handed back — means
 * re-inspecting it.
 *
 * The same duplication risk applies as to `orders/job-flow.ts`: a mirror that
 * drifts is worse than no mirror, because it is confidently wrong. The parity
 * test reads the real template out of the database, scores the same results
 * both ways, and asserts they agree.
 */

import type {
  InspectionResultEntry,
  InspectionTemplateSection,
  ItemRating,
  Recommendation,
} from './inspection.js';

/** What the client holds while the form is being filled: sparse by nature. */
export type InspectionResults = Readonly<
  Record<string, Readonly<Record<string, InspectionResultEntry>>>
>;

/**
 * `rating_to_score`. `na` scores nothing AND weighs nothing — a car with no
 * sunroof is not marked down for the sunroof it does not have.
 */
function ratingToScore(rating: ItemRating | undefined): number | null {
  switch (rating) {
    case 'pass':
      return 100;
    case 'attention':
      return 60;
    case 'fail':
      return 0;
    default:
      return null;
  }
}

/** The caps a critical finding imposes, straight from 0026. */
const CRITICAL_FAIL_CAP = 45;
const CRITICAL_ATTENTION_CAP = 70;

/**
 * `round(v_total / v_weights)` the way Postgres does it, without ever dividing
 * in floating point.
 *
 * `numeric` division is exact decimal and rounds half away from zero; IEEE
 * doubles are neither. A weighted mean of 100/60/0 over integer weights lands
 * on an exact .5 often enough to matter — 1480/20 · ½ is not a contrived case
 * in a form of this size — and `72.5` arriving as `72.49999999999999` is a
 * point of score, which on the `negotiate`/`buy` boundary is the difference
 * between two different words in front of a buyer.
 *
 * floor((2·total + weights) / (2·weights)) is half-up, in integers, exactly.
 * Both sides stay far inside the safe-integer range: 100 × the sum of the
 * template's weights is a few thousand.
 */
function roundHalfUp(total: number, weights: number): number {
  if (Number.isInteger(total) && Number.isInteger(weights)) {
    return Math.floor((2 * total + weights) / (2 * weights));
  }
  // A template with fractional weights: nothing seeds one today, and the
  // parity test would catch it if one did. Half-up on a positive quotient.
  return Math.floor(total / weights + 0.5);
}

/**
 * `score_inspection`. Null when nothing scoreable was answered — which is not
 * zero, and must never be rendered as one.
 */
export function scoreInspection(
  sections: readonly InspectionTemplateSection[],
  results: InspectionResults,
): number | null {
  let total = 0;
  let weights = 0;
  let cap = 100;

  for (const section of sections) {
    const sectionResults = results[section.key];
    for (const item of section.items) {
      const rating = sectionResults?.[item.key]?.rating;
      const score = ratingToScore(rating);

      if (score !== null) {
        const weight = (item.weight ?? 1) * (section.weight ?? 1);
        total += score * weight;
        weights += weight;
      }

      // A weighted average cannot express "this one thing settles it", so a
      // critical finding caps the result instead of being averaged into it.
      if (item.critical === true) {
        if (rating === 'fail') cap = Math.min(cap, CRITICAL_FAIL_CAP);
        else if (rating === 'attention') cap = Math.min(cap, CRITICAL_ATTENTION_CAP);
      }
    }
  }

  if (weights === 0) return null;

  return Math.min(roundHalfUp(total, weights), cap);
}

/**
 * `score_to_recommendation`. Product policy, kept in one place server-side and
 * copied here for the same reason as the score: the inspector sees the word
 * their report is about to carry before they file it.
 */
export function recommendationFor(score: number | null): Recommendation | null {
  if (score === null) return null;
  if (score >= 80) return 'buy';
  if (score >= 60) return 'negotiate';
  return 'avoid';
}

/**
 * The required items still unanswered, as `section.item` keys.
 *
 * Mirrors the check `submit_inspection_report` runs before it writes anything:
 * a partially filled inspection that still produces a score looks complete to
 * a buyer while quietly omitting whatever the inspector skipped.
 */
export function missingRequiredItems(
  sections: readonly InspectionTemplateSection[],
  results: InspectionResults,
): readonly string[] {
  const missing: string[] = [];

  for (const section of sections) {
    const sectionResults = results[section.key];
    for (const item of section.items) {
      if (item.required !== true) continue;
      if (sectionResults?.[item.key]?.rating === undefined) {
        missing.push(`${section.key}.${item.key}`);
      }
    }
  }

  return missing;
}

export interface InspectionProgress {
  readonly answered: number;
  readonly total: number;
  readonly requiredAnswered: number;
  readonly requiredTotal: number;
  /** Every required item is answered — the server would accept this now. */
  readonly complete: boolean;
}

/** How far through the form the inspector is, counted the same way twice. */
export function inspectionProgress(
  sections: readonly InspectionTemplateSection[],
  results: InspectionResults,
): InspectionProgress {
  let answered = 0;
  let total = 0;
  let requiredAnswered = 0;
  let requiredTotal = 0;

  for (const section of sections) {
    const sectionResults = results[section.key];
    for (const item of section.items) {
      const isAnswered = sectionResults?.[item.key]?.rating !== undefined;
      total += 1;
      if (isAnswered) answered += 1;
      if (item.required === true) {
        requiredTotal += 1;
        if (isAnswered) requiredAnswered += 1;
      }
    }
  }

  return {
    answered,
    total,
    requiredAnswered,
    requiredTotal,
    complete: requiredAnswered === requiredTotal,
  };
}

/** Per-section progress, for the accordion header the inspector navigates by. */
export function sectionProgress(
  section: InspectionTemplateSection,
  results: InspectionResults,
): InspectionProgress {
  return inspectionProgress([section], results);
}
