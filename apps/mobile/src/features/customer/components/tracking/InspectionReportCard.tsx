/**
 * The inspection report, on the order it was bought with.
 *
 * Leads with what is wrong with the car, worst first (`collectFindings`), then
 * the verdict — the order a buyer standing next to a car should read it in.
 * Shared as a PDF generated on the phone (ADR-0019).
 *
 * And the step the whole feature exists for (CLAUDE.md §1, moat reason 3):
 * a buyer who goes ahead adds the car to their account, and its logbook opens
 * with this inspection already in it (0027).
 */

import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { collectFindings, countByRating } from '@habba/core';
import { Button, Card, Field, ListRow, Row, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { OrderInspection } from '@/features/shared/data/types';
import { inspectionDocument } from '@/features/shared/lib/report-pdf';
import { DocumentActions } from '@/features/shared/components/DocumentActions';

export function InspectionReportCard({
  inspection,
  orderCompleted,
}: {
  readonly inspection: OrderInspection;
  readonly orderCompleted: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { report } = inspection;
  const findings = collectFindings(report);
  const counts = countByRating(report);
  const verdictTone =
    report.recommendation === 'buy'
      ? 'success'
      : report.recommendation === 'negotiate'
        ? 'warning'
        : 'emergency';

  return (
    <Card testID="inspection-report" elevation="sm" style={{ gap: theme.spacing.md }}>
      <Text variant="heading">{t('inspectionReport.title')}</Text>

      <Row gap="md" align="flex-end">
        {report.overall_score !== null ? (
          <Text variant="title" numeric>
            {t('inspection.score', { score: report.overall_score })}
          </Text>
        ) : null}
        {report.recommendation !== null ? (
          <Text variant="bodyStrong" tone={verdictTone}>
            {t(`inspection.recommendation.${report.recommendation}`)}
          </Text>
        ) : null}
      </Row>

      <Text variant="caption" tone="muted" numeric>
        {t('inspectionReport.counts', {
          fail: counts.fail,
          attention: counts.attention,
          pass: counts.pass,
        })}
      </Text>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="bodyStrong">{t('inspectionReport.findingsTitle')}</Text>
        {findings.length === 0 ? (
          <Text variant="bodySmall" tone="muted">
            {t('inspectionReport.noFindings')}
          </Text>
        ) : (
          findings.slice(0, 6).map((finding, index) => (
            <View key={`${finding.section}-${finding.label}-${index}`} style={{ gap: 2 }}>
              <Text variant="bodySmall" tone={finding.rating === 'fail' ? 'emergency' : 'warning'}>
                {finding.section} — {finding.label}: {t(`inspection.rating.${finding.rating}`)}
              </Text>
              {finding.note !== undefined && finding.note !== '' ? (
                <Text variant="caption" tone="muted">
                  {finding.note}
                </Text>
              ) : null}
            </View>
          ))
        )}
        {findings.length > 6 ? (
          <Text variant="caption" tone="subtle">
            {t('inspectionReport.moreInPdf', { count: findings.length - 6 })}
          </Text>
        ) : null}
      </View>

      <DocumentActions
        testID="share-inspection"
        load={() => Promise.resolve(inspectionDocument(report, t('documents.inspectionReport')))}
        viewLabel={t('documents.viewReport')}
      />

      {orderCompleted && inspection.vehicleId === null ? (
        <AddBoughtCar reportId={inspection.reportId} />
      ) : null}
    </Card>
  );
}

function AddBoughtCar({ reportId }: { readonly reportId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [makeId, setMakeId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');

  const makes = useQuery({
    queryKey: ['makes'],
    queryFn: () => repository.listMakes(),
    enabled: open,
  });
  const models = useQuery({
    queryKey: ['models', makeId],
    queryFn: () => repository.listModels(makeId ?? ''),
    enabled: makeId !== null,
  });

  const convert = useMutation({
    // Its failure is shown in place, not as a toast.
    meta: { inlineError: true },
    mutationFn: () =>
      repository.convertInspectionToVehicle(
        reportId,
        makeId ?? '',
        modelId ?? '',
        nickname.trim() === '' ? null : nickname.trim(),
      ),
    onSuccess: async (vehicleId) => {
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      router.replace({ pathname: '/logbook', params: { id: vehicleId } });
    },
  });

  if (!open) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="bodyStrong">{t('inspectionReport.boughtIt')}</Text>
        <Text variant="caption" tone="muted">
          {t('inspectionReport.boughtItHint')}
        </Text>
        <Button
          testID="add-bought-car"
          label={t('inspectionReport.addToLogbook')}
          onPress={() => setOpen(true)}
        />
      </View>
    );
  }

  return (
    <View testID="add-bought-car-form" style={{ gap: theme.spacing.sm }}>
      <Text variant="bodyStrong">
        {makeId === null ? t('inspectionReport.chooseMake') : t('inspectionReport.chooseModel')}
      </Text>
      {makeId === null
        ? (makes.data ?? []).map((make) => (
            <ListRow
              key={make.id}
              title={make.nameAr}
              onPress={() => setMakeId(make.id)}
              showChevron
            />
          ))
        : (models.data ?? []).map((model) => (
            <ListRow
              key={model.id}
              title={model.nameAr}
              selected={model.id === modelId}
              onPress={() => setModelId(model.id)}
            />
          ))}
      {makeId !== null ? (
        <>
          <Field
            label={t('inspectionReport.nickname')}
            value={nickname}
            onChangeText={setNickname}
            placeholder={t('inspectionReport.nicknamePlaceholder')}
          />
          {convert.isError ? (
            <Text variant="caption" tone="emergency">
              {t('inspectionReport.convertFailed')}
            </Text>
          ) : null}
          <Button
            testID="convert-inspection"
            label={t('inspectionReport.convert')}
            onPress={() => convert.mutate()}
            loading={convert.isPending}
            disabled={modelId === null}
          />
          <Button
            label={t('inspectionReport.changeMake')}
            variant="ghost"
            onPress={() => {
              setMakeId(null);
              setModelId(null);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
