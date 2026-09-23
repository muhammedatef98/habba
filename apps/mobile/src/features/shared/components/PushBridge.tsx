/**
 * Notifications, meeting the app.
 *
 *   - A tap opens the screen it is about, in the right mode — including the
 *     tap that launched the app from cold, which arrives before any listener.
 *   - News arriving while the app is open refreshes the screens it concerns
 *     at once, so "your technician has arrived" is never announced by a
 *     banner over a tracking screen that still says "on the way" for three
 *     more seconds.
 *   - On launch, a signed-in phone that already granted permission is
 *     registered again, quietly: tokens rotate, and the language may have
 *     changed. It never asks here (push.ts says why).
 *
 * Renders nothing. Mounted once, inside the query client, in the root layout.
 */

import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { registerThisDevice } from '@/features/shared/lib/push';
import { targetFor } from '@/features/shared/lib/push-routes';
import { useMode } from '@/features/shared/state/mode';
import { useSession } from '@/features/shared/state/session';

export function PushBridge() {
  const queryClient = useQueryClient();
  const setMode = useMode((state) => state.setMode);
  const userId = useSession((state) => state.userId);
  const locale = useSession((state) => state.locale);
  const handledLaunch = useRef(false);

  useEffect(() => {
    if (userId === null) return;
    void registerThisDevice({ prompt: false, locale });
  }, [userId, locale]);

  useEffect(() => {
    if (userId === null) return;

    const open = (data: unknown) => {
      const target = targetFor(data);
      if (target === null) return;
      setMode(target.mode);
      router.push({ pathname: target.pathname, params: target.params });
    };

    const refresh = (data: unknown) => {
      const target = targetFor(data);
      if (target === null) return;
      for (const key of target.refresh) {
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }
    };

    const received = Notifications.addNotificationReceivedListener((notification) => {
      refresh(notification.request.content.data);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      refresh(response.notification.request.content.data);
      open(response.notification.request.content.data);
    });

    if (!handledLaunch.current) {
      handledLaunch.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response !== null) open(response.notification.request.content.data);
      });
    }

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [userId, queryClient, setMode]);

  return null;
}
