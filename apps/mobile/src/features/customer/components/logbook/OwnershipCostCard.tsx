/**
 * تكلفة الملكية — what this car has cost, from its own logbook.
 *
 * Every figure is the server's (0097): Habba orders at what the customer
 * finally paid, the owner's own entries at the cost they typed. The card
 * leads with the last 12 months because that is the number people compare
 * ("is this car getting expensive?"), then the year, then cost per 1,000 km
 * — the figure that lets a 2015 Camry and a 2022 Tahoe be compared at all,
 * and which is withheld until the odometer has moved far enough to mean it.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MiniBars, StatCluster, Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { VehicleCostSummary } from '@habba/core';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { shortMonth } from '@/features/shared/lib/vehicle-health';

export interface OwnershipCostCardProps {
  readonly costs: VehicleCostSummary;
  readonly testID?: string | undefined;
}

export function OwnershipCostCard({ costs, testID }: OwnershipCostCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const sar = (amount: string) => t('common.sar', { amount: formatSarDisplay(amount) });

  if (costs.entries === 0) {
    return (
      <Card
        {...(testID !== undefined ? { testID } : {})}
        elevation="none"
        style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.xs }}
      >
        <Text variant="bodySmall" tone="muted">
          {t('insights.costEmpty')}
        </Text>
      </Card>
    );
  }

  const latest = costs.months[costs.months.length - 1]?.month;
  const categoryMax = Math.max(0, ...costs.categories.map((row) => Number(row.amount)));

  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="sm"
      style={{ gap: theme.spacing.lg }}
    >
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="subtle">
          {t('insights.cost12m')}
        </Text>
        <Text variant="title" numeric testID="cost-12m">
          {sar(costs.last12Months)}
        </Text>
      </View>

      <MiniBars
        testID="cost-months"
        bars={costs.months.map((row, index) => ({
          key: row.month,
          value: Number(row.amount),
          // One label per three months, centred under its quarter: twelve
          // labels at phone width collide.
          ...(index % 3 === 1 ? { label: shortMonth(row.month, i18n.language) } : {}),
        }))}
        labelSpan={3}
        {...(latest !== undefined ? { highlightKey: latest } : {})}
        accessibilityLabel={t('insights.costChartA11y', { amount: sar(costs.last12Months) })}
      />

      <StatCluster
        items={[
          { key: 'year', value: sar(costs.thisYear), label: t('insights.costThisYear') },
          {
            key: 'per1000',
            value: costs.per1000Km === null ? undefined : sar(costs.per1000Km),
            label: t('insights.costPer1000'),
          },
          { key: 'total', value: sar(costs.total), label: t('insights.costTotal') },
        ]}
      />

      {costs.categories.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          {costs.categories.map((row) => {
            const share = categoryMax > 0 ? Number(row.amount) / categoryMax : 0;
            const key = row.category === 'other' ? 'misc' : row.category;
            return (
              <View key={row.category} testID={`cost-category-${row.category}`} style={{ gap: 4 }}>
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                  }}
                >
                  <Text variant="bodySmall" style={{ flex: 1 }}>
                    {t(`insights.cat_${key}`)}
                  </Text>
                  <Text variant="caption" tone="muted" numeric>
                    {sar(row.amount)}
                  </Text>
                </View>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.colors.surfaceSunken,
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(3, Math.round(share * 100))}%`,
                      borderRadius: 3,
                      backgroundColor: theme.colors.primary,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}
