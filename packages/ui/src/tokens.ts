/**
 * Habba design tokens.
 *
 * Ported from `Habba Design System.dc.html` (Claude Design handoff, Aug 2026),
 * which is the source of truth for the palette. Build prompt §8.
 *
 * The category is full of generic blue "trust" apps and aggressive red
 * "emergency" apps — this is deliberately neither. The name means both *a gust
 * of wind* and *to rush to someone's aid*. The palette follows: deep desert
 * teal for calm competence, warm sand for action. Red is reserved exclusively
 * for genuine emergencies, never for marketing — if everything is urgent,
 * nothing is.
 *
 * Context that drove these choices: people use this one-handed, stressed, at
 * the roadside, often at night. Hence large touch targets, high contrast, and
 * dark mode as a first-class theme rather than an afterthought.
 *
 * FOUR VALUES DIVERGE FROM THE DESIGN FILE, each because the design used a
 * colour valid as a border or dot for small *text*, below the 4.5:1 floor that
 * tokens.test.ts enforces. Three are resolved by promoting the text role to a
 * darker step the designer already chose; only petrol[400] is new. Each is
 * marked `WCAG:` inline below.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const petrol = {
  50: '#EFF7F6',
  100: '#D9EBE9',
  200: '#A9D2CE',
  300: '#6FB3AE',
  // WCAG: the design's dark primary is 500 (#2E8A84), but its own dark label
  // (#04211F) measures 4.09:1 on it — fine for the 19px/700 CTAs, failing for
  // the 16px call button. 400 is that teal lifted to 4.75:1 at any size.
  400: '#34968F',
  500: '#2E8A84',
  600: '#12514F', // base — primary in light
  800: '#0B2E2E',
  900: '#04211F',
} as const;

const sand = {
  50: '#FBEDD6',
  200: '#F6D6A6',
  400: '#F0BC72',
  500: '#E8A33D', // base — accent
  600: '#B87F22',
  700: '#8A5A16',
} as const;

/**
 * Ink and surfaces. The design specifies these as flat pairs rather than a
 * ramp, so they are named by role, not by step.
 */
const light = {
  bg: '#F6F3ED',
  surface: '#FFFFFF',
  sunken: '#F0EBE1',
  border: '#E2DDD2',
  borderStrong: '#CFD6D4',
  ink: '#14201F',
  inkMuted: '#4A5654',
  inkSubtle: '#66706E',
} as const;

const dark = {
  bg: '#071A1A',
  surface: '#0F2A29',
  sunken: '#0A2322',
  border: '#204442',
  borderStrong: '#2C5250',
  ink: '#EFF3F1',
  inkMuted: '#8AA3A0',
  // WCAG: the design's dark tertiary (#5C7472) is 3.58:1 on bg — it fails at
  // the 12px timestamps it was used for. Minimally darkened to clear 4.5:1.
  // #5C7472 itself remains correct for borders and dots (see borderStrong).
  inkSubtle: '#6E8785',
} as const;

/** Reserved for genuine emergencies. Never decorative, never marketing (§8). */
const emergency = {
  50: '#FDF3F2',
  400: '#E06B60',
  500: '#C4342A',
  600: '#9E2820',
} as const;

const success = { 50: '#E9F6F0', 400: '#5FC493', 500: '#1F8A5B', 600: '#15613F' } as const;

/**
 * The design deliberately makes warning and accent the same amber: a
 * non-emergency alert must never borrow the emergency red. Aliased rather
 * than duplicated so the two can never drift apart.
 */
const warning = sand;

/** New in this port — the previous palette had no informational colour. */
const info = { 50: '#ECF3F5', 400: '#7FB6C8', 500: '#3E7C8F', 600: '#2F6070' } as const;

export const palette = { petrol, sand, light, dark, emergency, success, warning, info } as const;

// ---------------------------------------------------------------------------
// Semantic colours — light and dark are both designed, not derived
// ---------------------------------------------------------------------------

export interface ColorScheme {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceSunken: string;
  readonly border: string;
  readonly borderStrong: string;

  readonly text: string;
  readonly textMuted: string;
  readonly textSubtle: string;
  readonly textInverse: string;

  readonly primary: string;
  readonly primaryHover: string;
  readonly primaryText: string;
  readonly primarySubtle: string;

  readonly accent: string;
  readonly accentHover: string;
  readonly accentText: string;
  readonly accentSubtle: string;
  /** Amber as *text* — the accent itself is too light to read at body size. */
  readonly accentFg: string;

  readonly emergency: string;
  readonly emergencyText: string;
  /** Text/icon color for emergency state on surface or emergencySubtle. Passes 4.5:1. */
  readonly emergencyFg: string;
  readonly emergencySubtle: string;
  readonly emergencyBorder: string;
  readonly success: string;
  /** Text/icon color for success state on surface or successSubtle. Passes 4.5:1. */
  readonly successFg: string;
  readonly successSubtle: string;
  readonly successBorder: string;
  readonly warning: string;
  /** Text/icon color for warning state on surface or warningSubtle. Passes 4.5:1. */
  readonly warningFg: string;
  readonly warningSubtle: string;
  readonly info: string;
  readonly infoFg: string;
  readonly infoSubtle: string;

