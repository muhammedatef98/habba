import { describe, expect, it } from 'vitest';
import { isMirroredIcon, type IconName } from './icon-names.js';

/**
 * §8: "Icons that imply direction (arrows, chevrons, progress) must mirror in
 * RTL. Icons that don't (car, wrench) must not."
 *
 * The rule sat in the build prompt unimplemented while `chevronBack` drew one
 * fixed left-pointing chevron for both "back" and "onward" — right in Arabic
 * at the end of a row, wrong in English on a back button, with no way to be
 * right in both. These assertions are the rule, written down.
 */
describe('isMirroredIcon', () => {
  it('mirrors the glyphs that point somewhere', () => {
    for (const name of ['chevronBack', 'chevronForward', 'arrow'] as const) {
      expect(isMirroredIcon(name)).toBe(true);
    }
  });

  it('does not mirror a glyph whose meaning has no handedness', () => {
    // A wrench flipped in Arabic is a wrench drawn wrong, not a wrench for
    // left-handed people. Same for a car, a battery, a star.
    for (const name of ['tow', 'battery', 'tyre', 'wrench', 'star', 'person'] as const) {
      expect(isMirroredIcon(name)).toBe(false);
    }
  });

  it('does not mirror the vertical chevron — down is down in every locale', () => {
    expect(isMirroredIcon('chevronDown')).toBe(false);
  });

  it('treats back and forward as a mirrored pair, so neither can drift alone', () => {
    const back: IconName = 'chevronBack';
    const forward: IconName = 'chevronForward';
    expect(isMirroredIcon(back)).toBe(isMirroredIcon(forward));
  });
});
