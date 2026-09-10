/**
 * Dates as this app shows them.
 *
 * CLAUDE.md §5: "Support Hijri dates in display alongside Gregorian." Alongside
 * is the operative word — Saudi users read both, and a logbook entry that gives
 * only one of them forces a mental conversion at exactly the moment they are
 * trying to remember whether that service was before or after Ramadan.
 *
 * §8: Latin numerals, so every tag below pins `-nu-latn` rather than trusting
 * the locale's default numbering system.
 *
 * The Hijri formatter degrades rather than throws. `islamic-umalqura` needs a
 * full-ICU build, and whether Hermes on a given device has one is not something
 * this app can guarantee — a logbook that crashes on a calendar it cannot
 * format would be a spectacular way to lose the thing the product is built on.
 */

import { toLatinDigits } from '@habba/core';

const LATIN = 'ar-u-nu-latn';
const HIJRI = 'ar-SA-u-ca-islamic-umalqura-nu-latn';

function tagFor(locale: string): string {
  return locale.startsWith('ar') ? LATIN : locale;
}

export function formatGregorianDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(tagFor(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** `null` when the platform cannot format the Islamic calendar — never throws. */
export function formatHijriDate(iso: string, locale: string): string | null {
  if (!locale.startsWith('ar')) return null;

  try {
    // `-nu-latn` is honoured by Node's ICU but not by Hermes', which returns
    // ١٤٤٨ regardless — so the numerals are normalised afterwards rather than
    // trusted to the tag. Observed on the simulator: the Gregorian line above
    // it read "2 سبتمبر 2026" and the Hijri line "٢٠ ربيع الأول ١٤٤٨",
    // two numbering systems inside one card.
    //
    // `toArabicIndicDigits`' own docstring names Hijri dates as a case that
    // wants Arabic-Indic. That holds for the printed report, where the whole
    // page is set in Arabic; it does not hold for a line sitting directly under
    // a Gregorian one, and §8's Latin-by-default settles the in-app case.
    const formatted = toLatinDigits(
      new Date(iso).toLocaleDateString(HIJRI, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
    // A platform without the calendar silently falls back to Gregorian rather
    // than throwing, so a result identical to the Gregorian one means the
    // calendar was not applied and there is nothing to show "alongside".
    const gregorian = toLatinDigits(
      new Date(iso).toLocaleDateString(LATIN, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
    return formatted === gregorian ? null : formatted;
  } catch {
    return null;
  }
}

/** "سبتمبر 2026" — the heading a month of logbook entries sits under. */
export function formatMonthLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(tagFor(locale), { month: 'long', year: 'numeric' });
}

/** Local `YYYY-MM`, for grouping. Local, because a month boundary is local. */
export function monthKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}
