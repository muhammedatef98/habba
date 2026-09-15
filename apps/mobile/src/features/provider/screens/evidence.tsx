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
  type CompletionMediaKind,
  type EvidenceGap,
} from '@habba/core';
import { Button, Card, Field, Screen, Text, useTheme } from '@habba/ui';
import { EvidenceCamera } from '@/features/provider/components/EvidenceCamera';
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

  /** Which photo the camera is open for, if any. */
  const [capturing, setCapturing] = useState<CompletionMediaKind | null>(null);
  /** Which photo is in flight, so the button can say so and cannot be re-tapped. */
  const [uploading, setUploading] = useState<CompletionMediaKind | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);

  const save = useMutation({
    mutationFn: () => providerRepository.recordEvidence(id ?? '', Number(mileageText), media),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      router.back();
    },
  });

  const data = job.data;
  if (data === null || data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {job.isLoading ? t('common.loading') : t('errors.notFound')}
        </Text>
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
   * ⚠️ The photo is added to `media` ONLY after the upload returns a path.
   *
   * This used to fabricate `habba://captured/<kind>/<timestamp>` and add it
   * immediately. Everything downstream then agreed the evidence existed: the
   * gap list cleared, `assert_completion_evidence` counted one before and one
   * after, the job was handed back, and the timeline took a hash-chained
   * attachment pointing at a file that had never been written. The chain
   * verified perfectly over nothing, which is the one outcome §2.4 exists to
   * prevent — and the resale report is built on those attachments.
   *
   * So a failed upload leaves the gap open and says so. A technician told to
   * retake the photo is a minor annoyance; a logbook full of dead references is
   * the moat quietly emptying.
   */
  const orderId = data.orderId;

  async function attachPhoto(kind: CompletionMediaKind, uri: string) {
    setCapturing(null);
    setUploading(kind);
    setUploadFailed(false);

    const path = await providerRepository.uploadCompletionPhoto(orderId, kind, uri);

    setUploading(null);
    if (path === null) {
      setUploadFailed(true);
      return;
    }

    setMedia((current) => [...current.filter((item) => item.kind !== kind), { url: path, kind }]);
  }

  if (capturing !== null) {
    return (
      <EvidenceCamera
        kind={capturing}
        onCaptured={(uri) => void attachPhoto(capturing, uri)}
        onCancel={() => setCapturing(null)}
      />
    );
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
            loading={uploading === 'before'}
            disabled={uploading !== null}
            onPress={() => setCapturing('before')}
          />
          <Button
            testID="add-after"
            label={
              media.some((m) => m.kind === 'after')
                ? t('provider.afterCaptured')
                : t('provider.addAfter')
            }
            variant={media.some((m) => m.kind === 'after') ? 'secondary' : 'accent'}
            loading={uploading === 'after'}
            disabled={uploading !== null}
            onPress={() => setCapturing('after')}
          />

          {/* Said plainly, because the old behaviour was to say nothing and
              carry on as though the photo had been taken. */}
          {uploadFailed ? (
            <Text testID="upload-failed" variant="caption" tone="emergency">
              {t('provider.uploadFailed')}
            </Text>
          ) : null}
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
        // Saving mid-upload would record the media list as it stands, which is
        // the list without the photo currently in flight.
        disabled={gaps.length > 0 || mileageWarning === 'below_recorded' || uploading !== null}
        loading={save.isPending}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
