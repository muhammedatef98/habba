/**
 * Screen 06 — a technician has been found and has quoted.
 *
 * §9.1 and the design agree on the rule this screen enforces: the total is
 * shown broken down *and* repeated inside the accept button, so it is not
 * possible to accept a number you have not seen. There is deliberately no
 * countdown on the customer — pressure belongs on the dispatch system, not on
 * someone standing next to a broken-down car.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, StatCluster, Text, useTheme } from '@habba/ui';
import { PriceBreakdown } from './PriceBreakdown';
import { ProviderRow } from './ProviderRow';
import type { JobProgress, Order, ProviderSummary } from '@/data/types';

export interface MatchedProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly progress: JobProgress | undefined;
  /**
   * Only supplied when the customer is the party who accepts. Emergency orders
   * are priced from the catalogue and fixed centrally (§11), so there is
   * nothing for the customer to accept — the screen is informational and this
   * is left undefined. It exists for the scheduled and workshop flows, where
   * the provider quotes a price the customer has to agree to.
   */
  readonly onAccept?: (() => void) | undefined;
  readonly acceptPending?: boolean | undefined;
  readonly onFindAnother: () => void;
}

export function Matched({
  order,
  provider,
  progress,
  onAccept,
  acceptPending,
  onFindAnother,
}: MatchedProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <Card
        testID="matched-banner"
        elevation="none"
        style={{
          backgroundColor: theme.colors.successSubtle,
          borderColor: theme.colors.successBorder,
        }}
      >
        <Text variant="bodyStrong" tone="success">
          {t('tracking.matchedBanner')}
        </Text>
      </Card>

      <Card>
        <View style={{ gap: theme.spacing.lg }}>
          {provider !== null ? <ProviderRow provider={provider} showActions={false} /> : null}

          <View
            style={{
              backgroundColor: theme.colors.surfaceSunken,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.base,
            }}
          >
            <StatCluster
              testID="matched-stats"
              items={[
                {
                  key: 'eta',
                  value: progress?.etaMinutes?.toString(),
                  label: t('tracking.unitMinute'),
                },
                {
                  key: 'distance',
                  value: progress?.distanceKm?.toFixed(1),
                  label: t('tracking.unitKm'),
                },
                {
                  key: 'total',
                  value: order.totalAmount ?? undefined,
                  label: t('tracking.totalWithVat'),
                  emphasis: 'accent',
                  flex: 1.2,
                },
              ]}
            />
          </View>

          <PriceBreakdown testID="matched-price" order={order} />
        </View>
      </Card>

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="caption" tone="muted">
          {t('tracking.priceFixedNote')}
        </Text>
      </Card>

      <View style={{ flex: 1 }} />

      <View style={{ gap: theme.spacing.sm }}>
        {onAccept !== undefined ? (
          <Button
            testID="accept-quote"
            label={t('tracking.acceptWithAmount', { amount: order.totalAmount ?? '—' })}
            onPress={onAccept}
            loading={acceptPending ?? false}
            disabled={order.totalAmount === null}
          />
        ) : null}
        <Button
          testID="find-another"
          label={t('tracking.findAnother')}
          variant="ghost"
          onPress={onFindAnother}
        />
      </View>
    </View>
  );
}
