/**
 * The app's location provider instance.
 *
 * Real GPS in a build that can ask for it; the fixed stub otherwise, so the
 * emergency flow stays exercisable on a simulator with no location set — which
 * is where most of it gets tested.
 */

import Constants from 'expo-constants';
import {
  DevLocationProvider,
  ExpoLocationProvider,
  type LocationProvider,
} from './location-provider.js';

/**
 * Expo Go cannot request location permissions for a bare-workflow app, and a
 * failed request there looks identical to a denial — which would send every
 * developer down the wrong path. The stub is the honest answer in that case.
 */
const canUseDeviceLocation = Constants.appOwnership !== 'expo';

export const locationProvider: LocationProvider = canUseDeviceLocation
  ? new ExpoLocationProvider()
  : new DevLocationProvider();
