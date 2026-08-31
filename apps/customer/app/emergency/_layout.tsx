/**
 * The emergency request flow.
 *
 * Dark is the default for this route group rather than the device's
 * preference: the design's own rationale is that most emergencies happen after
 * sunset, and a full-brightness white screen at night on the hard shoulder is
 * hostile. The locale still comes from the session — only the light/dark
 * preference is overridden.
 *
 * ⚠️ The auth guard lives here, not on each screen. The single `emergency.tsx`
 * this replaced carried its own `isAuthenticated` check, and splitting it into
 * three routes silently dropped it — the flow stayed enterable with no session,
 * happily created an order, and only failed at `/tracking`, which had kept its
 * guard and bounced straight back. Guarding the layout means a future screen
 * added to this group cannot forget.
 */

import { Redirect, Stack } from 'expo-router';
import { ThemeProvider } from '@habba/ui';
import { useIsAuthenticated, useSession } from '@/state/session';

export default function EmergencyLayout() {
  const locale = useSession((state) => state.locale);
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ThemeProvider locale={locale} preference="dark">
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
