/**
 * One dispatchable job, as the technician decides on it.
 *
 * The decision is: is it worth driving to. That is three facts — what, how
 * far, how much — and the card is ordered so they can be read in that order
 * without hunting. The payout was previously the last line of a paragraph of
 * captions, in the same size as the district name.
 *
 * `hasTriageVideo` was in the data from the day the field was added and shown
 * nowhere. §11 makes video triage the mechanism that kills false dispatches —
 * "provider quotes before driving out" — and a job carrying twenty seconds of
 * the actual noise is a materially better job to take than one that does not.
 * A technician cannot prefer it if the list never says which is which.
 *
 * Distance is a bucket and the address is absent, and both are the API's doing
 * rather than a layout choice: ADR-0013 will not return an address before
 * acceptance, and exact metres from three offers allow trilateration.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, StatusPill, Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { OpenJob } from '@/features/provider/data/provider-repository';

export interface OpenJobCardProps {
  readonly job: OpenJob;
  readonly onPress: () => void;
  readonly testID?: string | undefined;
}

export function OpenJobCard({ job, onPress, testID }: OpenJobCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={job.serviceNameAr}
      style={({ pressed }) => [pressed ? { opacity: 0.9, transform: [{ scale: 0.99 }] } : null]}
    >
      <Card elevation="sm" style={{ gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'flex-start',
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="heading" numberOfLines={2}>
              {job.serviceNameAr}
            </Text>

            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                alignItems: 'center',
                gap: theme.spacing.sm,
                flexWrap: 'wrap',
              }}
            >
              <Icon name="locate" size={theme.iconSize.sm} color={theme.colors.textMuted} />
              <Text variant="caption" tone="muted">
                {job.distanceBucket}
                {job.districtNameAr === null ? '' : ` · ${job.districtNameAr}`}
              </Text>
            </View>
          </View>

          {job.hasTriageVideo ? (
            <StatusPill tone="active" showDot={false} label={t('provider.hasVideo')} />
          ) : null}
        </View>

        {job.problemSummary.length > 0 ? (
          <Text variant="bodySmall" tone="muted" numberOfLines={2}>
            {job.problemSummary}
          </Text>
        ) : null}

        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'baseline',
            gap: theme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingTop: theme.spacing.md,
          }}
        >
          <Text variant="caption" tone="subtle" style={{ flex: 1 }}>
            {t('provider.payoutLabel')}
          </Text>
          {/* A dash when the server has not costed the job yet, rather than a
              zero — a technician reading "0 ر.س" would skip a job that may pay
              perfectly well. */}
          <Text variant="heading" tone="primary" numeric>
            {job.estimatedPayout ?? '—'}
          </Text>
          <Text variant="caption" tone="muted">
            {t('provider.sarSuffix')}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
