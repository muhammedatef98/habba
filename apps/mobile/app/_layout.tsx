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
import { Almarai_800ExtraBold } from '@expo-google-fonts/almarai';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from '@expo-google-fonts/outfit';
import { ThemeProvider, lightColors } from '@habba/ui';
import { detectDeviceLocale, initI18n } from '@/features/shared/lib/i18n';
import { readStoredLocale, readStoredTheme } from '@/features/shared/lib/preferences';
import { syncLayoutDirection } from '@/features/shared/lib/rtl';
import { OfflineNotice } from '@/features/shared/components/OfflineNotice';
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
  const themePreference = useSession((state) => state.themePreference);
  const setThemePreference = useSession((state) => state.setThemePreference);
  const hydrate = useSession((state) => state.hydrate);
  const restoreMode = useMode((state) => state.restore);
  const [ready, setReady] = useState(false);

  // The design's Latin face, used for every figure in the app. Loaded by exact
  // weight because React Native resolves faces by family name and does not
  // synthesise bold — a missing weight renders as regular with no warning.
  const [fontsLoaded] = useFonts({
    // Almarai carries the wordmark only — the design sets the lockup in it, and
    // body copy stays in IBM Plex Sans Arabic.
    Almarai_800ExtraBold,
    // The app's body face (§8). Every weight, because React Native matches a
    // face by exact family name and does not synthesise bold — and because
    // nothing loaded it before, every line of Arabic was silently rendering in
    // the system font (tokens.ts).
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // The customer's own choice outranks the device. Boot used to read the
      // device locale unconditionally, which meant a saved preference was
      // overwritten on every launch — the language switcher could not have
      // worked even if something had been listening to it.
      // The session and the mode are read back here too, before the first
      // frame: a launch that shows the phone screen for an instant on the way
      // to the restored session reads as "it signed me out again".
      const [storedLocale, storedTheme] = await Promise.all([
        readStoredLocale(),
        readStoredTheme(),
        hydrate(),
        restoreMode(),
      ]);
      const effective = storedLocale ?? detectDeviceLocale();

      syncLayoutDirection(effective);
      await initI18n(effective);

      if (!cancelled) {
        setLocale(effective);
        if (storedTheme !== null) setThemePreference(storedTheme);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, restoreMode, setLocale, setThemePreference]);

  // Gate on the fonts too: rendering before Outfit resolves shows every figure
  // in the fallback face and then reflows, which on the tracking screen means
  // the price visibly jumping.
  if (!ready || !fontsLoaded) {
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
        <ThemeProvider locale={locale} preference={themePreference}>
          <StatusBar style="auto" />
          {/* Above the navigator and outside it, so the notice survives every
              screen change instead of each screen having to remember it.
              Deliberately NOT wrapped in a SafeAreaView: <Screen> already
              applies `insets.top` itself, and a second one here would double
              the top padding of every screen in the app. The notice carries
              its own inset instead, and renders nothing at all while the
              connection is fine — so the layout is untouched when online. */}
          {/* One flex parent for the two of them. Left as bare siblings, the
              navigator had no `flex: 1` of its own to fall back on and the
              screen below it stopped filling the window. */}
          <View style={{ flex: 1 }}>
            <OfflineNotice testID="offline-notice" />
            <View style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />
            </View>
          </View>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
