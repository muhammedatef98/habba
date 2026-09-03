import { describe, expect, test } from 'vitest';
import { clampedFontScale, MAX_BODY_SCALE, MAX_HEADING_SCALE, scaledHeight } from './font-scale.js';

/**
 * The device's text-size setting is honoured, within bounds the layout can
 * actually hold. Habba's customers are car owners; the over-fifties are a large
 * share of them, and enlarged text is the first setting anyone changes.
 */
describe('font scale', () => {
  test('follows the device setting', () => {
    expect(clampedFontScale(1.3)).toBe(1.3);
  });

  test('never shrinks text, whatever the device reports', () => {
    // A multiplier below 1 would make the app less readable than its own
    // defaults for someone who asked for nothing.
    expect(clampedFontScale(0.8)).toBe(1);
    expect(clampedFontScale(0)).toBe(1);
  });

  test('caps the accessibility sizes', () => {
    // iOS reaches 3.1×. Unbounded, a two-word button label becomes a paragraph
    // and the primary action leaves the screen.
    expect(clampedFontScale(3.1)).toBe(MAX_BODY_SCALE);
    expect(clampedFontScale(3.1, MAX_HEADING_SCALE)).toBe(MAX_HEADING_SCALE);
  });

  test('headings are capped lower than body copy', () => {
    // 40px display type has far less room to grow than 12px captions before it
    // stops fitting a phone at all.
    expect(MAX_HEADING_SCALE).toBeLessThan(MAX_BODY_SCALE);
  });

  test('a box grows with the text it holds', () => {
    // A 56dp button at 1.5× needs 84dp, or the label is clipped by the very
    // control that is meant to be readable.
    expect(scaledHeight(56, 1)).toBe(56);
    expect(scaledHeight(56, 1.5)).toBe(84);
    // And stops growing where the text does.
    expect(scaledHeight(56, 3.1)).toBe(Math.round(56 * MAX_BODY_SCALE));
  });

  test('the 48dp touch target is a floor, never a ceiling', () => {
    expect(scaledHeight(48, 1)).toBe(48);
    expect(scaledHeight(48, 1.4)).toBeGreaterThan(48);
  });

  test('a broken reading never becomes a broken layout', () => {
    expect(clampedFontScale(Number.NaN)).toBe(1);
    expect(clampedFontScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
