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
  SUPPORTED_LOCALES,
  resolveLocale,
  resources,
  type Locale,
} from '@habba/i18n';
import { withOverrides, type CopyOverride } from '@habba/i18n/overrides';

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
    // Re-render on replaced words (applyCopyOverrides), not only on a
    // language change: an operator's fix should show without a restart.
    react: { bindI18nStore: 'added' },
  });

  return i18next;
}

/**
 * Lays the operators' words (0093) over the shipped ones. Each call starts from
 * the shipped tree, so a row deleted in the console puts the original back on
 * the next fetch. A replacement that would break its sentence is skipped
 * (withOverrides).
 */
export function applyCopyOverrides(overrides: readonly CopyOverride[]): void {
  for (const locale of SUPPORTED_LOCALES) {
    i18next.addResourceBundle(
      locale,
      'translation',
      withOverrides(resources[locale], overrides, locale),
      true,
      true,
    );
  }
}

export { i18next };
