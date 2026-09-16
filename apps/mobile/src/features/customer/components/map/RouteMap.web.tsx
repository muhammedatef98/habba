/**
 * The tracking map, minus the map, for the browser preview.
 *
 * Same reason as `LocationPicker.web.tsx`: `react-native-maps` throws at
 * import time off-device, so the live-tracking screen could not mount at all
 * in the preview. Metro picks this file for web and leaves the native one
 * alone.
 *
 * No fake route line and no invented distance. The screen around this already
 * shows the ETA and the distance the SERVER computed (`order_live_progress`,
 * 0040) — the map is the illustration, and an illustration that draws a
 * straight line between two points a technician is not driving is worse than
 * an honest gap.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Text, useTheme } from '@habba/ui';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';

export interface RouteMapProps {
  readonly customer: DeviceLocation;
  readonly provider?: DeviceLocation | undefined;
  readonly height?: number;
  readonly testID?: string | undefined;
}

export function RouteMap({ height = 260, testID }: RouteMapProps) {
  const { t } = useTranslation();
  const theme = useTheme();

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
      }}
    >
      <Icon name="locate" size={theme.iconSize.xl} color={theme.colors.textSubtle} />
      <Text variant="bodySmall" tone="muted" align="center">
        {t('emergency.mapUnavailableWeb')}
      </Text>
    </View>
  );
}
