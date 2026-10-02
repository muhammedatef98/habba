/**
 * A short run of bars — twelve months of spending, seven days of earnings.
 *
 * Deliberately not a chart library (§3: no UI kit): the app needs one shape,
 * read at a glance, and a dependency for it would outweigh the screen it is on.
 *
 * Time runs in the reading direction. In Arabic the oldest bar is on the
 * right and the newest on the left, the way the eye moves through the row —
 * resolved through `rowDirectionFor` like every other horizontal stack, so
 * the first Arabic launch (when the platform still thinks it is LTR) draws it
 * the right way round too.
 *
 * Bars are proportional to the largest value, with a hairline floor so a zero
 * month still shows where it sits. The highlighted bar (usually the latest)
 * takes the accent; the rest stay quiet.
 */

import { View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { useTheme } from './theme.js';

export interface MiniBar {
  readonly key: string;
  readonly value: number;
  /** Short label under the bar; omit to leave the slot empty. */
  readonly label?: string;
}

export interface MiniBarsProps {
  readonly bars: readonly MiniBar[];
  /** Key of the bar drawn in the accent colour. */
  readonly highlightKey?: string;
  readonly height?: number;
  /**
   * Bars per label slot. Twelve one-bar slots at phone width truncate an
   * Arabic month name; a slot of three gives each label room and centres it
   * under its group. The slot shows the first label its bars carry.
   */
  readonly labelSpan?: number;
  /** One sentence summarising the chart for screen readers. */
  readonly accessibilityLabel: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function MiniBars({
  bars,
  highlightKey,
  height = 72,
  labelSpan = 1,
  accessibilityLabel,
  style,
  testID,
}: MiniBarsProps) {
  const theme = useTheme();
  const max = Math.max(0, ...bars.map((bar) => bar.value));
  const hasLabels = bars.some((bar) => bar.label !== undefined);
  const span = Math.max(1, Math.floor(labelSpan));
  const slots: { key: string; size: number; label: string; highlighted: boolean }[] = [];
  for (let start = 0; start < bars.length; start += span) {
    const group = bars.slice(start, start + span);
    slots.push({
      key: group[0]?.key ?? String(start),
      size: group.length,
      label: group.find((bar) => bar.label !== undefined)?.label ?? '',
      highlighted: group.some((bar) => bar.key === highlightKey),
    });
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[{ gap: theme.spacing.xs }, style]}
    >
      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'flex-end',
          height,
          gap: 4,
        }}
      >
        {bars.map((bar) => {
          const share = max > 0 ? bar.value / max : 0;
          const highlighted = bar.key === highlightKey;
          return (
            <View
              key={bar.key}
              style={{
                flex: 1,
                height: Math.max(2, Math.round(share * height)),
                borderRadius: 4,
                backgroundColor: highlighted
                  ? theme.colors.accent
                  : bar.value > 0
                    ? theme.colors.primary
                    : theme.colors.border,
                opacity: highlighted || bar.value === 0 ? 1 : 0.75,
              }}
            />
          );
        })}
      </View>
      {hasLabels ? (
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            gap: 4,
          }}
        >
          {slots.map((slot) => (
            <Text
              key={slot.key}
              variant="caption"
              tone={slot.highlighted ? 'default' : 'subtle'}
              numberOfLines={1}
              style={{ flex: slot.size, textAlign: 'center' }}
            >
              {slot.label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
