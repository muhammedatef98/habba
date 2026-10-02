/**
 * A score out of 100 as a ring — صحة السيارة on the car's card.
 *
 * A ring rather than a bar because it reads as a single object at a glance
 * and fits beside a title without taking a row of its own. The figure in the
 * middle is the score itself, never a percentage sign: the scale is stated
 * once where the score is explained, and "87" is what people repeat.
 *
 * The colour comes from the caller's tone, not from the number, so the rule
 * that decides "good" lives with the rule that decides the score (0097) and
 * not in a second, drifting copy here. No tone is ever red: a car due an oil
 * change is not an emergency, and §8 keeps red for the ones that are.
 *
 * An unknown score draws the empty track and a dash — the honest state for a
 * car with nothing recorded, instead of a ring that looks full or broken.
 */

import { View, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export type ScoreTone = 'success' | 'primary' | 'warning' | 'muted';

export interface ScoreRingProps {
  /** 0–100, or null when there is nothing to judge. */
  readonly score: number | null;
  readonly tone: ScoreTone;
  /** Outer diameter in dp. */
  readonly size?: number;
  /** Read by screen readers in place of the drawing, e.g. «صحة السيارة ٨٧ من ١٠٠». */
  readonly accessibilityLabel: string;
  /** The figure as the app's locale writes it. Defaults to the plain number. */
  readonly formatted?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function ScoreRing({
  score,
  tone,
  size = 56,
  accessibilityLabel,
  formatted,
  style,
  testID,
}: ScoreRingProps) {
  const theme = useTheme();
  const stroke = Math.max(4, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = score === null ? 0 : Math.max(0, Math.min(100, score));

  const colour = {
    success: theme.colors.success,
    primary: theme.colors.primary,
    warning: theme.colors.accent,
    muted: theme.colors.borderStrong,
  }[tone];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[{ width: size, height: size }, style]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.colors.surfaceSunken}
          strokeWidth={stroke}
          fill="none"
        />
        {score !== null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colour}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
            // Starts at twelve o'clock and fills clockwise in both directions:
            // a gauge is a dial, not text, and a dial does not mirror.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          variant={size >= 80 ? 'heading' : 'label'}
          numeric
          style={{ color: score === null ? theme.colors.textSubtle : theme.colors.text }}
        >
          {score === null ? '—' : (formatted ?? String(clamped))}
        </Text>
      </View>
    </View>
  );
}
