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

import { useEffect, useState } from 'react';
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
import { BackBar } from '@/features/shared/components/BackBar';
import {
  emptyDraft,
  pendingUploads,
  withPhoto,
  withUpload,
  type EvidenceDraft,
} from '@/features/provider/lib/evidence-draft';
import {
  keepPhoto,
  loadDraft,
  saveDraft,
  syncEvidenceNow,
} from '@/features/provider/lib/evidence-queue';

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
  const [warrantyDays, setWarrantyDays] = useState<number>(WARRANTY_OPTIONS[0] ?? 30);
  const [photoError, setPhotoError] = useState<string | undefined>(undefined);
  const [queuedNotice, setQueuedNotice] = useState(false);

  /**
   * The draft on the phone (ADR-0012). Photos are kept here first and
   * uploaded second, so a basement with no signal costs the technician a
   * wait, never the photos. Read back on open: whatever was captured before
   * the app was closed is still here.
   */
  const [draft, setDraft] = useState<EvidenceDraft | null>(null);
  const stored = useQuery({
    queryKey: ['evidence-draft', id],
    queryFn: () => loadDraft(id ?? ''),
    enabled: id !== undefined,
  });
  useEffect(() => {
    if (draft !== null || stored.isPending || id === undefined) return;
    const found = stored.data ?? null;
    if (found !== null) {
      setDraft(found);
      if (found.mileage !== null) setMileageText(String(found.mileage));
      setWarrantyDays(found.warrantyDays);
    } else {
      setDraft(emptyDraft(id, WARRANTY_OPTIONS[0] ?? 30, new Date()));
    }
  }, [draft, stored.isPending, stored.data, id]);

  const persist = async (next: EvidenceDraft) => {
    setDraft(next);
    await saveDraft(next);
  };

  /**
   * The camera, then the phone, then — if there is signal — the upload.
   *
   * Camera only — no gallery. A before photo chosen from the gallery could be
   * any car on any day, and the whole value of the photo is that it was taken
   * here, now. An upload that fails for want of signal is not an error: the
   * photo is safe on the phone and goes up on its own later.
   */
  const capture = useMutation({
    mutationFn: async (kind: PhotoKind) => {
      if (draft === null) return null;
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error(CAMERA_DENIED);

      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        exif: false,
      });
      const asset = shot.canceled ? undefined : shot.assets[0];
      if (asset === undefined) return null;

      const kept = await keepPhoto(draft.orderId, kind, asset.uri);
      let next = withPhoto(draft, kind, kept, new Date());
      await persist(next);
      try {
        const item = await providerRepository.uploadEvidencePhoto(draft.orderId, kind, kept);
        next = withUpload(next, kept, item, new Date());
        await persist(next);
      } catch {
        // Kept on the phone; EvidenceSync uploads it when the signal is back.
      }
      return next;
    },
    onMutate: () => setPhotoError(undefined),
    onError: (cause: unknown) => {
      setPhotoError(
        cause instanceof Error && cause.message === CAMERA_DENIED
          ? t('provider.cameraDenied')
          : t('provider.photoUploadFailed'),
      );
    },
  });

  /**
   * Saving marks the draft as wanted and tries to send it now. If it went,
   * back to the job; if the phone is offline, it stays queued and the job
   * screen says so — the technician can drive off.
   */
  const save = useMutation({
    // Its failure is shown in place, not as a toast.
    meta: { inlineError: true },
    mutationFn: async () => {
      if (draft === null) return 'queued' as const;
      const ready: EvidenceDraft = {
        ...draft,
        mileage: mileageText.length === 0 ? null : Number(mileageText),
        warrantyDays,
        submitRequested: true,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      await persist(ready);
      const result = await syncEvidenceNow();
      if (result.recorded.includes(ready.orderId)) return 'sent' as const;
      if (result.refused.some((entry) => entry.orderId === ready.orderId)) {
        throw new Error('refused');
      }
      return 'queued' as const;
    },
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: ['evidence-draft', id] });
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      if (outcome === 'sent') router.back();
      else setQueuedNotice(true);
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

  // A photo counts once it is on the phone; going up is the queue's job.
  const media: readonly CompletionMediaItem[] = (draft?.photos ?? []).map((photo) => ({
    kind: photo.kind,
    url: photo.localUri,
  }));
  const waitingUploads = draft === null ? 0 : pendingUploads(draft).length;

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
      <BackBar />
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
            const photo = draft?.photos.find((entry) => entry.kind === kind);
            const captured = photo !== undefined;

            return (
              <Row key={kind} gap="md">
                {photo !== undefined ? (
                  <Image
                    testID={`preview-${kind}`}
                    source={{ uri: photo.localUri }}
                    accessibilityLabel={t(PHOTO_LABELS[kind].captured)}
                    style={{ width: 56, height: 56, borderRadius: theme.radius.md }}
                  />
                ) : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <Button
                    testID={`add-${kind}`}
                    label={captured ? t(PHOTO_LABELS[kind].captured) : t(PHOTO_LABELS[kind].add)}
                    variant={captured ? 'secondary' : 'accent'}
                    onPress={() => capture.mutate(kind)}
                    loading={capturingKind === kind}
                    disabled={draft === null || (capture.isPending && capturingKind !== kind)}
                  />
                  {photo !== undefined ? (
                    <Text
                      testID={`photo-state-${kind}`}
                      variant="caption"
                      tone={photo.uploaded !== null ? 'success' : 'warning'}
                    >
                      {photo.uploaded !== null
                        ? t('provider.photoUploaded')
                        : t('provider.photoQueued')}
                    </Text>
                  ) : null}
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
          {t('provider.evidenceRefused')}
        </Text>
      ) : null}

      {queuedNotice ? (
        <Card
          testID="evidence-queued"
          elevation="none"
          style={{ backgroundColor: theme.colors.warningSubtle, gap: theme.spacing.xs }}
        >
          <Text variant="bodyStrong">{t('provider.evidenceQueuedTitle')}</Text>
          <Text variant="caption" tone="muted">
            {t('provider.evidenceQueuedBody', { count: waitingUploads })}
          </Text>
        </Card>
      ) : null}

      <Button
        testID="save-evidence"
        label={t('common.save')}
        onPress={() => save.mutate()}
        disabled={
          draft === null ||
          gaps.length > 0 ||
          mileageWarning === 'below_recorded' ||
          capture.isPending
        }
        loading={save.isPending}
      />

      <Button
        label={queuedNotice ? t('common.back') : t('common.cancel')}
        variant="ghost"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
