/**
 * How much of this car's history Habba can stand behind.
 *
 * The single most important number on the screen and it used to be a 12px grey
 * caption. §1.2 is the argument: a documented car sells for meaningfully more,
 * and what a buyer is actually paying for is the *verified* share — an owner's
 * recollection is worth something, a signed service record is worth more
 * (ADR-0005). Showing the ratio as a proportion makes the gap visible, and the
 * gap is the reason to route the next service through Habba.
 *
 * Two segments, not a percentage: "68%" invites the question "of what", while
 * a bar of two lengths answers it. The counts are printed underneath because a
 * bar alone cannot be read precisely and these are small numbers.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, rowDirectionFor, useTheme } from '@habba/ui';
import { formatCount } from '@/lib/format-number';

export interface CoverageBarProps {
  readonly verified: number;
  readonly selfReported: number;
  readonly testID?: string | undefined;
}

export function CoverageBar({ verified, selfReported, testID }: CoverageBarProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const total = verified + selfReported;
  if (total === 0) return null;

  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: verified }}
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          height: 8,
          borderRadius: theme.radius.full,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceSunken,
        }}
      >
        {verified > 0 ? (
          <View style={{ flex: verified, backgroundColor: theme.colors.verified }} />
        ) : null}
        {selfReported > 0 ? (
          <View style={{ flex: selfReported, backgroundColor: theme.colors.selfReported }} />
        ) : null}
      </View>

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          gap: theme.spacing.base,
          flexWrap: 'wrap',
        }}
      >
        <Legend
          color={theme.colors.verified}
          label={t('logbook.verifiedBadge')}
          value={formatCount(verified, i18n.language)}
        />
        <Legend
          color={theme.colors.selfReported}
          label={t('logbook.selfReportedBadge')}
          value={formatCount(selfReported, i18n.language)}
        />
      </View>
    </View>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  readonly color: string;
  readonly label: string;
  readonly value: string;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        alignItems: 'center',
        gap: theme.spacing.xs,
      }}
    >
      <View
        style={{ width: 8, height: 8, borderRadius: theme.radius.full, backgroundColor: color }}
      />
      <Text variant="caption" tone="muted" numeric>
        {value}
      </Text>
      <Text variant="caption" tone="subtle">
        {label}
      </Text>
    </View>
  );
}
