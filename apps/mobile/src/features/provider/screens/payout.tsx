/**
 * One payout, broken down into the jobs it covers.
 *
 * The reason this screen exists rather than a row that just shows a total: a
 * technician who cannot reconcile a payment against the work they remember
 * doing has no way to raise a dispute except "it feels low". `payout_orders`
 * has recorded the per-line figures since 0031 and nothing has ever shown them.
 *
 * `my_payout_lines` returns nothing for a payout id that is not this
 * provider's, rather than raising — so a wrong id renders as an empty payout
 * and cannot be used to probe which ids exist.
 */

import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Screen,
  Skeleton,
  StatCluster,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
  type StatusTone,
} from '@habba/ui';
import {
  providerRepository,
  type PayoutStatus,
} from '@/features/provider/data/provider-repository';
import { useSession } from '@/features/shared/state/session';
import { formatGregorianDate } from '@/features/shared/lib/dates';

const PAYOUT_TONE: Record<PayoutStatus, StatusTone> = {
  pending: 'neutral',
  approved: 'active',
  paid: 'success',
  failed: 'emergency',
};

export default function PayoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useSession((state) => state.locale);
  const { id } = useLocalSearchParams<{ id: string }>();

  // Read from the list rather than refetched alone: `payouts` has no
  // single-row RPC, and the list is already scoped by RLS to this provider.
  const payouts = useQuery({
    queryKey: ['payouts'],
    queryFn: () => providerRepository.listPayouts(),
  });

  const lines = useQuery({
    queryKey: ['payout-lines', id],
    queryFn: () => providerRepository.listPayoutLines(id ?? ''),
    enabled: id !== undefined,
  });

  if (payouts.isPending) {
    return (
      <Screen scrollable style={{ gap: theme.spacing.lg }}>
        <Skeleton height={120} />
        <Skeleton height={80} />
      </Screen>
    );
  }

  const payout = (payouts.data ?? []).find((row) => row.id === id);

  if (payout === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('errors.notFound')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const rows = lines.data ?? [];

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title" numeric>
          {t('earnings.sar', { amount: payout.netAmount })}
        </Text>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {t('earnings.period', {
              from: formatGregorianDate(payout.periodStart, locale),
              to: formatGregorianDate(payout.periodEnd, locale),
            })}
          </Text>
          <StatusPill
            tone={PAYOUT_TONE[payout.status]}
            showDot={payout.status === 'approved'}
            label={t(`earnings.status.${payout.status}`)}
          />
        </View>
      </View>

      <Card elevation="sm" style={{ gap: theme.spacing.base }}>
        <StatCluster
          testID="payout-breakdown"
          items={[
            { key: 'gross', label: t('earnings.gross'), value: payout.grossAmount },
            { key: 'commission', label: t('earnings.commission'), value: payout.commission },
            {
              key: 'net',
              label: t('earnings.net'),
              value: payout.netAmount,
              emphasis: 'accent',
            },
          ]}
        />

        {/* The bank reference, when there is one. It is what a technician
            matches against their statement, and withholding it turns a
            reconcilable payment into a number they have to take on trust. */}
        {payout.reference !== null ? (
          <View style={{ gap: 2 }}>
            <Text variant="label" tone="muted">
              {t('earnings.reference')}
            </Text>
            <Text variant="bodySmall" numeric>
              {payout.reference}
            </Text>
          </View>
        ) : null}

        {payout.paidAt !== null ? (
          <Text variant="caption" tone="subtle">
            {t('earnings.paidOn', { date: formatGregorianDate(payout.paidAt, locale) })}
          </Text>
        ) : null}
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('earnings.payoutJobs', { count: payout.orderCount })}</Text>

        {rows.map((line) => (
          <Card
            key={line.orderId}
            testID={`payout-line-${line.orderId}`}
            elevation="none"
            style={{
              backgroundColor: theme.colors.surfaceSunken,
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodySmall" numberOfLines={1}>
                {line.serviceNameAr}
              </Text>
              <Text variant="caption" tone="subtle" numeric>
                {line.orderNumber} · {formatGregorianDate(line.completedAt, locale)}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text variant="bodyStrong" numeric>
                {t('earnings.sar', { amount: line.net })}
              </Text>
              <Text variant="caption" tone="subtle" numeric>
                {t('earnings.lineCommission', { amount: line.commission })}
              </Text>
            </View>
          </Card>
        ))}
      </View>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