  readonly textLink: string;

  /** ADR-0005: verified and owner-entered must never look the same. */
  readonly verified: string;
  readonly verifiedSubtle: string;
  readonly selfReported: string;
  readonly selfReportedSubtle: string;

  readonly focusRing: string;
  readonly overlay: string;
}

export const lightColors: ColorScheme = {
  background: light.bg,
  surface: light.surface,
  surfaceRaised: light.surface,
  surfaceSunken: light.sunken,
  border: light.border,
  borderStrong: light.borderStrong,

  text: light.ink,
  textMuted: light.inkMuted,
  // WCAG: the design's de-emphasised timestamps use #9AA3A1, which is 2.33:1
  // on the page background — below even the large-text floor. Promoted to the
  // design's own caption grey.
  textSubtle: light.inkSubtle,
  textInverse: light.surface,

  primary: petrol[600],
  primaryHover: petrol[800],
  primaryText: light.surface,
  primarySubtle: petrol[50],

  accent: sand[500],
  accentHover: sand[600],
  accentText: light.ink,
  accentSubtle: sand[50],
  // WCAG: sand[600] measures 3.44:1 on white — it fails for the 18px/600 price
  // numerals it was used for. sand[700] is the designer's own next step down.
  accentFg: sand[700],

  emergency: emergency[500],
  emergencyText: light.surface,
  emergencyFg: emergency[600],
  emergencySubtle: emergency[50],
  emergencyBorder: '#F0D3D0',
  success: success[500],
  successFg: success[600],
  successSubtle: success[50],
  successBorder: '#BFE3D2',
  warning: warning[500],
  warningFg: warning[700],
  warningSubtle: warning[50],
  info: info[500],
  infoFg: info[600],
  infoSubtle: info[50],

  textLink: petrol[600],

  verified: petrol[600],
  verifiedSubtle: petrol[50],
  // inkMuted, not inkSubtle: the badge sits on the *sunken* surface, which is
  // darker than the page background, and inkSubtle measured 4.30:1 there —
  // under the 4.5:1 floor. Caught by tokens.test.ts.
  selfReported: light.inkMuted,
  selfReportedSubtle: light.sunken,

  focusRing: petrol[400],
  overlay: 'rgba(20, 32, 31, 0.55)',
};

export const darkColors: ColorScheme = {
  // Not pure black: OLED black with light Arabic text causes visible smearing
  // when scrolling, and the logbook is a long scrolling list. The design's
  // #071A1A is a deep petrol, not a neutral — the whole dark theme is tinted.
  background: dark.bg,
  surface: dark.surface,
  surfaceRaised: '#123634',
  surfaceSunken: dark.sunken,
  border: dark.border,
  borderStrong: dark.borderStrong,

  text: dark.ink,
  textMuted: dark.inkMuted,
  textSubtle: dark.inkSubtle,
  textInverse: petrol[900],

  // Dark surfaces need a lighter primary to clear contrast thresholds; using
  // the same petrol[600] as light mode would fail against the dark background.
  // The design file says as much: "Teal 600 is too dark on 071A1A — dark theme
  // promotes teal 400 to primary and darkens the label instead."
  primary: petrol[400],
  primaryHover: petrol[300],
  primaryText: petrol[900],
  primarySubtle: '#123634',

  accent: sand[500],
  accentHover: sand[400],
  accentText: petrol[900],
  accentSubtle: '#33260F',
  accentFg: sand[400],

  emergency: emergency[400],
  emergencyText: petrol[900],
  emergencyFg: emergency[400],
  emergencySubtle: '#2A100E',
  emergencyBorder: '#5C2420',
  success: success[500],
  successFg: success[400],
  successSubtle: '#0F2E22',
  successBorder: '#1F5A40',
  warning: warning[500],
  warningFg: warning[400],
  warningSubtle: '#33260F',
  info: info[500],
  infoFg: info[400],
  infoSubtle: '#142E36',

  textLink: petrol[300],

  verified: petrol[300],
  verifiedSubtle: '#123634',
  selfReported: dark.inkMuted,
  selfReportedSubtle: dark.sunken,

  focusRing: petrol[300],
  overlay: 'rgba(4, 33, 31, 0.70)',
};
// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Arabic needs materially more line-height than Latin — ascenders, descenders
 * and diacritics collide otherwise. Build prompt §8 sets 1.7.
 */
export const ARABIC_LINE_HEIGHT_RATIO = 1.7;
export const LATIN_LINE_HEIGHT_RATIO = 1.45;

export const fontFamily = {
  // §8 names IBM Plex Sans Arabic or Tajawal. Both carry Latin glyphs, so one
  // family covers both scripts — no mixed-family fallback seams mid-sentence.
  //
  // The bare family name is the 400 face, for the few places that set a family
  // without a weight. Anything that renders text should go through
  // `arabicFace[weight]` instead — see below.
  arabic: 'IBMPlexSansArabic_400Regular',
  latin: 'IBMPlexSansArabic_400Regular',
  mono: 'RobotoMono',
} as const;

