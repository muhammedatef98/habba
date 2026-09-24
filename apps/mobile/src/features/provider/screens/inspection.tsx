/**
 * Filing an inspection.
 *
 * The template the job's service names (0073), item by item: سليم، يحتاج
 * انتباه، خلل، أو لا ينطبق, with a note where something is wrong — a buyer
 * reads "what is wrong with this car" before any score. For a pre-purchase
 * inspection the car is not in Habba yet, so the form also asks which car
 * it is: the report has to name the car it is about (0026).
 *
 * The score is the server's. This screen never computes one: a technician
 * seeing a number while rating would be tempted to steer it, and the buyer's
 * trust is in the fact that nobody at the car could.
 *
 * Submit is enabled exactly when the server will accept the report — every
 * required item rated — using the same rule (`inspectionProgress`).
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { inspectionProgress, type InspectionResultEntry, type ItemRating } from '@habba/core';
import { Button, Card, Field, Row, Screen, Text, useTheme } from '@habba/ui';
import {
  providerRepository,
  type FiledInspection,
} from '@/features/provider/data/provider-repository';

const RATINGS: readonly ItemRating[] = ['pass', 'attention', 'fail', 'na'];

type Results = Record<string, Record<string, InspectionResultEntry>>;

export default function InspectionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => providerRepository.getJob(id ?? ''),
    enabled: id !== undefined,
  });
  const templateKey = job.data?.inspectionTemplateKey ?? null;
  const template = useQuery({
    queryKey: ['inspection-template', templateKey],
    queryFn: () => providerRepository.getInspectionTemplate(templateKey ?? ''),
    enabled: templateKey !== null,
  });

  const [results, setResults] = useState<Results>({});
  const [vin, setVin] = useState('');
  const [plate, setPlate] = useState('');
  const [makeAr, setMakeAr] = useState('');
  const [modelAr, setModelAr] = useState('');
  const [year, setYear] = useState('');
  const [mileage, setMileage] = useState('');
  const [filed, setFiled] = useState<FiledInspection | null>(null);

  const sections = template.data?.sections ?? [];
  const progress = useMemo(() => inspectionProgress(sections, results), [sections, results]);

  const hasVehicle = job.data?.hasVehicle ?? false;
  const identified = hasVehicle || vin.trim() !== '' || plate.trim() !== '';
  const vinValid = vin.trim() === '' || /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
  const ready = progress.missingRequired.length === 0 && identified && vinValid;

  const submit = useMutation({
    mutationFn: () =>
      providerRepository.submitInspection(id ?? '', templateKey ?? '', results, {
        vin: vin.trim() === '' ? null : vin.trim().toUpperCase(),
        plate: plate.trim() === '' ? null : plate.trim(),
        makeAr: makeAr.trim() === '' ? null : makeAr.trim(),
        modelAr: modelAr.trim() === '' ? null : modelAr.trim(),
        year: /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : null,
        mileage: /^\d+$/.test(mileage.trim()) ? Number(mileage.trim()) : null,
      }),
    onSuccess: async (outcome) => {
      setFiled(outcome);
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
    },
  });

  const rate = (section: string, item: string, rating: ItemRating) =>
    setResults((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [item]: { ...current[section]?.[item], rating },
      },
    }));

  const note = (section: string, item: string, text: string) =>
    setResults((current) => {
      const entry = current[section]?.[item];
      if (entry === undefined) return current;
      return {
        ...current,
        [section]: { ...current[section], [item]: { ...entry, note: text } },
      };
    });

  if (job.data === null || job.data === undefined || template.data === null) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {job.isLoading || template.isLoading ? t('common.loading') : t('errors.notFound')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (filed !== null || job.data.inspectionFiled) {
    return (
      <Screen>
        <Card testID="inspection-filed" elevation="sm" style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('inspection.filedTitle')}</Text>
          {filed !== null && filed.score !== null ? (
            <Text variant="title" numeric>
              {t('inspection.score', { score: filed.score })}
            </Text>
          ) : null}
          {filed !== null && filed.recommendation !== null ? (
            <Text variant="bodyStrong">
              {t(`inspection.recommendation.${filed.recommendation}`)}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted">
            {t('inspection.filedBody')}
          </Text>
        </Card>
        <Button label={t('inspection.backToJob')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{template.data?.nameAr ?? t('inspection.title')}</Text>
        <Text testID="inspection-progress" variant="caption" tone="muted" numeric>
          {t('inspection.progress', { answered: progress.answered, total: progress.total })}
          {progress.missingRequired.length > 0
            ? ` · ${t('inspection.requiredLeft', { count: progress.missingRequired.length })}`
            : ''}
        </Text>
      </View>

      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong">{t('inspection.subjectTitle')}</Text>
        {!hasVehicle ? (
          <>
            <Text variant="caption" tone="muted">
              {t('inspection.identifyCar')}
            </Text>
            <Field
              testID="inspection-vin"
              label={t('inspection.vin')}
              value={vin}
              onChangeText={setVin}
              autoCapitalize="characters"
              forceLtrInput
              error={vinValid ? undefined : t('inspection.vinInvalid')}
            />
            <Field
              testID="inspection-plate"
              label={t('inspection.plate')}
              value={plate}
              onChangeText={setPlate}
            />
            <Row gap="sm" align="flex-start">
              <View style={{ flex: 1 }}>
                <Field label={t('inspection.make')} value={makeAr} onChangeText={setMakeAr} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('inspection.model')} value={modelAr} onChangeText={setModelAr} />
              </View>
            </Row>
            <Field
              label={t('inspection.year')}
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              forceLtrInput
            />
          </>
        ) : null}
        <Field
          testID="inspection-mileage"
          label={t('inspection.mileage')}
          value={mileage}
          onChangeText={setMileage}
          keyboardType="number-pad"
          forceLtrInput
        />
      </Card>

      {sections.map((section) => (
        <Card key={section.key} style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{section.title_ar}</Text>
          {section.items.map((item) => {
            const entry = results[section.key]?.[item.key];
            const needsNote = entry?.rating === 'attention' || entry?.rating === 'fail';
            return (
              <View key={item.key} style={{ gap: theme.spacing.xs }}>
                <Text variant="bodySmall" style={{ fontWeight: theme.fontWeight.semibold }}>
                  {item.label_ar}
                  {item.required === true ? ' *' : ''}
                </Text>
                <Row gap="xs" wrap>
                  {RATINGS.map((rating) => {
                    const selected = entry?.rating === rating;
                    const tint =
                      rating === 'pass'
                        ? theme.colors.successSubtle
                        : rating === 'attention'
                          ? theme.colors.warningSubtle
                          : rating === 'fail'
                            ? theme.colors.emergencySubtle
                            : theme.colors.surfaceSunken;
                    return (
                      <Card
                        key={rating}
                        testID={`rate-${section.key}-${item.key}-${rating}`}
                        elevation="none"
                        onPress={() => rate(section.key, item.key, rating)}
                        accessibilityLabel={`${item.label_ar}: ${t(`inspection.rating.${rating}`)}`}
                        style={{
                          minHeight: theme.minTouchTarget,
                          justifyContent: 'center',
                          paddingVertical: theme.spacing.xs,
                          paddingHorizontal: theme.spacing.md,
                          backgroundColor: selected ? tint : theme.colors.surface,
                          borderColor: selected ? theme.colors.primary : theme.colors.border,
                          borderWidth: selected ? 1.5 : 1,
                        }}
                      >
                        <Text variant="caption" tone={selected ? 'default' : 'muted'}>
                          {t(`inspection.rating.${rating}`)}
                        </Text>
                      </Card>
                    );
                  })}
                </Row>
                {needsNote ? (
                  <Field
                    label={t('inspection.note')}
                    value={entry?.note ?? ''}
                    onChangeText={(text) => note(section.key, item.key, text)}
                    placeholder={t('inspection.notePlaceholder')}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      ))}

      {submit.isError ? (
        <Text variant="caption" tone="emergency">
          {t('inspection.submitFailed')}
        </Text>
      ) : null}
      {!identified ? (
        <Text variant="caption" tone="warning">
          {t('inspection.identifyCar')}
        </Text>
      ) : null}

      <Button
        testID="submit-inspection"
        label={t('inspection.submit')}
        onPress={() => submit.mutate()}
        loading={submit.isPending}
        disabled={!ready}
      />
      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
