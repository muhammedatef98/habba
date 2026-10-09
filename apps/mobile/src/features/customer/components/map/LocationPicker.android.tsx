/**
 * Screen 03's map on Android — `LocationPicker.tsx` (iOS, Apple Maps) drawn
 * by MapLibre over OpenStreetMap instead (see `open-map.ts`).
 *
 * Same contract and same controls: a fixed centre pin with the map moving
 * under it, back to my location, closer or further, a taller map. One
 * difference: no satellite view. OpenFreeMap has no imagery, and the free
 * imagery services forbid commercial apps, so the layers button is left out
 * rather than offered and broken.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type NativeSyntheticEvent } from 'react-native';
import * as Location from 'expo-location';
import {
  Camera,
  Map as MapLibreMap,
  NativeUserLocation,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Row, Text, useTheme, type IconName } from '@habba/ui';
import { locationProvider } from '@/features/shared/lib/location';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';
import type { LocationPickerProps } from './LocationPicker';
import { OPEN_MAP_STYLE, zoomForSpan } from './open-map';

/** Tight enough to place a car on a specific side of a road (LocationPicker.tsx's span). */
const ZOOM = zoomForSpan(0.004);
/** LocationPicker.tsx halves or doubles the span per press: one zoom level. */
const MIN_ZOOM = zoomForSpan(0.6);
const MAX_ZOOM = zoomForSpan(0.0006);

export function LocationPicker({
  initial,
  onSettled,
  focus,
  onLocated,
  height = 300,
  testID,
}: LocationPickerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const [tall, setTall] = useState(false);
  const [locating, setLocating] = useState(false);
  // The blue dot needs the location permission; asking is LocationPicker's
  // «موقعي» button's job, not the map's, so the dot appears once it is held.
  const [canShowMe, setCanShowMe] = useState(false);

  // The last view the map reported. A ref, not state: it fires while panning,
  // and re-rendering the map on every frame fights the gesture.
  const view = useRef({ center: [initial.lon, initial.lat] as [number, number], zoom: ZOOM });

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then(({ granted }) => setCanShowMe(granted));
  }, []);

  const handleChangeComplete = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center, zoom } = event.nativeEvent;
      view.current = { center, zoom };
      onSettled({ lat: center[1], lon: center[0] });
    },
    [onSettled],
  );

  const moveTo = useCallback((location: DeviceLocation, zoom = ZOOM) => {
    camera.current?.easeTo({ center: [location.lon, location.lat], zoom, duration: 350 });
  }, []);

  useEffect(() => {
    if (focus !== null && focus !== undefined) moveTo(focus.location);
  }, [focus, moveTo]);

  const zoom = (step: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.current.zoom + step));
    moveTo({ lon: view.current.center[0], lat: view.current.center[1] }, next);
  };

  const locateMe = async () => {
    setLocating(true);
    const result = await locationProvider.getCurrentLocation();
    setLocating(false);
    if (!result.ok) {
      onLocated?.(null);
      return;
    }
    setCanShowMe(true);
    moveTo(result.location);
    onLocated?.(result.accuracyMetres ?? null);
  };

  const mapHeight = tall ? Math.round(height * 1.7) : height;

  return (
    <View
      testID={testID}
      style={{
        height: mapHeight,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <MapLibreMap
        style={StyleSheet.absoluteFill}
        mapStyle={OPEN_MAP_STYLE}
        logo={false}
        compass
        onRegionDidChange={handleChangeComplete}
      >
        <Camera
          ref={camera}
          initialViewState={{ center: view.current.center, zoom: ZOOM }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        />
        {canShowMe ? <NativeUserLocation /> : null}
      </MapLibreMap>

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
        <View style={{ width: 2, height: 18, backgroundColor: theme.colors.accent }} />
      </View>

      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFill,
          { padding: theme.spacing.sm, justifyContent: 'space-between' },
        ]}
      >
        <Row justify="flex-end" align="flex-start">
          <MapButton
            testID="map-expand"
            icon={tall ? 'collapse' : 'expand'}
            label={tall ? t('emergency.shrinkMap') : t('emergency.expandMap')}
            onPress={() => setTall((value) => !value)}
          />
        </Row>
        <Row justify="space-between" align="flex-end">
          <View style={{ gap: theme.spacing.xs }}>
            <MapButton
              testID="map-zoom-in"
              icon="plus"
              label={t('emergency.zoomIn')}
              onPress={() => zoom(1)}
            />
            <MapButton
              testID="map-zoom-out"
              icon="minus"
              label={t('emergency.zoomOut')}
              onPress={() => zoom(-1)}
            />
          </View>
          <MapButton
            testID="map-locate-me"
            icon="locate"
            label={t('emergency.myLocation')}
            onPress={() => void locateMe()}
            busy={locating}
            showLabel
          />
        </Row>
      </View>
    </View>
  );
}

/** LocationPicker.tsx's button, kept here so the iOS file is untouched. */
function MapButton({
  icon,
  label,
  onPress,
  busy = false,
  showLabel = false,
  testID,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly showLabel?: boolean;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      onPress={onPress}
      disabled={busy}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: theme.minTouchTarget,
        height: theme.minTouchTarget,
        paddingHorizontal: showLabel ? theme.spacing.md : 0,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Row gap="xs">
        <Icon name={icon} size={theme.iconSize.sm} color={theme.colors.text} />
        {showLabel ? <Text variant="caption">{label}</Text> : null}
      </Row>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
