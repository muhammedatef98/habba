/**
 * Provider app root: RTL, i18n, theme, query client.
 *
 * Mirrors the customer app's boot sequence — the direction has to be settled
 * before the first render (CLAUDE.md §2.1).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { ThemeProvider, lightColors } from '@habba/ui';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from '@habba/i18n';
import { getLocales } from 'expo-localization';
import { I18nManager } from 'react-native';
import { isRtl } from '@habba/i18n';
import { initI18n } from '@/lib/i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A technician works in basement car parks and lift shafts. Cached data
      // that is slightly stale beats a blank screen (CLAUDE.md §2.7).
      staleTime: 15_000,
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
});

function detectLocale(): Locale {
  try {
    return resolveLocale(getLocales().map((locale) => locale.languageTag));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export default function ProviderRootLayout() {
  const [locale, setLocale] = useState<Locale | null>(null);

  // The design system's body face. Loaded here for the same reason as in the
  // customer app: `fontFamily.arabic` names a face, and an unloaded face falls
  // back to the system font with no warning (packages/ui/src/tokens.ts).
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const detected = detectLocale();

      const shouldBeRtl = isRtl(detected);
      I18nManager.allowRTL(shouldBeRtl);
      if (I18nManager.isRTL !== shouldBeRtl) I18nManager.forceRTL(shouldBeRtl);

      await initI18n(detected);
      if (!cancelled) setLocale(detected);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (locale === null || !fontsLoaded) {
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
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
