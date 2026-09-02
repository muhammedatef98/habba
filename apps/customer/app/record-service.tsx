/**
 * Record a past service — Phase 2's core interaction.
 *
 * The screen exists so an owner can fill in history that predates Habba, and
 * get value from the logbook before ever placing an order (build prompt §11:
 * the logbook is top-of-funnel and is never gated).
 *
 * The notice about provenance is deliberate and permanent. An owner who
 * believes they are creating "verified" records will feel cheated when the
 * report says otherwise in front of a buyer — telling them here, before they
 * type, is the only honest moment to do it (ADR-0005).
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Screen, Text, useTheme } from '@habba/ui';
import { ChipRow } from '@/components/form/ChipRow';
import { repository } from '@/data/repository';
import { daysInMonth, serviceYears, toServiceDate } from '@/lib/calendar';
import { useIsAuthenticated } from '@/state/session';

interface FieldErrors {
  summary?: string | undefined;
  when?: string | undefined;
  mileage?: string | undefined;
}

/**
 * Month names for the picker, in the UI locale.
 *
 * Built from `Intl` rather than a hardcoded list so Arabic gets its own month
 * names rather than transliterated English ones, and so the list cannot drift
 * from the locale the rest of the screen is in.
 */
function monthNames(locale: string): readonly string[] {
  const tag = locale.startsWith('ar') ? 'ar-u-nu-latn' : locale;
  return Array.from({ length: 12 }, (_, index) =>
    new Date(2026, index, 1).toLocaleDateString(tag, { month: 'long' }),
  );
}

export default function RecordServiceScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();

  const years = serviceYears();
  const months = monthNames(i18n.language);

  const [summary, setSummary] = useState('');
  const [mileage, setMileage] = useState('');

  // Three chip rows rather than a free-text `YYYY-MM-DD` field. Asking someone
  // to type a date in an exact format, on a numeric keypad, in an RTL layout,
  // to record something they did last spring, is the most avoidable failure on
  // this screen — and the format was only enforced after they hit save.
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);

  // Explicit `| undefined` rather than optional properties: under
  // exactOptionalPropertyTypes, clearing a field by assigning undefined is not
  // the same as omitting the key, and clearing is exactly what happens on
  // every keystroke.
  const [errors, setErrors] = useState<FieldErrors>({});

  const occurredAt =
    year === null || month === null || day === null ? null : toServiceDate(year, month, day);

  const save = useMutation({
    mutationFn: async () => {
      if (occurredAt === null) throw new Error('bad_date');

      await repository.recordPastService({
        vehicleId: id ?? '',
        summaryAr: summary.trim(),
        occurredAt,
        mileage: mileage.length > 0 ? Number(mileage) : undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      router.back();
    },
    onError: (error: Error) => {
      // CLAUDE.md §12: plain Arabic, with a next action — never a raw
      // Postgres message.
      if (error.message.includes('future')) {
        setErrors({ when: t('logbook.errors.futureDate') });
      } else if (error.message.includes('lower than the recorded')) {
        setErrors({ mileage: t('logbook.errors.mileageTooLow', { current: '' }) });
      } else {
        setErrors({ summary: t('errors.generic') });
      }
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  function handleSave() {
    const next: FieldErrors = {};

    if (summary.trim().length === 0) next.summary = t('logbook.errors.descriptionRequired');

    if (occurredAt === null) {
      next.when = t('vehicle.errors.required');
    } else if (occurredAt.getTime() > Date.now()) {
      next.when = t('logbook.errors.futureDate');
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    save.mutate();
  }

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('logbook.recordTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('logbook.recordSubtitle')}
        </Text>
      </View>

      {/* Said before they type, not after they submit. */}
      <Card elevation="none" style={{ backgroundColor: theme.colors.selfReportedSubtle }}>
        <Text variant="caption" style={{ color: theme.colors.selfReported }}>
          {t('logbook.recordNotVerifiedNotice')}
        </Text>
      </Card>

      <Field
        testID="service-summary"
        label={t('logbook.recordWhat')}
        value={summary}
        onChangeText={(value) => {
          setSummary(value);
          setErrors((prev) => ({ ...prev, summary: undefined }));
        }}
        placeholder={t('logbook.recordWhatPlaceholder')}
        error={errors.summary}
        multiline
      />

      <View style={{ gap: theme.spacing.md }}>
        <Text variant="label" tone="muted">
          {t('logbook.recordWhen')}
        </Text>

        <ChipRow
          testIdPrefix="service-year"
          label={t('logbook.recordYear')}
          options={years.map((value) => ({ key: String(value), label: String(value) }))}
          selected={year === null ? null : String(year)}
          onSelect={(key) => {
            setYear(Number(key));
            setErrors((prev) => ({ ...prev, when: undefined }));
          }}
        />

        {year !== null ? (
          <ChipRow
            testIdPrefix="service-month"
            label={t('logbook.recordMonth')}
            options={months.map((name, index) => ({ key: String(index + 1), label: name }))}
            selected={month === null ? null : String(month)}
            onSelect={(key) => {
              const next = Number(key);
              setMonth(next);
              // A day that does not exist in the newly chosen month has to go,
              // or 31 March silently becomes an invalid 31 April.
              setDay((current) =>
                current !== null && current > daysInMonth(year, next) ? null : current,
              );
              setErrors((prev) => ({ ...prev, when: undefined }));
            }}
          />
        ) : null}

        {year !== null && month !== null ? (
          <ChipRow
            testIdPrefix="service-day"
            label={t('logbook.recordDay')}
            options={Array.from({ length: daysInMonth(year, month) }, (_, index) => ({
              key: String(index + 1),
              label: String(index + 1),
            }))}
            selected={day === null ? null : String(day)}
            onSelect={(key) => {
              setDay(Number(key));
              setErrors((prev) => ({ ...prev, when: undefined }));
            }}
          />
        ) : null}

        {errors.when !== undefined ? (
          <Text variant="caption" tone="emergency">
            {errors.when}
          </Text>
        ) : null}
      </View>

      <Field
        testID="service-mileage"
        label={`${t('logbook.recordMileage')} — ${t('common.optional')}`}
        value={mileage}
        onChangeText={(value) => {
          setMileage(value.replace(/\D/g, ''));
          setErrors((prev) => ({ ...prev, mileage: undefined }));
        }}
        error={errors.mileage}
        keyboardType="number-pad"
        forceLtrInput
      />

      <Button
        testID="save-service"
        label={t('common.save')}
        onPress={handleSave}
        loading={save.isPending}
        disabled={summary.trim().length === 0 || occurredAt === null}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
