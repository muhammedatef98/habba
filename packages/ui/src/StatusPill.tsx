/**
 * Small state badge — a dot plus a word.
 *
 * §8 reserves red for genuine emergencies, so tone is a closed set rather than
 * a free colour prop: there is no way to spell "urgent-looking but not an
 * emergency" with this component, which is the point.
 */

import { View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { useTheme } from './theme.js';

export type StatusTone = 'neutral' | 'success' | 'active' | 'emergency';

export interface StatusPillProps {
  readonly label: string;
  readonly tone?: StatusTone;
  /** The dot reads as "live". Omit it for settled states that are not moving. */
  readonly showDot?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function StatusPill({
  label,
  tone = 'neutral',
  showDot = true,
  style,
  testID,
}: StatusPillProps) {
  const theme = useTheme();

  const palettes: Record<StatusTone, { background: string; dot: string }> = {
    neutral: { background: theme.colors.surfaceSunken, dot: theme.colors.textSubtle },
    success: { background: theme.colors.successSubtle, dot: theme.colors.success },
    active: { background: theme.colors.warningSubtle, dot: theme.colors.warning },
    emergency: { background: theme.colors.emergencySubtle, dot: theme.colors.emergency },
  };

  const tones = {
    neutral: 'muted',
    success: 'success',
    active: 'warning',
    emergency: 'emergency',
  } as const;
  const spec = palettes[tone];

  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: theme.spacing.sm,
          paddingVertical: 6,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.full,
          backgroundColor: spec.background,
        },
        style,
      ]}
    >
      {showDot ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: theme.radius.full,
            backgroundColor: spec.dot,
          }}
        />
      ) : null}
      <Text variant="caption" tone={tones[tone]} style={{ fontWeight: theme.fontWeight.medium }}>
        {label}
      </Text>
    </View>
  );
}
