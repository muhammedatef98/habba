/**
 * The two choices a customer makes that must survive closing the app.
 *
 * Neither was persisted. Language and theme lived in Zustand and were rebuilt
 * from the device on every launch, so picking English in الإعدادات lasted
 * exactly as long as the process did — and, because nothing acted on the
 * value either, not even that long.
 *
 * Stored in `expo-secure-store`, which is a keychain and therefore heavier
 * than a UI preference needs. It is used because it is the only storage this
 * app already has: it is a declared dependency, it ships inside Expo Go, and
 * reaching for AsyncStorage or expo-updates instead would mean a native
 * rebuild for two strings. If a lighter store is ever added, this module is
 * the only thing that has to move.
 *
 * Every operation fails soft. A preference that cannot be written is a worse
 * experience, not a broken app, and a keychain read that throws at boot must
 * never be the reason the app does not start.
 */

import * as SecureStore from 'expo-secure-store';
import { isSupportedLocale, type Locale } from '@habba/i18n';

const LOCALE_KEY = 'habba.preference.locale';
const THEME_KEY = 'habba.preference.theme';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_VALUES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_VALUES as readonly string[]).includes(value);
}

/** The saved locale, or null when nothing has been chosen or the read failed. */
export async function readStoredLocale(): Promise<Locale | null> {
  try {
    const stored = await SecureStore.getItemAsync(LOCALE_KEY);
    // Validated rather than cast: a value written by an older build, or by
    // hand, must not become an unsupported `lng` that i18next silently
    // falls back on while the direction has already been flipped for it.
    return stored !== null && isSupportedLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function writeStoredLocale(locale: Locale): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCALE_KEY, locale);
  } catch {
    // Fails soft — see the module note.
  }
}

export async function readStoredTheme(): Promise<ThemePreference | null> {
  try {
    const stored = await SecureStore.getItemAsync(THEME_KEY);
    return stored !== null && isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function writeStoredTheme(preference: ThemePreference): Promise<void> {
  try {
    await SecureStore.setItemAsync(THEME_KEY, preference);
  } catch {
    // Fails soft — see the module note.
  }
}
