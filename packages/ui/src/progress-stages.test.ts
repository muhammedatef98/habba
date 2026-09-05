import { describe, expect, test } from 'vitest';
import { stageAppearance, UNKNOWN_PROGRESS_FILL } from './progress-stages.js';

/**
 * The bar answers one question — which stage am I in — and it has to answer it
 * without colour. Roughly one man in twelve cannot separate the two hues it
 * uses, and this bar is read on the hard shoulder.
 */
describe('stage appearance', () => {
  test('a stage in progress never looks finished', () => {
    // The bug this replaces: `currentProgress ?? 1` filled the current stage
    // completely, so it was identical in shape to a done one and only the hue
    // told them apart. The booking flow passes no progress at all, so all
    // three of its steps looked finished the moment you arrived at them.
    const current = stageAppearance(1, 1);
    const done = stageAppearance(0, 1);

    expect(current.fill).toBeLessThan(done.fill);
    expect(current.fill).toBe(UNKNOWN_PROGRESS_FILL);
  });

  test('even a nearly-complete stage stays visibly unfinished', () => {
    expect(stageAppearance(1, 1, 1).fill).toBeLessThan(1);
    expect(stageAppearance(1, 1, 5).fill).toBeLessThan(1);
  });

  test('the current stage is taller than every other — a cue with no colour', () => {
    const heights = [0, 1, 2].map((index) => stageAppearance(index, 1).height);
    const [done, current, upcoming] = heights;

    expect(current).toBeGreaterThan(done ?? 0);
    expect(current).toBeGreaterThan(upcoming ?? 0);
  });

  test('done is full, upcoming is empty', () => {
    expect(stageAppearance(0, 2)).toMatchObject({ fill: 1, isDone: true, isCurrent: false });
    expect(stageAppearance(3, 2)).toMatchObject({ fill: 0, isDone: false, isCurrent: false });
  });

  test('a negative or absent progress value never renders as backwards', () => {
    expect(stageAppearance(1, 1, -1).fill).toBe(0);
  });

  test('the first stage before anything starts is current, not done', () => {
    expect(stageAppearance(0, 0)).toMatchObject({ isDone: false, isCurrent: true });
  });
});
