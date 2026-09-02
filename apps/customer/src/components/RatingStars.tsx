/**
 * Star picker for post-completion ratings (§9.1).
 *
 * Not a third-party star-rating package: the touch target for each star must
 * clear 48dp (§8), which most off-the-shelf star widgets do not guarantee.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@habba/ui';

export interface RatingStarsProps {
  readonly onRate: (stars: number) => void;
  readonly disabled?: boolean;
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export function RatingStars({ onRate, disabled = false }: RatingStarsProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
      {STAR_VALUES.map((value) => {
        const filled = selected !== null && value <= selected;
        return (
          <Pressable
            key={value}
            testID={`rating-star-${value}`}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${value}`}
            onPress={() => {
              setSelected(value);
              onRate(value);
            }}
            style={{
              minWidth: theme.minTouchTarget,
              minHeight: theme.minTouchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="title"
              style={{ color: filled ? theme.colors.accent : theme.colors.border }}
            >
              ★
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
