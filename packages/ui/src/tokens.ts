/**
 * Habba design tokens.
 *
 * Build prompt §8. The category is full of generic blue "trust" apps and
 * aggressive red "emergency" apps — this is deliberately neither.
 *
 * The name means both *a gust of wind* and *to rush to someone's aid*. The
 * palette follows: deep desert teal for calm competence, warm sand for action.
 * Red is reserved exclusively for genuine emergencies, never for marketing —
 * if everything is urgent, nothing is.
 *
 * Context that drove these choices: people use this one-handed, stressed, at
 * the roadside, often at night. Hence large touch targets, high contrast, and
 * dark mode as a first-class theme rather than an afterthought.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const petrol = {
  50: '#E6F2F0',
  100: '#C2DEDA',
  200: '#9AC8C2',
  300: '#6FB0A8',
  400: '#4A9A90',
  500: '#2A7D73',
  600: '#166159',
  700: '#0E4F4A', // primary
  800: '#0A3B37',
  900: '#062724',
} as const;

const sand = {
  50: '#FDF6EC',
  100: '#F9E8CE',
  200: '#F2D5A8',
  300: '#E9BE79',
  400: '#DFA84F',
  500: '#C98B2B', // accent
  600: '#A66F1E',
  700: '#7F5416',
  800: '#5A3B10',
  900: '#3A260A',
} as const;

const neutral = {
  0: '#FFFFFF',
  50: '#F7F7F6',
  100: '#EFEEEC',
  200: '#DFDDD9',
  300: '#C6C3BD',
  400: '#A29E96',
  500: '#7C7871',
  600: '#5C5952',
  700: '#403E39',
  800: '#2A2825',
  900: '#1A1917',
  950: '#0F0E0D',
} as const;

/** Reserved for genuine emergencies. Never decorative, never marketing (§8). */
const emergency = {
  400: '#E5534B',
  500: '#D2342B',
  600: '#A82720',
} as const;

const success = { 400: '#4CAF7D', 500: '#2E8B5A', 600: '#1F6B43' } as const;
const warning = { 400: '#E0A030', 500: '#C07C12', 600: '#945D0A' } as const;

export const palette = { petrol, sand, neutral, emergency, success, warning } as const;

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

  readonly emergency: string;
  readonly emergencyText: string;
  readonly success: string;
  readonly warning: string;

  /** ADR-0005: verified and owner-entered must never look the same. */
  readonly verified: string;
  readonly verifiedSubtle: string;
  readonly selfReported: string;
  readonly selfReportedSubtle: string;

  readonly focusRing: string;
  readonly overlay: string;
}

export const lightColors: ColorScheme = {
  background: neutral[50],
  surface: neutral[0],
  surfaceRaised: neutral[0],
  surfaceSunken: neutral[100],
  border: neutral[200],
  borderStrong: neutral[300],

  text: neutral[900],
  textMuted: neutral[600],
  textSubtle: neutral[500],
  textInverse: neutral[0],

  primary: petrol[700],
  primaryHover: petrol[800],
  primaryText: neutral[0],
  primarySubtle: petrol[50],

  accent: sand[500],
  accentHover: sand[600],
  accentText: neutral[950],
  accentSubtle: sand[50],

  emergency: emergency[500],
  emergencyText: neutral[0],
  success: success[500],
  warning: warning[500],

  verified: petrol[700],
  verifiedSubtle: petrol[50],
  selfReported: neutral[500],
  selfReportedSubtle: neutral[100],

  focusRing: petrol[400],
  overlay: 'rgba(15, 14, 13, 0.55)',
};

export const darkColors: ColorScheme = {
  // Not pure black: OLED black with light Arabic text causes visible smearing
  // when scrolling, and the logbook is a long scrolling list.
  background: neutral[950],
  surface: neutral[900],
  surfaceRaised: neutral[800],
  surfaceSunken: '#0A0A09',
  border: neutral[800],
  borderStrong: neutral[700],

  text: neutral[50],
  textMuted: neutral[300],
  textSubtle: neutral[400],
  textInverse: neutral[950],

  // Dark surfaces need a lighter primary to clear contrast thresholds; using
  // the same petrol[700] as light mode would fail against neutral[900].
  primary: petrol[300],
  primaryHover: petrol[200],
  primaryText: neutral[950],
  primarySubtle: petrol[900],

  accent: sand[300],
  accentHover: sand[200],
  accentText: neutral[950],
  accentSubtle: sand[900],

  emergency: emergency[400],
  emergencyText: neutral[950],
  success: success[400],
  warning: warning[400],

  verified: petrol[300],
  verifiedSubtle: petrol[900],
  selfReported: neutral[400],
  selfReportedSubtle: neutral[800],

  focusRing: petrol[300],
  overlay: 'rgba(0, 0, 0, 0.70)',
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
  arabic: 'IBMPlexSansArabic',
  latin: 'IBMPlexSansArabic',
  mono: 'RobotoMono',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 34,
  '4xl': 44,
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
  lg: { shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
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
