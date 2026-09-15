/**
 * Registers this device for push, and routes a tapped notification.
 *
 * Mounted once, in the root layout, because both halves have to outlive any
 * single screen: registration should happen on the launch after sign-in
 * whatever screen that lands on, and a tap can arrive while the app is on any
 * screen at all — or on none, if the app was not running.
 *
 * The three ways a notification reaches a person, all of which have to work:
 *
 *   1. App in the foreground — the banner is shown (`foregroundBehaviour`) and
 *      the tap comes through the response listener.
 *   2. App backgrounded — same listener, on resume.
 *   3. App not running — the tap LAUNCHES the app, and no listener added after
 *      launch will ever see it. `getLastNotificationResponseAsync` is the only
 *      way to recover it, and missing this case is the classic way a push
 *      feature ships looking fine and opens the home screen every time.
 */

import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { repository } from '@/features/shared/data/repository';
import { pushProvider } from '@/features/shared/lib/push';
import { destinationFor } from '@/features/shared/lib/push-routing';
import { foregroundBehaviour } from '@/features/shared/lib/push-provider';
import { useMode } from '@/features/shared/state/mode';
import { useSession } from '@/features/shared/state/session';
import { useIsApprovedProvider } from '@/features/shared/hooks/use-roles';

Notifications.setNotificationHandler({
  handleNotification: async () => foregroundBehaviour,
});

export function usePushNotifications(): void {
  const userId = useSession((state) => state.userId);
  const isProvider = useIsApprovedProvider();
  const setMode = useMode((state) => state.setMode);

  /**
   * Undefined until the root navigator exists.
   *
   * The cold-start path is exactly when it does not: the tap launches the
   * process, this hook mounts, and a `router.push` issued before the navigator
   * is ready is dropped with a warning — so the app opens on the home screen
   * and the notification looks broken while every listener is working
   * perfectly. Waiting one render costs nothing and is the difference.
   */
  const navigationReady = useRootNavigationState()?.key !== undefined;

  /**
   * The token this device registered, kept so sign-out can retire it.
   *
   * A ref rather than state: nothing renders from it, and making it state would
   * re-run the effect that set it.
   */
  const registered = useRef<string | null>(null);

  // Registration. Keyed on the signed-in user, so switching accounts on one
  // phone re-registers and the token is reassigned server-side (0065).
  useEffect(() => {
    if (userId === null) return;

    let cancelled = false;

    void (async () => {
      await pushProvider.configureChannels();
      const result = await pushProvider.register();
      if (cancelled || !result.ok) return;

      registered.current = result.token;
      await repository.registerPushToken(result.token, result.platform);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Sign-out retires the token. Without this, the next person to sign in on
  // this phone keeps receiving the previous person's order updates until they
  // happen to register — and on a shared workshop handset that is every day.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (userId !== null) {
      wasSignedIn.current = true;
      return;
    }
    if (!wasSignedIn.current) return;

    wasSignedIn.current = false;
    const token = registered.current;
    registered.current = null;
    if (token !== null) void repository.unregisterPushToken(token);
  }, [userId]);

  // Taps. `isProvider` is in the dependency list because the handler consults
  // it: a stale closure here would send an approved technician's job-offer tap
  // to the customer side on the launch where their role arrived late.
  useEffect(() => {
    if (!navigationReady) return;

    const open = (data: unknown) => {
      const destination = destinationFor(data);
      if (destination === null) return;

      // A job offer belongs to the `(provider)` group, which redirects out if
      // the app is in customer mode — so the tap would appear to do nothing.
      // Switching first is not a privilege grant: the group's own layout still
      // checks the role, and RLS still checks everything else (§5.1.3).
      if (destination.requiresMode === 'provider') {
        if (!isProvider) return;
        setMode('provider');
      } else if (destination.requiresMode === 'customer') {
        setMode('customer');
      }

      router.push({ pathname: destination.pathname, params: destination.params });
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });

    // The cold-start case. Checked once on mount, after the listener is
    // installed so a tap arriving in between is not lost either way.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response !== null) open(response.notification.request.content.data);
    });

    return () => subscription.remove();
  }, [navigationReady, isProvider, setMode]);
}
