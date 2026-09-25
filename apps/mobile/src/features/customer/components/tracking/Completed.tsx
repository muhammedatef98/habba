/**
 * Screen 08c — done, invoiced, and rated.
 *
 * The receipt and the rating share one screen, and the rating is skippable:
 * §9.1 is explicit that the customer is not held hostage once their emergency
 * is over. The completion also writes to the vehicle logbook automatically,
 * which is the moat (§1) — so the link into the logbook is the other action
 * that matters here.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { InvoiceDocument } from '@habba/core';
import { Button, Card, Icon, Text, useTheme } from '@habba/ui';
import { RatingStars, RatingStarsValue } from '@/features/customer/components/RatingStars';
import { PriceBreakdown } from './PriceBreakdown';
import type { Order, ProviderSummary } from '@/features/shared/data/types';
import { DocumentActions } from '@/features/shared/components/DocumentActions';
import { invoiceDocument } from '@/features/shared/lib/report-pdf';

export interface CompletedProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly onRate: (stars: number) => void;
  readonly ratePending: boolean;
  readonly rateSucceeded: boolean;
  readonly rateFailed?: boolean | undefined;
  readonly onViewLogbook: () => void;
  readonly onDismiss: () => void;
  /**
   * The tax invoice, issued by the database when the order completed (0074).
   * Null while it loads, and for an order with nothing to invoice.
   */
  readonly invoice?: InvoiceDocument | null | undefined;
  /**
   * The stars already given, when the order is opened again from the history.
   * Undefined while that is still being read, so the stars do not flash up
   * inviting a second rating the server would refuse.
   */
  readonly givenRating?: number | null | undefined;
}

export function Completed({
  order,
  provider,
  onRate,
  ratePending,
  rateSucceeded,
  rateFailed = false,
  onViewLogbook,
  onDismiss,
  invoice = null,
  givenRating,
}: CompletedProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rated = rateSucceeded || (givenRating !== null && givenRating !== undefined);

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <View style={{ alignItems: 'center', gap: theme.spacing.base, paddingTop: theme.spacing.lg }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.successSubtle,
            borderWidth: 1,
            borderColor: theme.colors.successBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* The icon, not a «✓» character: the Arabic display face has no
              check glyph and fell back to one that read as «√». */}
          <Icon name="check" size={theme.iconSize['2xl']} color={theme.colors.successFg} />
        </View>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" align="center">
            {t('tracking.completedTitle')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t('tracking.completedBody')}
          </Text>
        </View>
      </View>

      <Card testID="completed-receipt">
        <View style={{ gap: theme.spacing.md }}>
          <PriceBreakdown order={order} />
          {order.escrowStatus === 'captured' ? (
            <Text variant="caption" tone="muted">
              {t('tracking.paidWith', { method: 'mada' })}
            </Text>
          ) : null}
          {invoice !== null ? (
            <View
              style={{
                gap: theme.spacing.sm,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                paddingTop: theme.spacing.md,
              }}
            >
              <Text variant="caption" tone="muted">
                {t('documents.invoiceNumber', { number: invoice.invoiceNumber })}
              </Text>
              <DocumentActions
                testID="completed-invoice"
                load={() => Promise.resolve(invoiceDocument(invoice, t('documents.invoice')))}
                viewLabel={t('documents.viewInvoice')}
              />
            </View>
          ) : null}
        </View>
      </Card>

      {order.vehicleId !== null ? (
        <Button label={t('tracking.viewLogbook')} variant="secondary" onPress={onViewLogbook} />
      ) : null}

      {givenRating === undefined && !rateSucceeded ? null : (
        <Card testID="completed-rating">
          <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <Text variant="bodyStrong" align="center">
              {givenRating !== null && givenRating !== undefined
                ? t('tracking.youRated', { name: provider?.businessNameAr ?? '' })
                : t('tracking.rateProviderQuestion', { name: provider?.businessNameAr ?? '' })}
            </Text>
            {givenRating !== null && givenRating !== undefined ? (
              <>
                <RatingStarsValue testID="completed-rating-given" stars={givenRating} />
                {rateSucceeded ? (
                  <Text variant="body" tone="success">
                    {t('tracking.rateThanks')}
                  </Text>
                ) : null}
              </>
            ) : rateSucceeded ? (
              <Text variant="body" tone="success">
                {t('tracking.rateThanks')}
              </Text>
            ) : (
              <>
                <RatingStars onRate={onRate} disabled={ratePending} />
                {/* The stars stay tappable underneath, so the message is an
                    invitation to try again rather than a dead end. */}
                {rateFailed ? (
                  <Text variant="caption" tone="emergency" align="center">
                    {t('tracking.errors.rateFailed')}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </Card>
      )}

      <View style={{ flex: 1 }} />

      <Button
        testID="completed-done"
        label={rated ? t('common.done') : t('common.later')}
        variant={rated ? 'secondary' : 'ghost'}
        onPress={onDismiss}
      />
    </View>
  );
}
