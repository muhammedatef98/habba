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
import { Button, Card, Text, useTheme } from '@habba/ui';
import { RatingStars } from '@/features/customer/components/RatingStars';
import { PriceBreakdown } from './PriceBreakdown';
import type { Order, ProviderSummary } from '@/features/shared/data/types';

export interface CompletedProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly onRate: (stars: number) => void;
  readonly ratePending: boolean;
  readonly rateSucceeded: boolean;
  readonly rateFailed?: boolean | undefined;
  readonly onViewLogbook: () => void;
  readonly onDismiss: () => void;
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
}: CompletedProps) {
  const { t } = useTranslation();
  const theme = useTheme();

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
          <Text variant="title" tone="success">
            ✓
          </Text>
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
        </View>
      </Card>

      {order.vehicleId !== null ? (
        <Button label={t('tracking.viewLogbook')} variant="secondary" onPress={onViewLogbook} />
      ) : null}

      <Card testID="completed-rating">
        <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <Text variant="bodyStrong">
            {t('tracking.rateProviderQuestion', { name: provider?.businessNameAr ?? '' })}
          </Text>
          {rateSucceeded ? (
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

      <View style={{ flex: 1 }} />

      {!rateSucceeded ? (
        <Button label={t('common.later')} variant="ghost" onPress={onDismiss} />
      ) : null}
    </View>
  );
}
