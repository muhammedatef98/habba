/**
 * Changing the app's language, for real.
 *
 * `setLocale` used to set a Zustand field and stop. Nothing called
 * `changeLanguage`, so the copy never moved; nothing called
 * `syncLayoutDirection`, so the layout never flipped; and nothing persisted
 * it, so the next launch overwrote the choice with the device's locale. The
 * settings screen's own caption promised the app would restart. It did not.
 * Tapping "English" tinted a chip and did nothing else.
 *
 * The reason it cannot simply be applied live is React Native's, not ours:
 * `I18nManager.forceRTL` takes effect on the next process start. So there are
 * only two coherent designs, and this picks the second:
 *
 *   1. Flip the copy now and the layout later — which leaves English text in a
 *      mirrored layout until the customer happens to reopen the app. That is
 *      the "half mirrored" state `rtl.ts` warns about, and it looks broken
 *      rather than pending.
 *   2. Change nothing visible until the restart, and say so plainly. Then
 *      language and direction move together and the app is never in a state
 *      that looks like a bug.
 *
 * Every locale pair this app supports changes direction (`ar` is RTL, `en` is
 * not), so `needsRestart` is effectively always true today. It is computed
 * rather than assumed because a third locale — Egypt is on the roadmap, and
 * `fr` for a GCC audience is plausible — would make that assumption wrong
 * without anything failing loudly.
 */

import { isRtl, type Locale } from '@habba/i18n';
import { initI18n } from './i18n';
import { writeStoredLocale } from './preferences';
import { syncLayoutDirection } from './rtl';

export interface LocaleChange {
  /** The app must be reopened before the new direction takes effect. */
  readonly needsRestart: boolean;
}

/**
 * Persists the choice and prepares the next launch for it.
 *
 * Deliberately does NOT call `changeLanguage` when the direction has to
 * change: see the note above. When it does not have to change — a future
 * same-direction locale pair — the copy switches immediately, because there is
 * nothing to wait for.
 */
export async function applyLocale(locale: Locale, current: Locale): Promise<LocaleChange> {
  await writeStoredLocale(locale);

  const directionChanges = isRtl(locale) !== isRtl(current);

  // Registered now either way, so the flip is already staged when the process
  // next starts — the customer reopening the app is the whole mechanism.
  syncLayoutDirection(locale);

  if (!directionChanges) {
    await initI18n(locale);
  }

  return { needsRestart: directionChanges };
}
