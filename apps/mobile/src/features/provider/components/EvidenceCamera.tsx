/**
 * The camera for a before/after evidence photo.
 *
 * ⚠️ It is a camera, not a picker, and that is a deliberate refusal rather than
 * an omission. `expo-image-picker` would let a technician attach any photo on
 * the phone — last week's job, a stock image of a clean engine bay — to a
 * hash-chained timeline attachment that the resale report then presents as
 * documentation of THIS car. Evidence that can be selected from a library is
 * not evidence. Making them point the lens at the car is most of the property.
 *
 * Nothing stronger than that is claimed. A technician determined to defeat this
 * can photograph another car, and no client-side control fixes that; what this
 * removes is the effortless path, which is the one that gets taken.
 *
 * `expo-camera` is already a dependency — the customer's video triage uses it —
 * so this adds no native module.
 */

import { useRef, useState } from 'react';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import type { CompletionMediaKind } from '@habba/core';
import { Button, Screen, Text, useTheme } from '@habba/ui';

interface EvidenceCameraProps {
  readonly kind: CompletionMediaKind;
  readonly onCaptured: (uri: string) => void;
  readonly onCancel: () => void;
}

export function EvidenceCamera({ kind, onCaptured, onCancel }: EvidenceCameraProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const granted = permission?.granted === true;

  async function capture() {
    if (camera.current === null) return;
    setBusy(true);
    setFailed(false);
    try {
      // Compressed hard on purpose. This uploads over whatever connection
      // exists at the roadside, and a 12-megapixel original is several seconds
      // of a technician standing still for no gain — the photo has to show
      // which car and what was done, not read a part number off a casting.
      const photo = await camera.current.takePictureAsync({ quality: 0.5 });
      if (photo === undefined) {
        setFailed(true);
        return;
      }
      onCaptured(photo.uri);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">
          {t(kind === 'before' ? 'provider.captureBefore' : 'provider.captureAfter')}
        </Text>
        <Text variant="bodySmall" tone="muted">
          {t('provider.captureHint')}
        </Text>
      </View>

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
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
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
              {t('provider.cameraPermission')}
            </Text>
            <Button
              testID="evidence-camera-allow"
              label={t('provider.cameraAllow')}
              variant="secondary"
              size="medium"
              fullWidth={false}
              onPress={() => void requestPermission()}
            />
          </View>
        )}
      </View>

      {failed ? (
        <Text variant="caption" tone="emergency" align="center">
          {t('provider.captureFailed')}
        </Text>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        {granted ? (
          <Button
            testID="evidence-shutter"
            label={t('provider.capture')}
            loading={busy}
            onPress={() => void capture()}
          />
        ) : null}

        <Button
          testID="evidence-camera-cancel"
          label={t('common.cancel')}
          variant="ghost"
          onPress={onCancel}
        />
      </View>
    </Screen>
  );
}
