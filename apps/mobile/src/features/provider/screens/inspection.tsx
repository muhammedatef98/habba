/**
 * الفحص — filling a structured inspection against the template.
 *
 * Phase 5's backend has been complete and tested since 0026/0027, with the real
 * eleven-section pre-purchase template seeded, and has never had a screen. An
 * inspector had no way to file a report at all.
 *
 * Three things shape this screen, all of them about where it is used: standing
 * beside someone else's car, in a workshop, deciding whether a stranger should
 * hand over thirty thousand riyals.
 *
 * **Section at a time.** Eleven sections and sixty-odd items on one scroll is a
 * form nobody finishes accurately. The list shows progress per section so the
 * inspector knows where to go back to.
 *
 * **What is missing is named before submitting.** `submit_inspection_report`
 * refuses a partial report and lists `section.item` keys — correct, and useless
 * at the moment it arrives. `unansweredRequired` is the same rule in @habba/core,
 * rendered in Arabic labels while the car is still in front of them.
 *
 * ⚠️ **No score is computed here, ever.** The weighted score and the
 * buy/negotiate/avoid recommendation are the server's (0026), and
 * `inspection_reports` has no INSERT policy at all — a report carrying a
 * flattering number is not something this app can produce. A buyer is about to
 * act on that figure.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  sectionProgress,
  unansweredRequired,
  type InspectionResultEntry,
  type InspectionTemplateSection,
  type ItemRating,
} from '@habba/core';
import {
  Button,
  Card,
  Field,
  Icon,
  Screen,
  Skeleton,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';

/** The vocabulary `rating_to_score` understands. Anything else scores nothing. */
const RATINGS: readonly ItemRating[] = ['pass', 'attention', 'fail', 'na'];

type Results = Record<string, Record<string, InspectionResultEntry>>;

