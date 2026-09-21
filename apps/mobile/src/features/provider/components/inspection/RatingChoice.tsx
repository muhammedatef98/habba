/**
 * The four-way rating control: سليم · يحتاج انتباه · خلل · لا ينطبق.
 *
 * All four visible at once rather than behind a picker. The inspector taps
 * this forty-three times in one session, most of them `pass`, and every tap
 * that costs two gestures instead of one is forty-three extra gestures done
 * standing up next to a running engine.
 *
 * Wrapping rather than scrolling horizontally, unlike `ChipRow`: there are
 * exactly four options and they are always the same four, so nothing is ever
 * off-screen and the inspector's thumb learns where each one is.
 */

import { Pressable, View } from 'react-native';
import { Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { ItemRating } from '@habba/core';
import { findingColors, ratingTone } from '@/features/shared/lib/inspection-rating';

export interface RatingChoiceProps {
  readonly options: readonly { readonly rating: ItemRating; readonly label: string }[];
  readonly selected: ItemRating | undefined;
  readonly onSelect: (rating: ItemRating) => void;
  /** Announced for the whole group, since the individual labels are one word. */
  readonly accessibilityLabel: string;
  readonly testIdPrefix: string;
}

export function RatingChoice({
  options,
  selected,
  onSelect,
  accessibilityLabel,
  testIdPrefix,
}: RatingChoiceProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        flexWrap: 'wrap',
        gap: theme.spacing.sm,
      }}
    >
      {options.map((option) => {
        const isSelected = option.rating === selected;
        const colors = findingColors(ratingTone(option.rating), theme.colors);

        return (
          <Pressable
            key={option.rating}
            testID={`${testIdPrefix}-${option.rating}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.rating)}
            style={({ pressed }) => [
              {
                minHeight: theme.minTouchTarget,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.full,
                borderWidth: isSelected ? 1.5 : 1,
                // Unselected options stay neutral. Four permanently coloured
                // chips on every one of forty-three rows turns the form into
                // noise and makes the answers impossible to scan afterwards.
                borderColor: isSelected ? colors.border : theme.colors.border,
                backgroundColor: isSelected ? colors.background : theme.colors.surface,
              },
              pressed ? { opacity: 0.8 } : null,
            ]}
          >
            <Text
              variant={isSelected ? 'bodyStrong' : 'bodySmall'}
              style={{ color: isSelected ? colors.foreground : theme.colors.textMuted }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
