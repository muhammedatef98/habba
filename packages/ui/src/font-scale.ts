/**
 * Following the device's text-size setting without letting it break the layout.
 *
 * React Native scales text with the OS setting by default, so the app already
 * grew its type — and nothing else. Every fixed height stayed where it was, so
 * at the larger settings a button label was clipped by the button and a chip's
 * text ran out of its pill. The setting was honoured in the one place that
 * made it unreadable.
 *
 * Two rules, and both matter:
 *
 * 1. **Boxes grow with the text they hold.** A 56dp button at a 1.5× setting
 *    needs 84dp, or the words do not fit. Heights are multiplied here rather
 *    than hardcoded larger, so nothing changes for the default setting.
 * 2. **The multiplier is capped.** iOS accessibility sizes reach 3.1×, which
 *    would turn a two-word button into a paragraph and push the primary action
 *    off screen. Capping is the standard answer, and the cap is lower for
 *    display type than for body: 40px headline copy has far less room to grow
 *    than 12px caption copy before it stops fitting a phone at all.
 *
 * This is not a small audience. Habba's customers are car owners — the
 * over-fifties are a large share of them, and enlarged text is the first
 * setting anyone changes.
 */

/**
 * Ceiling for body-sized copy. 1.6 is roughly iOS's "Large" accessibility step
 * and about as far as a two-line button label can stretch before wrapping to
 * three.
 */
export const MAX_BODY_SCALE = 1.6;

/**
 * Ceiling for display and title type. Lower on purpose: those sizes are
 * already 32–40px, and the same multiplier that is comfortable on a caption
 * pushes a headline into four lines.
 */
export const MAX_HEADING_SCALE = 1.3;

/** The device setting, clamped. Never below 1 — shrinking text helps nobody. */
export function clampedFontScale(scale: number, max: number = MAX_BODY_SCALE): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, 1), max);
}

/**
 * A fixed height, grown to fit text at the given setting.
 *
 * Takes the scale rather than reading it, so the arithmetic stays testable in
 * plain Node — a module that imports react-native cannot be loaded by Vitest.
 * Callers pass `PixelRatio.getFontScale()`.
 *
 * Rounded because fractional heights produce off-by-one seams between adjacent
 * bordered elements on some densities.
 */
export function scaledHeight(base: number, scale: number, max: number = MAX_BODY_SCALE): number {
  return Math.round(base * clampedFontScale(scale, max));
}
