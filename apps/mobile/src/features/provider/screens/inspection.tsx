/**
 * The inspector's form — the deliverable of a فحص.
 *
 * Every other job hands back photos and an odometer reading. This one hands
 * back a document somebody is about to make a five-figure decision on, so the
 * screen is built around three things the inspector needs while they are
 * standing at the car with the seller watching:
 *
 *   * **Where they are.** Eleven collapsed sections, each carrying its own
 *     count of required answers, so what is left can be read without opening
 *     anything.
 *   * **What it is scoring.** The provisional number updates as they answer,
 *     from the same mirror the server scores with (`@habba/core`). It is
 *     labelled provisional and it is never sent — `submit_inspection_report`
 *     computes the real one from the template's own weights.
 *   * **What would be refused.** Missing required items are named, in
 *     Arabic, before the button is reachable. The server's refusal is
 *     correct and unhelpful at this point: the car has been handed back.
 *
 * There is no draft persistence yet. That is a real gap on a form this long
 * and it is written down in the roadmap rather than papered over with a
 * half-working autosave.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  inspectionProgress,
  missingRequiredItems,
  normaliseVin,
  recommendationFor,
  scoreInspection,
  vinProblem,
  type InspectionResults,
  type InspectionTemplateSection,
  type ItemRating,
} from '@habba/core';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Screen,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { InspectionSection } from '@/features/provider/components/inspection/InspectionSection';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { FindingBadge } from '@/features/shared/components/FindingBadge';
import { RECOMMENDATION_LABEL_KEY, scoreTone } from '@/features/shared/lib/inspection-rating';
import type { InspectionSubject } from '@/features/shared/data/types';

/** How many missing items are named before the list is summarised. */
const NAMED_GAPS = 4;

