/**
 * Surface container.
 *
 * §8 warns against "uniform radius, spacing and shadows across every
 * component" — so elevation is an explicit choice per use, not a default that
 * flattens the whole UI into the same card grid.
 */

import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from './theme.js';

export interface CardProps {
  readonly children: ReactNode;
  readonly elevation?: 'none' | 'sm' | 'md';
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function Card({
  children,
  elevation = 'sm',
  onPress,
  accessibilityLabel,
  style,
  testID,
}: CardProps) {
  const theme = useTheme();
  const shadow = theme.elevation[elevation];

  const base: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.base,
    borderWidth: 1,
    // In dark mode shadows are nearly invisible, so the border carries the
    // separation instead. Reusing the light-mode treatment would make dark
    // mode look flat and unfinished.
    borderColor: theme.mode === 'dark' ? theme.colors.border : 'transparent',
    shadowColor: '#000',
    ...shadow,
    ...style,
  };

  if (onPress === undefined) {
    return (
      <View testID={testID} style={base}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        base,
        pressed ? { opacity: 0.92, transform: [{ scale: 0.99 }] } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}
