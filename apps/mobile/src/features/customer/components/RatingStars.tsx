/**
 * Star picker for post-completion ratings (§9.1).
 *
 * Not a third-party star-rating package: the touch target for each star must
 * clear 48dp (§8), which most off-the-shelf star widgets do not guarantee.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, rowDirectionFor, useTheme } from '@habba/ui';

export interface RatingStarsProps {
  readonly onRate: (stars: number) => void;
  readonly disabled?: boolean;
}

/**
 * A rating already given, shown rather than asked for. One element to a
 * screen reader — «4 نجوم من 5» — not five buttons that do nothing.
 */
export function RatingStarsValue({
  stars,
  testID,
}: {
  readonly stars: number;
  readonly testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t('tracking.rateStars', { count: stars })}
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        gap: theme.spacing.xs,
      }}
    >
      {STAR_VALUES.map((value) => (
        <Text
          key={value}
          variant="title"
          style={{ color: value <= stars ? theme.colors.accent : theme.colors.border }}
        >
          ★
        </Text>
      ))}
    </View>
  );
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export function RatingStars({ onRate, disabled = false }: RatingStarsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <View
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        gap: theme.spacing.xs,
      }}
    >
      {STAR_VALUES.map((value) => {
        const filled = selected !== null && value <= selected;
        return (
          <Pressable
            key={value}
            testID={`rating-star-${value}`}
            disabled={disabled}
            accessibilityRole="button"
            // «3 نجوم من 5», not «3»: a bare digit gave a screen-reader user
            // no idea what the five buttons were.
            accessibilityLabel={t('tracking.rateStars', { count: value })}
            accessibilityState={{ selected: selected === value, disabled }}
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
