/**
 * This phone, as somewhere Habba can reach (0066).
 *
 * Permission is asked for at a moment that explains itself, never at launch:
 * a customer right after sending a request ("tell me when a technician
 * accepts"), a technician when they go online ("tell me about new jobs").
 * Asked cold on first open, most people say no, and on iOS there is no second
 * chance to ask.
 *
 * Every failure is an answer, not an exception. A simulator, a denial, Expo Go
 * (which cannot receive pushes for this app) and a build with no EAS project
 * id all leave the app working exactly as it did before notifications — it
 * simply is not reachable while closed, and the technician's shift screen
 * says so.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { repository } from '@/features/shared/data/repository';

export type PushRegistration =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: 'not_a_device' | 'denied' | 'not_configured' | 'unavailable';
    };

/** Shown while the app is open, too: a job offer must not wait for the app to close. */
export function configureNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * The two Android channels the server addresses (packages/core push/expo.ts).
 * Separate so a person can silence maintenance reminders without silencing
 * the technician at their door.
 */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'الطلبات',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
  });
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'تذكيرات الصيانة',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * Registers this phone for the signed-in person.
 *
 * `prompt: false` only re-registers where permission was already given — the
 * launch-time refresh that picks up a rotated token or a language change
 * without ever showing a dialog.
 */
export async function registerThisDevice(options: {
  readonly prompt: boolean;
  readonly locale: string;
}): Promise<PushRegistration> {
  if (!Device.isDevice) return { ok: false, reason: 'not_a_device' };

  try {
    await ensureChannels();

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && options.prompt && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return { ok: false, reason: 'denied' };

    const projectId = easProjectId();
    if (projectId === undefined) return { ok: false, reason: 'not_configured' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await repository.registerPushDevice(
      token,
      Platform.OS === 'ios' ? 'ios' : 'android',
      options.locale,
    );
    return { ok: true, token };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Sign-out: this phone stops receiving this person's notifications. Must run
 * while the session is still valid — the server only lets you remove your own.
 * Never blocks sign-out: failing here costs a stray notification, not the
 * ability to leave.
 */
export async function unregisterThisDevice(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const permission = await Notifications.getPermissionsAsync();
    const projectId = easProjectId();
    if (!permission.granted || projectId === undefined) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await repository.unregisterPushDevice(token);
  } catch {
    // See above: sign-out proceeds regardless.
  }
}
