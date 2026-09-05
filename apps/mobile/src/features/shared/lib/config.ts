/**
 * Build-time configuration, read once.
 *
 * Everything here comes from `app.config.ts`, which reads environment
 * variables. Nothing in this file has a hardcoded project URL, key or host —
 * a staging build and a production build differ only in their environment.
 *
 * `expoConfig.extra` is readable by anyone with the app, so only values that
 * are public by design live here (see app.config.ts).
 */

import Constants from 'expo-constants';

interface HabbaExtra {
  readonly reportBaseUrl?: string;
}

function extra(): HabbaExtra {
  try {
    return (Constants.expoConfig?.extra ?? {}) as HabbaExtra;
  } catch {
    return {};
  }
}

/**
 * Where تقرير هبّة is served. The fallback matches app.config.ts so a build
 * without the variable still produces a shareable link rather than
 * `undefined/<token>` in front of a buyer.
 */
export function reportBaseUrl(): string {
  return extra().reportBaseUrl ?? 'https://habba.sa/r';
}
