/**
 * One inspection rating, as a badge.
 *
 * Shared between the inspector filling the form and the buyer reading it back,
 * for the reason in `lib/inspection-rating.ts`: the same finding has to look
 * the same to both of them, and to anyone who opens the public link.
 */

import { View, type ViewStyle } from 'react-native';
import { Text, useTheme } from '@habba/ui';
import { findingColors, type FindingTone } from '@/features/shared/lib/inspection-rating';

export interface FindingBadgeProps {
  readonly label: string;
  readonly tone: FindingTone;
  /** Copy is the caller's — @habba/ui carries none, and neither does this. */
  readonly style?: ViewStyle | undefined;
  readonly testID?: string | undefined;
}

export function FindingBadge({ label, tone, style, testID }: FindingBadgeProps) {
  const theme = useTheme();
  const colors = findingColors(tone, theme.colors);

  return (
    <View
      testID={testID}
      // The tone is carried by the border as well as the fill. A badge told
      // apart by hue alone is one a colour-blind reader cannot read, and this
      // one is the difference between "sound" and "fault" on a car they are
      // about to buy.
      style={[
        {
          alignSelf: 'flex-start',
          paddingVertical: 4,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Text variant="caption" style={{ color: colors.foreground }}>
        {label}
      </Text>
    </View>
  );
}
