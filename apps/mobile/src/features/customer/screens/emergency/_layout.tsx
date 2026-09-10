/**
 * The emergency request flow.
 *
 * Dark is this flow's DEFAULT, not a lock. The designer's rationale is that
 * most emergencies happen after sunset and a full-brightness white screen on
 * the hard shoulder is hostile — an argument about the situation, and a good
 * one. But the design also ships light variants of these screens, and someone
 * who explicitly chose light in settings has told us something about their eyes
 * or their glare that outranks our guess about their evening.
 *
 * `system` still resolves to dark here: a device left on light at 9pm is a
 * default nobody chose.
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
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';

export default function EmergencyLayout() {
  const locale = useSession((state) => state.locale);
  const isAuthenticated = useIsAuthenticated();
  const preference = useSession((state) => state.themePreference);

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ThemeProvider locale={locale} preference={preference === 'light' ? 'light' : 'dark'}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