export default function InspectionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id, template } = useLocalSearchParams<{ id: string; template?: string }>();
  const orderId = id ?? '';
  const templateKey = template ?? 'pre_purchase_v1';

  const templateQuery = useQuery({
    queryKey: ['inspection-template', templateKey],
    queryFn: () => providerRepository.getInspectionTemplate(templateKey),
  });

  const [results, setResults] = useState<Results>({});
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [vin, setVin] = useState('');
  const [plate, setPlate] = useState('');
  const [mileage, setMileage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      providerRepository.submitInspection({
        orderId,
        templateKey,
        results,
        // Empty is null, not ''. The server's `inspection_subject_identified`
        // constraint counts an empty string as present, which would let a
        // report through identifying its subject by nothing at all.
        subjectVin: vin.trim() === '' ? null : vin.trim().toUpperCase(),
        subjectPlate: plate.trim() === '' ? null : plate.trim(),
        subjectMakeAr: null,
        subjectModelAr: null,
        subjectYear: null,
        subjectMileage: mileage.trim() === '' ? null : Number(mileage),
      }),
    onSuccess: () => {
      setError(null);
      router.back();
    },
    // The server's message names what it refused, and it is more specific than
    // anything this screen could invent — an unknown template, a subject with
    // no identity, a job that is not this provider's.
    onError: (cause: Error) => setError(cause.message),
  });

  if (templateQuery.isPending) {
    return (
      <Screen scrollable style={{ gap: theme.spacing.lg }}>
        <Skeleton height={60} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </Screen>
    );
  }

  const data = templateQuery.data;
  if (data === null || data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('inspection.noTemplate')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const missing = unansweredRequired(data.sections, results);
  // The car has to be identifiable: it has no `vehicles` row to borrow a VIN
  // and plate from, and the server refuses a report that names neither.
  const identified = vin.trim() !== '' || plate.trim() !== '';

  const rate = (sectionKey: string, itemKey: string, rating: ItemRating) => {
    setResults((current) => ({
      ...current,
      [sectionKey]: {
        ...(current[sectionKey] ?? {}),
        [itemKey]: { ...(current[sectionKey]?.[itemKey] ?? {}), rating },
      },
    }));
  };

  const note = (sectionKey: string, itemKey: string, text: string) => {
    setResults((current) => ({
      ...current,
      [sectionKey]: {
        ...(current[sectionKey] ?? {}),
        [itemKey]: {
          // ⚠️ Spread first so a note never invents a rating. An entry carrying
          // only a note is NOT an answer — the server tests the rating, and
          // `unansweredRequired` mirrors that exactly.
          ...(current[sectionKey]?.[itemKey] ?? ({} as InspectionResultEntry)),
          note: text,
        } as InspectionResultEntry,
      },
    }));
  };

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{data.nameAr}</Text>
        <Text variant="bodySmall" tone="muted">
          {t('inspection.subtitle')}
        </Text>
      </View>

      {/* The subject, first. A report that cannot say which car it is about is
          an unattributable score, and the buyer reading it has no way to tell. */}
      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong">{t('inspection.subjectTitle')}</Text>
        <Text variant="caption" tone="muted">
          {t('inspection.subjectHint')}
        </Text>

        <Field
          testID="inspection-plate"
          label={t('inspection.plateLabel')}
          value={plate}
          onChangeText={setPlate}
        />
        <Field
          testID="inspection-vin"
          label={t('inspection.vinLabel')}
          hint={t('inspection.vinHint')}
          value={vin}
          onChangeText={(value) => setVin(value.toUpperCase())}
          forceLtrInput
          autoCapitalize="characters"
        />
        <Field
          testID="inspection-mileage"
          label={t('inspection.mileageLabel')}
          value={mileage}
          onChangeText={(value) => setMileage(value.replace(/\D/g, ''))}
          keyboardType="number-pad"
          forceLtrInput
        />
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('inspection.sections')}</Text>

        {data.sections.map((section) => (
          <SectionCard
            key={section.key}
            section={section}
            results={results}
            open={openSection === section.key}
            onToggle={() => setOpenSection(openSection === section.key ? null : section.key)}
            onRate={rate}
            onNote={note}
          />
        ))}
      </View>

      {/* Named, in words, while they are still standing next to the car. */}
      {missing.length > 0 ? (
        <Card
          testID="inspection-missing"
          elevation="none"
          style={{
            backgroundColor: theme.colors.warningSubtle,
            borderColor: theme.colors.warning,
            borderWidth: 1,
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="bodyStrong" tone="warning">
            {t('inspection.stillNeeded', { count: missing.length })}
          </Text>
          {missing.slice(0, 6).map((key) => (
            <Text key={key} variant="caption" tone="warning">
              • {labelFor(data.sections, key)}
            </Text>
          ))}
          {missing.length > 6 ? (
            <Text variant="caption" tone="warning">
              {t('inspection.andMore', { count: missing.length - 6 })}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {!identified ? (
        <Text variant="caption" tone="warning">
          {t('inspection.needsSubject')}
        </Text>
      ) : null}

      {error !== null ? (
        <Text testID="inspection-error" variant="caption" tone="emergency">
          {error}
        </Text>
      ) : null}

      <Button
        testID="submit-inspection"
        label={t('inspection.submit')}
        onPress={() => submit.mutate()}
        loading={submit.isPending}
        disabled={missing.length > 0 || !identified || submit.isPending}
      />

      {/* Said where the decision is made. The inspector is not scoring the car —
          they are describing it, and the weighting is not theirs to apply. */}
      <Text variant="caption" tone="subtle">
        {t('inspection.scoreNote')}
      </Text>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function SectionCard({
  section,
  results,
  open,
  onToggle,
  onRate,
  onNote,
}: {
  readonly section: InspectionTemplateSection;
  readonly results: Results;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onRate: (sectionKey: string, itemKey: string, rating: ItemRating) => void;
  readonly onNote: (sectionKey: string, itemKey: string, text: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const progress = sectionProgress(section, results);
  const done = progress.requiredMissing === 0;

  return (
    <Card
      testID={`inspection-section-${section.key}`}
      elevation={open ? 'sm' : 'none'}
      style={{
        gap: open ? theme.spacing.base : 0,
        backgroundColor: open ? theme.colors.surface : theme.colors.surfaceSunken,
        borderWidth: 1,
        borderColor: done ? theme.colors.successBorder : theme.colors.border,
      }}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={section.title_ar}
      >
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {section.title_ar}
          </Text>
          {/* Progress on the row, so an inspector can see where to go back to
              without opening all eleven. */}
          <Text variant="caption" tone="subtle" numeric>
            {t('inspection.progress', { done: progress.answered, total: progress.total })}
          </Text>
          <Icon
            name={done ? 'check' : 'arrow'}
            size={theme.iconSize.sm}
            color={done ? theme.colors.successFg : theme.colors.textSubtle}
          />
        </View>
      </Pressable>

      {open
        ? section.items.map((item) => {
            const entry = results[section.key]?.[item.key];
            return (
              <View
                key={item.key}
                style={{
                  gap: theme.spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                }}
              >
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="bodySmall" style={{ flex: 1 }}>
                    {item.label_ar}
                  </Text>
                  {item.required === true && entry?.rating === undefined ? (
                    <StatusPill tone="neutral" showDot={false} label={t('inspection.required')} />
                  ) : null}
                </View>

                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    gap: theme.spacing.xs,
                  }}
                >
                  {RATINGS.map((rating) => (
                    <View key={rating} style={{ flex: 1 }}>
                      <Button
                        testID={`rate-${section.key}-${item.key}-${rating}`}
                        label={t(`inspection.rating.${rating}`)}
                        variant={entry?.rating === rating ? toneFor(rating) : 'secondary'}
                        size="medium"
                        onPress={() => onRate(section.key, item.key, rating)}
                      />
                    </View>
                  ))}
                </View>

                {/* Only once something is wrong. A note field under every item
                    on an eleven-section form is sixty fields nobody fills in;
                    under a fault it is the sentence the buyer most needs. */}
                {entry?.rating === 'attention' || entry?.rating === 'fail' ? (
                  <Field
                    testID={`note-${section.key}-${item.key}`}
                    label={t('inspection.noteLabel')}
                    value={entry.note ?? ''}
                    onChangeText={(text) => onNote(section.key, item.key, text)}
                    multiline
                  />
                ) : null}
              </View>
            );
          })
        : null}
    </Card>
  );
}

/** `fail` reads as the emergency tone, `pass` as success — the rest is neutral. */
function toneFor(rating: ItemRating): 'primary' | 'secondary' | 'accent' | 'emergency' {
  if (rating === 'fail') return 'emergency';
  if (rating === 'pass') return 'primary';
  if (rating === 'attention') return 'accent';
  return 'secondary';
}

/**
 * Turns a `section.item` key into the Arabic label the inspector saw.
 *
 * The server reports keys and this screen reports words. Falling back to the
 * key is deliberate: a template gaining an item the app has not seen should
 * still name it, badly, rather than silently omitting it from the missing list.
 */
function labelFor(sections: readonly InspectionTemplateSection[], key: string): string {
  const [sectionKey, itemKey] = key.split('.');
  const section = sections.find((candidate) => candidate.key === sectionKey);
  const item = section?.items.find((candidate) => candidate.key === itemKey);
  if (section === undefined || item === undefined) return key;
  return `${section.title_ar} — ${item.label_ar}`;
}
