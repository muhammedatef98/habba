/**
 * The technician's calendar (0104), as the «مواعيدي» screen plans it.
 *
 * Riyadh's calendar throughout, like the customer's picker (slot-days.ts):
 * the server publishes in Riyadh time, so "Sunday" here is Riyadh's Sunday
 * whatever the phone's zone says. Saudi Arabia keeps no daylight saving, so
 * the offset is a constant.
 *
 * Pure, so the arithmetic is tested in Node.
 */

const RIYADH_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** Friday: the day most technicians are off, so it starts unchosen. */
export const FRIDAY = 5;

/** The appointment lengths the server accepts (0104), minus 45 which nobody asked for. */
export const SLOT_LENGTHS = [30, 60, 90, 120] as const;
export type SlotLength = (typeof SLOT_LENGTHS)[number];

export interface PlanDay {
  /** Riyadh calendar date, `YYYY-MM-DD` — what the server takes. */
  readonly key: string;
  /** Noon in Riyadh that day; format with `timeZone: 'Asia/Riyadh'`. */
  readonly date: Date;
  /** 0 Sunday … 6 Saturday, in Riyadh. */
  readonly weekday: number;
}

function keyOf(shifted: Date): string {
  return `${shifted.getUTCFullYear()}-${`${shifted.getUTCMonth() + 1}`.padStart(2, '0')}-${`${shifted.getUTCDate()}`.padStart(2, '0')}`;
}

/** Today and the days after it, in Riyadh. */
export function upcomingDays(count: number, now: Date = new Date()): readonly PlanDay[] {
  const today = new Date(now.getTime() + RIYADH_OFFSET_MS);
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: count }, (_, index) => {
    const shifted = new Date(midnight + index * DAY_MS);
    return {
      key: keyOf(shifted),
      date: new Date(midnight + index * DAY_MS + 12 * 3_600_000 - RIYADH_OFFSET_MS),
      weekday: shifted.getUTCDay(),
    };
  });
}

/** The week ahead from tomorrow, without Fridays. */
export function defaultDayKeys(days: readonly PlanDay[]): readonly string[] {
  return days
    .slice(1, 8)
    .filter((day) => day.weekday !== FRIDAY)
    .map((day) => day.key);
}

/** Appointments that fit in one day's window. */
export function slotsPerDay(startMinute: number, endMinute: number, length: number): number {
  if (length <= 0 || endMinute <= startMinute) return 0;
  return Math.floor((endMinute - startMinute) / length);
}

/** A window edge moved by a step, kept inside the day and the other edge. */
export function clampWindow(
  startMinute: number,
  endMinute: number,
  length: number,
): { startMinute: number; endMinute: number } {
  const start = Math.min(Math.max(startMinute, 0), 1440 - length);
  const end = Math.min(Math.max(endMinute, start + length), 1440);
  return { startMinute: start, endMinute: end };
}

/** «09:00», from minutes after midnight, in the reader's language. */
export function minuteLabel(minute: number, locale: string): string {
  const tag = locale.startsWith('ar') ? 'ar-u-ca-gregory-nu-latn' : locale;
  return new Date(Date.UTC(2026, 0, 1, 0, minute)).toLocaleTimeString(tag, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/** A Riyadh day key for an instant, for grouping the technician's slots. */
export function riyadhKey(iso: string): string {
  return keyOf(new Date(new Date(iso).getTime() + RIYADH_OFFSET_MS));
}

export function groupByRiyadhDay<T extends { readonly startsAt: string }>(
  items: readonly T[],
): readonly { key: string; items: readonly T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = riyadhKey(item.startsAt);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return [...groups.entries()].map(([key, grouped]) => ({ key, items: grouped }));
}
