/**
 * Screen 07's map — where the technician is, relative to you.
 *
 * §8 calls live tracking the emotional core of the product, and the map is the
 * part people stare at. It shows two things and no more: the customer's
 * location and the provider's.
 *
 * There is deliberately no route line. Drawing one needs a routing provider,
 * and a straight line between the two points is not the road the technician is
 * on — it would imply a path they are not taking and a distance that is not
 * the one they are driving. The ETA already carries that estimate honestly
 * (server-side, with a detour factor); a fake polyline would dress a guess up
 * as knowledge.
 *
 * The provider marker only appears when the server has a fresh fix. A stale
 * position frozen on a map reads as a technician who has stopped moving.
 */

import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Platform } from 'react-native';
import { useTheme } from '@habba/ui';
import type { DeviceLocation } from '@/lib/location-provider';

export interface RouteMapProps {
  readonly customer: DeviceLocation;
  readonly provider?: DeviceLocation | undefined;
  readonly height?: number;
  readonly testID?: string | undefined;
}

/** Wide enough to hold both points with room around them. */
const SPAN_DEGREES = 0.02;

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
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: customer.lat,
          longitude: customer.lon,
          latitudeDelta: SPAN_DEGREES,
          longitudeDelta: SPAN_DEGREES,
        }}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        {...(Platform.OS === 'ios' ? { userInterfaceStyle: 'dark' as const } : {})}
      >
        <Marker coordinate={{ latitude: customer.lat, longitude: customer.lon }}>
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
          <Marker coordinate={{ latitude: provider.lat, longitude: provider.lon }}>
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
      </MapView>
    </View>
  );
}
