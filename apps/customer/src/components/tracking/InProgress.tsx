/**
 * Screen 08b — work underway.
 *
 * A timeline rather than a waiting screen: the customer can see what has
 * already happened and what is left, which is what makes an unattended repair
 * tolerable. The steps are derived from the order's real status, so the list
 * cannot claim progress the backend has not recorded.
 *
 * Evidence photos come from `orders.completion_media` (migration 0032), which
 * the provider must supply before handing the job back. The strip only appears
 * once there is something in it — an empty frame would imply the technician
 * skipped a step the database in fact requires.
 */

import { Image, View } from 'react-native';
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
import { ProviderRow } from './ProviderRow';
import type { JobProgress, Order, ProviderSummary } from '@/data/types';

export interface InProgressProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly progress: JobProgress | undefined;
  readonly hasUnapprovedParts: boolean;
  readonly onReviewQuote: () => void;
}

export function InProgress({
  order,
  provider,
  progress,
  hasUnapprovedParts,
  onReviewQuote,
}: InProgressProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const providerName = provider?.businessNameAr ?? '';

  const photos = order.completionMedia;

  const steps: readonly TimelineItem[] = [
    { key: 'arrived', title: t('tracking.stages.arrived'), state: 'done' },
    ...(photos.length > 0
      ? [
          {
            key: 'evidence',
            title: t('tracking.evidenceTitle'),
            state: 'done' as const,
            children: (
              <View
                style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}
              >
                {photos.slice(0, 3).map((photo) => (
                  <Image
                    key={photo.url}
                    source={{ uri: photo.url }}
                    accessibilityLabel={photo.caption ?? t('tracking.evidenceTitle')}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surfaceSunken,
                    }}
                  />
                ))}
                {photos.length > 3 ? (
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.primarySubtle,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="label" tone="primary">{`+${photos.length - 3}`}</Text>
                  </View>
                ) : null}
              </View>
            ),
          },
        ]
      : []),
    { key: 'working', title: t('tracking.inProgressPill'), state: 'current' },
    { key: 'handover', title: t('tracking.stages.completed'), state: 'pending' },
  ];

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <StatusPill testID="in-progress-pill" tone="active" label={t('tracking.inProgressPill')} />

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('tracking.providerWorking', { name: providerName })}</Text>
        <Text variant="body" tone="muted">
          {t('tracking.workingBody')}
        </Text>
      </View>

      <TimelineList testID="in-progress-steps" items={steps} />

      {hasUnapprovedParts ? (
        <Card
          testID="tracking-quote-banner"
          elevation="none"
          style={{ backgroundColor: theme.colors.accentSubtle }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong" tone="accent">
              {t('tracking.quoteReadyBanner')}
            </Text>
            <Button
              label={t('tracking.reviewQuote')}
              variant="accent"
              size="medium"
              onPress={onReviewQuote}
            />
          </View>
        </Card>
      ) : null}

      <View style={{ flex: 1 }} />

      {provider !== null ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <ProviderRow
            provider={provider}
            {...(progress?.lastUpdateAt !== undefined ? { detail: progress.lastUpdateAt } : {})}
          />
        </Card>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          paddingTop: theme.spacing.base,
        }}
      >
        <Text variant="body" tone="muted">
          {t('tracking.agreedTotalLong')}
        </Text>
        <Text variant="bodyStrong" numeric>
          {t('emergency.priceFixed', { amount: order.totalAmount ?? '—' })}
        </Text>
      </View>
    </View>
  );
}
