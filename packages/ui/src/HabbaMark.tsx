/**
 * The Habba mark — two swept gust strokes.
 *
 * هبّة means both a gust of wind and rushing to someone's aid (CLAUDE.md §0),
 * and the mark is that gust. The design ships it as vector, but react-native-svg
 * is not a dependency and adding it costs a native rebuild for a handful of
 * static images, so this renders the raster export from
 * `apps/customer/scripts/generate-logo-assets.py`.
 *
 * Two colourways rather than one tinted image: the mark is two-tone by design,
 * and Image `tintColor` would flatten it into a silhouette, losing the amber
 * stroke that carries the brand.
 */

import { Image, type ImageStyle, type StyleProp } from 'react-native';
import markOnDark from '../assets/mark-on-dark.png';
import markOnLight from '../assets/mark-on-light.png';
import { useTheme } from './theme.js';

export interface HabbaMarkProps {
  readonly size?: number;
  /**
   * Which surface the mark sits on. Defaults to following the theme, which is
   * right for the common case of the mark on the page background.
   */
  readonly on?: 'light' | 'dark';
  readonly style?: StyleProp<ImageStyle>;
  readonly accessibilityLabel?: string;
}

// Owned by the design system, not by an app: the provider app needs the same
// image, and @habba/ui reaching into apps/customer would break the moment it
// were consumed from anywhere else.
const MARKS = {
  light: markOnLight,
  dark: markOnDark,
} as const;

export function HabbaMark({ size = 48, on, style, accessibilityLabel }: HabbaMarkProps) {
  const theme = useTheme();
  const surface = on ?? (theme.mode === 'dark' ? 'dark' : 'light');

  return (
    <Image
      source={MARKS[surface]}
      // Decorative wherever the name is already written beside it, which is
      // why the label is opt-in rather than a hardcoded "Habba".
      accessible={accessibilityLabel !== undefined}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
      resizeMode="contain"
      style={[{ width: size, height: size }, style]}
    />
  );
}
