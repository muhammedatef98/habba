/**
 * حجز موعد — the scheduled-service flow.
 *
 * Light by default, unlike the emergency group. The designer's argument for
 * forcing dark there was about the situation: a full-brightness screen on the
 * hard shoulder at night is hostile. None of that applies to someone booking
 * an oil change from their sofa on Tuesday, so this follows the customer's own
 * preference like the rest of the app.
 *
 * The auth guard lives here rather than on each screen, for the same reason it
 * does in the emergency group: a screen added to this stack later cannot
 * forget it.
 */

import { Redirect, Stack } from 'expo-router';
import { useIsAuthenticated } from '@/features/shared/state/session';

export default function BookingLayout() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
