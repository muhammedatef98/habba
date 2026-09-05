/**
 * Grouped figures, always in Latin digits.
 *
 * §8: "Latin numerals by default (Saudi users prefer `1234` over `١٢٣٤` in
 * UI)". Passing the UI locale straight to `toLocaleString` does not guarantee
 * that — whether `ar` yields `١٢٬٣٤٥` or `12,345` depends on the ICU build the
 * JS engine was compiled with, so it can differ between the Node used in tests
 * and Hermes on the device. `-u-nu-latn` states the numbering system outright
 * and removes the platform from the decision, while keeping the locale's own
 * grouping.
 */

const LATIN_DIGITS_ARABIC = 'ar-u-nu-latn';

export function formatCount(value: number, locale: string): string {
  const tag = locale.startsWith('ar') ? LATIN_DIGITS_ARABIC : locale;
  return value.toLocaleString(tag);
}

/** A short day/month for a card, in the UI locale but with Latin digits. */
export function formatShortDate(iso: string, locale: string): string {
  const tag = locale.startsWith('ar') ? LATIN_DIGITS_ARABIC : locale;
  return new Date(iso).toLocaleDateString(tag, { day: 'numeric', month: 'short' });
}
