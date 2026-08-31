/**
 * One line of order history on the home screen.
 *
 * The design puts a single most-recent order here rather than a list: the home
 * screen's job is the next action, and a full history belongs behind its own
 * tab. Status is carried by the pill, so the row stays readable at a glance
 * without the customer parsing a sentence.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, StatusPill, Text, useTheme, type StatusTone } from '@habba/ui';
import type { OrderStatus, OrderSummary } from '@/data/types';

export interface RecentOrderRowProps {
  readonly order: OrderSummary;
  readonly onPress: () => void;
  readonly testID?: string | undefined;
}

/** Terminal states read as settled; anything else is still moving. */
function toneFor(status: OrderStatus): StatusTone {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'disputed') return 'neutral';
  return 'active';
}

export function RecentOrderRow({ order, onPress, testID }: RecentOrderRowProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const when = new Date(order.createdAt).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
  });

  return (
    <View
      testID={testID}
      accessibilityRole="button"
      onTouchEnd={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: theme.minTouchTarget,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
      }}
    >
      <StatusPill
        tone={toneFor(order.status)}
        showDot={order.status !== 'completed'}
        label={t(`job.status.${order.status}`)}
      />

      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="muted">
          {order.serviceNameAr}
          {' · '}
          {when}
        </Text>
      </View>

      {order.totalAmount !== null ? (
        <Text variant="caption" tone="muted" numeric>
          {t('emergency.priceFixed', { amount: order.totalAmount })}
        </Text>
      ) : null}

      <Icon name="chevronBack" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
    </View>
  );
}
