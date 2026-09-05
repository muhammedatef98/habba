/**
 * Customer route group (§5.1.4).
 *
 * Every account has this surface — everyone is a customer (§5.1.1) — so the
 * only gate is being signed in. A signed-out user is sent to the phone screen
 * rather than shown an empty logbook.
 */

import { Redirect, Stack } from 'expo-router';
import { useIsAuthenticated } from '@/features/shared/state/session';

export default function CustomerLayout() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />;
}
