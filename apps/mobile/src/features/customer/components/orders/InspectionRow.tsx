/**
 * One completed inspection, in the history list.
 *
 * ⚠️ The recommendation, not the score, is what this row leads with.
 *
 * `تقرير الفحص` argues the same thing at length: a buyer who reads "72" and
 * stops has learned nothing, and the whole reason they paid was the word
 * underneath it. A list is where that temptation is strongest, because a
 * number is so much easier to scan — so the number is the quiet part here and
 * the server's own recommendation (`score_to_recommendation`, 0026) is the
 * loud one.
 *
 * The «في دفترك» marker matters more than it looks. An inspection that has
 * already become a vehicle cannot be converted again (0027 refuses it), and a
 * row that still invited the buyer to add the car would be an invitation to a
 * refusal.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Recommendation } from '@habba/core';
import { Icon, StatusPill, Text, rowDirectionFor, useTheme, type StatusTone } from '@habba/ui';
import { formatShortDate } from '@/features/shared/lib/format-number';
import type { InspectionSummary } from '@/features/shared/data/repository';

/** The same reading as the report screen's, for the same reason. `buy` is not green. */
const RECOMMENDATION_TONE: Record<Recommendation, StatusTone> = {
  buy: 'success',
  negotiate: 'active',
  avoid: 'emergency',
};

export interface InspectionRowProps {
  readonly inspection: InspectionSummary;
  readonly onPress: () => void;
  readonly testID?: string | undefined;
}

export function InspectionRow({ inspection, onPress, testID }: InspectionRowProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const subject =
    [inspection.subjectMakeAr, inspection.subjectModelAr, inspection.subjectYear]
      .filter((part) => part !== null && part !== undefined)
      .join(' · ') ||
    inspection.subjectPlate ||
    inspection.subjectVin ||
    t('inspections.unknownSubject');

  const when =
    inspection.completedAt === null ? null : formatShortDate(inspection.completedAt, i18n.language);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subject}
      style={({ pressed }) => [
        {
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
        },
        pressed ? { opacity: 0.6 } : null,
      ]}
    >
      {inspection.recommendation !== null ? (
        <StatusPill
          tone={RECOMMENDATION_TONE[inspection.recommendation]}
          showDot={false}
          label={t(`inspectionReport.recommendation.${inspection.recommendation}`)}
        />
      ) : null}

      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" numberOfLines={1}>
          {subject}
        </Text>
        <Text variant="caption" tone="subtle" numeric>
          {[when, inspection.vehicleId !== null ? t('inspections.inYourLogbook') : null]
            .filter((part) => part !== null)
            .join(' · ')}
        </Text>
      </View>

      {inspection.overallScore !== null ? (
        <Text variant="caption" tone="muted" numeric>
          {t('inspections.scoreShort', { score: inspection.overallScore })}
        </Text>
      ) : null}

      <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
    </Pressable>
  );
}
