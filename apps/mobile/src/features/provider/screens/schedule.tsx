/**
 * مواعيد الورشة — the calendar customers have been booking against since
 * Phase 4, published by nobody.
 *
 * `appointment_slots`, `generate_slots` and `book_appointment` have existed
 * since 0024, and `slot-concurrency-test.sh` has proved since then that
 * sixteen simultaneous customers cannot overbook a capacity-3 slot. What had
 * never existed was a way for a workshop to create that slot. The customer's
 * booking screen was reading a table no hand could fill — every real workshop
 * would have shown "no times available", forever, and the third fulfilment
 * mode (§1, differentiator 2) would have been a mode in name only.
 *
 * Three things this screen is careful about.
 *
 * **Blocking is not cancelling.** «إيقاف الحجز» closes a slot to NEW bookings
 * and leaves the appointment somebody already holds exactly where it is — the
 * copy says so in as many words, because a workshop closing early for a
 * funeral needs to know whether it still has a car coming at four. The server
 * agrees: 0036 refuses any write to `booked_count`, so blocking cannot take a
 * place away even by accident.
 *
 * **A booked slot cannot be deleted, and the refusal is shown.** `orders.
 * slot_id` is `on delete restrict` (0019). The row is hidden from a slot that
 * is spoken for, and if a customer books in the seconds between the list
 * loading and the tap landing, the failure is surfaced as "somebody booked
 * this" rather than swallowed into a generic error.
 *
 * **The count published is the count created.** 0072. Pressing «انشر» twice on
 * the same week adds nothing and says «كل هذه المواعيد منشورة مسبقاً», rather
 * than reporting a number of slots that do not exist.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Screen,
  Skeleton,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import {
  providerRepository,
  type ScheduleSlot,
} from '@/features/provider/data/provider-repository';
import {
  SLOT_FORM_DEFAULTS,
  validateSlotForm,
  type SlotFormError,
} from '@/features/provider/lib/schedule-form';
import { useSession } from '@/features/shared/state/session';
import { daysFromToday, groupSlotsByDay } from '@/features/shared/lib/slot-days';
import { formatCount } from '@/features/shared/lib/format-number';

/**
 * How far ahead the calendar is read.
 *
 * Three weeks, which is a little more than the longest publishing run the form
 * allows (14 days) — so a workshop that publishes the maximum can still see
 * the far end of what it just created rather than being told it created
 * something invisible.
 */
const HORIZON_DAYS = 21;

