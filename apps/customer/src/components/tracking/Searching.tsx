/**
 * Screen 05 — searching for a technician.
 *
 * The design's governing note for this screen is "لا دوّارة": no spinner.
 * A spinner claims work is happening without evidence; this screen shows the
 * evidence — how many providers have been reached, how wide the search has
 * grown, and a log with timestamps that visibly extends.
 *
 * All of those figures are server-supplied and every one of them is optional
 * (see DispatchTelemetry). When the matcher publishes none of them the screen
 * degrades to the pulse and the reassurance copy, which is honest, rather than
 * to invented counters, which would be the one thing this design forbids.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  StatusPill,
  Text,
  TimelineList,
  useTheme,
  type TimelineItem,
} from '@habba/ui';
import { SearchingPulse } from './SearchingPulse';
import type { DispatchTelemetry } from '@/data/types';

export interface SearchingProps {
  readonly telemetry: DispatchTelemetry | undefined;
  readonly onCancel: () => void;
  readonly cancelPending: boolean;
}

function formatClock(iso: string): string {
  // Wall-clock to the second, as the design shows. Intl is used rather than a
  // hand-rolled slice so the 24h/12h convention follows the device.
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Searching({ telemetry, onCancel, cancelPending }: SearchingProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const contacted = telemetry?.contactedCount;
  const radiusKm = telemetry?.radiusKm;
  const median = telemetry?.areaMedianSeconds;

  const logItems: readonly TimelineItem[] = (telemetry?.log ?? []).map((entry, index) => ({
    key: entry.id,
    state: index === 0 ? 'current' : 'done',
    title:
      entry.kind === 'radius_expanded'
        ? t('tracking.radiusExpanded', { km: entry.radiusKm ?? '—' })
        : entry.kind === 'providers_notified'
          ? t('tracking.techniciansCount', { count: entry.providerCount ?? 0 })
          : t('tracking.searchingHeadline'),
    timestamp: formatClock(entry.occurredAt),
  }));

  return (
    <View style={{ gap: theme.spacing.lg, flex: 1 }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('tracking.searchingHeadline')}</Text>
        <Text variant="body" tone="muted">
          {t('tracking.searchingReassure')}
        </Text>
      </View>

      <SearchingPulse />

      {radiusKm !== undefined ? (
        <Text variant="caption" tone="muted" align="center">
          {t('tracking.searchRadius', { km: radiusKm.toFixed(1) })}
        </Text>
      ) : null}

      {contacted !== undefined ? (
        <Card testID="dispatch-telemetry">
          <View style={{ gap: theme.spacing.base }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text variant="caption" tone="muted">
                {t('tracking.contactedLabel')}
              </Text>
              <Text variant="heading" tone="primary" numeric>
                {t('tracking.techniciansCount', { count: contacted })}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: theme.spacing.md, flexWrap: 'wrap' }}>
              {telemetry?.reviewingCount !== undefined ? (
                <StatusPill
                  tone="success"
                  label={t('tracking.reviewing', { count: telemetry.reviewingCount })}
                />
              ) : null}
              {telemetry?.respondingCount !== undefined ? (
                <StatusPill
                  tone="active"
                  label={t('tracking.aboutToRespond', { count: telemetry.respondingCount })}
                />
              ) : null}
              {telemetry?.busyCount !== undefined ? (
                <StatusPill
                  tone="neutral"
                  showDot={false}
                  label={t('tracking.busy', { count: telemetry.busyCount })}
                />
              ) : null}
            </View>
          </View>
        </Card>
      ) : null}

      {logItems.length > 0 ? <TimelineList testID="dispatch-log" items={logItems} /> : null}

      {median !== undefined ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.infoSubtle }}>
          <Text variant="caption" tone="info">
            {t('tracking.avgMatchTime', {
              minutes: `${Math.floor(median / 60)}:${String(median % 60).padStart(2, '0')}`,
            })}
          </Text>
        </Card>
      ) : null}

      <View style={{ flex: 1 }} />

      <View style={{ gap: theme.spacing.sm }}>
        <Button
          testID="cancel-order"
          label={t('tracking.cancelAction')}
          variant="emergencyOutline"
          onPress={onCancel}
          loading={cancelPending}
        />
        <Text variant="caption" tone="subtle" align="center">
          {t('tracking.cancelFreeBeforeMatch')}
        </Text>
      </View>
    </View>
  );
}
