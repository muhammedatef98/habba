/**
 * Line-itemed price with VAT, shared by the quote screen (06) and the receipt
 * (08c).
 *
 * §9.1: the customer must never accept a number they have not been shown
 * broken down, so the total is always rendered alongside its components rather
 * than on its own.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, useTheme } from '@habba/ui';
import type { Order } from '@/data/types';

export interface PriceBreakdownProps {
  readonly order: Order;
  readonly testID?: string;
}

export function PriceBreakdown({ order, testID }: PriceBreakdownProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const row = (label: string, amount: string) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
        {amount}
      </Text>
    </View>
  );

  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      {order.labourAmount !== null ? row(t('tracking.labourLine'), order.labourAmount) : null}
      {order.partsAmount !== null ? row(t('quote.partsTotal'), order.partsAmount) : null}
      {order.vatAmount !== null ? row(t('tracking.vatLine'), order.vatAmount) : null}

      <View
        style={{
          height: 1,
          backgroundColor: theme.colors.border,
          marginVertical: theme.spacing.xs,
        }}
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{t('tracking.totalLine')}</Text>
        <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {t('emergency.priceFixed', { amount: order.totalAmount ?? '—' })}
        </Text>
      </View>
    </View>
  );
}
