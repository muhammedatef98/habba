/**
 * Typography primitive.
 *
 * Every string in the app goes through this, so line-height, font family and
 * text alignment are correct by construction rather than by remembering.
 * Build prompt §8: Arabic needs `fontSize * 1.7`, and RTL alignment must come
 * from the theme rather than hardcoded `left`/`right`.
 */

import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from './theme.js';
import { latinFace, type FontSizeToken } from './tokens.js';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'bodySmall'
  | 'caption'
  | 'label';

/**
 * Sizes and weights from the design system's type scale, one variant per step
 * it names: display 40/600, h1 32/600, h2 24/600, h3 20/500, body 16/400,
 * body-sm 14/400, caption 12/400.
 *
 * Weights are 600 at the top rather than 700: the design sets its headings in
 * semibold, and bold at 40px in Arabic closes the counters.
 */
const VARIANTS: Record<
  TextVariant,
  { size: FontSizeToken; weight: '400' | '500' | '600' | '700' }
> = {
  display: { size: '3xl', weight: '600' },
  title: { size: '2xl', weight: '600' },
  heading: { size: 'xl', weight: '600' },
  subheading: { size: 'lg', weight: '500' },
  body: { size: 'base', weight: '400' },
  bodyStrong: { size: 'base', weight: '600' },
  bodySmall: { size: 'sm', weight: '400' },
  caption: { size: 'xs', weight: '400' },
  label: { size: 'sm', weight: '600' },
};

export type TextTone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'inverse'
  | 'primary'
  | 'emergency'
  | 'success'
  | 'warning'
  | 'accent'
  | 'info';

export interface HabbaTextProps extends TextProps {
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
  readonly align?: 'start' | 'center' | 'end';
  /**
   * Figures: prices, ETAs, distances, timestamps, plate codes.
   *
   * Switches to the design's Latin face and turns on tabular figures, so a
   * number that ticks does not make the row beside it twitch. Never use it for
   * Arabic copy — Outfit has no Arabic glyphs, and the text would fall back
   * mid-sentence.
   */
  readonly numeric?: boolean;
  readonly style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  tone = 'default',
  align = 'start',
  numeric = false,
  style,
  ...rest
}: HabbaTextProps) {
  const theme = useTheme();
  const spec = VARIANTS[variant];
  const size = theme.fontSize[spec.size];

  const color = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    subtle: theme.colors.textSubtle,
    inverse: theme.colors.textInverse,
    primary: theme.colors.primary,
    emergency: theme.colors.emergencyFg,
    success: theme.colors.successFg,
    warning: theme.colors.warningFg,
    // accentFg, not accent: the raw amber is a fill colour and fails contrast
    // as text. See tokens.ts.
    accent: theme.colors.accentFg,
    info: theme.colors.infoFg,
  }[tone];

  // `start`/`end` are the logical values — React Native resolves them against
  // the writing direction. Never `left`/`right` (§8).
  const textAlign = align === 'center' ? 'center' : align === 'start' ? 'auto' : 'right';

  return (
    <RNText
      {...rest}
      style={[
        {
          color,
          fontSize: size,
          lineHeight: theme.lineHeightFor(size),
          fontWeight: spec.weight,
          fontFamily: numeric ? latinFace[spec.weight] : theme.fontFamily.arabic,
          ...(numeric ? { fontVariant: ['tabular-nums' as const] } : {}),
          textAlign,
          writingDirection: theme.direction,
        },
        style,
      ]}
    />
  );
}
