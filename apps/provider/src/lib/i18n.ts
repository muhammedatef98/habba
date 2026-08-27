/**
 * i18next configuration.
 *
 * Build prompt §3 specifies i18next + expo-localization; the resources and
 * types live in @habba/i18n so they can be tested without React Native.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  resolveLocale,
  resources,
  type Locale,
} from '@habba/i18n';

export function detectDeviceLocale(): Locale {
  try {
    return resolveLocale(getLocales().map((locale) => locale.languageTag));
  } catch {
    // expo-localization can throw in non-native contexts (tests, web SSR).
    // Arabic-first is the product decision, so it is also the safe fallback.
    return DEFAULT_LOCALE;
  }
}

export async function initI18n(locale: Locale = detectDeviceLocale()) {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(locale);
    return i18next;
  }

  await i18next.use(initReactI18next).init({
    lng: locale,
    fallbackLng: FALLBACK_LOCALE,
    resources: {
      ar: { translation: resources.ar },
      en: { translation: resources.en },
    },
    interpolation: {
      // React already escapes; double-escaping mangles Arabic punctuation.
      escapeValue: false,
    },
    returnNull: false,
  });

  return i18next;
}

export { i18next };
