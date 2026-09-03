/**
 * Horizontal stack that survives the launch where the platform is a restart
 * behind the locale.
 *
 * Every hand-written `flexDirection: 'row'` is laid out by Yoga against
 * `I18nManager.isRTL`, which is not yet true on the first Arabic launch — so a
 * `space-between` header puts its title on the left, and no amount of correct
 * text alignment fixes that, because the box itself is on the wrong side. This
 * resolves the direction from the locale and the platform together
 * (direction.ts).
 */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { rowDirectionFor } from './direction.js';
import { useTheme } from './theme.js';
import type { spacing as spacingTokens } from './tokens.js';

export interface RowProps {
  readonly children: ReactNode;
  /** Gap between children, from the spacing scale. */
  readonly gap?: keyof typeof spacingTokens | undefined;
  readonly align?: ViewStyle['alignItems'] | undefined;
  readonly justify?: ViewStyle['justifyContent'] | undefined;
  readonly wrap?: boolean | undefined;
  /**
   * Visual order opposes reading order. A deliberate choice for a specific
   * control — never a fix for a row that looks mirrored, which is a direction
   * problem and is handled above.
   */
  readonly reverse?: boolean | undefined;
  readonly style?: ViewStyle | undefined;
  readonly testID?: string | undefined;
}

export function Row({
  children,
  gap = 'sm',
  align = 'center',
  justify,
  wrap = false,
  reverse = false,
  style,
  testID,
}: RowProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection, reverse),
        alignItems: align,
        ...(justify === undefined ? {} : { justifyContent: justify }),
        ...(wrap ? { flexWrap: 'wrap' as const } : {}),
        gap: theme.spacing[gap],
        ...style,
      }}
    >
      {children}
    </View>
  );
}
