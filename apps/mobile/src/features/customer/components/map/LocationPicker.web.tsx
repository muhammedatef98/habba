/**
 * The location picker, minus the map, for the browser preview.
 *
 * ⚠️ `react-native-maps` has no web implementation. It reaches for
 * `codegenNativeComponent`, which does not exist off-device, and the module
 * throws at IMPORT time — so the whole emergency flow died with
 * "codegenNativeComponent is not a function" the moment the location step
 * mounted. Not a broken screen: a blank app and a console error.
 *
 * Metro resolves `.web.tsx` ahead of `.tsx` for the web platform, so this file
 * is the whole fix and the native picker is untouched. iOS and Android are the
 * product (§3); this exists so the preview can walk the flow end to end.
 *
 * It reports the coordinate it was given and says, plainly, that the map is
 * not part of the preview. It does NOT draw a fake map: a grey rectangle with
 * a pin on it, on the screen where somebody confirms where their broken-down
 * car is, would be the preview lying about the one thing that screen exists to
 * get right.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Text, useTheme } from '@habba/ui';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';

export interface LocationPickerProps {
  readonly initial: DeviceLocation;
  readonly onSettled: (location: DeviceLocation) => void;
  readonly height?: number;
  readonly testID?: string | undefined;
}

export function LocationPicker({ initial, onSettled, height = 300, testID }: LocationPickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  // The native picker reports wherever the map settles. With no map to move,
  // the device's own fix is the answer — reported once, so the step behaves
  // like a confirmed location rather than an empty one.
  //
  // Guarded by a ref rather than an empty dependency array: `onSettled` is an
  // inline closure on the screen above, so it is a new function every render,
  // and a naive effect would report the same coordinate on a loop.
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onSettled(initial);
  }, [initial, onSettled]);

  return (
    <View
      testID={testID}
      style={{
        height,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.base,
      }}
    >
      <Icon name="locate" size={theme.iconSize.xl} color={theme.colors.textSubtle} />
      <Text variant="bodySmall" tone="muted" align="center">
        {t('emergency.mapUnavailableWeb')}
      </Text>
      <Text variant="caption" tone="subtle" numeric>
        {initial.lat.toFixed(5)}, {initial.lon.toFixed(5)}
      </Text>
    </View>
  );
}
