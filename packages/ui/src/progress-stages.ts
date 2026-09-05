/**
 * How each stage of a progress bar should look.
 *
 * Split out from the component so it can be tested: what separates "you are
 * here" from "you finished this" is the kind of thing that has to be asserted,
 * not eyeballed.
 *
 * The rule it encodes: **stage state is never carried by colour alone.**
 * Roughly one man in twelve has red-green colour blindness, and this bar
 * answers the one question §9.1 says matters to someone on the hard shoulder —
 * *which* stage am I in. Height and fill answer it without hue.
 */

export interface StageAppearance {
  /** Fraction of the track that is filled, 0–1. */
  readonly fill: number;
  /** Track height in dp. The current stage is thicker — a cue with no colour. */
  readonly height: number;
  readonly isDone: boolean;
  readonly isCurrent: boolean;
}

/**
 * What a current stage shows when nothing has said how far along it is.
 *
 * Not 1. A full bar is what *done* looks like, so defaulting to a full one
 * made every in-progress stage identical in shape to a completed one — and the
 * booking flow never passes progress at all, so all three of its steps looked
 * finished the moment you reached them. Just under half reads as "started, not
 * finished" at a glance and never overstates what is known.
 */
export const UNKNOWN_PROGRESS_FILL = 0.45;

const HEIGHT_UPCOMING = 4;
const HEIGHT_DONE = 4;
const HEIGHT_CURRENT = 7;

export function stageAppearance(
  index: number,
  currentIndex: number,
  currentProgress?: number | undefined,
): StageAppearance {
  const isDone = index < currentIndex;
  const isCurrent = index === currentIndex;

  if (isDone) return { fill: 1, height: HEIGHT_DONE, isDone, isCurrent };

  if (isCurrent) {
    const known = currentProgress === undefined ? UNKNOWN_PROGRESS_FILL : currentProgress;
    return {
      // Clamped, and never quite full: a current stage that renders at 1 is
      // indistinguishable from a finished one for anyone who cannot separate
      // the two hues.
      fill: Math.min(Math.max(known, 0), 0.95),
      height: HEIGHT_CURRENT,
      isDone,
      isCurrent,
    };
  }

  return { fill: 0, height: HEIGHT_UPCOMING, isDone, isCurrent };
}
