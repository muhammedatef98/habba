/**
 * Completion evidence capture.
 *
 * This is the screen the moat depends on. §11: "Do not skip the completion
 * photos/mileage. Without them the moat is empty."
 *
 * Two design choices follow from that:
 *
 *   * It names what is MISSING, item by item, rather than reporting a generic
 *     "incomplete". Someone crouched beside a car at night needs "add an after
 *     photo", not "validation failed".
 *   * It warns about an implausible odometer reading BEFORE submitting. The
 *     server only rejects readings that go down; a fat-fingered extra digit
 *     goes up, passes every server check, and then poisons the maintenance
 *     estimates and prints an absurd number on the resale report.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  checkMileage,
  missingEvidence,
  type CompletionMediaItem,
  type EvidenceGap,
} from '@habba/core';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Screen,
  Skeleton,
  SkeletonCard,
  Text,
  useTheme,
} from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';

const GAP_LABEL_KEY: Record<EvidenceGap, string> = {
  mileage: 'provider.gapMileage',
  before_photo: 'provider.gapBefore',
  after_photo: 'provider.gapAfter',
};

export default function EvidenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => providerRepository.getJob(id ?? ''),
    enabled: id !== undefined,
  });

  const [mileageText, setMileageText] = useState('');
  const [media, setMedia] = useState<readonly CompletionMediaItem[]>([]);

  const save = useMutation({
    mutationFn: () => providerRepository.recordEvidence(id ?? '', Number(mileageText), media),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      router.back();
    },
  });

  const data = job.data;

  // Same three outcomes as the job screen, and the same reason: this is the
  // screen a technician fills in at the end of a job, often in a basement or a
  // workshop with no signal (§2.7). "Not found" over a dropped request would
  // read as the job having been taken away from them.
  if (job.isPending) {
    return (
      <Screen>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.md }}
        >
          <Skeleton height={28} width="65%" />
          <SkeletonCard testID="evidence-skeleton" lines={2} />
          <SkeletonCard lines={3} />
        </View>
      </Screen>
    );
  }

  if (job.isError) {
    return (
      <Screen>
        <ErrorState
          testID="evidence-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={job.isFetching}
          onRetry={() => void job.refetch()}
        />
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (data === null || data === undefined) {
    return (
      <Screen>
        <EmptyState testID="evidence-missing" title={t('errors.notFound')} />
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const mileage = mileageText.length === 0 ? null : Number(mileageText);

  const gaps = missingEvidence(
    {
      requiresMileage: data.requiresCompletionMileage,
      requiresPhotos: data.requiresCompletionPhotos,
    },
    mileage,
    media,
  );

  const mileageWarning =
    mileage === null ? null : checkMileage(mileage, data.vehicleCurrentMileage, 1);

  /**
   * Stands in for the camera. The native build replaces this with
   * expo-image-picker plus an upload to Supabase Storage; keeping the capture
   * behind one function means the screen's logic — which is the part that
   * matters — does not depend on a native module.
   */
  function addPhoto(kind: 'before' | 'after') {
    setMedia((current) => [
      ...current.filter((item) => item.kind !== kind),
      { url: `habba://captured/${kind}/${Date.now()}`, kind },
    ]);
  }

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('provider.evidenceTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('provider.evidenceWhy')}
        </Text>
      </View>

      {data.requiresCompletionMileage ? (
        <Field
          testID="evidence-mileage"
          label={t('provider.mileageLabel')}
          value={mileageText}
          onChangeText={(value) => setMileageText(value.replace(/\D/g, ''))}
          keyboardType="number-pad"
          forceLtrInput
          hint={
            data.vehicleCurrentMileage === null
              ? undefined
              : t('provider.mileageLastKnown', { km: data.vehicleCurrentMileage })
          }
          error={
            mileageWarning === 'below_recorded'
              ? t('provider.mileageBelowRecorded', { km: data.vehicleCurrentMileage })
              : mileageWarning === 'implausible_jump'
                ? t('provider.mileageImplausible')
                : undefined
          }
        />
      ) : null}

      {data.requiresCompletionPhotos ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('provider.photosLabel')}
          </Text>

          <Button
            testID="add-before"
            label={
              media.some((m) => m.kind === 'before')
                ? t('provider.beforeCaptured')
                : t('provider.addBefore')
            }
            variant={media.some((m) => m.kind === 'before') ? 'secondary' : 'accent'}
            onPress={() => addPhoto('before')}
          />
          <Button
            testID="add-after"
            label={
              media.some((m) => m.kind === 'after')
                ? t('provider.afterCaptured')
                : t('provider.addAfter')
            }
            variant={media.some((m) => m.kind === 'after') ? 'secondary' : 'accent'}
            onPress={() => addPhoto('after')}
          />
        </View>
      ) : null}

      {gaps.length > 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">{t('provider.stillNeeded')}</Text>
            {/* Named individually. "Add an after photo" and "something is
                wrong" are very different instructions at 11pm. */}
            {gaps.map((gap) => (
              <Text key={gap} variant="caption" style={{ color: theme.colors.warning }}>
                • {t(GAP_LABEL_KEY[gap])}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      <Button
        testID="save-evidence"
        label={t('common.save')}
        onPress={() => save.mutate()}
        disabled={gaps.length > 0 || mileageWarning === 'below_recorded'}
        loading={save.isPending}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
