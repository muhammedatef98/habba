/**
 * What must survive closing the app: the two preferences, and the sign-in.
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
const SESSION_KEY = 'habba.session';

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

/**
 * The signed-in customer, as much of them as the client is allowed to remember.
 *
 * Nothing here is server data — no vehicles, no orders, no logbook. Those are
 * refetched, so a stale cache can never present itself as fact. This is only
 * the identity needed to skip the phone screen on the next launch.
 */
export interface StoredSession {
  readonly userId: string;
  readonly fullName: string;
  readonly phoneE164: string | null;
  readonly isGuest: boolean;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0 &&
    typeof candidate.fullName === 'string' &&
    (candidate.phoneE164 === null || typeof candidate.phoneE164 === 'string') &&
    typeof candidate.isGuest === 'boolean'
  );
}

/**
 * The stored session, or null when nobody is signed in — or when what was
 * stored is not a session this build understands.
 *
 * Validated rather than cast for the same reason the locale is: stored state
 * outlives the code that wrote it, and a half-shaped object here would put the
 * app into a signed-in state with no id to fetch anything with.
 */
export async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (stored === null) return null;

    const parsed: unknown = JSON.parse(stored);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeStoredSession(session: StoredSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Fails soft — see the module note. The cost is one extra sign-in.
  }
}

/** Signing out. The identity must not outlive it on the device. */
export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Fails soft — see the module note.
  }
}
