/**
 * Dates as this app shows them: Gregorian only.
 *
 * The owner's decision (2026-10-02): every date in the app is Gregorian, and
 * the Hijri date is not shown anywhere. The calendar is pinned with
 * `-ca-gregory` rather than left to the locale, because `ar-SA` defaults to
 * the Umm al-Qura calendar on some platforms and would bring Hijri back
 * without anyone asking for it.
 *
 * §8: Latin numerals, so every tag below pins `-nu-latn` rather than trusting
 * the locale's default numbering system.
 */

import { toLatinDigits } from '@habba/core';

const LATIN = 'ar-u-ca-gregory-nu-latn';

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

/**
 * An appointment: weekday, date and time, in Riyadh time.
 *
 * Pinned to Asia/Riyadh rather than the device's zone: slots are published in
 * Riyadh time (0024's generate_slots), and a technician whose phone is set
 * elsewhere must read the same hour the customer booked.
 */
export function formatAppointment(iso: string, locale: string): string {
  return toLatinDigits(
    new Date(iso).toLocaleString(tagFor(locale), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Riyadh',
    }),
  );
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

/**
 * Local `YYYY`, for the year band above the month grouping.
 *
 * Local for the same reason `monthKey` is: a year boundary is local. A service
 * at 02:00 on 1 January in Riyadh belongs to the new year for the person who
 * paid for it, whatever UTC thinks.
 */
export function yearKey(iso: string): string {
  return `${new Date(iso).getFullYear()}`;
}

/** «الجمعة، 2 أكتوبر» — today, as the home header says it, in Riyadh. */
export function formatTodayLine(at: Date, locale: string): string {
  return toLatinDigits(
    at.toLocaleDateString(tagFor(locale), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Asia/Riyadh',
    }),
  );
}
