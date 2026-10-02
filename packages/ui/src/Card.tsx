/**
 * Surface container.
 *
 * §8 warns against "uniform radius, spacing and shadows across every
 * component" — so elevation is an explicit choice per use, not a default that
 * flattens the whole UI into the same card grid.
 */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { AnimatedPressable, usePressScale } from './motion.js';
import { useTheme } from './theme.js';

export interface CardProps {
  readonly children: ReactNode;
  readonly elevation?: 'none' | 'sm' | 'md';
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  /**
   * For a card used as one choice among several. Said to the screen reader;
   * the look of the selected state stays the caller's. Without it a blind
   * user heard six identical "button"s and could not tell which service,
   * car or rating was chosen.
   */
  readonly selected?: boolean | undefined;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function Card({
  children,
  elevation = 'sm',
  onPress,
  accessibilityLabel,
  selected,
  style,
  testID,
}: CardProps) {
  const theme = useTheme();
  const shadow = theme.elevation[elevation];
  const press = usePressScale(onPress === undefined);

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
    <AnimatedPressable
      testID={testID}
      onPress={onPress}
      {...press.handlers}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(selected === undefined ? {} : { accessibilityState: { selected } })}
      style={[base, press.style]}
    >
      {children}
    </AnimatedPressable>
  );
}
