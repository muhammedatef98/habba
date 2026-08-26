/**
 * Locale resources and direction handling.
 *
 * CLAUDE.md §2.1: Arabic is the default locale, not a translation. `ar` is the
 * source of truth for copy; `en` is secondary.
 *
 * This package stays free of i18next and React Native so it can be unit-tested
 * in plain Node. The app wires these resources into i18next (build prompt §3);
 * the types below are what make a missing key a compile error rather than a
 * `common.continue` string appearing in the UI.
 */

import ar from './locales/ar.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';
export const FALLBACK_LOCALE: Locale = 'ar';

export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

export const resources = { ar, en } as const;

/** The shape every locale must satisfy. `ar` is the reference. */
export type TranslationResource = typeof ar;

/**
 * Dotted key paths through the resource tree, e.g. `"auth.errors.invalidPhone"`.
 * Typing these is what stops a renamed key from silently rendering as itself.
 */
export type TranslationKey = DottedKeys<TranslationResource>;

type DottedKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DottedKeys<T[K]>}`;
}[keyof T & string];

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/**
 * Picks the best supported locale for a device.
 *
 * Accepts full BCP-47 tags (`ar-SA`, `en-GB`) and falls back to Arabic — the
 * default is Arabic because the product is Arabic-first, not because the
 * device said so.
 */
export function resolveLocale(preferred: readonly string[] | string | undefined): Locale {
  const candidates = typeof preferred === 'string' ? [preferred] : (preferred ?? []);

  for (const candidate of candidates) {
    const base = candidate.split('-')[0]?.toLowerCase();
    if (base !== undefined && isSupportedLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

/** Reads a dotted path out of a resource tree. */
export function lookup(locale: Locale, key: string): string | undefined {
  const segments = key.split('.');
  let node: unknown = resources[locale];

  for (const segment of segments) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }

  return typeof node === 'string' ? node : undefined;
}

/**
 * `{{name}}` interpolation, matching i18next's default syntax so copy is
 * portable between this helper and the app's i18next instance.
 */
export function interpolate(template: string, params?: Readonly<Record<string, string | number>>) {
  if (params === undefined) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Minimal translator, used by tests and by any non-React consumer.
 *
 * Falls back to Arabic, then to the key itself. Returning the key is a loud,
 * visible failure — better than an empty string, which looks like a layout bug
 * and gets ignored.
 */
export function createTranslator(locale: Locale) {
  return function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>) {
    const template = lookup(locale, key) ?? lookup(FALLBACK_LOCALE, key) ?? key;
    return interpolate(template, params);
  };
}
