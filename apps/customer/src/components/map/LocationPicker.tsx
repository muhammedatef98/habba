/**
 * Screen 03's map — confirm where the vehicle actually is.
 *
 * The pin is fixed at the centre of the screen and the map moves underneath
 * it, which is the design's explicit choice: dragging a small pin accurately
 * with one thumb, at night, next to a broken-down car, is worse than moving
 * the whole field. The pin is therefore not a marker at all — it is a static
 * overlay, and the coordinate comes from wherever the map settles.
 *
 * Apple Maps on iOS rather than Google: MapKit needs no API key, and an
 * unconfigured key renders a grey grid with a watermark, which on this screen
 * would look exactly like a broken map at the moment the customer most needs
 * to trust it.
 */

import { useCallback, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useTranslation } from 'react-i18next';
import { Text, useTheme } from '@habba/ui';
import type { DeviceLocation } from '@/lib/location-provider';

/** Tight enough to place a car on a specific side of a road. */
const SPAN_DEGREES = 0.004;

export interface LocationPickerProps {
  readonly initial: DeviceLocation;
  readonly onSettled: (location: DeviceLocation) => void;
  readonly height?: number;
  readonly testID?: string | undefined;
}

export function LocationPicker({ initial, onSettled, height = 300, testID }: LocationPickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  // The last region the map reported. Kept in a ref rather than state: this
  // fires continuously while panning, and re-rendering the map on every frame
  // fights the gesture.
  const region = useRef<Region>({
    latitude: initial.lat,
    longitude: initial.lon,
    latitudeDelta: SPAN_DEGREES,
    longitudeDelta: SPAN_DEGREES,
  });

  const handleChangeComplete = useCallback(
    (next: Region) => {
      region.current = next;
      onSettled({ lat: next.latitude, lon: next.longitude });
    },
    [onSettled],
  );

  return (
    <View
      testID={testID}
      style={{
        height,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region.current}
        onRegionChangeComplete={handleChangeComplete}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        // This flow is dark, and a bright map inside it would be the one thing
        // on screen burning the user's eyes at night. Spread rather than passed
        // as undefined: the prop is not nullable under exactOptionalPropertyTypes.
        {...(Platform.OS === 'ios' ? { userInterfaceStyle: 'dark' as const } : {})}
      />

      {/* Centre pin. Rendered above the map and never moved: the map moves. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]}>
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderStrong,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            marginBottom: theme.spacing.sm,
          }}
        >
          <Text variant="caption">{t('emergency.dragToAdjust')}</Text>
        </View>

        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.accent,
            borderWidth: 4,
            borderColor: theme.colors.background,
          }}
        />
        {/* The stem, so the dot reads as pointing at a spot rather than
            floating above one. */}
        <View style={{ width: 2, height: 18, backgroundColor: theme.colors.accent }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
