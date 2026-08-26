/**
 * Theme context: colour scheme + text direction.
 *
 * Build prompt §8: "Dark mode is not optional. Half of emergency usage happens
 * after sunset." Both schemes are designed rather than derived — see tokens.ts.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { directionOf, type Locale } from '@habba/i18n';
import {
  colorsFor,
  duration,
  easing,
  elevation,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeightFor,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  type ColorScheme,
  type ThemeMode,
} from './tokens.js';

export interface HabbaTheme {
  readonly mode: ThemeMode;
  readonly colors: ColorScheme;
  readonly direction: 'rtl' | 'ltr';
  readonly isRtl: boolean;
  readonly locale: Locale;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly fontSize: typeof fontSize;
  readonly fontWeight: typeof fontWeight;
  readonly fontFamily: typeof fontFamily;
  readonly elevation: typeof elevation;
  readonly duration: typeof duration;
  readonly easing: typeof easing;
  readonly minTouchTarget: number;
  readonly lineHeightFor: (size: number) => number;
}

const ThemeContext = createContext<HabbaTheme | null>(null);

export type ThemePreference = ThemeMode | 'system';

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly preference?: ThemePreference;
}

export function ThemeProvider({ children, locale, preference = 'system' }: ThemeProviderProps) {
  const systemScheme = useColorScheme();

  const theme = useMemo<HabbaTheme>(() => {
    const mode: ThemeMode =
      preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

    const direction = directionOf(locale);
    // Arabic needs the taller ratio; Latin copy in an Arabic UI still reads
    // better at the Arabic rhythm, so the locale decides, not the string.
    const script = locale === 'ar' ? 'arabic' : 'latin';

    return {
      mode,
      colors: colorsFor(mode),
      direction,
      isRtl: direction === 'rtl',
      locale,
      spacing,
      radius,
      fontSize,
      fontWeight,
      fontFamily,
      elevation,
      duration,
      easing,
      minTouchTarget: MIN_TOUCH_TARGET,
      lineHeightFor: (size: number) => lineHeightFor(size, script),
    };
  }, [locale, preference, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): HabbaTheme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>');
  }
  return theme;
}
