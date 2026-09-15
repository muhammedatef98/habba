/**
 * The app's push provider instance.
 *
 * The routing half lives in `push-routing.ts`, which imports nothing — see the
 * note there. This file exists only to choose an implementation, the same shape
 * as `location.ts` and `otp.ts`.
 */

import Constants from 'expo-constants';
import { DevPushProvider, ExpoPushProvider, type PushProvider } from './push-provider.js';

/**
 * Expo Go cannot mint a push token for a bare-workflow app, and the failure
 * looks like a denied permission — which would send every developer to the
 * wrong place. The stub is the honest answer there, exactly as in `location.ts`.
 */
const canUseDevicePush = Constants.appOwnership !== 'expo';

export const pushProvider: PushProvider = canUseDevicePush
  ? new ExpoPushProvider()
  : new DevPushProvider();
