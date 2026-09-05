/**
 * One line of order history on the home screen.
 *
 * The home screen's job is the next action, so history here is a short tail
 * under its own heading rather than a second orders tab. Status is carried by
 * the pill so the row reads at a glance without parsing a sentence.
 *
 * ⚠️ This was a `View` with `onTouchEnd`, which is not a button: it gave no
 * press feedback, ignored `accessibilityRole` for actual activation, and fired
 * on the release of a scroll gesture that happened to end on the row — so
 * flicking the home screen could navigate you into an old order. `Pressable`
 * defers to the scroll responder, which is the whole difference.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, StatusPill, Text, rowDirectionFor, type StatusTone, useTheme } from '@habba/ui';
import { formatShortDate } from '@/features/shared/lib/format-number';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import type { OrderStatus, OrderSummary } from '@/features/shared/data/types';

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

  const when = formatShortDate(order.createdAt, i18n.language);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${order.serviceNameAr} — ${t(`job.status.${order.status}`)}`}
      style={({ pressed }) => [
        {
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
        },
        pressed ? { opacity: 0.6 } : null,
      ]}
    >
      <StatusPill
        tone={toneFor(order.status)}
        showDot={order.status !== 'completed'}
        label={t(`job.status.${order.status}`)}
      />

      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" numberOfLines={1}>
          {order.serviceNameAr}
        </Text>
        <Text variant="caption" tone="subtle">
          {when}
        </Text>
      </View>

      {order.totalAmount !== null ? (
        <Text variant="caption" tone="muted" numeric>
          {t('common.sar', { amount: formatSarDisplay(order.totalAmount) })}
        </Text>
      ) : null}

      <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
    </Pressable>
  );
}