/**
 * IBM Plex Sans Arabic, keyed by weight — the same treatment `latinFace` gets,
 * and for the same reason: React Native resolves a face by exact family name
 * and does not synthesise bold.
 *
 * This was the bug. `fontFamily.arabic` was `'IBMPlexSansArabic'`, a name no
 * loaded face answered to, because the app only ever loaded Almarai and Outfit.
 * React Native does not warn about that — it silently falls back to the system
 * font — so every line of Arabic in the app was rendering in San Francisco or
 * Roboto while the design system said otherwise, and every `fontWeight` was
 * being applied to the wrong typeface.
 */
export const arabicFace = {
  '400': 'IBMPlexSansArabic_400Regular',
  '500': 'IBMPlexSansArabic_500Medium',
  '600': 'IBMPlexSansArabic_600SemiBold',
  '700': 'IBMPlexSansArabic_700Bold',
} as const;

/**
 * Outfit, the design's Latin face, keyed by weight.
 *
 * The design sets every figure in it — prices, ETAs, distances, timestamps,
 * plate codes, the uppercase section labels — 79 times across the emergency
 * flow alone. Arabic body copy stays in IBM Plex Sans Arabic; this is for
 * numerals and isolated Latin, which is exactly where a geometric sans reads
 * better and where Plex's figures look soft next to the design.
 *
 * Keyed by weight because React Native resolves a face by exact family name:
 * there is no synthetic bolding to fall back on, so `Outfit` alone would
 * silently render regular at every weight.
 */
export const latinFace = {
  '400': 'Outfit_400Regular',
  '500': 'Outfit_500Medium',
  '600': 'Outfit_600SemiBold',
  '700': 'Outfit_700Bold',
} as const;

export type FontWeightToken = keyof typeof latinFace;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * The design system's type scale, exactly.
 *
 * Every step is a size the design actually specifies — 12 / 14 / 16 / 20 / 24 /
 * 32 / 40 — rather than a generic t-shirt ramp. The previous values (18, 22,
 * 28, 34, 44) were close enough to look deliberate and wrong enough that no
 * heading in the app matched the mockups.
 *
 * There is nothing above 40: the design tops out at display, and an unused
 * larger step is an invitation to invent a size the design never sanctioned.
 *
 * Paired line heights fall out of `lineHeightFor` at the 1.7 Arabic ratio and
 * land on the design's own numbers — 12/20, 14/24, 16/27, 20/34, 24/41, 32/54,
 * 40/68 — so the ratio and the scale agree by construction rather than by two
 * tables being kept in sync.
 */
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
} as const;

export type FontSizeToken = keyof typeof fontSize;

/** Line height for a size, in the script's ratio. Always use this, never a literal. */
export function lineHeightFor(size: number, script: 'arabic' | 'latin' = 'arabic'): number {
  const ratio = script === 'arabic' ? ARABIC_LINE_HEIGHT_RATIO : LATIN_LINE_HEIGHT_RATIO;
  return Math.round(size * ratio);
}

// ---------------------------------------------------------------------------
// Spacing, radius, elevation, motion
// ---------------------------------------------------------------------------

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  '4xl': 96,
} as const;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/**
 * Minimum interactive size. §8 says 48dp; this is not negotiable downward —
 * the user may be wearing gloves, in the dark, on the hard shoulder.
 */
export const MIN_TOUCH_TARGET = 48;

export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  sm: { shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  md: { shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  lg: {
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

/**
 * Letter spacing — use sparingly. Arabic is a connected script: positive
 * tracking breaks letter joins and should only be used on isolated Latin UI
 * labels (all-caps, codes). Zero is the correct default for Arabic body copy.
 */
export const letterSpacing = {
  tight: -0.3, // display headings (Latin only)
  normal: 0, // body text, any script
  wide: 0.5, // Latin labels and captions
  wider: 1.0, // all-caps Latin only (plate codes, IBANs)
} as const;

export const iconSize = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  '2xl': 40,
} as const;

/**
 * Layer scale for React Native zIndex and elevation stacking.
 * Avoids the "what z-index is my modal?" problem by naming intent.
 */
export const zIndex = {
  base: 0,
  raised: 1,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
  tooltip: 600,
} as const;

/**
 * Motion should suggest wind: eased, directional, never bouncy (§8).
 * Springs with visible overshoot are explicitly off-brand here.
 */
export const duration = {
  instant: 80,
  fast: 150,
  normal: 260,
  slow: 420,
  deliberate: 640,
} as const;

export const easing = {
  /** Decelerate — entrances. */
  out: [0.16, 1, 0.3, 1],
  /** Accelerate — exits. */
  in: [0.7, 0, 0.84, 0],
  /** Symmetric — movement between two states. */
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const theme = {
  palette,
  light: lightColors,
  dark: darkColors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  fontFamily,
  letterSpacing,
  iconSize,
  zIndex,
  elevation,
  duration,
  easing,
  MIN_TOUCH_TARGET,
  lineHeightFor,
} as const;

export type ThemeMode = 'light' | 'dark';

export function colorsFor(mode: ThemeMode): ColorScheme {
  return mode === 'dark' ? darkColors : lightColors;
}
