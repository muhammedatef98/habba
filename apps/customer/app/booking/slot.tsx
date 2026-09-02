/**
 * Step 3 — when, and the price before committing.
 *
 * The confirm step lives at the bottom of this screen rather than on a fourth
 * one. §11 requires the price to be visible before approval, and it is: the
 * summary sits directly under the time the customer just picked, with the
 * service, the VAT and the total broken out. A separate confirmation screen
 * would add a tap to re-read numbers that were already on the previous screen.
 *
 * A day strip over a calendar. Slots run a week ahead, and a month grid where
 * three weeks of it are empty tells the customer almost nothing while costing
 * a lot of screen.
 *
 * The booking can still fail here, and legitimately: `book_appointment`'s
 * claim is a single atomic UPDATE (0024), so a slot that was free when it was
 * listed can be gone by the time it is tapped. That is the normal outcome
 * under contention, not an error to hide — it gets its own message telling the
 * customer to pick another time.
 */

import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addSar, applyRate, SAUDI_VAT_RATE, type SarAmount } from '@habba/core';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { repository } from '@/data/repository';
import { daysFromToday, groupSlotsByDay } from '@/lib/slot-days';
import { formatSarDisplay } from '@/lib/money-format';
import { useBookingDraft } from '@/state/booking-draft';
import type { AppointmentSlot } from '@/data/types';

