/**
 * صحة السيارة, explained.
 *
 * The home card shows the ring; this is where the owner learns why it reads
 * what it does. Every point taken off is listed with the reason the server
 * gave (0097), so the score is never a verdict without an argument — and the
 * argument is also the to-do list: each line is something the owner can fix
 * from the section right below it.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, ScoreRing, Text, rowDirectionFor, useTheme } from '@habba/ui';
import type { HealthFactor, VehicleHealth } from '@habba/core';
import { formatCount } from '@/features/shared/lib/format-number';
import { toneForGrade } from '@/features/shared/lib/vehicle-health';

export interface VehicleHealthCardProps {
  readonly health: VehicleHealth;
  readonly testID?: string | undefined;
}

export function VehicleHealthCard({ health, testID }: VehicleHealthCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const grade = t(`insights.grade_${health.grade}`);
  const unknown = health.score === null;

  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="sm"
      style={{ gap: theme.spacing.md }}
    >
      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.lg,
        }}
      >
        <ScoreRing
          testID="health-ring-large"
          score={health.score}
          tone={toneForGrade(health.grade)}
          size={88}
          {...(health.score !== null
            ? { formatted: formatCount(health.score, i18n.language) }
            : {})}
          accessibilityLabel={
            unknown
              ? t('insights.healthUnknownA11y')
              : t('insights.healthA11y', { score: health.score, grade })
          }
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="subtle">
            {t('insights.healthTitle')}
          </Text>
          <Text variant="heading">{grade}</Text>
          {!unknown ? (
            <Text variant="caption" tone="muted">
              {t('insights.healthOutOf')}
            </Text>
          ) : null}
        </View>
      </View>

      {unknown ? (
        <Text variant="bodySmall" tone="muted">
          {t('insights.healthUnknownBody')}
        </Text>
      ) : health.factors.length === 0 ? (
        <Text variant="bodySmall" tone="success">
          {t('insights.healthAllGood')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('insights.healthWhy')}
          </Text>
          {health.factors.map((factor) => (
            <FactorRow key={factor.key} factor={factor} />
          ))}
          <Text variant="caption" tone="subtle">
            {t('insights.healthHint')}
          </Text>
        </View>
      )}
    </Card>
  );
}

function FactorRow({ factor }: { readonly factor: HealthFactor }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const positive = factor.impact > 0;
  const points = `${positive ? '+' : '−'}${formatCount(Math.abs(factor.impact), i18n.language)}`;

  return (
    <View
      testID={`health-factor-${factor.key}`}
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Icon
        name={positive ? 'check' : 'alert'}
        size={theme.iconSize.sm}
        color={positive ? theme.colors.successFg : theme.colors.warningFg}
      />
      <Text variant="bodySmall" style={{ flex: 1 }}>
        {t(`insights.factor_${factor.key}`, { count: factor.count })}
      </Text>
      <View
        style={{
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 2,
          borderRadius: theme.radius.full,
          backgroundColor: positive ? theme.colors.successSubtle : theme.colors.warningSubtle,
        }}
      >
        {/* Isolated so the sign stays in front of the number in Arabic. */}
        <Text variant="caption" tone={positive ? 'success' : 'warning'} numeric>
          {`⁦${points}⁩`}
        </Text>
      </View>
    </View>
  );
}
