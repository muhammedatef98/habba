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
import { Image, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  checkMileage,
  missingEvidence,
  type CompletionMediaItem,
  type EvidenceGap,
} from '@habba/core';
import { Button, Card, Field, Row, Screen, Text, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { formatCount } from '@/features/shared/lib/format-number';

const GAP_LABEL_KEY: Record<EvidenceGap, string> = {
  mileage: 'provider.gapMileage',
  before_photo: 'provider.gapBefore',
  after_photo: 'provider.gapAfter',
};

type PhotoKind = 'before' | 'after';

const PHOTO_KINDS: readonly PhotoKind[] = ['before', 'after'];

const PHOTO_LABELS: Record<PhotoKind, { add: string; captured: string }> = {
  before: { add: 'provider.addBefore', captured: 'provider.beforeCaptured' },
  after: { add: 'provider.addAfter', captured: 'provider.afterCaptured' },
};

const CAMERA_DENIED = 'camera_denied';

/**
 * The warranty periods a technician can give. No "none": §1 promises every
 * job carries a warranty, and a zero on the list would become the default
 * the moment someone is in a hurry. How long is theirs to choose.
 */
const WARRANTY_OPTIONS: readonly number[] = [30, 90, 180];

export default function EvidenceScreen() {
  const { t, i18n } = useTranslation();
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

  const [previews, setPreviews] = useState<Partial<Record<PhotoKind, string>>>({});
  const [warrantyDays, setWarrantyDays] = useState<number>(WARRANTY_OPTIONS[0] ?? 30);
  const [photoError, setPhotoError] = useState<string | undefined>(undefined);

  /**
   * The camera, then the upload, as one step.
   *
   * Camera only — no gallery. A before photo chosen from the gallery could be
   * any car on any day, and the whole value of the photo is that it was taken
   * here, now. Upload happens immediately rather than on save, so a failure is
   * reported beside the photo that failed, while the technician is still
   * beside the car and can take it again.
   */
  const capture = useMutation({
    mutationFn: async (kind: PhotoKind) => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error(CAMERA_DENIED);

      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        exif: false,
      });
      const asset = shot.canceled ? undefined : shot.assets[0];
      if (asset === undefined) return null;

      const item = await providerRepository.uploadEvidencePhoto(id ?? '', kind, asset.uri);
      return { kind, item, preview: asset.uri };
    },
    onMutate: () => setPhotoError(undefined),
    onSuccess: (result) => {
      if (result === null) return;
      setMedia((current) => [...current.filter((m) => m.kind !== result.kind), result.item]);
      setPreviews((current) => ({ ...current, [result.kind]: result.preview }));
    },
    onError: (cause: unknown) => {
      setPhotoError(
        cause instanceof Error && cause.message === CAMERA_DENIED
          ? t('provider.cameraDenied')
          : t('provider.photoUploadFailed'),
      );
    },
  });

  const save = useMutation({
    // Its failure is shown in place, not as a toast.

    meta: { inlineError: true },
    mutationFn: () =>
      providerRepository.recordEvidence(id ?? '', Number(mileageText), media, warrantyDays),
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

  const capturingKind = capture.isPending ? capture.variables : undefined;

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
              : t('provider.mileageLastKnown', {
                  km: formatCount(data.vehicleCurrentMileage, i18n.language),
                })
          }
          error={
            mileageWarning === 'below_recorded'
              ? t('provider.mileageBelowRecorded', {
                  km: formatCount(data.vehicleCurrentMileage ?? 0, i18n.language),
                })
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

          {PHOTO_KINDS.map((kind) => {
            const captured = media.some((m) => m.kind === kind);
            const preview = previews[kind];

            return (
              <Row key={kind} gap="md">
                {preview !== undefined ? (
                  <Image
                    testID={`preview-${kind}`}
                    source={{ uri: preview }}
                    accessibilityLabel={t(PHOTO_LABELS[kind].captured)}
                    style={{ width: 56, height: 56, borderRadius: theme.radius.md }}
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Button
                    testID={`add-${kind}`}
                    label={captured ? t(PHOTO_LABELS[kind].captured) : t(PHOTO_LABELS[kind].add)}
                    variant={captured ? 'secondary' : 'accent'}
                    onPress={() => capture.mutate(kind)}
                    loading={capturingKind === kind}
                    disabled={capture.isPending && capturingKind !== kind}
                  />
                </View>
              </Row>
            );
          })}

          {photoError !== undefined ? (
            <Text testID="photo-error" variant="caption" tone="emergency">
              {photoError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('provider.warrantyLabel')}
        </Text>
        <Row gap="sm">
          {WARRANTY_OPTIONS.map((days) => {
            const selected = warrantyDays === days;
            return (
              <Card
                selected={selected}
                key={days}
                testID={`warranty-${days}`}
                elevation="none"
                onPress={() => setWarrantyDays(days)}
                accessibilityLabel={t('provider.warrantyDays', { count: days })}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  minHeight: theme.minTouchTarget,
                  justifyContent: 'center',
                  backgroundColor: selected
                    ? theme.colors.primarySubtle
                    : theme.colors.surfaceSunken,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  borderWidth: selected ? 1.5 : 1,
                }}
              >
                <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'} numeric>
                  {t('provider.warrantyDays', { count: days })}
                </Text>
              </Card>
            );
          })}
        </Row>
        <Text variant="caption" tone="subtle">
          {t('provider.warrantyHint')}
        </Text>
      </View>

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

      {save.isError ? (
        <Text testID="save-error" variant="caption" tone="emergency">
          {t('provider.evidenceSaveFailed')}
        </Text>
      ) : null}

      <Button
        testID="save-evidence"
        label={t('common.save')}
        onPress={() => save.mutate()}
        disabled={gaps.length > 0 || mileageWarning === 'below_recorded' || capture.isPending}
        loading={save.isPending}
      />

      <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
