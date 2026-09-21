/**
 * One section of the inspection form, collapsed until it is being worked on.
 *
 * Eleven sections and forty-three items do not fit on a phone, and a flat list
 * of all of them gives the inspector no way to know where they are or what is
 * left. Collapsed sections carry their own count in the header, so the form
 * can be scanned for what is outstanding without opening anything.
 *
 * A note field appears only on `attention` and `fail`. That is not tidiness:
 * `collectFindings` carries notes for exactly those two ratings and the
 * report prints them there, so a note typed against a `pass` would be written
 * into the record and then shown to nobody.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Field, Icon, Text, rowDirectionFor, useTheme } from '@habba/ui';
import {
  sectionProgress,
  type InspectionResults,
  type InspectionTemplateSection,
  type ItemRating,
} from '@habba/core';
import { ITEM_RATINGS, RATING_LABEL_KEY } from '@/features/shared/lib/inspection-rating';
import { RatingChoice } from './RatingChoice';

export interface InspectionSectionProps {
  readonly section: InspectionTemplateSection;
  readonly results: InspectionResults;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onRate: (itemKey: string, rating: ItemRating) => void;
  readonly onNote: (itemKey: string, note: string) => void;
}

export function InspectionSection({
  section,
  results,
  expanded,
  onToggle,
  onRate,
  onNote,
}: InspectionSectionProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');
  const progress = sectionProgress(section, results);
  const sectionResults = results[section.key];
  const row = rowDirectionFor(theme.direction, theme.nativeDirection);

  const title =
    (isArabic ? section.title_ar : (section.title_en ?? section.title_ar)) || section.key;

  return (
    <Card elevation={expanded ? 'sm' : 'none'} style={{ gap: theme.spacing.sm }}>
      <Pressable
        testID={`inspection-section-${section.key}`}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title} — ${t('inspection.sectionProgress', {
          answered: progress.requiredAnswered,
          total: progress.requiredTotal,
        })}`}
        style={{
          flexDirection: row,
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: theme.minTouchTarget,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone={progress.complete ? 'muted' : 'warning'} numeric>
            {t('inspection.sectionProgress', {
              answered: progress.requiredAnswered,
              total: progress.requiredTotal,
            })}
          </Text>
        </View>

        {/* `chevronDown` is deliberately not in the mirrored set — down is
            down in both directions — so rotating it is safe in Arabic and
            English alike, and is why there is no separate up glyph. */}
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={theme.iconSize.sm} color={theme.colors.textMuted} />
        </View>
      </Pressable>

      {expanded
        ? section.items.map((item) => {
            const entry = sectionResults?.[item.key];
            const label = (isArabic ? item.label_ar : (item.label_en ?? item.label_ar)) || item.key;
            const showNote = entry?.rating === 'attention' || entry?.rating === 'fail';

            return (
              <View
                key={item.key}
                style={{
                  gap: theme.spacing.sm,
                  paddingTop: theme.spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                }}
              >
                <View style={{ flexDirection: row, alignItems: 'center', gap: theme.spacing.sm }}>
                  <Text variant="body" style={{ flex: 1 }}>
                    {label}
                  </Text>

                  {/* Marked in the form, not only in the scoring, because the
                      inspector's care on these four items is what the cap is
                      for. They are the ones a buyer walks away over. */}
                  {item.critical === true ? (
                    <Text variant="caption" tone="warning">
                      {t('inspection.criticalItem')}
                    </Text>
                  ) : null}
                </View>

                <RatingChoice
                  testIdPrefix={`rate-${section.key}-${item.key}`}
                  accessibilityLabel={label}
                  selected={entry?.rating}
                  onSelect={(rating) => onRate(item.key, rating)}
                  options={ITEM_RATINGS.map((rating) => ({
                    rating,
                    label: t(RATING_LABEL_KEY[rating]),
                  }))}
                />

                {showNote ? (
                  <Field
                    testID={`note-${section.key}-${item.key}`}
                    label={t('inspection.noteLabel')}
                    placeholder={t('inspection.notePlaceholder')}
                    hint={t('inspection.notePrompt')}
                    value={entry?.note ?? ''}
                    onChangeText={(value) => onNote(item.key, value)}
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