export default function ProviderScheduleScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const locale = useSession((state) => state.locale);

  // Midnight local, not `now`. A slot at 09:00 belongs to today all day, and
  // reading from `now` would make this morning's appointments vanish from the
  // workshop's own calendar at the moment it most wants to look at them.
  const fromIso = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }, []);

  const slots = useQuery({
    queryKey: ['my-slots', fromIso],
    queryFn: () => providerRepository.listMySlots(fromIso, HORIZON_DAYS),
  });

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [days, setDays] = useState<string>(SLOT_FORM_DEFAULTS.days);
  const [startHour, setStartHour] = useState<string>(SLOT_FORM_DEFAULTS.startHour);
  const [endHour, setEndHour] = useState<string>(SLOT_FORM_DEFAULTS.endHour);
  const [slotMinutes, setSlotMinutes] = useState<string>(SLOT_FORM_DEFAULTS.slotMinutes);
  const [capacity, setCapacity] = useState<string>(SLOT_FORM_DEFAULTS.capacity);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-slots'] });

  const publish = useMutation({
    mutationFn: async () => {
      const created = await providerRepository.generateSlots({
        // Today, not tomorrow: 0072 skips the hours that have already gone, so
        // "publish from today" means the rest of today and nothing wasted.
        fromIso,
        days: Number(days),
        startHour: Number(startHour),
        endHour: Number(endHour),
        slotMinutes: Number(slotMinutes),
        capacity: Number(capacity),
      });
      return created;
    },
    onSuccess: async (created: number) => {
      setError(null);
      // ⚠️ Zero is a sentence, not a failure. It means every one of those slots
      // was already published — which is what a workshop pressing the button a
      // second time has done, and it must not be told it created a week.
      setNotice(
        created === 0
          ? t('schedule.publishedNone')
          : t('schedule.publishedCount', { count: formatCount(created, i18n.language) }),
      );
      setPublishing(false);
      await refresh();
    },
    onError: () => {
      setNotice(null);
      setError(t('schedule.publishFailed'));
    },
  });

  const setBlocked = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      providerRepository.setSlotBlocked(id, blocked),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: () => setError(t('schedule.blockFailed')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => providerRepository.deleteSlot(id),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: async (cause: Error) => {
      // The one refusal worth naming. Everything else is "it did not save".
      setError(
        cause.message === 'slot_has_bookings'
          ? t('schedule.deleteBooked')
          : t('schedule.deleteFailed'),
      );
      // Whatever happened, the list on screen no longer matches the server.
      await refresh();
    },
  });

  const allSlots = slots.data ?? [];
  const publishedDays = groupSlotsByDay(allSlots);
  const activeKey = dayKey ?? publishedDays[0]?.key ?? null;
  // Falls back rather than showing nothing: deleting the last slot of the
  // selected day leaves `dayKey` pointing at a day that no longer exists, and
  // an empty list under a chip strip that no longer has that chip reads as a
  // bug rather than as a deletion that worked.
  const activeDay = publishedDays.find((day) => day.key === activeKey) ?? publishedDays[0];
  const busy = setBlocked.isPending || remove.isPending;

  const validation = validateSlotForm({ days, startHour, endHour, slotMinutes, capacity });
  const message = (key: SlotFormError | undefined) => (key === undefined ? undefined : t(key));

  const dayLabel = (date: Date) => {
    const offset = daysFromToday(date);
    if (offset === 0) return t('schedule.today');
    if (offset === 1) return t('schedule.tomorrow');
    return date.toLocaleDateString(tagFor(i18n.language), { weekday: 'short', day: 'numeric' });
  };

  const timeRange = (slot: ScheduleSlot) =>
    `${clock(slot.startsAt, i18n.language)} – ${clock(slot.endsAt, i18n.language)}`;

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('schedule.title')}</Text>
        <Text variant="bodySmall" tone="muted">
          {t('schedule.subtitle')}
        </Text>
      </View>

      {error !== null ? (
        <Card
          elevation="none"
          testID="schedule-error"
          style={{ backgroundColor: theme.colors.emergencySubtle }}
        >
          <Text variant="bodySmall" tone="emergency">
            {error}
          </Text>
        </Card>
      ) : null}

      {notice !== null ? (
        <Card
          elevation="none"
          testID="schedule-notice"
          style={{ backgroundColor: theme.colors.successSubtle }}
        >
          <Text variant="bodySmall" tone="success">
            {notice}
          </Text>
        </Card>
      ) : null}

      {/* Publishing. Collapsed by default: a workshop opens this screen far
          more often to look at tomorrow than to republish the month. */}
      <Card elevation="sm" style={{ gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Icon name="calendar" size={theme.iconSize.md} color={theme.colors.primary} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('schedule.publishTitle')}
          </Text>
        </View>

        {publishing ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {t('schedule.publishBody')}
            </Text>

            <Field
              testID="schedule-days"
              label={t('schedule.daysLabel')}
              value={days}
              onChangeText={setDays}
              keyboardType="number-pad"
              forceLtrInput
              error={message(validation.days)}
            />

            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                gap: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Field
                  testID="schedule-start-hour"
                  label={t('schedule.startHourLabel')}
                  value={startHour}
                  onChangeText={setStartHour}
                  keyboardType="number-pad"
                  forceLtrInput
                  error={message(validation.hours)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  testID="schedule-end-hour"
                  label={t('schedule.endHourLabel')}
                  value={endHour}
                  onChangeText={setEndHour}
                  keyboardType="number-pad"
                  forceLtrInput
                />
              </View>
            </View>

            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                gap: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Field
                  testID="schedule-slot-minutes"
                  label={t('schedule.slotMinutesLabel')}
                  value={slotMinutes}
                  onChangeText={setSlotMinutes}
                  keyboardType="number-pad"
                  forceLtrInput
                  error={message(validation.slotMinutes)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  testID="schedule-capacity"
                  label={t('schedule.capacityLabel')}
                  value={capacity}
                  onChangeText={setCapacity}
                  keyboardType="number-pad"
                  hint={t('schedule.capacityHint')}
                  forceLtrInput
                  error={message(validation.capacity)}
                />
              </View>
            </View>

            <Button
              testID="schedule-publish"
              label={t('schedule.publish')}
              loading={publish.isPending}
              disabled={!validation.ok}
              onPress={() => publish.mutate()}
            />
            <Button
              label={t('common.cancel')}
              variant="ghost"
              onPress={() => {
                setPublishing(false);
                setError(null);
              }}
            />
          </View>
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {t('schedule.publishHint')}
            </Text>
            <Button
              testID="schedule-open-publish"
              label={t('schedule.openPublish')}
              variant="secondary"
              onPress={() => {
                setNotice(null);
                setError(null);
                setPublishing(true);
              }}
            />
          </>
        )}
      </Card>

      {/* The calendar itself. */}
      {slots.isError ? (
        <ErrorState
          testID="schedule-load-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={slots.isFetching}
          onRetry={() => void slots.refetch()}
        />
      ) : slots.isPending ? (
        <View style={{ gap: theme.spacing.base }}>
          <Skeleton height={44} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : publishedDays.length === 0 ? (
        <EmptyState
          testID="schedule-empty"
          icon={<Icon name="calendar" size={theme.iconSize.xl} color={theme.colors.textSubtle} />}
          title={t('schedule.emptyTitle')}
          body={t('schedule.emptyBody')}
        />
      ) : (
        <View style={{ gap: theme.spacing.base }}>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              flexWrap: 'wrap',
              gap: theme.spacing.sm,
            }}
          >
            {publishedDays.map((day) => {
              const selected = day.key === activeKey;
              // Free places across the day, which is what a workshop scanning
              // the strip is actually looking for — not how many slots exist.
              const free = day.slots.reduce(
                (total, slot) =>
                  total + (slot.isBlocked ? 0 : Math.max(0, slot.capacity - slot.bookedCount)),
                0,
              );

              return (
                <Pressable
                  key={day.key}
                  testID={`schedule-day-${day.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setDayKey(day.key)}
                  style={{
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surface,
                    gap: 2,
                  }}
                >
                  <Text variant="bodySmall" tone={selected ? 'primary' : 'default'}>
                    {dayLabel(day.date)}
                  </Text>
                  <Text variant="caption" tone={free === 0 ? 'subtle' : 'muted'} numeric>
                    {free === 0
                      ? t('schedule.dayFull')
                      : t('schedule.dayFree', { count: formatCount(free, i18n.language) })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            {(activeDay?.slots ?? []).map((slot) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                range={timeRange(slot)}
                busy={busy}
                locale={locale}
                onToggleBlock={() => setBlocked.mutate({ id: slot.id, blocked: !slot.isBlocked })}
                onDelete={() => remove.mutate(slot.id)}
              />
            ))}
          </View>
        </View>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

interface SlotRowProps {
  readonly slot: ScheduleSlot;
  readonly range: string;
  readonly busy: boolean;
  readonly locale: string;
  readonly onToggleBlock: () => void;
  readonly onDelete: () => void;
}

function SlotRow({ slot, range, busy, locale, onToggleBlock, onDelete }: SlotRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const full = slot.bookedCount >= slot.capacity;
  const tone = slot.isBlocked ? 'neutral' : full ? 'active' : 'success';
  const status = slot.isBlocked
    ? t('schedule.blocked')
    : full
      ? t('schedule.full')
      : t('schedule.open');

  return (
    <Card
      testID={`schedule-slot-${slot.id}`}
      elevation="none"
      style={{
        backgroundColor: theme.colors.surfaceSunken,
        gap: theme.spacing.sm,
        // A blocked slot is dimmed by its border, not by opacity: the numbers
        // on it are still the numbers the workshop needs to read.
        borderStartWidth: 3,
        borderStartColor: slot.isBlocked ? theme.colors.border : theme.colors.primary,
      }}
    >
      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <Text variant="bodyStrong" numeric style={{ flex: 1 }}>
          {range}
        </Text>
        <StatusPill tone={tone} showDot={false} label={status} />
      </View>

      <Text variant="caption" tone="muted" numeric>
        {t('schedule.booked', {
          booked: formatCount(slot.bookedCount, locale),
          capacity: formatCount(slot.capacity, locale),
        })}
      </Text>

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            testID={`schedule-block-${slot.id}`}
            label={slot.isBlocked ? t('schedule.unblock') : t('schedule.block')}
            variant="secondary"
            size="medium"
            disabled={busy}
            accessibilityHint={slot.isBlocked ? t('schedule.unblockHint') : t('schedule.blockHint')}
            onPress={onToggleBlock}
          />
        </View>
        {/* ⚠️ Offered only for a slot nobody holds. The server refuses the rest
            (`on delete restrict`, 0019) and the screen surfaces that refusal,
            but a button that is there to fail is a button that teaches the
            workshop to distrust the screen. */}
        {slot.bookedCount === 0 ? (
          <View style={{ flex: 1 }}>
            <Button
              testID={`schedule-delete-${slot.id}`}
              label={t('schedule.delete')}
              variant="ghost"
              size="medium"
              disabled={busy}
              onPress={onDelete}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function tagFor(language: string): string {
  return language.startsWith('ar') ? 'ar-u-nu-latn' : language;
}

function clock(iso: string, language: string): string {
  return new Date(iso).toLocaleTimeString(tagFor(language), {
    hour: '2-digit',
    minute: '2-digit',
  });
}
