/**
 * Screen 07's map on Android — the same two dots as `RouteMap.tsx` (iOS,
 * Apple Maps), drawn by MapLibre over OpenStreetMap (see `open-map.ts`).
 *
 * Still no route line, for the reason RouteMap.tsx gives: a straight line is
 * not the road the technician is on.
 */

import { View } from 'react-native';
import { Camera, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';
import { useTheme } from '@habba/ui';
import type { RouteMapProps } from './RouteMap';
import { OPEN_MAP_STYLE, zoomForSpan } from './open-map';

/** Wide enough to hold both points with room around them; RouteMap.tsx's span. */
const ZOOM = zoomForSpan(0.02);

export function RouteMap({ customer, provider, height = 260, testID }: RouteMapProps) {
  const theme = useTheme();

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
      <MapLibreMap style={{ flex: 1 }} mapStyle={OPEN_MAP_STYLE} logo={false} compass={false}>
        <Camera initialViewState={{ center: [customer.lon, customer.lat], zoom: ZOOM }} />

        <Marker lngLat={[customer.lon, customer.lat]}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.info,
              borderWidth: 3,
              borderColor: theme.colors.background,
            }}
          />
        </Marker>

        {provider !== undefined ? (
          <Marker lngLat={[provider.lon, provider.lat]}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.accent,
                borderWidth: 3,
                borderColor: theme.colors.background,
              }}
            />
          </Marker>
        ) : null}
      </MapLibreMap>
    </View>
  );
}
