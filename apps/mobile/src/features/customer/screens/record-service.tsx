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
 *
 * The one thing the owner can do about that is attach evidence: a photo of the
 * invoice or the work turns `self_reported` into `self_documented`. The server
 * derives that, never the client, so the notice below changes as attachments
 * are added rather than promising anything.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { sar } from '@habba/core';
import { BottomSheet, Button, Card, Field, ListRow, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { PastServicePart, TimelineAttachment } from '@/features/shared/data/types';
import { useIsAuthenticated } from '@/features/shared/state/session';

interface FieldErrors {
  summary?: string | undefined;
  when?: string | undefined;
  mileage?: string | undefined;
  cost?: string | undefined;
}

/**
 * The service types worth naming. `other` exists so the list never blocks an
 * entry — an owner with an unusual repair must still be able to record it.
 */
const SERVICE_TYPES = [
  'oil_change',
  'brakes',
  'battery',
  'tyres',
  'air_filter',
  'ac_service',
  'bodywork',
  'other',
] as const;

type ServiceType = (typeof SERVICE_TYPES)[number];

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

  const [serviceType, setServiceType] = useState<ServiceType>('oil_change');
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [when, setWhen] = useState('');
  const [mileage, setMileage] = useState('');
  const [cost, setCost] = useState('');
  const [partName, setPartName] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [parts, setParts] = useState<readonly PastServicePart[]>([]);
  const [attachments, setAttachments] = useState<readonly TimelineAttachment[]>([]);

  // Explicit `| undefined` rather than optional properties: under
  // exactOptionalPropertyTypes, clearing a field by assigning undefined is not
  // the same as omitting the key, and clearing is exactly what happens on
  // every keystroke.
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: async () => {
      const occurredAt = parseDate(when);
      if (occurredAt === null) throw new Error('bad_date');

      // Money never touches float (§2.5). An unparseable amount is dropped
      // rather than coerced — a wrong number on a resale report is worse than
      // a missing one.
      const parsedCost = cost.length > 0 ? sar(cost) : null;

      await repository.recordPastService({
        vehicleId: id ?? '',
        summaryAr: summary.trim(),
        occurredAt,
        mileage: mileage.length > 0 ? Number(mileage) : undefined,
        details: {
          service_type: serviceType,
          ...(parsedCost !== null && parsedCost.ok ? { cost_sar: parsedCost.amount } : {}),
          ...(parts.length > 0 ? { parts } : {}),
        },
        attachments,
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

  /**
   * Stands in for the camera, mirroring the provider evidence screen. The
   * native build replaces this with expo-image-picker plus an upload to
   * Supabase Storage; keeping the capture behind one function is what makes
   * that a single-file change.
   */
  function attachPhoto() {
    setAttachments((previous) => [
      ...previous,
      { url: `habba://captured/service/${Date.now()}`, kind: 'service_photo' },
    ]);
  }

  function addPart() {
    const name = partName.trim();
    if (name.length === 0) return;

    setParts((previous) => [
      ...previous,
      partNumber.trim().length > 0
        ? { nameAr: name, partNumber: partNumber.trim() }
        : { nameAr: name },
    ]);
    setPartName('');
    setPartNumber('');
  }

  function handleSave() {
    const next: FieldErrors = {};

    if (summary.trim().length === 0) next.summary = t('logbook.errors.descriptionRequired');

    const parsed = parseDate(when);
    if (parsed === null) {
      next.when = t('vehicle.errors.required');
    } else if (parsed.getTime() > Date.now()) {
      next.when = t('logbook.errors.futureDate');
    }

    if (cost.length > 0 && !sar(cost).ok) next.cost = t('logbook.errors.cost');

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    save.mutate();
  }

  const documented = attachments.length > 0;

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('logbook.recordTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('logbook.recordSubtitle')}
        </Text>
      </View>

      {/* Said before they type, not after they submit — and it changes the
          moment evidence is attached, because the server's answer changes. */}
      <Card
        elevation="none"
        style={{
          backgroundColor: documented
            ? theme.colors.selfDocumentedSubtle
            : theme.colors.selfReportedSubtle,
        }}
      >
        <Text
          variant="caption"
          style={{ color: documented ? theme.colors.selfDocumented : theme.colors.selfReported }}
        >
          {documented ? t('logbook.recordDocumentedNotice') : t('logbook.recordNotVerifiedNotice')}
        </Text>
      </Card>

      <ListRow
        testID="service-type"
        title={t('logbook.recordType')}
        value={t(`logbook.serviceTypes.${serviceType}`)}
        onPress={() => setTypeSheetOpen(true)}
      />

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

      <Field
        testID="service-cost"
        label={`${t('logbook.recordCost')} — ${t('common.optional')}`}
        hint={t('logbook.recordCostHint')}
        value={cost}
        onChangeText={(value) => {
          setCost(value.replace(/[^\d.]/g, ''));
          setErrors((prev) => ({ ...prev, cost: undefined }));
        }}
        error={errors.cost}
        keyboardType="decimal-pad"
        forceLtrInput
      />

      {/* Parts, with their numbers. §1 differentiator 6: a part number is what
          turns "changed the filter" into something a buyer can check. */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {`${t('logbook.recordParts')} — ${t('common.optional')}`}
        </Text>

        {parts.map((part, index) => (
          <ListRow
            key={`${part.nameAr}-${index}`}
            testID={`part-${index}`}
            title={part.nameAr}
            subtitle={part.partNumber}
            value={t('common.cancel')}
            onPress={() => setParts((previous) => previous.filter((_, at) => at !== index))}
          />
        ))}

        <Field
          testID="part-name"
          label={t('logbook.recordPartName')}
          value={partName}
          onChangeText={setPartName}
        />
        <Field
          testID="part-number"
          label={`${t('logbook.recordPartNumber')} — ${t('common.optional')}`}
          value={partNumber}
          onChangeText={setPartNumber}
          forceLtrInput
          autoCapitalize="characters"
        />
        <Button
          testID="add-part"
          label={t('logbook.recordAddPart')}
          variant="secondary"
          size="medium"
          onPress={addPart}
          disabled={partName.trim().length === 0}
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {`${t('logbook.recordPhotos')} — ${t('common.optional')}`}
        </Text>
        {attachments.map((attachment, index) => (
          <ListRow
            key={attachment.url}
            testID={`attachment-${index}`}
            title={t('logbook.recordPhotoCaptured', { index: index + 1 })}
            value={t('common.cancel')}
            onPress={() => setAttachments((previous) => previous.filter((_, at) => at !== index))}
          />
        ))}
        <Button
          testID="add-photo"
          label={t('logbook.recordAddPhoto')}
          variant="secondary"
          size="medium"
          onPress={attachPhoto}
        />
      </View>

      <Button
        testID="save-service"
        label={t('common.save')}
        onPress={handleSave}
        loading={save.isPending}
        disabled={summary.trim().length === 0 || when.length === 0}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />

      <BottomSheet
        testID="service-type-sheet"
        visible={typeSheetOpen}
        onClose={() => setTypeSheetOpen(false)}
        title={t('logbook.recordType')}
        closeLabel={t('common.cancel')}
      >
        <View style={{ gap: theme.spacing.xs }}>
          {SERVICE_TYPES.map((type) => (
            <ListRow
              key={type}
              testID={`service-type-${type}`}
              title={t(`logbook.serviceTypes.${type}`)}
              selected={serviceType === type}
              onPress={() => {
                setServiceType(type);
                setTypeSheetOpen(false);
              }}
            />
          ))}
        </View>
      </BottomSheet>
    </Screen>
  );
}
