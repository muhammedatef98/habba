/**
 * Icon names and the direction rule, with no React Native imports.
 *
 * Split from `Icon.tsx` so §8's mirroring rule can be asserted in a plain Node
 * test. Importing the component would pull in react-native and
 * react-native-svg, which is why the rule was previously only observable by
 * looking at a device — and a product decision that can only be checked by
 * eye is one nobody notices breaking.
 */

export type IconName =
  // services
  | 'tow'
  | 'battery'
  | 'tyre'
  | 'lockout'
  | 'fuel'
  | 'radiator'
  // navigation
  | 'home'
  | 'calendar'
  | 'wallet'
  | 'person'
  | 'chevronDown'
  // Direction-carrying, and named by MEANING rather than by which way the art
  // points: `chevronBack` always means "go back" and `chevronForward` always
  // means "onward", in both directions. See MIRRORED below.
  | 'chevronBack'
  | 'chevronForward'
  | 'arrow'
  // actions and status
  | 'phone'
  | 'chat'
  | 'check'
  | 'star'
  | 'mic'
  | 'flipCamera'
  | 'locate'
  | 'edit'
  | 'share'
  | 'bell'
  | 'alert'
  | 'gauge'
  // Bookable catalogue. The emergency set above was drawn first and these were
  // being borrowed from it — every periodic service rendered as `gauge`, which
  // made the booking list five identical rows with different words on them.
  | 'oil'
  | 'brake'
  | 'ac'
  | 'wash'
  | 'inspection'
  | 'wrench';

/**
 * Glyphs that must flip with the reading direction (§8).
 *
 * "Icons that imply direction (arrows, chevrons, progress) must mirror in RTL.
 * Icons that don't (car, wrench) must not." The rule was written in the build
 * prompt and never implemented, and `chevronBack` was doing the work of two
 * icons: it drew a fixed left-pointing chevron, which happened to read as
 * "onward" at the end of a row in Arabic and as "back" on a back button in
 * English — so it was wrong exactly half the time in each language, and the
 * app had no way to be right in both.
 *
 * Splitting it into back/forward and mirroring both is what makes the pair
 * correct in either direction. `chevronDown` is not here: down is down.
 */
const MIRRORED: ReadonlySet<IconName> = new Set<IconName>([
  'chevronBack',
  'chevronForward',
  'arrow',
]);

/**
 * Whether this glyph flips with the reading direction.
 *
 * Exported so the rule can be asserted in a test rather than only observed on
 * a device — §8's distinction between a chevron and a wrench is a product
 * decision, and a product decision that only exists inside a render function
 * is one nobody notices breaking.
 */
export function isMirroredIcon(name: IconName): boolean {
  return MIRRORED.has(name);
}
