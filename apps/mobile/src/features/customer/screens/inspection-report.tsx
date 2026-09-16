/**
 * تقرير الفحص — what the buyer paid to find out.
 *
 * Phase 5 has had a complete, tested backend since 0026/0027 and no screen on
 * either side. The provider can now file one; this is the person it was filed
 * for.
 *
 * ⚠️ **Findings first, score second.** `collectFindings` in @habba/core sorts by
 * what a fault costs to fix rather than by template order, and this screen puts
 * that list above the number. Leading with "68/100" invites someone to stop
 * reading at a figure that sounds survivable — and the whole reason they paid
 * for an inspection is the two lines underneath it about the oil leak.
 *
 * The recommendation is the server's (`score_to_recommendation`, 0026). Nothing
 * here recomputes it: a buyer is about to hand over thirty thousand riyals on
 * the strength of that word.
 */

import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { collectFindings, countByRating, type ItemRating, type Recommendation } from '@habba/core';
import {
  Button,
  Card,
  Icon,
  Screen,
  Skeleton,
  StatCluster,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
  type StatusTone,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useSession } from '@/features/shared/state/session';
import { formatGregorianDate } from '@/features/shared/lib/dates';

/**
 * ⚠️ `buy` is not a green light and is not styled as one.
 *
 * `score_to_recommendation` returns `buy` at 80 and above, which means a car
 * can be recommended while carrying real faults. A success-green banner would
 * be the app making a promise the score does not support — so `buy` reads as
 * neutral-positive and the findings below it stay the loudest thing on screen.
 */
const RECOMMENDATION_TONE: Record<Recommendation, StatusTone> = {
  buy: 'success',
  negotiate: 'active',
  avoid: 'emergency',
};

const FINDING_TONE: Record<'fail' | 'attention', StatusTone> = {
  fail: 'emergency',
  attention: 'active',
};

export default function InspectionReportScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useSession((state) => state.locale);
  const { id } = useLocalSearchParams<{ id: string }>();

  const report = useQuery({
    queryKey: ['inspection-report', id],
    queryFn: () => repository.getInspectionDetail(id ?? ''),
    enabled: id !== undefined,
  });

  if (report.isPending) {
    return (
      <Screen scrollable style={{ gap: theme.spacing.lg }}>
        <Skeleton height={120} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </Screen>
    );
  }

  const data = report.data;
  if (data === null || data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('errors.notFound')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const findings = collectFindings(data);
  const counts = countByRating(data);
  const subject = data.subject;

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('inspectionReport.title')}</Text>
        <Text variant="caption" tone="muted">
          {[subject.make_ar, subject.model_ar, subject.year]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </Text>
        <Text variant="caption" tone="subtle" numeric>
          {subject.plate ?? subject.vin ?? ''}
          {data.completed_at !== '' ? ` · ${formatGregorianDate(data.completed_at, locale)}` : ''}
        </Text>
      </View>

      {/* ⚠️ The faults, above the score. See the note at the top of this file. */}
      {findings.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="subheading">{t('inspectionReport.findings')}</Text>
          {findings.map((finding, index) => (
            <Card
              key={`${finding.section}-${finding.label}-${index}`}
              testID={`finding-${index}`}
              elevation="none"
              style={{
                backgroundColor: theme.colors.surfaceSunken,
                gap: theme.spacing.xs,
                borderStartWidth: 3,
                borderStartColor:
                  finding.rating === 'fail' ? theme.colors.emergency : theme.colors.accent,
              }}
            >
              <View
                style={{
                  flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {finding.label}
                </Text>
                <StatusPill
                  tone={FINDING_TONE[finding.rating as 'fail' | 'attention']}
                  showDot={false}
                  label={t(`inspection.rating.${finding.rating}`)}
                />
              </View>
              <Text variant="caption" tone="subtle">
                {finding.section}
              </Text>
              {/* The inspector's own words. This is the sentence a buyer takes
                  to the seller, and paraphrasing it here would be inventing
                  evidence. */}
              {finding.note !== undefined ? <Text variant="bodySmall">{finding.note}</Text> : null}
            </Card>
          ))}
        </View>
      ) : (
        <Card elevation="none" style={{ backgroundColor: theme.colors.successSubtle }}>
          <Text variant="bodySmall" tone="success">
            {t('inspectionReport.noFindings')}
          </Text>
        </Card>
      )}

      {/* The number, after the reading. */}
      <Card elevation="sm" style={{ gap: theme.spacing.base }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" tone="muted">
              {t('inspectionReport.score')}
            </Text>
            <Text variant="display" numeric testID="inspection-score">
              {data.overall_score === null ? '—' : `${data.overall_score}/100`}
            </Text>
          </View>
          {data.recommendation !== null ? (
            <StatusPill
              testID="inspection-recommendation"
              tone={RECOMMENDATION_TONE[data.recommendation]}
              showDot={false}
              label={t(`inspectionReport.recommendation.${data.recommendation}`)}
            />
          ) : null}
        </View>

        <StatCluster
          testID="inspection-counts"
          items={(['pass', 'attention', 'fail', 'na'] as const).map((rating: ItemRating) => ({
            key: rating,
            label: t(`inspection.rating.${rating}`),
            value: String(counts[rating]),
            ...(rating === 'fail' && counts.fail > 0 ? { emphasis: 'accent' as const } : {}),
          }))}
        />

        <Text variant="caption" tone="subtle">
          {t('inspectionReport.scoreNote')}
        </Text>
      </Card>

      {/* Everything, section by section, for the buyer who wants to read it
          all — and for the seller being shown it, who will want to check the
          items that passed as much as the ones that did not. */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('inspectionReport.allSections')}</Text>
        {data.template.sections.map((section) => (
          <Card
            key={section.key}
            elevation="none"
            style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.sm }}
          >
            <Text variant="bodyStrong">{section.title_ar}</Text>
            {section.items.map((item) => {
              const entry = data.results[section.key]?.[item.key];
              return (
                <View
                  key={item.key}
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="caption" style={{ flex: 1 }}>
                    {item.label_ar}
                  </Text>
                  <Text
                    variant="caption"
                    tone={
                      entry?.rating === 'fail'
                        ? 'emergency'
                        : entry?.rating === 'attention'
                          ? 'warning'
                          : 'subtle'
                    }
                  >
                    {entry === undefined ? '—' : t(`inspection.rating.${entry.rating}`)}
                  </Text>
                </View>
              );
            })}
          </Card>
        ))}
      </View>

      {/* §1's third moat reason: the buyer purchases, the report becomes a
          vehicle, and the new owner arrives with a documented history already
          in place — at zero acquisition cost. */}
      <Card style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Icon name="gauge" size={theme.iconSize.md} color={theme.colors.primary} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('inspectionReport.convertTitle')}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {t('inspectionReport.convertBody')}
        </Text>
        <Button
          testID="convert-inspection"
          label={t('inspectionReport.convert')}
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/add-vehicle', params: { fromInspection: id ?? '' } })
          }
        />
      </Card>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
