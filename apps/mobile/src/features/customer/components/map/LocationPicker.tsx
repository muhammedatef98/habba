/**
 * Screen 03's map — confirm where the vehicle actually is.
 *
 * The pin is fixed at the centre of the screen and the map moves underneath
 * it, which is the design's explicit choice: dragging a small pin accurately
 * with one thumb, at night, next to a broken-down car, is worse than moving
 * the whole field. The pin is therefore not a marker at all — it is a static
 * overlay, and the coordinate comes from wherever the map settles.
 *
 * Around it, the controls a customer reaches for when the first guess is
 * wrong: back to where the phone says I am, closer or further, a satellite
 * view (a car park or a desert road is easier to recognise from above than
 * as a grey block), and a taller map when the spot needs care.
 *
 * Apple Maps on iOS rather than Google: MapKit needs no API key, and an
 * unconfigured key renders a grey grid with a watermark, which on this screen
 * would look exactly like a broken map at the moment the customer most needs
 * to trust it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useTranslation } from 'react-i18next';
import { Icon, Row, Text, useTheme, type IconName } from '@habba/ui';
import { locationProvider } from '@/features/shared/lib/location';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';

/** Tight enough to place a car on a specific side of a road. */
const SPAN_DEGREES = 0.004;
/** Each zoom press halves or doubles the span. */
const ZOOM_STEP = 2;
const MIN_SPAN = 0.0006;
const MAX_SPAN = 0.6;

export interface MapFocus {
  readonly location: DeviceLocation;
  /** Changes on every request, so asking for the same spot twice still moves. */
  readonly nonce: number;
}

export interface LocationPickerProps {
  readonly initial: DeviceLocation;
  readonly onSettled: (location: DeviceLocation) => void;
  /** Move the map here (a search result, a saved place). */
  readonly focus?: MapFocus | null | undefined;
  /** The phone's own fix, with how far off it may be, after «موقعي». */
  readonly onLocated?: ((accuracyMetres: number | null) => void) | undefined;
  readonly height?: number;
  readonly testID?: string | undefined;
}

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
  const map = useRef<MapView>(null);
  const [satellite, setSatellite] = useState(false);
  const [tall, setTall] = useState(false);
  const [locating, setLocating] = useState(false);

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

  const moveTo = useCallback((location: DeviceLocation, span = SPAN_DEGREES) => {
    map.current?.animateToRegion(
      {
        latitude: location.lat,
        longitude: location.lon,
        latitudeDelta: span,
        longitudeDelta: span,
      },
      350,
    );
  }, []);

  useEffect(() => {
    if (focus !== null && focus !== undefined) moveTo(focus.location);
  }, [focus, moveTo]);

  const zoom = (factor: number) => {
    const current = region.current;
    const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, current.latitudeDelta * factor));
    moveTo({ lat: current.latitude, lon: current.longitude }, span);
  };

  const locateMe = async () => {
    setLocating(true);
    const result = await locationProvider.getCurrentLocation();
    setLocating(false);
    if (!result.ok) {
      onLocated?.(null);
      return;
    }
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
      <MapView
        ref={map}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region.current}
        onRegionChangeComplete={handleChangeComplete}
        mapType={satellite ? 'hybrid' : 'standard'}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
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

      {/* Controls. A row laid out by reading direction rather than absolute
          left/right, so they sit on the same side of the thumb in Arabic and
          English whatever the platform's own idea of direction is. */}
      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFill,
          { padding: theme.spacing.sm, justifyContent: 'space-between' },
        ]}
      >
        <Row justify="space-between" align="flex-start">
          <MapButton
            testID="map-layers"
            icon="layers"
            label={satellite ? t('emergency.mapStandard') : t('emergency.mapSatellite')}
            onPress={() => setSatellite((value) => !value)}
            active={satellite}
          />
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
              onPress={() => zoom(1 / ZOOM_STEP)}
            />
            <MapButton
              testID="map-zoom-out"
              icon="minus"
              label={t('emergency.zoomOut')}
              onPress={() => zoom(ZOOM_STEP)}
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

function MapButton({
  icon,
  label,
  onPress,
  active = false,
  busy = false,
  showLabel = false,
  testID,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly active?: boolean;
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
      accessibilityState={{ selected: active, busy }}
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
        backgroundColor: active ? theme.colors.primary : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Row gap="xs">
        <Icon
          name={icon}
          size={theme.iconSize.sm}
          color={active ? theme.colors.textInverse : theme.colors.text}
        />
        {showLabel ? <Text variant="caption">{label}</Text> : null}
      </Row>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
