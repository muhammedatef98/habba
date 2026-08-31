/**
 * The emergency request flow.
 *
 * Dark is the default for this route group rather than the device's
 * preference: the design's own rationale is that most emergencies happen after
 * sunset, and a full-brightness white screen at night on the hard shoulder is
 * hostile. The locale still comes from the session — only the light/dark
 * preference is overridden.
 */

import { Stack } from 'expo-router';
import { ThemeProvider } from '@habba/ui';
import { useSession } from '@/state/session';

export default function EmergencyLayout() {
  const locale = useSession((state) => state.locale);

  return (
    <ThemeProvider locale={locale} preference="dark">
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
