/**
 * Root layout: i18n, RTL, theme, query client, and the persisted app mode.
 *
 * RTL is established before the first render (CLAUDE.md §2.1) rather than
 * bolted on later, and the mode is restored before the first navigation so a
 * technician who force-quit mid-shift lands back on their shift (§5.1.4)
 * rather than watching the customer home screen flash past.
 *
 * One app, two route groups — `(customer)` and `(provider)`. Which one a user
 * may actually reach is decided by the group's own layout, and behind that by
 * RLS. Nothing here grants anything.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, lightColors } from '@habba/ui';
import { detectDeviceLocale, initI18n } from '@/features/shared/lib/i18n';
import { syncLayoutDirection } from '@/features/shared/lib/rtl';
import { useMode } from '@/features/shared/state/mode';
import { useSession } from '@/features/shared/state/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The technician-in-a-basement case (CLAUDE.md §2.7) applies to
      // customers too: keep data usable while offline rather than blanking
      // the screen the moment a request fails.
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const locale = useSession((state) => state.locale);
  const setLocale = useSession((state) => state.setLocale);
  const restoreMode = useMode((state) => state.restore);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const detected = detectDeviceLocale();
      syncLayoutDirection(detected);
      await initI18n(detected);
      await restoreMode();

      if (!cancelled) {
        setLocale(detected);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setLocale, restoreMode]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: lightColors.background,
        }}
      >
        <ActivityIndicator color={lightColors.primary} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider locale={locale}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
