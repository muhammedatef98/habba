/**
 * أرباحي — what the work has earned, and where the money is.
 *
 * Three questions a technician actually asks, in the order they ask them:
 * how much today / this week / this month; how much is owed and not yet
 * paid; and when did the last transfers land. Then the jobs behind it.
 *
 * Every figure is the server's (0095). The net especially: commission is on
 * parts and labour and never on VAT, per category and per date, and an app
 * that did that arithmetic itself would one day disagree with the payout.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Row, Screen, StatusPill, Text, useTheme } from '@habba/ui';
import type { PayoutStatus } from '@/features/provider/data/provider-repository';
import { PRO_HERO, SectionTitle } from '@/features/provider/components/ProParts';
import { useProviderDashboard } from '@/features/provider/hooks/use-dashboard';
import { formatShortDate } from '@/features/shared/lib/format-number';
import { formatSarDisplay } from '@/features/shared/lib/money-format';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABEL: Readonly<Record<Period, string>> = {
  today: 'pro.periodToday',
  week: 'pro.periodWeek',
  month: 'pro.periodMonth',
};

const PAYOUT_TONE: Readonly<Record<PayoutStatus, 'success' | 'neutral' | 'active' | 'emergency'>> =
  {
    pending: 'neutral',
    approved: 'active',
    paid: 'success',
    failed: 'emergency',
  };

export default function EarningsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dashboard = useProviderDashboard();
  const [period, setPeriod] = useState<Period>('week');

  const data = dashboard.data;
  const language = i18n.language;
  const isArabic = language.startsWith('ar');

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }} testID="earnings">
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('pro.earningsTitle')}</Text>
        <Text variant="bodySmall" tone="muted">
          {t('pro.earningsSubtitle')}
        </Text>
      </View>

      {dashboard.isError ? (
        <Card elevation="none" style={{ gap: theme.spacing.sm }}>
          <Text variant="bodySmall" tone="muted">
            {t('pro.loadFailed')}
          </Text>
          <Button
            label={t('pro.retry')}
            variant="secondary"
            size="medium"
            onPress={() => void dashboard.refetch()}
          />
        </Card>
      ) : null}

      {/* The headline: one period's net, large, on the brand colour. */}
      <View
        testID="earnings-hero"
        style={{
          borderRadius: theme.radius.xl,
          padding: theme.spacing.lg,
          gap: theme.spacing.base,
          backgroundColor: PRO_HERO,
        }}
      >
        <Row gap="xs">
          {(['today', 'week', 'month'] as const).map((key) => {
            const selected = key === period;
            return (
              <Pressable
                key={key}
                testID={`earnings-period-${key}`}
                onPress={() => setPeriod(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  paddingVertical: theme.spacing.sm,
                  borderRadius: theme.radius.full,
                  alignItems: 'center',
                  backgroundColor: selected ? '#FFFFFF' : 'rgba(255,255,255,0.12)',
                }}
              >
                <Text variant="label" style={{ color: selected ? PRO_HERO : '#FFFFFF' }}>
                  {t(PERIOD_LABEL[key])}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <View style={{ gap: 2 }}>
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {t('pro.netLabel')}
          </Text>
          <Row gap="sm" align="baseline">
            <Text testID="earnings-net" variant="display" numeric style={{ color: '#FFFFFF' }}>
              {data === undefined ? '—' : formatSarDisplay(data.periods[period].net)}
            </Text>
            <Text variant="body" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {t('provider.sarSuffix')}
            </Text>
          </Row>
        </View>

        <Row
          gap="md"
          style={{
            borderTopWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.18)',
            paddingTop: theme.spacing.md,
          }}
        >
          <HeroFigure
            label={t('pro.jobsLabel')}
            value={data === undefined ? '—' : String(data.periods[period].jobs)}
          />
          <HeroFigure
            label={t('pro.grossLabel')}
            value={
              data === undefined
                ? '—'
                : `${formatSarDisplay(data.periods[period].gross)} ${t('provider.sarSuffix')}`
            }
          />
        </Row>
      </View>

      {/* Owed and not yet paid: the number a technician checks on payday. */}
      {data !== undefined ? (
        <Card
          testID="earnings-unpaid"
          elevation="none"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.accentSubtle,
          }}
        >
          <Row gap="md">
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surface,
              }}
            >
              <Icon name="clock" size={theme.iconSize.sm} color={theme.colors.accentFg} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{t('pro.unpaidTitle')}</Text>
              <Text variant="caption" tone="muted">
                {t('pro.unpaidJobs', { count: data.unpaid.jobs })}
              </Text>
            </View>
            <Text variant="heading" numeric>
              {formatSarDisplay(data.unpaid.net)} {t('provider.sarSuffix')}
            </Text>
          </Row>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle title={t('pro.payoutsTitle')} />
        {data === undefined || data.payouts.length === 0 ? (
          <Text variant="bodySmall" tone="muted">
            {t('pro.noPayouts')}
          </Text>
        ) : (
          <Card elevation="none" style={{ borderWidth: 1, borderColor: theme.colors.border }}>
            {data.payouts.map((payout, index) => (
              <Row
                key={payout.id}
                testID={`payout-${payout.id}`}
                gap="md"
                style={{
                  paddingVertical: theme.spacing.md,
                  ...(index === 0
                    ? {}
                    : { borderTopWidth: 1, borderTopColor: theme.colors.border }),
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodySmall" numeric>
                    {t('pro.payoutPeriod', {
                      from: formatShortDate(payout.periodStart, language),
                      to: formatShortDate(payout.periodEnd, language),
                    })}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('pro.payoutJobs', { count: payout.orderCount })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong" numeric>
                    {formatSarDisplay(payout.netAmount)} {t('provider.sarSuffix')}
                  </Text>
                  <StatusPill
                    label={t(`pro.payoutStatus.${payout.status}`)}
                    tone={PAYOUT_TONE[payout.status]}
                    showDot={false}
                  />
                </View>
              </Row>
            ))}
          </Card>
        )}
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle title={t('pro.recentTitle')} />
        {data === undefined || data.recent.length === 0 ? (
          <Text variant="bodySmall" tone="muted">
            {t('pro.noRecent')}
          </Text>
        ) : (
          <Card elevation="none" style={{ borderWidth: 1, borderColor: theme.colors.border }}>
            {data.recent.map((job, index) => (
              <Row
                key={job.orderId}
                testID={`recent-${job.orderId}`}
                gap="md"
                style={{
                  paddingVertical: theme.spacing.md,
                  ...(index === 0
                    ? {}
                    : { borderTopWidth: 1, borderTopColor: theme.colors.border }),
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.colors.successSubtle,
                  }}
                >
                  <Icon name="check" size={theme.iconSize.sm} color={theme.colors.success} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodySmall" numberOfLines={1}>
                    {isArabic ? job.serviceNameAr : job.serviceNameEn}
                  </Text>
                  <Text variant="caption" tone="subtle" numeric>
                    {job.orderNumber} · {formatShortDate(job.completedAt, language)}
                  </Text>
                </View>
                <Text variant="bodyStrong" tone="success" numeric>
                  +{formatSarDisplay(job.net)}
                </Text>
              </Row>
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

function HeroFigure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </Text>
      <Text variant="bodyStrong" numeric style={{ color: '#FFFFFF' }}>
        {value}
      </Text>
    </View>
  );
}
