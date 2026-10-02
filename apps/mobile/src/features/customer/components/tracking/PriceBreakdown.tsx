/**
 * Line-itemed price with VAT, shared by the quote screen (06) and the receipt
 * (08c).
 *
 * §9.1: the customer must never accept a number they have not been shown
 * broken down, so the total is always rendered alongside its components rather
 * than on its own.
 *
 * Every line reads the same way — «320 ر.س» — as the lines on the quote
 * screen before it. The total is the amount alone: once parts are on the
 * bill it is no longer the fixed emergency price, and calling it one would
 * be telling the customer something untrue about the number they approve.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Row, Text, useTheme } from '@habba/ui';
import type { SarAmount } from '@habba/core';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { agreedTotal } from '@/features/shared/lib/order-price';
import type { Order } from '@/features/shared/data/types';

export interface PriceBreakdownProps {
  readonly order: Order;
  readonly testID?: string;
}

export function PriceBreakdown({ order, testID }: PriceBreakdownProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const sar = (amount: SarAmount) => t('common.sar', { amount: formatSarDisplay(amount) });
  const total = agreedTotal(order);

  const row = (label: string, amount: SarAmount) => (
    <Row key={label} justify="space-between">
      <Text variant="bodySmall" tone="muted">
        {label}
      </Text>
      <Text variant="bodySmall" tone="muted" numeric>
        {sar(amount)}
      </Text>
    </Row>
  );

  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      {order.labourAmount !== null ? row(t('tracking.labourLine'), order.labourAmount) : null}
      {order.partsAmount !== null ? row(t('tracking.partsLine'), order.partsAmount) : null}
      {order.vatAmount !== null ? row(t('tracking.vatLine'), order.vatAmount) : null}

      <View
        style={{
          height: 1,
          backgroundColor: theme.colors.border,
          marginVertical: theme.spacing.xs,
        }}
      />

      <Row justify="space-between">
        <Text variant="bodyStrong">{t('tracking.totalLine')}</Text>
        <Text variant="subheading" numeric>
          {total === null ? '—' : sar(total)}
        </Text>
      </Row>
      <Text variant="caption" tone="subtle">
        {t('tracking.inclVat')}
      </Text>
    </View>
  );
}
