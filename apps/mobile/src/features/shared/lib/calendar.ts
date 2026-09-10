/**
 * Options for the date picker on the past-service screen.
 *
 * A pure module so "how many days does this month have" is tested rather than
 * discovered by a customer who chose 31 February — the previous screen asked
 * for a free-text `YYYY-MM-DD`, which had no such problem only because it had
 * no such help.
 */

/** Years a past service could plausibly have happened in, newest first. */
export function serviceYears(now: Date = new Date(), span = 15): readonly number[] {
  const current = now.getFullYear();
  return Array.from({ length: span }, (_, index) => current - index);
}

/** Days in a given month. `month` is 1-12, matching what a person would say. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, and the Date
  // constructor knows about leap years so this does not have to.
  return new Date(year, month, 0).getDate();
}

/**
 * The chosen date at midday UTC, or null when the parts do not make a date.
 *
 * Midday rather than midnight: a date stored at 00:00 in a +03 timezone lands
 * on the previous day once it is read back as UTC, which silently shifts every
 * service record by one day. Midday survives any offset either side of it.
 */
export function toServiceDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const iso = `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}T12:00:00Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
