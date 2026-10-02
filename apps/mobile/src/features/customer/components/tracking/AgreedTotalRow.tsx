/**
 * The agreed total, at the foot of a live job.
 *
 * The amount alone on the line, and "fixed, VAT included" under it. As one
 * string — «سعر ثابت — 172.50 ر.س شامل الضريبة» — it wrapped over two lines
 * and squeezed its label into a narrow column beside it, on the one number
 * the customer is checking.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Row, Text, useTheme } from '@habba/ui';
import type { Order } from '@/features/shared/data/types';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { agreedTotal } from '@/features/shared/lib/order-price';

export function AgreedTotalRow({
  order,
  label,
  divided = false,
  fixed = true,
}: {
  readonly order: Order;
  readonly label: string;
  readonly divided?: boolean;
  /**
   * Emergency prices are fixed centrally (§11); a booked service is the
   * provider's price, which the bill can still change with parts.
   */
  readonly fixed?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const total = agreedTotal(order);

  return (
    <Row
      justify="space-between"
      align="flex-start"
      gap="md"
      style={
        divided
          ? {
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              paddingTop: theme.spacing.base,
            }
          : undefined
      }
    >
      <Text variant="body" tone="muted" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <View style={{ gap: 2 }}>
        <Text variant="subheading" numeric>
          {total === null ? '—' : t('common.sar', { amount: formatSarDisplay(total) })}
        </Text>
        <Text variant="caption" tone="subtle">
          {fixed ? t('tracking.fixedInclVat') : t('tracking.inclVat')}
        </Text>
      </View>
    </Row>
  );
}
