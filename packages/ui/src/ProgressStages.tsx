/**
 * Horizontal four-stage job progress.
 *
 * Deliberately not a countdown or a percentage: §9.1 shows named stages
 * because a customer on the hard shoulder needs to know *which* stage they
 * are in, not how many seconds are notionally left. The current stage can be
 * partially filled to show movement within it without implying a deadline.
 */

import { View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { stageAppearance } from './progress-stages.js';
import { useTheme } from './theme.js';

export interface ProgressStage {
  readonly key: string;
  readonly label: string;
}

export interface ProgressStagesProps {
  readonly stages: readonly ProgressStage[];
  /** Index of the stage in progress. Everything before it renders complete. */
  readonly currentIndex: number;
  /** 0–1 fill within the current stage. Omit when genuinely unknown. */
  readonly currentProgress?: number;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function ProgressStages({
  stages,
  currentIndex,
  currentProgress,
  style,
  testID,
}: ProgressStagesProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: stages.length, now: currentIndex }}
      style={[
        {
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.sm,
        },
        style,
      ]}
    >
      {stages.map((stage, index) => {
        // Shape, not just colour: the current stage is a taller track with a
        // partial fill, so "you are here" and "you finished this" are still
        // different for the roughly one man in twelve who cannot separate the
        // two hues (progress-stages.ts). Reanimated is not involved — this
        // reflects server state and should not animate on its own schedule.
        const { fill, height, isDone, isCurrent } = stageAppearance(
          index,
          currentIndex,
          currentProgress,
        );
        const trackColor = isDone ? theme.colors.primary : theme.colors.borderStrong;

        return (
          <View key={stage.key} style={{ flex: 1, gap: 6 }}>
            <View
              style={{
                height,
                borderRadius: theme.radius.full,
                backgroundColor: isCurrent ? theme.colors.borderStrong : trackColor,
                overflow: 'hidden',
              }}
            >
              {isCurrent && fill > 0 ? (
                <View
                  style={{
                    width: `${Math.round(fill * 100)}%`,
                    height: '100%',
                    borderRadius: theme.radius.full,
                    backgroundColor: theme.colors.accent,
                  }}
                />
              ) : null}
            </View>
            <Text
              variant="caption"
              tone={isCurrent ? 'warning' : isDone ? 'primary' : 'subtle'}
              style={{
                fontSize: theme.fontSize.xs,
                fontWeight:
                  isDone || isCurrent ? theme.fontWeight.semibold : theme.fontWeight.regular,
              }}
            >
              {stage.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
