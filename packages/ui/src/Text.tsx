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
import type { FontSizeToken } from './tokens.js';

export type TextVariant =
  'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label';

const VARIANTS: Record<
  TextVariant,
  { size: FontSizeToken; weight: '400' | '500' | '600' | '700' }
> = {
  display: { size: '4xl', weight: '700' },
  title: { size: '3xl', weight: '700' },
  heading: { size: 'xl', weight: '600' },
  body: { size: 'base', weight: '400' },
  bodyStrong: { size: 'base', weight: '600' },
  caption: { size: 'sm', weight: '400' },
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
  readonly style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  tone = 'default',
  align = 'start',
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
          fontFamily: theme.fontFamily.arabic,
          textAlign,
          writingDirection: theme.direction,
        },
        style,
      ]}
    />
  );
}
