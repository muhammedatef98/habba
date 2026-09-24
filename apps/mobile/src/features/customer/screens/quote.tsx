/**
 * Quote approval — §9.1: line-itemed parts + labour, each part with OEM flag
 * and price, approve/reject per line.
 *
 * Each line gets an answer: approve, or decline (0067). A declined line stays
 * on the screen, muted, because it stays on the record — and a customer who
 * changes their mind can still approve it while the job is open. The
 * technician cannot hand the job back until every line has one answer or the
 * other, which is why the count of lines still waiting leads the screen.
 *
 * Re-pricing an approved line revokes its approval (0035) — if that happens
 * while this screen is open, the next poll shows the line reverted and
 * unapproved again, which is the correct and intended behaviour, not a bug.
 */

import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Icon,
  Row,
  Screen,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import {
  addSar,
  applyRate,
  multiplySar,
  sarOrThrow,
  SAUDI_VAT_RATE,
  type SarAmount,
} from '@habba/core';
import { repository } from '@/features/shared/data/repository';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { formatCount } from '@/features/shared/lib/format-number';
import { useIsAuthenticated } from '@/features/shared/state/session';

export default function QuoteScreen() {
  const { t, i18n } = useTranslation();
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

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['order-parts', id] });
    await queryClient.invalidateQueries({ queryKey: ['order', id] });
  };

  const approve = useMutation({
    mutationFn: (partId: string) => repository.approveOrderPart(partId),
    onSuccess: refresh,
  });

  const decline = useMutation({
    mutationFn: (partId: string) => repository.declineOrderPart(partId),
    onSuccess: refresh,
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const lines = parts.data ?? [];
  const isDeclined = (line: (typeof lines)[number]) => line.declinedAt !== null;
  const pendingCount = lines.filter((line) => !line.approvedByCustomer && !isDeclined(line)).length;
  const allApproved = lines.length > 0 && pendingCount === 0;

  // CLAUDE.md §2.5 / ADR-0007: exact SAR arithmetic, never float — same
  // module and same rate-rounding rule the server uses. A declined line is
  // never billed, so it is not in the total either.
  const partsAmount = lines
    .filter((line) => !isDeclined(line))
    .reduce(
      (sum, line) => addSar(sum, multiplySar(line.unitPrice, line.quantity)),
      sarOrThrow('0.00'),
    );
  const labourAmount = order.data?.quotedAmount ?? sarOrThrow('0.00');
  const vatAmount = applyRate(addSar(partsAmount, labourAmount), SAUDI_VAT_RATE);
  const totalAmount = addSar(addSar(partsAmount, labourAmount), vatAmount);

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Text variant="title" style={{ flex: 1 }}>
            {t('quote.title')}
          </Text>
          {/* The count is the point of the screen: the technician is standing
              still until these are answered, and a customer who cannot see how
              many are left cannot tell whether they are done. */}
          {lines.length > 0 ? (
            <StatusPill
              tone={pendingCount === 0 ? 'success' : 'active'}
              showDot={pendingCount > 0}
              label={
                pendingCount === 0
                  ? t('quote.allApprovedBadge')
                  : t('quote.pendingBadge', {
                      count: formatCount(pendingCount, i18n.language),
                    })
              }
            />
          ) : null}
        </View>
        <Text variant="body" tone="muted">
          {t('quote.subtitle')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {lines.map((line) => (
          <Card
            key={line.id}
            testID={`quote-line-${line.id}`}
            elevation={line.approvedByCustomer || isDeclined(line) ? 'none' : 'sm'}
            style={{
              borderWidth: 1,
              borderColor: line.approvedByCustomer
                ? theme.colors.successBorder
                : isDeclined(line)
                  ? theme.colors.border
                  : theme.colors.accent,
              backgroundColor: line.approvedByCustomer
                ? theme.colors.successSubtle
                : isDeclined(line)
                  ? theme.colors.surfaceSunken
                  : theme.colors.surface,
              opacity: isDeclined(line) ? 0.75 : 1,
            }}
          >
            <View style={{ gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  justifyContent: 'space-between',
                }}
              >
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
                  {t('quote.warranty', { count: line.warrantyDays })}
                </Text>
              ) : null}

              <Text variant="bodyStrong" numeric>
                {t('quote.unitPrice', { price: formatSarDisplay(line.unitPrice) })}
              </Text>

              {line.approvedByCustomer ? (
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                  }}
                >
                  <Icon name="check" size={theme.iconSize.sm} color={theme.colors.successFg} />
                  <Text variant="caption" tone="success">
                    {t('quote.approvedLine')}
                  </Text>
                </View>
              ) : isDeclined(line) ? (
                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="caption" tone="muted">
                    {t('quote.declinedLine')}
                  </Text>
                  <Button
                    testID={`reapprove-part-${line.id}`}
                    label={t('quote.changedMind')}
                    variant="ghost"
                    size="medium"
                    onPress={() => approve.mutate(line.id)}
                    loading={approve.isPending && approve.variables === line.id}
                  />
                </View>
              ) : (
                <View style={{ gap: theme.spacing.sm }}>
                  <Row gap="sm">
                    <View style={{ flex: 1 }}>
                      <Button
                        testID={`approve-part-${line.id}`}
                        label={t('quote.approveLine')}
                        size="medium"
                        onPress={() => approve.mutate(line.id)}
                        loading={approve.isPending && approve.variables === line.id}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        testID={`decline-part-${line.id}`}
                        label={t('quote.declineLine')}
                        variant="secondary"
                        size="medium"
                        onPress={() => decline.mutate(line.id)}
                        loading={decline.isPending && decline.variables === line.id}
                      />
                    </View>
                  </Row>

                  {/* Approving a part is the customer agreeing to pay for it.
                      A failure that says nothing leaves them believing they
                      approved it, and the job waiting on an approval that
                      never landed — on the line that carries the money. */}
                  {(approve.isError && approve.variables === line.id) ||
                  (decline.isError && decline.variables === line.id) ? (
                    <Text variant="caption" tone="emergency">
                      {t('quote.approveFailed')}
                    </Text>
                  ) : null}
                </View>
              )}
            </View>
          </Card>
        ))}
      </View>

      <Card elevation="sm">
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
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        justifyContent: 'space-between',
      }}
    >
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'default' : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={strong ? 'accent' : 'default'} numeric>
        {t('quote.amount', { amount: formatSarDisplay(value) })}
      </Text>
    </View>
  );
}
