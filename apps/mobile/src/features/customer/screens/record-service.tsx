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
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';

interface FieldErrors {
  summary?: string | undefined;
  when?: string | undefined;
  mileage?: string | undefined;
}

/** Accepts YYYY-MM-DD, the format the date field asks for. */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function RecordServiceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [summary, setSummary] = useState('');
  const [when, setWhen] = useState('');
  const [mileage, setMileage] = useState('');

  // Explicit `| undefined` rather than optional properties: under
  // exactOptionalPropertyTypes, clearing a field by assigning undefined is not
  // the same as omitting the key, and clearing is exactly what happens on
  // every keystroke.
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: async () => {
      const occurredAt = parseDate(when);
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

    const parsed = parseDate(when);
    if (parsed === null) {
      next.when = t('vehicle.errors.required');
    } else if (parsed.getTime() > Date.now()) {
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

      <Field
        testID="service-date"
        label={t('logbook.recordWhen')}
        value={when}
        onChangeText={(value) => {
          setWhen(value);
          setErrors((prev) => ({ ...prev, when: undefined }));
        }}
        placeholder="2025-05-14"
        error={errors.when}
        keyboardType="numbers-and-punctuation"
        forceLtrInput
      />

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
        disabled={summary.trim().length === 0 || when.length === 0}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
