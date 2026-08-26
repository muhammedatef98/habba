/**
 * Right-to-left layout management.
 *
 * Build prompt §8: `I18nManager.forceRTL(true)` at boot, "and handle the
 * required reload". The reload is the awkward part — React Native only applies
 * a direction change after a restart, so switching language mid-session needs
 * an explicit, explained restart rather than a silently half-flipped UI.
 *
 * CLAUDE.md §2.1: RTL is built in from commit one because retrofitting it is a
 * rewrite.
 */

import { I18nManager } from 'react-native';
import { isRtl, type Locale } from '@habba/i18n';

export interface RtlSyncResult {
  /** True when the native direction changed and a restart is required. */
  readonly needsRestart: boolean;
  readonly isRtl: boolean;
}

/**
 * Aligns the native layout direction with the given locale.
 *
 * Returns whether a restart is needed rather than triggering one, so the
 * caller can show the explanation first. Restarting an app with no warning
 * looks like a crash.
 */
export function syncLayoutDirection(locale: Locale): RtlSyncResult {
  const shouldBeRtl = isRtl(locale);

  // allowRTL must be enabled before forceRTL has any effect.
  I18nManager.allowRTL(shouldBeRtl);

  if (I18nManager.isRTL === shouldBeRtl) {
    return { needsRestart: false, isRtl: shouldBeRtl };
  }

  I18nManager.forceRTL(shouldBeRtl);
  return { needsRestart: true, isRtl: shouldBeRtl };
}

export function currentlyRtl(): boolean {
  return I18nManager.isRTL;
}
