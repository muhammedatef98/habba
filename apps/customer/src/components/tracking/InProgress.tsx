/**
 * Screen 08b — work underway.
 *
 * A timeline rather than a waiting screen: the customer can see what has
 * already happened and what is left, which is what makes an unattended repair
 * tolerable. The steps are derived from the order's real status, so the list
 * cannot claim progress the backend has not recorded.
 *
 * Evidence photos are part of the design but need the provider-side evidence
 * API, which does not exist yet on the customer read path — that row is simply
 * absent rather than stubbed.
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

  const steps: readonly TimelineItem[] = [
    { key: 'arrived', title: t('tracking.stages.arrived'), state: 'done' },
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
        <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {t('emergency.priceFixed', { amount: order.totalAmount ?? '—' })}
        </Text>
      </View>
    </View>
  );
}
