/**
 * The live order, hoisted to the top of the home screen.
 *
 * This is the single biggest thing the old home got wrong: an in-flight
 * emergency appeared as a hairline row *below* the emergency button, so
 * relaunching the app mid-job offered to start a second one before it offered
 * to show you the first. Someone standing on the hard shoulder reopening the
 * app has exactly one question, and this answers it before anything else on
 * the screen gets a turn.
 *
 * Teal, not red. §8 keeps red for the emergency bar inside the flow itself;
 * out here a live job is a state, not an alarm — the pulse carries the
 * liveness instead.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, StatusPill, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { LivePulseDot } from './LivePulseDot';
import type { OrderSummary } from '@/features/shared/data/types';

export interface ActiveOrderCardProps {
  readonly order: OrderSummary;
  readonly onPress: () => void;
  readonly testID?: string | undefined;
}

export function ActiveOrderCard({ order, onPress, testID }: ActiveOrderCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="sm"
      onPress={onPress}
      accessibilityLabel={`${t('home.activeTitle')} — ${order.serviceNameAr}`}
      style={{
        backgroundColor: theme.colors.primarySubtle,
        borderColor: theme.colors.primary,
        borderWidth: 1,
        // Logical, so the accent edge stays on the reading-start side in both
        // directions rather than jumping to the wrong side in Arabic.
        borderStartWidth: 4,
        borderRadius: theme.radius.lg,
      }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <LivePulseDot color={theme.colors.primary} />
          <Text variant="label" tone="primary" style={{ flex: 1 }}>
            {t('home.activeTitle')}
          </Text>
          <StatusPill tone="active" showDot={false} label={t(`job.status.${order.status}`)} />
        </View>

        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {order.serviceNameAr}
            </Text>
            <Text variant="caption" tone="primary">
              {t('home.activeTrack')}
            </Text>
          </View>
          <Icon name="chevronForward" size={theme.iconSize.md} color={theme.colors.primary} />
        </View>
      </View>
    </Card>
  );
}
