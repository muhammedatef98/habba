/**
 * مواعيدي — when customers can book this technician (0104).
 *
 * A customer booking a visit picks a technician and then a time, and the
 * times come only from here. Before this screen nothing in the app published
 * any, so every technician showed an empty list.
 *
 * Two parts. Publishing: the days (tomorrow's week, Fridays off, by
 * default), one daily window and an appointment length — the shape most
 * technicians' weeks actually have. Then the coming times by day, where a
 * tap closes a time or opens it again. A booked time is shown as booked and
 * left alone: closing it would not cancel the customer, and implying it would
 * is worse than not offering it.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toLatinDigits } from '@habba/core';
import { Button, Card, Icon, Row, Screen, Skeleton, Text, useTheme } from '@habba/ui';
import { providerRepository, type MySlot } from '@/features/provider/data/provider-repository';
import {
  SLOT_LENGTHS,
  clampWindow,
  defaultDayKeys,
  groupByRiyadhDay,
  minuteLabel,
  slotsPerDay,
  upcomingDays,
  type SlotLength,
} from '@/features/provider/lib/availability';
import { SectionTitle } from '@/features/provider/components/ProParts';
import { BackBar } from '@/features/shared/components/BackBar';
import { useToast } from '@/features/shared/state/toast';

const PLAN_DAYS = 14;
const STEP = 30;

function tagFor(locale: string): string {
  return locale.startsWith('ar') ? 'ar-u-ca-gregory-nu-latn' : locale;
}

export default function AvailabilityScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const locale = i18n.language;

  const days = useMemo(() => upcomingDays(PLAN_DAYS), []);
  const [chosen, setChosen] = useState<readonly string[]>(() => defaultDayKeys(days));
  const [length, setLength] = useState<SlotLength>(60);
  const [hours, setHours] = useState({ startMinute: 9 * 60, endMinute: 17 * 60 });

  const slots = useQuery({
    queryKey: ['my-slots'],
    queryFn: () => providerRepository.listMySlots(PLAN_DAYS + 7),
  });

  const publish = useMutation({
    mutationFn: () =>
      providerRepository.publishAvailability({
        dates: days.filter((day) => chosen.includes(day.key)).map((day) => day.key),
        startMinute: hours.startMinute,
        endMinute: hours.endMinute,
        slotMinutes: length,
      }),
    meta: { inlineError: true },
    onSuccess: async (added) => {
      showToast(
        added > 0 ? t('availability.published', { count: added }) : t('availability.nothingNew'),
        'success',
      );
      await queryClient.invalidateQueries({ queryKey: ['my-slots'] });
    },
    onError: () => showToast(t('availability.publishFailed')),
  });

  const toggle = useMutation({
    mutationFn: (slot: MySlot) => providerRepository.setSlotBlocked(slot.id, !slot.blocked),
    meta: { inlineError: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-slots'] }),
    onError: () => showToast(t('availability.toggleFailed')),
  });

  const perDay = slotsPerDay(hours.startMinute, hours.endMinute, length);
  const planned = perDay * chosen.length;
  const groups = groupByRiyadhDay(slots.data ?? []);

  const dayChip = (date: Date, options: Intl.DateTimeFormatOptions) =>
    toLatinDigits(date.toLocaleDateString(tagFor(locale), { ...options, timeZone: 'Asia/Riyadh' }));
  const timeOf = (iso: string) =>
    toLatinDigits(
      new Date(iso).toLocaleTimeString(tagFor(locale), {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Riyadh',
      }),
    );

  const moveEdge = (edge: 'start' | 'end', delta: number) =>
    setHours((current) =>
      clampWindow(
        edge === 'start' ? current.startMinute + delta : current.startMinute,
        edge === 'end' ? current.endMinute + delta : current.endMinute,
        length,
      ),
    );

  const stepper = (edge: 'start' | 'end') => {
    const value = edge === 'start' ? hours.startMinute : hours.endMinute;
    return (
      <Row gap="sm" align="center">
        <Text variant="label" tone="muted" style={{ flex: 1 }}>
          {t(edge === 'start' ? 'availability.from' : 'availability.to')}
        </Text>
        <StepButton
          testID={`availability-${edge}-minus`}
          icon="minus"
          label={t('availability.earlier')}
          onPress={() => moveEdge(edge, -STEP)}
        />
        <Text
          variant="bodyStrong"
          numeric
          numberOfLines={1}
          style={{ minWidth: 96, textAlign: 'center' }}
        >
          {toLatinDigits(minuteLabel(value, locale))}
        </Text>
        <StepButton
          testID={`availability-${edge}-plus`}
          icon="plus"
          label={t('availability.later')}
          onPress={() => moveEdge(edge, STEP)}
        />
      </Row>
    );
  };

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }} testID="availability-screen">
      <BackBar label={t('availability.title')} />

      <Text variant="body" tone="muted">
        {t('availability.intro')}
      </Text>

      <Card style={{ gap: theme.spacing.base }}>
        <SectionTitle title={t('availability.publishTitle')} />

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('availability.days')}
          </Text>
          <Row gap="xs" wrap>
            {days.map((day) => {
              const on = chosen.includes(day.key);
              return (
                <Pressable
                  key={day.key}
                  testID={`availability-day-${day.key}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() =>
                    setChosen((current) =>
                      on ? current.filter((key) => key !== day.key) : [...current, day.key],
                    )
                  }
                  style={({ pressed }) => ({
                    width: 56,
                    paddingVertical: theme.spacing.sm,
                    alignItems: 'center',
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: on ? theme.colors.primary : theme.colors.border,
                    backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text variant="caption" tone={on ? 'inverse' : 'muted'}>
                    {dayChip(day.date, { weekday: 'short' })}
                  </Text>
                  <Text variant="bodyStrong" tone={on ? 'inverse' : 'default'} numeric>
                    {dayChip(day.date, { day: 'numeric' })}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          {stepper('start')}
          {stepper('end')}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('availability.length')}
          </Text>
          <Row gap="xs" wrap>
            {SLOT_LENGTHS.map((minutes) => {
              const on = minutes === length;
              return (
                <Pressable
                  key={minutes}
                  testID={`availability-length-${minutes}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setLength(minutes);
                    setHours((current) =>
                      clampWindow(current.startMinute, current.endMinute, minutes),
                    );
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    borderRadius: theme.radius.full,
                    borderWidth: 1,
                    borderColor: on ? theme.colors.primary : theme.colors.border,
                    backgroundColor: on ? theme.colors.primarySubtle : theme.colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text variant="caption" tone={on ? 'primary' : 'default'}>
                    {t('availability.minutes', { count: minutes })}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </View>

        <Text variant="caption" tone="muted" testID="availability-summary">
          {chosen.length === 0
            ? t('availability.pickDays')
            : t('availability.summary', { count: planned, days: chosen.length })}
        </Text>

        <Button
          testID="availability-publish"
          label={t('availability.publish')}
          loading={publish.isPending}
          disabled={planned === 0}
          onPress={() => publish.mutate()}
        />
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        <SectionTitle title={t('availability.comingTitle')} />

        {slots.isPending ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Skeleton height={20} width="40%" />
            <Skeleton height={44} />
          </View>
        ) : slots.isError ? (
          <Text variant="body" tone="muted">
            {t('availability.loadFailed')}
          </Text>
        ) : groups.length === 0 ? (
          <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
            <Text variant="body" tone="muted" testID="availability-empty">
              {t('availability.empty')}
            </Text>
          </Card>
        ) : (
          <>
            <Text variant="caption" tone="subtle">
              {t('availability.tapHint')}
            </Text>
            {groups.map((group) => (
              <View key={group.key} style={{ gap: theme.spacing.sm }}>
                <Text variant="bodyStrong">
                  {dayChip(new Date(group.items[0]?.startsAt ?? Date.now()), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
                <Row gap="xs" wrap>
                  {group.items.map((slot) => (
                    <Pressable
                      key={slot.id}
                      testID={`availability-slot-${slot.id}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: slot.booked, selected: !slot.blocked }}
                      disabled={slot.booked || toggle.isPending}
                      onPress={() => toggle.mutate(slot)}
                      style={({ pressed }) => ({
                        minWidth: 76,
                        alignItems: 'center',
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: theme.spacing.xs,
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: slot.booked
                          ? theme.colors.success
                          : slot.blocked
                            ? theme.colors.border
                            : theme.colors.primary,
                        backgroundColor: slot.booked
                          ? theme.colors.successSubtle
                          : slot.blocked
                            ? theme.colors.surfaceSunken
                            : theme.colors.surface,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text
                        variant="bodyStrong"
                        numeric
                        tone={slot.blocked ? 'subtle' : 'default'}
                        style={slot.blocked ? { textDecorationLine: 'line-through' } : undefined}
                      >
                        {timeOf(slot.startsAt)}
                      </Text>
                      <Text
                        variant="caption"
                        tone={slot.booked ? 'success' : slot.blocked ? 'subtle' : 'primary'}
                        style={{ fontSize: theme.fontSize.xs }}
                      >
                        {slot.booked
                          ? t('availability.booked')
                          : slot.blocked
                            ? t('availability.closed')
                            : t('availability.open')}
                      </Text>
                    </Pressable>
                  ))}
                </Row>
              </View>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

function StepButton({
  icon,
  label,
  onPress,
  testID,
}: {
  readonly icon: 'plus' | 'minus';
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceSunken,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={theme.iconSize.sm} color={theme.colors.text} />
    </Pressable>
  );
}
