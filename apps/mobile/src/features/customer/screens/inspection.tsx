/**
 * The inspection the buyer paid for.
 *
 * Ordered the way `renderInspectionReport` orders the public page, and for the
 * same reason: a buyer needs "what is wrong with this car" before "what did it
 * score". Leading with a number invites them to stop reading at a reassuring
 * one, and 78% with a cracked chassis behind it is exactly the number that
 * sends somebody into a bad purchase feeling reassured.
 *
 * So: findings first, worst first. Then the score and the word. Then, only if
 * they ask for it, all forty-three items.
 *
 * The screen ends with «هذه سيارتي الآن», which is the moat's acquisition loop
 * (§1.3): somebody who was not a Habba customer paid for an inspection, bought
 * the car, and their logbook opens with a Habba-verified assessment of it
 * already inside. Offered only while `convert_inspection_to_vehicle` would
 * still accept it — a report converts exactly once (0027).
 */

import { useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { collectFindings, countByRating } from '@habba/core';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Screen,
  SkeletonCard,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { ChipRow } from '@/features/customer/components/form/ChipRow';
import { FindingBadge } from '@/features/shared/components/FindingBadge';
import { repository } from '@/features/shared/data/repository';
import { formatCount } from '@/features/shared/lib/format-number';
import {
  RATING_LABEL_KEY,
  RECOMMENDATION_LABEL_KEY,
  ratingTone,
  scoreTone,
} from '@/features/shared/lib/inspection-rating';

export default function InspectionReportScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language.startsWith('ar');
  const row = rowDirectionFor(theme.direction, theme.nativeDirection);

  const inspection = useQuery({
    queryKey: ['inspection', id],
    queryFn: () => repository.getInspectionForOrder(id ?? ''),
    enabled: id !== undefined,
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  const [showDetail, setShowDetail] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [makeId, setMakeId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  const report = inspection.data?.report ?? null;

  const findings = useMemo(() => (report === null ? [] : collectFindings(report)), [report]);
  const counts = useMemo(
    () => (report === null ? { pass: 0, attention: 0, fail: 0, na: 0 } : countByRating(report)),
    [report],
  );

  const claim = useMutation({
    mutationFn: () =>
      repository.convertInspectionToVehicle({
        reportId: inspection.data?.reportId ?? '',
        makeId: makeId ?? '',
        modelId: modelId ?? '',
        ...(nickname.length === 0 ? {} : { nickname }),
      }),
    onSuccess: async (vehicleId) => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      await queryClient.invalidateQueries({ queryKey: ['inspection', id] });
      router.replace({ pathname: '/logbook', params: { id: vehicleId } });
    },
  });

  if (inspection.isError) {
    return (
      <Screen>
        <ErrorState
          testID="inspection-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={inspection.isFetching}
          onRetry={() => void inspection.refetch()}
        />
      </Screen>
    );
  }

  if (inspection.isPending) {
    return (
      <Screen>
        <Text variant="title">{t('inspection.customerTitle')}</Text>
        <View accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
          <SkeletonCard testID="inspection-skeleton" />
        </View>
      </Screen>
    );
  }

  // The order exists, the report does not yet. Not an error, and not an empty
  // state either — the inspector is at the car right now.
  if (inspection.data === null || report === null) {
    return (
      <Screen>
        <Text variant="title">{t('inspection.customerTitle')}</Text>
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="body" tone="muted">
            {t('inspection.waiting')}
          </Text>
        </Card>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const outcome = inspection.data;
  const { subject } = report;
  const claimed = outcome.vehicleId !== null;

  // Whatever the inspector typed for the car, or the service's own name. The
  // subject is free text on a car nobody owns, so any of it may be absent.
  const subjectName = [subject.make_ar, subject.model_ar, subject.year]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  const title = subjectName.length > 0 ? subjectName : t('inspection.customerTitle');

  const modelsForMake = (models.data ?? []).filter((model) => model.makeId === makeId);

  const claimError =
    claim.error instanceof Error
      ? claim.error.message.toLowerCase().includes('already has a habba logbook')
        ? t('inspection.alreadyRegistered')
        : claim.error.message.toLowerCase().includes('already attached')
          ? t('inspection.alreadyClaimed')
          : t('inspection.claimFailed')
      : null;

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{title}</Text>
        <Text variant="caption" tone="muted">
          {report.template.name_ar}
        </Text>
      </View>

      {/* Findings before the score, deliberately. See the header comment. */}
      <Card style={{ gap: theme.spacing.sm }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="bodyStrong">{t('inspection.findingsTitle')}</Text>
          <Text variant="caption" tone="muted">
            {t('inspection.findingsWhy')}
          </Text>
        </View>

        {findings.length === 0 ? (
          <Text variant="body" tone="muted">
            {t('inspection.findingsNone')}
          </Text>
        ) : (
          findings.map((finding, index) => (
            <View
              key={`${finding.section}-${finding.label}-${index}`}
              style={{
                gap: theme.spacing.xs,
                paddingTop: theme.spacing.sm,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ flexDirection: row, alignItems: 'center', gap: theme.spacing.sm }}>
                <FindingBadge
                  tone={ratingTone(finding.rating)}
                  label={t(RATING_LABEL_KEY[finding.rating])}
                />
                <Text variant="bodySmall" tone="muted" style={{ flex: 1 }}>
                  {finding.section}
                </Text>
              </View>

              <Text variant="bodyStrong">{finding.label}</Text>

              {/* The inspector's own words. They are why the finding is worth
                  more than its rating — "repaired and resprayed, left front
                  wing" is a negotiating position; "fault" is not. */}
              {finding.note === undefined ? null : (
                <Text variant="bodySmall" tone="muted">
                  {finding.note}
                </Text>
              )}
            </View>
          ))
        )}
      </Card>

      <Card style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: row, alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="muted">
              {t('inspection.scoreLabel')}
            </Text>
            <Text testID="inspection-score" variant="display" numeric>
              {report.overall_score === null
                ? '—'
                : t('inspection.scoreOutOf', { score: report.overall_score })}
            </Text>
          </View>

          <FindingBadge
            testID="inspection-verdict"
            tone={scoreTone(report.overall_score, report.recommendation)}
            label={
              report.recommendation === null
                ? t('inspection.verdictNone')
                : t(RECOMMENDATION_LABEL_KEY[report.recommendation])
            }
          />
        </View>

        <Text variant="caption" tone="muted" numeric>
          {t('inspection.countsSummary', {
            pass: counts.pass,
            attention: counts.attention,
            fail: counts.fail,
          })}
        </Text>

        {/* The car the report is about, carried by the report itself — there
            may be no vehicle row anywhere to read it from. */}
        <View style={{ gap: 2 }}>
          {subject.plate === undefined ? null : (
            <Text variant="caption" tone="muted">
              {t('inspection.plateLabel')}: {subject.plate}
            </Text>
          )}
          {subject.vin === undefined ? null : (
            <Text variant="caption" tone="muted" numeric>
              {t('inspection.vinLabel')}: {subject.vin}
            </Text>
          )}
          {subject.mileage === undefined ? null : (
            <Text variant="caption" tone="muted" numeric>
              {t('inspection.mileageLabel')}: {formatCount(subject.mileage, i18n.language)}
            </Text>
          )}
        </View>
      </Card>

      <Button
        testID="toggle-inspection-detail"
        label={showDetail ? t('inspection.hideDetails') : t('inspection.showDetails')}
        variant="secondary"
        onPress={() => setShowDetail((current) => !current)}
      />

      {showDetail
        ? report.template.sections.map((section) => {
            const sectionResults = report.results[section.key] ?? {};
            return (
              <Card key={section.key} elevation="none" style={{ gap: theme.spacing.sm }}>
                <Text variant="bodyStrong">
                  {isArabic ? section.title_ar : (section.title_en ?? section.title_ar)}
                </Text>

                {section.items.map((item) => {
                  const entry = sectionResults[item.key];
                  // An item the inspector never answered is shown as `na`, the
                  // same way the public page shows it. Silently omitting it
                  // would make the app's copy of the report shorter than the
                  // one the buyer forwards.
                  const rating = entry?.rating ?? 'na';

                  return (
                    <View
                      key={item.key}
                      style={{ flexDirection: row, alignItems: 'center', gap: theme.spacing.sm }}
                    >
                      <Text variant="bodySmall" style={{ flex: 1 }}>
                        {isArabic ? item.label_ar : (item.label_en ?? item.label_ar)}
                      </Text>
                      <FindingBadge tone={ratingTone(rating)} label={t(RATING_LABEL_KEY[rating])} />
                    </View>
                  );
                })}
              </Card>
            );
          })
        : null}

      {outcome.publicToken === null ? null : (
        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="bodyStrong">{t('inspection.shareTitle')}</Text>
          <Text variant="caption" tone="muted">
            {t('inspection.shareWhy')}
          </Text>
          <Button
            testID="share-inspection"
            label={t('inspection.shareAction')}
            variant="secondary"
            onPress={() => {
              void Share.share({ message: `https://habba.sa/i/${outcome.publicToken ?? ''}` });
            }}
          />
        </Card>
      )}

      {/* The acquisition loop. Gone once the report has been converted — a
          second claim is refused server-side, and offering it would be
          offering something the server will not do. */}
      {claimed ? (
        <Card elevation="none" style={{ gap: theme.spacing.sm }}>
          <Text variant="body" tone="muted">
            {t('inspection.alreadyClaimed')}
          </Text>
          <Button
            testID="open-inspection-logbook"
            label={t('inspection.openLogbook')}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/logbook', params: { id: outcome.vehicleId ?? '' } })
            }
          />
        </Card>
      ) : (
        <Card
          style={{
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.primarySubtle,
            borderColor: theme.colors.primary,
            borderWidth: 1,
          }}
        >
          <Text variant="bodyStrong">{t('inspection.claimTitle')}</Text>
          <Text variant="bodySmall" tone="muted">
            {t('inspection.claimWhy')}
          </Text>

          {claiming ? (
            <View style={{ gap: theme.spacing.sm }}>
              {/* The make and model are asked rather than guessed: the report
                  carries whatever the inspector typed, which is free text, and
                  `vehicles` needs the catalogue's ids. Everything else — VIN,
                  plate, year, odometer — comes off the report itself. */}
              <ChipRow
                label={t('inspection.claimMake')}
                testIdPrefix="claim-make"
                selected={makeId}
                onSelect={(key) => {
                  setMakeId(key);
                  setModelId(null);
                }}
                options={(makes.data ?? []).map((make) => ({
                  key: make.id,
                  label: isArabic ? make.nameAr : make.nameEn,
                }))}
              />

              {makeId === null ? null : (
                <ChipRow
                  label={t('inspection.claimModel')}
                  testIdPrefix="claim-model"
                  selected={modelId}
                  onSelect={setModelId}
                  options={modelsForMake.map((model) => ({
                    key: model.id,
                    label: isArabic ? model.nameAr : model.nameEn,
                  }))}
                />
              )}

              <Field
                testID="claim-nickname"
                label={t('inspection.claimNickname')}
                value={nickname}
                onChangeText={setNickname}
              />

              {claimError === null ? null : (
                <Text testID="claim-error" variant="caption" tone="emergency">
                  {claimError}
                </Text>
              )}

              <Button
                testID="confirm-claim"
                label={t('inspection.claimConfirm')}
                onPress={() => claim.mutate()}
                disabled={makeId === null || modelId === null}
                loading={claim.isPending}
              />
            </View>
          ) : (
            <Button
              testID="start-claim"
              label={t('inspection.claimAction')}
              onPress={() => setClaiming(true)}
            />
          )}
        </Card>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