export default function BookingSlotScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const draft = useBookingDraft();
  const provider = draft.provider;
  const service = draft.service;

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * The booking has been placed and this screen is on its way out.
   *
   * Without it the guard below and the success handler fight each other:
   * clearing the draft is the right thing to do the moment the server owns the
   * order, but it also empties `provider`, so the guard fired first and
   * redirected back to step 1 — the booking succeeded and the customer was
   * returned to an empty form as if nothing had happened. A ref rather than
   * state because nothing should re-render on it.
   */
  const placed = useRef(false);

  const slots = useQuery({
    queryKey: ['slots', provider?.id],
    queryFn: () => repository.listSlots(provider?.id ?? ''),
    enabled: provider !== null,
  });

  const book = useMutation({
    mutationFn: async () => {
      if (draft.slot === null || service === null) throw new Error('incomplete');

      return repository.bookAppointment({
        slotId: draft.slot.id,
        serviceId: service.id,
        ...(draft.vehicleId !== null ? { vehicleId: draft.vehicleId } : {}),
        ...(draft.problem.trim().length > 0 ? { problem: draft.problem.trim() } : {}),
      });
    },
    onSuccess: async (orderId) => {
      placed.current = true;
      // The draft is finished the moment the server owns the order; leaving it
      // populated would pre-fill the next booking with this one's answers.
      draft.reset();
      await queryClient.invalidateQueries({ queryKey: ['recent-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['orders', 'all'] });
      router.replace({ pathname: '/tracking', params: { id: orderId } });
    },
    onError: (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        message.includes('slot_unavailable') || message.includes('no longer available')
          ? t('booking.errorSlotTaken')
          : t('booking.errorGeneric'),
      );
      // The list is now known to be stale — whatever else happened, this slot
      // is not bookable, so refetch rather than leave it on screen.
      void slots.refetch();
      draft.selectSlot(null);
    },
  });

  if (!placed.current && (provider === null || service === null)) {
    return <Redirect href="/booking" />;
  }
  if (provider === null || service === null) return null;

  const days = groupSlotsByDay(slots.data ?? []);
  const activeKey = dayKey ?? days[0]?.key ?? null;
  const activeDay = days.find((day) => day.key === activeKey);

  const subtotal = service.basePrice;
  const vat = applyRate(subtotal, SAUDI_VAT_RATE);
  const total = addSar(subtotal, vat);

  const dayLabel = (date: Date) => {
    const offset = daysFromToday(date);
    if (offset === 0) return t('booking.slotToday');
    if (offset === 1) return t('booking.slotTomorrow');
    return date.toLocaleDateString(
      i18n.language.startsWith('ar') ? 'ar-u-nu-latn' : i18n.language,
      {
        weekday: 'short',
        day: 'numeric',
      },
    );
  };

  const timeLabel = (slot: AppointmentSlot) =>
    new Date(slot.startsAt).toLocaleTimeString(
      i18n.language.startsWith('ar') ? 'ar-u-nu-latn' : i18n.language,
      { hour: '2-digit', minute: '2-digit' },
    );

  return (
    <Screen scrollable>
      <BookingSteps
        current={2}
        title={t('booking.slotHeadline')}
        subtitle={t('booking.slotSubhead')}
      />

      {slots.isPending ? (
        <Text variant="body" tone="muted">
          {t('common.loading')}
        </Text>
      ) : days.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="body" tone="muted">
            {t('booking.slotNone')}
          </Text>
        </Card>
      ) : (
        <View style={{ gap: theme.spacing.base }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {days.map((day) => {
              const selected = day.key === activeKey;
              return (
                <Card
                  key={day.key}
                  testID={`booking-day-${day.key}`}
                  elevation="none"
                  onPress={() => {
                    setDayKey(day.key);
                    draft.selectSlot(null);
                  }}
                  style={{
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.full,
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceSunken,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderWidth: 1,
                  }}
                >
                  <Text
                    variant="bodySmall"
                    style={selected ? { color: theme.colors.primaryText } : undefined}
                    tone={selected ? 'default' : 'muted'}
                  >
                    {dayLabel(day.date)}
                  </Text>
                </Card>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {activeDay?.slots.map((slot) => {
              const selected = draft.slot?.id === slot.id;
              return (
                <Card
                  key={slot.id}
                  testID={`booking-slot-${slot.id}`}
                  elevation="none"
                  onPress={() => {
                    draft.selectSlot(slot);
                    setError(undefined);
                  }}
                  style={{
                    minWidth: 96,
                    alignItems: 'center',
                    paddingVertical: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderWidth: selected ? 1.5 : 1,
                  }}
                >
                  <Text variant="bodyStrong" tone={selected ? 'primary' : 'default'} numeric>
                    {timeLabel(slot)}
                  </Text>
                  {/* Scarcity only when it is true — `remaining` comes from
                      capacity minus booked_count, not from a growth tactic. */}
                  {slot.remaining === 1 ? (
                    <Text variant="caption" tone="warning">
                      {t('booking.slotLastOne')}
                    </Text>
                  ) : null}
                </Card>
              );
            })}
          </View>
        </View>
      )}

      {draft.slot !== null ? (
        <Card testID="booking-summary" elevation="sm" style={{ gap: theme.spacing.md }}>
          <Text variant="subheading">{t('booking.summaryTitle')}</Text>

          <View style={{ gap: theme.spacing.xs }}>
            <SummaryRow label={service.nameAr} value={undefined} strong />
            <SummaryRow label={provider.businessNameAr} value={undefined} />
            <SummaryRow
              label={new Date(draft.slot.startsAt).toLocaleString(
                i18n.language.startsWith('ar') ? 'ar-u-nu-latn' : i18n.language,
                {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                },
              )}
              value={undefined}
            />
          </View>

          <View
            style={{
              gap: theme.spacing.xs,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              paddingTop: theme.spacing.md,
            }}
          >
            <SummaryRow label={t('booking.summarySubtotal')} value={subtotal} />
            <SummaryRow label={t('booking.summaryVat')} value={vat} />
            <SummaryRow label={t('booking.summaryTotal')} value={total} strong />
          </View>

          {error !== undefined ? (
            <Text variant="bodySmall" tone="emergency">
              {error}
            </Text>
          ) : null}

          <Button
            testID="booking-confirm"
            label={t('booking.confirm')}
            onPress={() => book.mutate()}
            loading={book.isPending}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  /** Omitted for the descriptive rows — the service, the provider, the time. */
  readonly value: SarAmount | undefined;
  readonly strong?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text
        variant={strong ? 'bodyStrong' : 'bodySmall'}
        tone={strong ? 'default' : 'muted'}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
      {value !== undefined ? (
        <Text
          variant={strong ? 'bodyStrong' : 'bodySmall'}
          tone={strong ? 'accent' : 'muted'}
          numeric
        >
          {t('common.sar', { amount: formatSarDisplay(value) })}
        </Text>
      ) : null}
    </View>
  );
}
