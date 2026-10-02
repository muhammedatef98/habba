/**
 * A confirmed appointment, days away.
 *
 * A booking reaches `accepted` the moment it is confirmed (0065), and the
 * live-tracking screen was built for an emergency technician driving over
 * right now — an ETA, a distance, a stage bar. Shown for Tuesday's oil change
 * it would claim someone was on the way. This says what is true instead:
 * when, where, with whom, and what happens next.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, FadeIn, StatusPill, Text, useTheme } from '@habba/ui';
import { formatAppointment, formatHijriDate } from '@/features/shared/lib/dates';
import { AgreedTotalRow } from './AgreedTotalRow';
import { ProviderRow } from './ProviderRow';
import type { Order, ProviderSummary } from '@/features/shared/data/types';

export interface BookedProps {
  readonly order: Order;
  readonly provider: ProviderSummary | null;
  readonly onCancel: () => void;
  readonly cancelPending: boolean;
}

export function Booked({ order, provider, onCancel, cancelPending }: BookedProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const when =
    order.scheduledFor === null ? null : formatAppointment(order.scheduledFor, i18n.language);
  const hijri =
    order.scheduledFor === null ? null : formatHijriDate(order.scheduledFor, i18n.language);

  return (
    // Each state arrives rather than replacing the last between frames.
    <FadeIn style={{ gap: theme.spacing.base, flex: 1 }}>
      <StatusPill testID="booked-pill" tone="active" label={t('tracking.bookedTitle')} />

      {when !== null ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text testID="booked-when" variant="title">
            {when}
          </Text>
          {hijri !== null ? (
            <Text variant="caption" tone="muted">
              {hijri}
            </Text>
          ) : null}
        </View>
      ) : null}

      {provider !== null ? <ProviderRow provider={provider} showActions={false} /> : null}

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.sm }}>
          {order.fulfilmentMode === 'workshop' && order.serviceAddressAr !== null ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" tone="muted">
                {t('provider.address')}
              </Text>
              <Text variant="bodyStrong">{order.serviceAddressAr}</Text>
            </View>
          ) : null}
          <Text variant="body" tone="muted">
            {order.fulfilmentMode === 'workshop'
              ? t('tracking.bookedWorkshopBody')
              : t('tracking.bookedMobileBody')}
          </Text>
          <AgreedTotalRow order={order} label={t('tracking.totalLine')} fixed={false} />
        </View>
      </Card>

      <Button
        testID="booked-cancel"
        label={t('tracking.bookedCancel')}
        variant="ghost"
        onPress={onCancel}
        loading={cancelPending}
      />
    </FadeIn>
  );
}
