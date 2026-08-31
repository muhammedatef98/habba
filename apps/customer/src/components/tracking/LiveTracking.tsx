/**
 * Screen 07 — the technician is on the way.
 *
 * §8 calls this "the emotional core of the product". It is the screen someone
 * stares at, so the three things they actually want are pinned to the top at
 * display size: how long, how far, how much. The four-stage bar below is
 * derived from the order's real status, not from a timer.
 *
 * The map itself is still open work (react-native-maps plus a customer-facing
 * read of provider_locations). Rather than draw a decorative fake map, the
 * surface renders as a plain field until a real position exists — the stage
 * bar and the ETA carry the screen in the meantime.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, ProgressStages, StatCluster, Text, useTheme, type ProgressStage } from '@habba/ui';
import { ProviderRow } from './ProviderRow';
import type { JobProgress, Order, OrderStatus, ProviderSummary } from '@/data/types';

export interface LiveTrackingProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly progress: JobProgress | undefined;
  readonly onShare: () => void;
}

const STAGE_ORDER: readonly OrderStatus[] = ['accepted', 'en_route', 'arrived', 'completed'];

/** Maps the order machine onto the design's four visible stages. */
export function stageIndexFor(status: OrderStatus): number {
  const direct = STAGE_ORDER.indexOf(status);
  if (direct !== -1) return direct;
  // in_progress and awaiting_approval both sit between "arrived" and
  // "completed" — the customer sees them as work happening on site.
  if (status === 'in_progress' || status === 'awaiting_approval') return 2;
  if (status === 'checked_in') return 1;
  return 0;
}

export function LiveTracking({ order, provider, progress, onShare }: LiveTrackingProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const stages: readonly ProgressStage[] = [
    { key: 'accepted', label: t('tracking.stages.accepted') },
    { key: 'enRoute', label: t('tracking.stages.enRoute') },
    { key: 'arrived', label: t('tracking.stages.arrived') },
    { key: 'completed', label: t('tracking.stages.completed') },
  ];

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <Card testID="live-headline" elevation="md">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.base }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="muted">
              {t('tracking.arrivesIn')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.xs }}>
              <Text
                variant="display"
                tone="primary"
                numeric
                style={{ lineHeight: theme.fontSize['3xl'] }}
              >
                {progress?.etaMinutes ?? '—'}
              </Text>
              <Text variant="body" tone="primary">
                {t('tracking.unitMinutes')}
              </Text>
            </View>
          </View>

          <StatCluster
            items={[
              {
                key: 'distance',
                value: progress?.distanceKm?.toFixed(1),
                label: t('tracking.distance'),
              },
              {
                key: 'price',
                value: order.totalAmount ?? undefined,
                label: t('tracking.price'),
                emphasis: 'accent',
              },
            ]}
          />
        </View>
      </Card>

      <ProgressStages
        testID="live-stages"
        stages={stages}
        currentIndex={stageIndexFor(order.status)}
        {...(progress?.stageProgress !== undefined
          ? { currentProgress: progress.stageProgress }
          : {})}
      />

      {provider !== null ? <ProviderRow testID="live-provider" provider={provider} /> : null}

      <View style={{ flex: 1 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">
          {t('tracking.shareTrip')}
        </Text>
        <Text
          variant="label"
          tone="primary"
          onPress={onShare}
          accessibilityRole="button"
          style={{ minHeight: theme.minTouchTarget, paddingTop: theme.spacing.md }}
        >
          {t('common.share')}
        </Text>
      </View>
    </View>
  );
}
