/**
 * Quote approval — §9.1: line-itemed parts + labour, each part with OEM flag
 * and price, approve/reject per line.
 *
 * "Reject" in the schema is not a separate state from "not yet approved" —
 * order_parts has only `approved_by_customer` (0035's guard_order_parts is
 * the authority). A customer who disagrees with a line leaves it unapproved,
 * which already blocks hand-back server-side; there is deliberately no
 * separate reject action to build here; adding one would be inventing a
 * server capability that does not exist rather than reflecting it.
 *
 * Re-pricing an approved line revokes its approval (0035) — if that happens
 * while this screen is open, the next poll shows the line reverted and
 * unapproved again, which is the correct and intended behaviour, not a bug.
 */

import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { addSar, applyRate, multiplySar, sarOrThrow, type SarAmount } from '@habba/core';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';

export default function QuoteScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => repository.getOrder(id ?? ''),
  });

  const parts = useQuery({
    queryKey: ['order-parts', id],
    queryFn: () => repository.listOrderParts(id ?? ''),
    refetchInterval: 3000,
  });

  const approve = useMutation({
    mutationFn: (partId: string) => repository.approveOrderPart(partId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order-parts', id] });
      await queryClient.invalidateQueries({ queryKey: ['order', id] });
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const lines = parts.data ?? [];
  const allApproved = lines.length > 0 && lines.every((line) => line.approvedByCustomer);

  // CLAUDE.md §2.5 / ADR-0007: exact SAR arithmetic, never float — same
  // module and same rate-rounding rule the server uses.
  const partsAmount = lines.reduce(
    (sum, line) => addSar(sum, multiplySar(line.unitPrice, line.quantity)),
    sarOrThrow('0.00'),
  );
  const labourAmount = order.data?.quotedAmount ?? sarOrThrow('0.00');
  const vatAmount = applyRate(addSar(partsAmount, labourAmount), '0.15');
  const totalAmount = addSar(addSar(partsAmount, labourAmount), vatAmount);

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('quote.title')}</Text>
        <Text variant="body" tone="muted">
          {t('quote.subtitle')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {lines.map((line) => (
          <Card key={line.id} testID={`quote-line-${line.id}`}>
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="bodyStrong">{line.nameAr}</Text>
                <Card
                  elevation="none"
                  style={{
                    paddingVertical: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.sm,
                    backgroundColor: line.isOem
                      ? theme.colors.verifiedSubtle
                      : theme.colors.surfaceSunken,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{ color: line.isOem ? theme.colors.verified : theme.colors.textMuted }}
                  >
                    {line.isOem ? t('quote.oemBadge') : t('quote.aftermarketBadge')}
                  </Text>
                </Card>
              </View>

              <Text variant="caption" tone="muted">
                {t('quote.quantity', { quantity: line.quantity })}
              </Text>
              {line.warrantyDays !== null ? (
                <Text variant="caption" tone="muted">
                  {t('quote.warranty', { days: line.warrantyDays })}
                </Text>
              ) : null}

              <Text variant="bodyStrong">{t('quote.unitPrice', { price: line.unitPrice })}</Text>

              {line.approvedByCustomer ? (
                <Text variant="caption" style={{ color: theme.colors.success }}>
                  {t('quote.approvedLine')}
                </Text>
              ) : (
                <Button
                  testID={`approve-part-${line.id}`}
                  label={t('quote.approveLine')}
                  size="medium"
                  onPress={() => approve.mutate(line.id)}
                  loading={approve.isPending && approve.variables === line.id}
                />
              )}
            </View>
          </Card>
        ))}
      </View>

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.xs }}>
          <SummaryRow label={t('quote.partsLabel')} value={partsAmount} />
          <SummaryRow label={t('quote.labourLabel')} value={labourAmount} />
          <SummaryRow label={t('quote.vatLabel')} value={vatAmount} />
          <View
            style={{
              height: 1,
              backgroundColor: theme.colors.border,
              marginVertical: theme.spacing.xs,
            }}
          />
          <SummaryRow label={t('quote.totalLabel')} value={totalAmount} strong />
        </View>
      </Card>

      <Text variant="caption" tone="muted">
        {allApproved ? t('quote.allApprovedHint') : t('quote.pendingHint')}
      </Text>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: SarAmount;
  strong?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{t('quote.amount', { amount: value })}</Text>
    </View>
  );
}
