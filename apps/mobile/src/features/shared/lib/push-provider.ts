/**
 * Push registration, behind an interface.
 *
 * Same shape as `otp-provider.ts` and `location-provider.ts`: a real
 * implementation and a stub, chosen by configuration in `push.ts`. The stub is
 * what keeps the app runnable on a simulator and in CI, where a push token
 * cannot be obtained at all.
 *
 * ⚠️ Note what this interface does NOT do: send anything. The device's only job
 * is to hand the server a token. What is worth notifying, to whom, and for how
 * long it stays true is decided in Postgres (0065) and shipped by the
 * `push-tick` Edge Function — a client that could trigger a notification could
 * trigger one for anybody.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { PUSH_CHANNEL_DEFAULT, PUSH_CHANNEL_JOB_OFFERS } from '@habba/core';

export type PushPlatform = 'ios' | 'android';

export type PushRegistration =
  | { readonly ok: true; readonly token: string; readonly platform: PushPlatform }
  | {
      readonly ok: false;
      readonly reason:
        /** The person said no. Only Settings changes this. */
        | 'permission_denied'
        /** A simulator, Expo Go without a project id, or a build that cannot mint one. */
        | 'unavailable';
    };

export interface PushProvider {
  /**
   * Creates the Android notification channels.
   *
   * Must run before the first notification arrives, not before the first one is
   * tapped: on Android a channel that does not exist yet gets the system
   * default, and its importance is then fixed for the lifetime of the install —
   * re-creating it later does not raise it. A job offer that lands in a silent
   * channel on day one is silent forever.
   */
  configureChannels(): Promise<void>;
  register(): Promise<PushRegistration>;
}

/**
 * How a notification behaves while the app is open.
 *
 * Shown, not swallowed. The default is to suppress the banner when the app is
 * foregrounded, which is wrong here: a technician staring at their job list is
 * exactly the person who should see a new offer arrive, and they have no other
 * indication that the list changed underneath them.
 */
export const foregroundBehaviour: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

/**
 * The EAS project id, which `getExpoPushTokenAsync` requires in a bare build.
 *
 * Reading both spellings because Expo moved it: `expoConfig.extra.eas.projectId`
 * is the modern location and `easConfig.projectId` is where older builds carry
 * it. Returning null rather than throwing lets `register()` report `unavailable`
 * and the app carry on without notifications, which is the correct outcome on a
 * simulator.
 */
function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)
    ?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra !== '') return fromExtra;

  const fromEas = (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  if (typeof fromEas === 'string' && fromEas !== '') return fromEas;

  return null;
}

export class ExpoPushProvider implements PushProvider {
  async configureChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    // The one channel that has to survive Do Not Disturb. A person is waiting
    // at the roadside and the offer expires in 45 seconds; this is the only
    // notification in the app that earns that.
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_JOB_OFFERS, {
      name: 'طلبات العمل',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });

    // Everything else. Deliberately ordinary — sharing a channel with job
    // offers would force the technician to choose between missing work and
    // being woken by a receipt.
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_DEFAULT, {
      name: 'تحديثات الطلب',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  async register(): Promise<PushRegistration> {
    try {
      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted;

      // Only ask if we have not been answered. Re-requesting a denied
      // permission is a no-op on both platforms and iOS never shows the prompt
      // twice, so asking again just burns the one chance we get.
      if (!granted && existing.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted;
      }

      if (!granted) return { ok: false, reason: 'permission_denied' };

      const projectId = easProjectId();
      if (projectId === null) return { ok: false, reason: 'unavailable' };

      const token = await Notifications.getExpoPushTokenAsync({ projectId });

      return {
        ok: true,
        token: token.data,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      };
    } catch {
      // A simulator with no APNs entitlement, a device with no Play Services, a
      // network failure while minting the token. All of them mean the same
      // thing to the caller: no token this launch, try again next one.
      return { ok: false, reason: 'unavailable' };
    }
  }
}

/**
 * Development stub.
 *
 * Reports `unavailable` rather than inventing a token. A fake
 * `ExponentPushToken[dev]` would be accepted by `register_push_token` — it
 * matches the shape — and would then sit in the table failing on every batch,
 * which is precisely the "stored junk that looks real" failure that the
 * fabricated evidence photo was.
 */
export class DevPushProvider implements PushProvider {
  async configureChannels(): Promise<void> {
    /* no channels without a notification service */
  }

  async register(): Promise<PushRegistration> {
    return { ok: false, reason: 'unavailable' };
  }
}
