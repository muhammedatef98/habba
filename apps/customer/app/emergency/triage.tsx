/**
 * Screen 04 — optional 20-second video triage.
 *
 * §1's third differentiator: a provider who has seen and heard the problem can
 * quote and bring the right part before driving out, which kills the false
 * dispatch that is the main cost in this business. Audio is recorded too and
 * that is not incidental — a lot of faults are identified by sound.
 *
 * The order has already been submitted by this point and matching is running,
 * which is what makes the step genuinely skippable. The screen says so, so the
 * customer never believes they are holding up their own rescue.
 *
 * Skip is given the same visual weight as record. §9.1 is explicit that this is
 * optional, and an optional step whose decline is a faint link is not optional
 * in practice.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import { useEmergencyDraft } from '@/state/emergency-draft';

/** §9.1. Long enough to show a fault, short enough that nobody narrates. */
const MAX_SECONDS = 20;

export default function VideoTriageScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const clip = useEmergencyDraft((state) => state.clip);
  const setClip = useEmergencyDraft((state) => state.setClip);

  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);

  const granted = cameraPermission?.granted === true && micPermission?.granted === true;

  // Drives the progress bar. Counting locally rather than asking the recorder
  // keeps the bar smooth; `maxDuration` is what actually stops the capture, so
  // the two cannot drift into a bar that fills after recording has ended.
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [recording]);

  const [uploading, setUploading] = useState(false);

  const goToTracking = useCallback(
    () => router.replace({ pathname: '/tracking', params: { id: id ?? '' } }),
    [id],
  );

  /**
   * Upload, then move on either way.
   *
   * A failed upload does not block: the technician is already being matched,
   * and holding the customer on a camera screen because a roadside connection
   * dropped would invert the whole point of the step being optional. The clip
   * is cleared regardless so it cannot leak into a later, unrelated order.
   */
  const useClip = useCallback(async () => {
    if (clip === null || id === undefined) {
      goToTracking();
      return;
    }
    setUploading(true);
    await repository.attachTriageClip(id, clip);
    setClip(null);
    setUploading(false);
    goToTracking();
  }, [clip, id, goToTracking, setClip]);

  const record = useCallback(async () => {
    if (camera.current === null) return;
    setFailed(false);
    setElapsed(0);
    setRecording(true);
    try {
      const video = await camera.current.recordAsync({ maxDuration: MAX_SECONDS });
      if (video !== undefined) {
        setClip({ uri: video.uri, seconds: Math.min(MAX_SECONDS, Math.round(elapsed)) });
      }
    } catch {
      // A failed recording must not strand the customer on this screen — the
      // whole point is that it is optional.
      setFailed(true);
    } finally {
      setRecording(false);
    }
  }, [elapsed, setClip]);

  const stop = useCallback(() => {
    camera.current?.stopRecording();
  }, []);

  return (
    <Screen scrollable>
      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{t('emergency.triageTitle')}</Text>
          <Text variant="bodySmall" tone="muted">
            {t('emergency.triageBody')}
          </Text>
        </View>
      </Card>

      <View
        style={{
          flex: 1,
          minHeight: 280,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceSunken,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        {granted ? (
          <CameraView ref={camera} style={{ flex: 1 }} mode="video" facing="back" />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.lg,
            }}
          >
            <Text variant="bodySmall" tone="muted" align="center">
              {t('emergency.triagePermission')}
            </Text>
            <Button
              testID="triage-allow"
              label={t('emergency.triageAllow')}
              variant="secondary"
              size="medium"
              fullWidth={false}
              onPress={() => {
                void requestCamera();
                void requestMic();
              }}
            />
          </View>
        )}
      </View>

      {recording ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              height: 5,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.surfaceSunken,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%`,
                height: '100%',
                backgroundColor: theme.colors.accent,
              }}
            />
          </View>
          <Text variant="caption" tone="accent" numeric align="center">
            {`${elapsed.toFixed(1)} / ${MAX_SECONDS}`}
          </Text>
        </View>
      ) : null}

      {clip !== null && !recording ? (
        <Text variant="caption" tone="success" align="center">
          {t('emergency.triageRecorded', { seconds: clip.seconds })}
        </Text>
      ) : null}

      {failed ? (
        <Text variant="caption" tone="emergency" align="center">
          {t('emergency.triageFailed')}
        </Text>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        {granted ? (
          <Button
            testID="triage-record"
            label={
              recording
                ? t('emergency.triageStop')
                : clip !== null
                  ? t('emergency.triageRetake')
                  : t('emergency.triageRecord')
            }
            variant={recording ? 'emergency' : 'primary'}
            onPress={() => {
              if (recording) stop();
              else void record();
            }}
          />
        ) : null}

        <Button
          testID="emergency-triage-skip"
          label={clip !== null ? t('emergency.triageUse') : t('emergency.triageSkip')}
          variant="secondary"
          loading={uploading}
          onPress={() => {
            if (clip === null) goToTracking();
            else void useClip();
          }}
        />
      </View>
    </Screen>
  );
}
