/**
 * How an inspection finding looks and what it is called.
 *
 * Shared rather than duplicated because the same four ratings are rendered on
 * both sides of the same record: the inspector chooses them at the car, and
 * the buyer reads them back. If the two drifted — a `fail` amber in one place
 * and red in the other — the inspector would be filing something other than
 * what the buyer sees, which is the only thing this document has to get right.
 *
 * The ratings themselves are the server's: `rating_to_score` scores exactly
 * these four and nothing else (0026).
 */

import type { ColorScheme } from '@habba/ui';
import type { ItemRating, Recommendation } from '@habba/core';

export type FindingTone = 'good' | 'warn' | 'bad' | 'neutral';

/** Every rating, in the order they are offered — best to worst, then `na`. */
export const ITEM_RATINGS: readonly ItemRating[] = ['pass', 'attention', 'fail', 'na'];

export const RATING_LABEL_KEY: Record<ItemRating, string> = {
  pass: 'inspection.ratingPass',
  attention: 'inspection.ratingAttention',
  fail: 'inspection.ratingFail',
  na: 'inspection.ratingNa',
};

export const RECOMMENDATION_LABEL_KEY: Record<Recommendation, string> = {
  buy: 'inspection.verdictBuy',
  negotiate: 'inspection.verdictNegotiate',
  avoid: 'inspection.verdictAvoid',
};

export function ratingTone(rating: ItemRating): FindingTone {
  switch (rating) {
    case 'pass':
      return 'good';
    case 'attention':
      return 'warn';
    case 'fail':
      return 'bad';
    default:
      // `na` is not a middling result, it is the absence of one. Neutral, so
      // a row of "does not apply" never reads as a row of near-misses.
      return 'neutral';
  }
}

export function recommendationTone(recommendation: Recommendation | null): FindingTone {
  switch (recommendation) {
    case 'buy':
      return 'good';
    case 'negotiate':
      return 'warn';
    case 'avoid':
      return 'bad';
    default:
      // No score is no verdict. Rendering null as `avoid` would have an
      // unfinished form read as a judgement against the car.
      return 'neutral';
  }
}

export interface FindingColors {
  readonly foreground: string;
  readonly background: string;
  readonly border: string;
}

/**
 * §8 reserves red for genuine emergencies and nothing else. A `fail` gets it
 * anyway, deliberately: the public report already prints these findings in the
 * same red (`--bad` in `renderInspectionReport`), and a buyer who reads the
 * shared link and then opens the app must not find the same finding
 * downgraded to amber on the way. It is also, in the most literal sense, the
 * warning this product exists to give — a cracked chassis on a car somebody is
 * about to pay for.
 */
export function findingColors(tone: FindingTone, colors: ColorScheme): FindingColors {
  switch (tone) {
    case 'good':
      return {
        foreground: colors.successFg,
        background: colors.successSubtle,
        border: colors.successBorder,
      };
    case 'warn':
      return {
        foreground: colors.warningFg,
        background: colors.warningSubtle,
        border: colors.warningBorder,
      };
    case 'bad':
      return {
        foreground: colors.emergencyFg,
        background: colors.emergencySubtle,
        border: colors.emergencyBorder,
      };
    default:
      return {
        foreground: colors.textMuted,
        background: colors.surfaceSunken,
        border: colors.border,
      };
  }
}

/**
 * The score as a tone, for the one number the buyer looks at first.
 *
 * Derived from the recommendation rather than from its own thresholds: the
 * word and the colour must agree, and two sets of boundaries would eventually
 * disagree on a car sitting exactly on 80.
 */
export function scoreTone(
  score: number | null,
  recommendation: Recommendation | null,
): FindingTone {
  if (score === null) return 'neutral';
  return recommendationTone(recommendation);
}
