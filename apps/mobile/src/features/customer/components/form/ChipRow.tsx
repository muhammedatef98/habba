/**
 * A horizontally scrolling row of mutually exclusive chips.
 *
 * Extracted from add-vehicle, which had it as a private component, because the
 * date picker needs exactly the same control three times over and a second
 * copy would have drifted. `radio` semantics rather than `button`, so a screen
 * reader announces "selected, 3 of 26" instead of twenty-six unrelated buttons.
 *
 * Horizontal scroll rather than a wrapping grid: these rows are long (years,
 * days of the month) and wrapping one turns a single control into half a
 * screenful, pushing whatever comes next below the fold.
 */

import { useRef } from 'react';
import { I18nManager, Pressable, ScrollView, View } from 'react-native';
import { Text, useTheme } from '@habba/ui';

export interface ChipOption {
  readonly key: string;
  readonly label: string;
}

export interface ChipRowProps {
  readonly label: string;
  readonly options: readonly ChipOption[];
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly testIdPrefix?: string | undefined;
}

export function ChipRow({ label, options, selected, onSelect, testIdPrefix }: ChipRowProps) {
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);

  /**
   * Park the row on its first option.
   *
   * React Native parks a horizontal `ScrollView` at the reading start on its
   * first measurement, but loses it when the content is measured again — which
   * is what happens on the record-service screen, where this row sits under a
   * multiline field whose height settles a frame later. The year row opened on
   * 2012, the far end of fifteen years, while an identically built row on
   * add-vehicle opened correctly on the current year.
   *
   * The offset is NOT mirrored: x = 0 is the physical left in both directions,
   * so under RTL the reading start is the maximum offset, not zero. Scrolling
   * to zero here is what put "لكزس" — the last make in the list — where
   * "تويوتا" should have been.
   *
   * Unanimated, because this is where the row should have been all along
   * rather than somewhere it slides from.
   */
  const parkAtStart = () => {
    if (I18nManager.isRTL) {
      scroller.current?.scrollToEnd({ animated: false });
    } else {
      scroller.current?.scrollTo({ x: 0, y: 0, animated: false });
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        onContentSizeChange={parkAtStart}
        onLayout={parkAtStart}
        contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}
      >
        {options.map((option) => {
          const isSelected = option.key === selected;
          return (
            <Pressable
              key={option.key}
              testID={`${testIdPrefix ?? 'chip'}-${option.key}`}
              onPress={() => onSelect(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
              style={({ pressed }) => [
                {
                  minHeight: theme.minTouchTarget,
                  justifyContent: 'center',
                  paddingHorizontal: theme.spacing.base,
                  borderRadius: theme.radius.full,
                  borderWidth: 1.5,
                  borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: isSelected ? theme.colors.primarySubtle : theme.colors.surface,
                },
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <Text
                variant={isSelected ? 'bodyStrong' : 'body'}
                tone={isSelected ? 'primary' : 'default'}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