export default function InspectionCaptureScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language.startsWith('ar');

  const form = useQuery({
    queryKey: ['inspection-form', id],
    queryFn: () => providerRepository.getInspectionForm(id ?? ''),
    enabled: id !== undefined,
  });

  const [results, setResults] = useState<InspectionResults>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subject, setSubject] = useState<InspectionSubject>({});
  const [vinText, setVinText] = useState('');
  const [attempted, setAttempted] = useState(false);

  const sections = useMemo(() => form.data?.sections ?? [], [form.data]);

  const progress = useMemo(() => inspectionProgress(sections, results), [sections, results]);
  const missing = useMemo(() => missingRequiredItems(sections, results), [sections, results]);
  const score = useMemo(() => scoreInspection(sections, results), [sections, results]);
  const recommendation = recommendationFor(score);

  const submit = useMutation({
    mutationFn: () =>
      providerRepository.submitInspection({
        orderId: id ?? '',
        templateKey: form.data?.templateKey ?? '',
        results,
        subject,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inspection-form', id] });
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      router.back();
    },
  });

  function rate(sectionKey: string, itemKey: string, rating: ItemRating) {
    setResults((current) => {
      const section = current[sectionKey] ?? {};
      const entry = section[itemKey];
      return {
        ...current,
        [sectionKey]: {
          ...section,
          // The note survives a change of rating. An inspector who wrote
          // "leak at the valve cover" and then decided it was a fault rather
          // than a note should not have to type it again.
          [itemKey]: { ...entry, rating },
        },
      };
    });
  }

  function note(sectionKey: string, itemKey: string, text: string) {
    setResults((current) => {
      const section = current[sectionKey] ?? {};
      const entry = section[itemKey];
      if (entry === undefined) return current;
      return {
        ...current,
        [sectionKey]: {
          ...section,
          // Blank is no note, not an empty one: the renderer tests for
          // `undefined`, and an empty string would print an empty paragraph.
          [itemKey]: text.length === 0 ? { rating: entry.rating } : { ...entry, note: text },
        },
      };
    });
  }

  if (form.isError) {
    return (
      <Screen>
        <ErrorState
          testID="inspection-form-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={form.isFetching}
          onRetry={() => void form.refetch()}
        />
      </Screen>
    );
  }

  if (form.data === null || form.data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {form.isLoading ? t('common.loading') : t('errors.notFound')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  // `order_id` is unique on `inspection_reports`, so there is nothing to fill
  // in. Said plainly rather than by disabling a button with no explanation.
  if (form.data.filedReportId !== null) {
    return (
      <Screen>
        <Text variant="title">{t('inspection.title')}</Text>
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="body" tone="muted">
            {t('inspection.filedAlready')}
          </Text>
        </Card>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const vin = normaliseVin(vinText);
  const vinIssue = vinText.length === 0 ? null : vinProblem(vinText);
  const hasSubject = vin.length > 0 || (subject.plate ?? '').length > 0;
  const subjectReady = !form.data.subjectRequired || (hasSubject && vinIssue === null);

  const blocked = !progress.complete || !subjectReady;

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('inspection.title')}</Text>
        <Text variant="body" tone="muted">
          {form.data.templateNameAr}
        </Text>
      </View>

      {/* The two counts the inspector navigates by, and the number the report
          is heading towards. Required is the one that gates filing, so it is
          the one that is coloured. */}
      <Card style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="muted">
              {t('inspection.livePreview')}
            </Text>
            <Text variant="title" numeric style={{ color: theme.colors.text }}>
              {score === null ? '—' : t('inspection.scoreOutOf', { score })}
            </Text>
          </View>

          <FindingBadge
            testID="inspection-live-verdict"
            tone={scoreTone(score, recommendation)}
            label={
              recommendation === null
                ? t('inspection.verdictNone')
                : t(RECOMMENDATION_LABEL_KEY[recommendation])
            }
          />
        </View>

        <Text variant="caption" tone="subtle">
          {t('inspection.livePreviewWhy')}
        </Text>

        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="muted" numeric>
            {t('inspection.progress', { answered: progress.answered, total: progress.total })}
          </Text>
          <Text variant="caption" tone={progress.complete ? 'success' : 'warning'} numeric>
            {t('inspection.requiredProgress', {
              answered: progress.requiredAnswered,
              total: progress.requiredTotal,
            })}
          </Text>
        </View>
      </Card>

      {/* Only for a car Habba has never seen. A periodic inspection on an
          owned vehicle already has its identity from the order, and asking
          for it again would invite a second, conflicting answer. */}
      {form.data.subjectRequired ? (
        <Card style={{ gap: theme.spacing.sm }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">{t('inspection.subjectTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('inspection.subjectWhy')}
            </Text>
          </View>

          <Field
            testID="inspection-vin"
            label={t('inspection.vinLabel')}
            hint={t('inspection.vinHint')}
            value={vinText}
            onChangeText={(value) => {
              setVinText(value);
              const next = normaliseVin(value);
              setSubject((current) => ({
                ...current,
                ...(next.length === 0 ? { vin: undefined } : { vin: next }),
              }));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            forceLtrInput
            error={vinIssue === null ? undefined : t('inspection.vinInvalid')}
          />

          <Field
            testID="inspection-plate"
            label={t('inspection.plateLabel')}
            value={subject.plate ?? ''}
            onChangeText={(value) =>
              setSubject((current) => ({
                ...current,
                ...(value.length === 0 ? { plate: undefined } : { plate: value }),
              }))
            }
          />

          <Field
            testID="inspection-make"
            label={t('inspection.makeLabel')}
            value={subject.makeAr ?? ''}
            onChangeText={(value) =>
              setSubject((current) => ({
                ...current,
                ...(value.length === 0 ? { makeAr: undefined } : { makeAr: value }),
              }))
            }
          />

          <Field
            testID="inspection-model"
            label={t('inspection.modelLabel')}
            value={subject.modelAr ?? ''}
            onChangeText={(value) =>
              setSubject((current) => ({
                ...current,
                ...(value.length === 0 ? { modelAr: undefined } : { modelAr: value }),
              }))
            }
          />

          <Field
            testID="inspection-year"
            label={t('inspection.yearLabel')}
            value={subject.year === undefined ? '' : String(subject.year)}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, '').slice(0, 4);
              setSubject((current) => ({
                ...current,
                ...(digits.length === 0 ? { year: undefined } : { year: Number(digits) }),
              }));
            }}
            keyboardType="number-pad"
            forceLtrInput
          />

          <Field
            testID="inspection-mileage"
            label={t('inspection.mileageLabel')}
            value={subject.mileage === undefined ? '' : String(subject.mileage)}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, '');
              setSubject((current) => ({
                ...current,
                ...(digits.length === 0 ? { mileage: undefined } : { mileage: Number(digits) }),
              }));
            }}
            keyboardType="number-pad"
            forceLtrInput
          />

          {attempted && !hasSubject ? (
            <Text variant="caption" tone="warning">
              {t('inspection.subjectMissing')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {sections.map((section) => (
        <InspectionSection
          key={section.key}
          section={section}
          results={results}
          expanded={expanded === section.key}
          onToggle={() => setExpanded((current) => (current === section.key ? null : section.key))}
          onRate={(itemKey, rating) => rate(section.key, itemKey, rating)}
          onNote={(itemKey, text) => note(section.key, itemKey, text)}
        />
      ))}

      {/* Named, not counted. "Eleven items missing" sends the inspector back
          through eleven sections; "engine — cold start" sends them to one. */}
      {attempted && missing.length > 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">{t('inspection.stillNeeded')}</Text>
            {missing.slice(0, NAMED_GAPS).map((key) => (
              <Text key={key} variant="caption" tone="warning">
                • {labelFor(key, sections, isArabic)}
              </Text>
            ))}
            {missing.length > NAMED_GAPS ? (
              <Text variant="caption" tone="muted" numeric>
                {t('inspection.andMore', { count: missing.length - NAMED_GAPS })}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {submit.isError ? (
        <Text testID="inspection-submit-error" variant="caption" tone="emergency">
          {submit.error instanceof Error && submit.error.message.includes('incomplete')
            ? t('inspection.incomplete')
            : t('errors.generic')}
        </Text>
      ) : null}

      <Button
        testID="submit-inspection"
        label={submit.isPending ? t('inspection.submitting') : t('inspection.submit')}
        onPress={() => {
          setAttempted(true);
          if (blocked) return;
          submit.mutate();
        }}
        loading={submit.isPending}
        // Deliberately NOT disabled while incomplete. A disabled button with
        // no explanation is the thing that has the inspector tapping and
        // wondering; tapping it is what shows them what is missing.
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

/**
 * "engine.cold_start" as the words on the form.
 *
 * `missingRequiredItems` speaks in keys because that is what the server's
 * refusal speaks in, and a technician who is shown a key has been shown
 * nothing. Falls back to the key rather than to an empty string: an
 * unrecognisable label is a bug worth seeing, a blank bullet is not.
 */
function labelFor(
  key: string,
  sections: readonly InspectionTemplateSection[],
  isArabic: boolean,
): string {
  const [sectionKey, itemKey] = key.split('.');
  const section = sections.find((candidate) => candidate.key === sectionKey);
  if (section === undefined) return key;

  const sectionTitle = isArabic ? section.title_ar : (section.title_en ?? section.title_ar);
  const item = section.items.find((candidate) => candidate.key === itemKey);
  if (item === undefined) return sectionTitle;

  const itemLabel = isArabic ? item.label_ar : (item.label_en ?? item.label_ar);
  return `${sectionTitle} — ${itemLabel}`;
}
