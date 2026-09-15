/**
 * الأرباح — what the technician is owed, and what has been paid.
 *
 * Until this screen existed, finished work left the app entirely: `my-jobs`
 * filters to live statuses and `payouts` only gains a row when ops runs the
 * job. Between completing a repair and being paid for it there was nothing to
 * look at, which for someone doing this for a living is the screen they would
 * check most.
 *
 * Two decisions shape it.
 *
 * **The commission is shown, not netted out.** A headline "475 ﷼" with the
 * hundred taken out quietly is how a marketplace teaches its providers to
 * distrust it. §1's sixth differentiator is transparent pricing; the same
 * argument applies pointing the other way. الإجمالي, عمولة هبّة and الصافي are
 * all three on the card.
 *
 * **Nothing here is computed on the device.** Every figure comes from 0067,
 * which is the same code `build_payout` uses. A screen that re-derived the net
 * from the gross and a rate would be a second implementation of the arithmetic
 * that pays this person, and it would drift.
 */

import { View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card,
  EmptyState,
  Icon,
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
  type EarningLine,
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

export default function EarningsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useSession((state) => state.locale);

  const summary = useQuery({
    queryKey: ['earnings-summary'],
    queryFn: () => providerRepository.getEarningsSummary(),
  });

  const unsettled = useQuery({
    queryKey: ['earnings-unsettled'],
    queryFn: () => providerRepository.listUnsettledEarnings(),
  });

  const payouts = useQuery({
    queryKey: ['payouts'],
    queryFn: () => providerRepository.listPayouts(),
  });

  if (summary.isPending) {
    return (
      <Screen scrollable style={{ gap: theme.spacing.lg }}>
        <Text variant="title">{t('earnings.title')}</Text>
        <Skeleton height={140} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </Screen>
    );
  }

  const data = summary.data;
  const lines = unsettled.data ?? [];
  const runs = payouts.data ?? [];

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <Text variant="title">{t('earnings.title')}</Text>

      {/* The headline. `unsettledNet` is what will actually arrive, so it is
          the big number — but the two figures it was derived from sit directly
          underneath it rather than in a footnote. */}
      <Card elevation="sm" style={{ gap: theme.spacing.base }}>
        <View style={{ gap: 2 }}>
          <Text variant="label" tone="muted">
            {t('earnings.unsettledLabel')}
          </Text>
          {/* ⚠️ The stored 2dp form, never `formatSarDisplay`. This is a figure
              someone reconciles against a bank transfer, and money-format.ts is
              explicit that its trimming is for price lists only. */}
          <Text variant="display" numeric testID="unsettled-net">
            {t('earnings.sar', { amount: data?.unsettledNet ?? '0.00' })}
          </Text>
          {/* Branched rather than pluralised. The locale files carry one form
              per key by house convention, and «من ٠ عمل مكتمل» is not a
              sentence anyone would write. */}
          <Text variant="caption" tone="muted">
            {(data?.unsettledCount ?? 0) === 0
              ? t('earnings.unsettledNone')
              : t('earnings.unsettledCount', { count: data?.unsettledCount ?? 0 })}
          </Text>
        </View>

        <StatCluster
          testID="earnings-breakdown"
          items={[
            { key: 'gross', label: t('earnings.gross'), value: data?.unsettledGross ?? '0.00' },
            {
              key: 'commission',
              label: t('earnings.commission'),
              value: data?.unsettledCommission ?? '0.00',
            },
            {
              key: 'net',
              label: t('earnings.net'),
              value: data?.unsettledNet ?? '0.00',
              emphasis: 'accent',
            },
          ]}
        />

        {/* Said once, plainly. The technician receives the net WITH the VAT
            still inside it — Habba's commission is taken on parts and labour
            only — and someone who assumes otherwise under-declares. */}
        <Text variant="caption" tone="subtle">
          {t('earnings.vatNote')}
        </Text>
      </Card>

      {data !== null && data !== undefined && data.lastPaidAt !== null ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken, gap: 2 }}>
          <Text variant="label" tone="muted">
            {t('earnings.paidToDate')}
          </Text>
          <Text variant="heading" numeric>
            {t('earnings.sar', { amount: data.paidNet })}
          </Text>
          <Text variant="caption" tone="subtle">
            {t('earnings.lastPaid', { date: formatGregorianDate(data.lastPaidAt, locale) })}
          </Text>
        </Card>
      ) : null}

      {/* Unsettled work, job by job. The list is what makes the headline
          checkable — a total nobody can break down is a number you either
          believe or do not. */}
      {lines.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="subheading">{t('earnings.unsettledJobs')}</Text>
          {lines.map((line) => (
            <EarningRow key={line.orderId} line={line} locale={locale} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('earnings.payouts')}</Text>

        {runs.length === 0 ? (
          <EmptyState
            testID="no-payouts"
            title={t('earnings.noPayoutsTitle')}
            body={t('earnings.noPayoutsBody')}
            icon={<Icon name="wallet" size={28} color={theme.colors.textSubtle} />}
          />
        ) : (
          runs.map((payout) => (
            <Pressable
              key={payout.id}
              testID={`payout-${payout.id}`}
              accessibilityRole="button"
              accessibilityLabel={t('earnings.sar', { amount: payout.netAmount })}
              onPress={() => router.push({ pathname: '/payout', params: { id: payout.id } })}
              style={({ pressed }) => [pressed ? { opacity: 0.9 } : null]}
            >
              <Card elevation="sm" style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'flex-start',
                    gap: theme.spacing.sm,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numeric>
                      {t('earnings.sar', { amount: payout.netAmount })}
                    </Text>
                    <Text variant="caption" tone="subtle">
                      {t('earnings.period', {
                        from: formatGregorianDate(payout.periodStart, locale),
                        to: formatGregorianDate(payout.periodEnd, locale),
                      })}
                    </Text>
                  </View>

                  <StatusPill
                    tone={PAYOUT_TONE[payout.status]}
                    showDot={payout.status === 'approved'}
                    label={t(`earnings.status.${payout.status}`)}
                  />
                </View>

                <Text variant="caption" tone="muted">
                  {t('earnings.payoutJobs', { count: payout.orderCount })}
                </Text>
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}

function EarningRow({ line, locale }: { readonly line: EarningLine; readonly locale: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card
      testID={`earning-${line.orderId}`}
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
        {/* The deduction, per job, rather than only in the total. This is the
            line a technician queries, and «العمولة ٦٠» answers it where a
            headline never can. */}
        <Text variant="caption" tone="subtle" numeric>
          {t('earnings.lineCommission', { amount: line.commission })}
        </Text>
      </View>
    </Card>
  );
}
