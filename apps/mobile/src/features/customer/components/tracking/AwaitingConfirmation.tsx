/**
 * A booked appointment, waiting on the workshop to say yes.
 *
 * ⚠️ This state was rendering as a dispatch search.
 *
 * `book_appointment` opens an order at `draft` (0024) and it stays there until
 * the provider confirms it. The tracking screen treated `draft` and
 * `searching` as one thing, so somebody who had chosen a workshop, chosen a
 * Tuesday and chosen a time was shown «نبحث عن فنّي قريب منك» with a live
 * count of technicians being contacted — about a booking where nobody was
 * being dispatched and nothing was being searched for.
 *
 * What this screen does instead is say the three true things: the appointment
 * exists, here is when it is, and the workshop has not confirmed it yet.
 *
 * **No countdown, and no invented deadline.** Nothing in the schema promises
 * the workshop will answer within any period, so a timer here would be the app
 * making a commitment on somebody else's behalf. If they never answer, the
 * customer cancels — and `release_slot_on_cancel` (0036) hands the place back
 * to the calendar for someone else.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { useSession } from '@/features/shared/state/session';
import { formatGregorianDate, formatHijriDate } from '@/features/shared/lib/dates';
import type { Order, ProviderSummary } from '@/features/shared/data/types';

export interface AwaitingConfirmationProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly onCancel: () => void;
  readonly cancelPending?: boolean | undefined;
  readonly cancelFailed?: boolean | undefined;
}

export function AwaitingConfirmation({
  order,
  provider,
  onCancel,
  cancelPending,
  cancelFailed,
}: AwaitingConfirmationProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const locale = useSession((state) => state.locale);

  const when = order.scheduledFor;
  const hijri = when === null ? null : formatHijriDate(when, i18n.language);

  return (
    <View style={{ gap: theme.spacing.base, flex: 1 }}>
      <Card
        testID="awaiting-confirmation-banner"
        elevation="none"
        style={{
          backgroundColor: theme.colors.surfaceSunken,
          gap: theme.spacing.xs,
        }}
      >
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Icon name="calendar" size={theme.iconSize.md} color={theme.colors.primary} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('tracking.awaitingTitle')}
          </Text>
        </View>
        <Text variant="bodySmall" tone="muted">
          {t('tracking.awaitingBody')}
        </Text>
      </Card>

      {/* The appointment itself — the part the customer arranged their week
          around, and the part the old screen never showed. */}
      {when !== null ? (
        <Card elevation="sm" style={{ gap: theme.spacing.xs }}>
          <Text variant="label" tone="muted">
            {t('tracking.awaitingWhen')}
          </Text>
          <Text variant="heading" numeric testID="awaiting-when">
            {formatGregorianDate(when, locale)}
          </Text>
          <Text variant="bodyStrong" numeric>
            {new Date(when).toLocaleTimeString(locale.startsWith('ar') ? 'ar-u-nu-latn' : locale, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          {/* §5: Hijri alongside Gregorian, never instead of it. */}
          {hijri !== null ? (
            <Text variant="caption" tone="subtle">
              {hijri}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {provider !== null ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="label" tone="muted">
            {t('tracking.awaitingProvider')}
          </Text>
          <Text variant="bodyStrong">{provider.businessNameAr}</Text>
        </Card>
      ) : null}

      <View style={{ flex: 1 }} />

      {cancelFailed === true ? (
        <Text variant="caption" tone="emergency">
          {t('tracking.errors.cancelFailed')}
        </Text>
      ) : null}

      <Button
        testID="awaiting-cancel"
        label={t('tracking.awaitingCancel')}
        variant="ghost"
        loading={cancelPending ?? false}
        onPress={onCancel}
      />
    </View>
  );
}
