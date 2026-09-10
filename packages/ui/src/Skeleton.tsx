/**
 * Placeholder shapes for content that is on its way.
 *
 * The screens this replaces printed "جارٍ التحميل…" on an otherwise empty
 * screen and then filled it all at once. Two things are wrong with that. The
 * jump is the obvious one — a blank screen becoming a full one reads as a
 * stutter rather than an arrival. The quieter one is that a line of text tells
 * the customer nothing about what is coming, so a list of six orders and a
 * single order look identical while they load, and the layout shifts under a
 * thumb that has already started moving toward where a button is about to be.
 *
 * A skeleton is a promise about shape. It is only honest if the shape is the
 * one that actually arrives, so these take the same dimensions as the content
 * they stand in for rather than being a generic grey block.
 *
 * No animation. §8 asks for motion that suggests wind, eased and directional;
 * a shimmer sweeping across six rows is neither, and on the tracking screen it
 * would compete with the one thing that should be moving. Static blocks at low
 * contrast read as "not yet" without asking for attention.
 */

import { View, type ViewStyle } from 'react-native';
import { useTheme } from './theme.js';

export interface SkeletonProps {
  /** Height in dp, or a text size token's worth of line. */
  readonly height?: number | undefined;
  /** Width as a number of dp or a percentage string. Defaults to full width. */
  readonly width?: number | `${number}%` | undefined;
  readonly radius?: 'sm' | 'md' | 'lg' | 'full' | undefined;
  readonly style?: ViewStyle | undefined;
  readonly testID?: string | undefined;
}

export function Skeleton({
  height = 14,
  width = '100%',
  radius = 'sm',
  style,
  testID,
}: SkeletonProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      // Hidden from screen readers: a reader announcing six empty boxes is
      // worse than silence. The screens pair these with a live region that
      // says the content is loading, once.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width,
        borderRadius: theme.radius[radius],
        backgroundColor: theme.colors.surfaceSunken,
        ...style,
      }}
    />
  );
}

/**
 * A card-shaped placeholder: the outline of a row with a title and two lines
 * under it, which is the shape of nearly every list in this app.
 */
export function SkeletonCard({
  lines = 2,
  testID,
}: {
  readonly lines?: number | undefined;
  readonly testID?: string | undefined;
}) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.base,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Skeleton height={18} width="55%" />
      {Array.from({ length: lines }, (_, index) => (
        // Uneven widths: real text does not end in the same place twice, and a
        // stack of identical bars reads as a broken table rather than as copy.
        <Skeleton key={index} height={12} width={index % 2 === 0 ? '85%' : '65%'} />
      ))}
    </View>
  );
}
