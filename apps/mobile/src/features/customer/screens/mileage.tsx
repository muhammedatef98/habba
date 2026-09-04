/**
 * Mileage — record a reading, and see the progression.
 *
 * Mileage is what makes predictive maintenance possible at all (§7.2: the
 * estimator needs at least two readings to derive a daily rate), and it is the
 * number a buyer checks first. So it gets its own screen rather than being a
 * field buried in the service form.
 *
 * The progression is drawn from the timeline itself — every event that carried
 * a reading — rather than from a separate table. There is only one history in
 * this product, and it is the timeline.
 *
 * The chart is deliberately plain Views: a bar per reading, width proportional
 * to the distance covered since the previous one. It answers "is this car
 * driven a lot, and steadily?" which is the question, and it costs no
 * dependency and no layout that breaks in RTL.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Field, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { TimelineEvent } from '@/features/shared/data/types';
import { useIsAuthenticated } from '@/features/shared/state/session';

interface Reading {
  readonly at: Date;
  readonly mileage: number;
  /** Km covered since the previous reading; null for the first one. */
  readonly delta: number | null;
  /** Average km/day since the previous reading; null for the first one. */
  readonly perDay: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Oldest first, because a progression is read forwards. */
function readingsFrom(events: readonly TimelineEvent[]): readonly Reading[] {
  const points = events
    .filter((event) => event.mileage !== null)
    .map((event) => ({ at: new Date(event.occurredAt), mileage: event.mileage as number }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return points.map((point, index) => {
    const previous = index === 0 ? undefined : points[index - 1];
    if (previous === undefined) {
      return { at: point.at, mileage: point.mileage, delta: null, perDay: null };
    }

    const delta = point.mileage - previous.mileage;
    const days = Math.max((point.at.getTime() - previous.at.getTime()) / MS_PER_DAY, 1);

    return { at: point.at, mileage: point.mileage, delta, perDay: delta / days };
  });
}

export default function MileageScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-GB';

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => repository.getVehicle(id ?? ''),
    enabled: id !== undefined,
  });

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => repository.listTimeline(id ?? ''),
    enabled: id !== undefined,
  });

  const readings = useMemo(() => readingsFrom(timeline.data ?? []), [timeline.data]);

  const record = useMutation({
    mutationFn: () => repository.recordMileage(id ?? '', Number(value)),
    onSuccess: async () => {
      setValue('');
      setError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      await queryClient.invalidateQueries({ queryKey: ['vehicle', id] });
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (cause: Error) => {
      // The odometer only moves forward — enforced server-side (0034), so the
      // message here explains the rule rather than inventing it.
      setError(
        cause.message.includes('lower') || cause.message.includes('rollback')
          ? t('logbook.errors.mileageTooLow', { current: vehicle.data?.currentMileage ?? 0 })
          : t('errors.generic'),
      );
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const current = vehicle.data?.currentMileage ?? 0;
  const maxDelta = readings.reduce((max, reading) => Math.max(max, reading.delta ?? 0), 0);

  function handleRecord() {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t('logbook.errors.mileageRequired'));
      return;
    }
    if (parsed < current) {
      setError(t('logbook.errors.mileageTooLow', { current }));
      return;
    }
    record.mutate();
  }

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('logbook.mileageTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('logbook.mileageSubtitle')}
        </Text>
      </View>

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t('logbook.mileageCurrent')}
          </Text>
          <Text variant="display">{current.toLocaleString(locale)}</Text>
          <Text variant="caption" tone="subtle">
            {t('logbook.mileageUnit')}
          </Text>
        </View>
      </Card>

      <Field
        testID="mileage-input"
        label={t('logbook.mileageNewLabel')}
        hint={t('logbook.mileageNewHint')}
        value={value}
        onChangeText={(next) => {
          setValue(next.replace(/\D/g, ''));
          setError(undefined);
        }}
        error={error}
        keyboardType="number-pad"
        forceLtrInput
      />

      <Button
        testID="save-mileage"
        label={t('logbook.mileageSave')}
        onPress={handleRecord}
        loading={record.isPending}
        disabled={value.length === 0}
      />

      <Text variant="heading">{t('logbook.mileageHistory')}</Text>

      {readings.length === 0 ? (
        <EmptyState
          testID="mileage-empty"
          title={t('logbook.mileageEmptyTitle')}
          body={t('logbook.mileageEmptyBody')}
        />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {readings.map((reading, index) => (
            <View key={`${reading.at.toISOString()}-${index}`} style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: theme.spacing.sm,
                }}
              >
                <Text variant="body">{reading.mileage.toLocaleString(locale)}</Text>
                <Text variant="caption" tone="muted">
                  {reading.at.toLocaleDateString(locale)}
                </Text>
              </View>

              {/* The bar is the distance covered since the previous reading, so
                  a long gap with little driving reads as a short bar — which is
                  the honest picture. */}
              <View
                accessible
                accessibilityLabel={
                  reading.delta === null
                    ? t('logbook.mileageFirstReading')
                    : t('logbook.mileageSince', {
                        km: Math.round(reading.delta),
                        perDay: Math.round(reading.perDay ?? 0),
                      })
                }
                style={{
                  height: 8,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.surfaceSunken,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: 8,
                    width: `${maxDelta === 0 ? 0 : Math.round(((reading.delta ?? 0) / maxDelta) * 100)}%`,
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radius.full,
                  }}
                />
              </View>

              <Text variant="caption" tone="subtle">
                {reading.delta === null
                  ? t('logbook.mileageFirstReading')
                  : t('logbook.mileageSince', {
                      km: Math.round(reading.delta),
                      perDay: Math.round(reading.perDay ?? 0),
                    })}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
