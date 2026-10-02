/**
 * Groups appointment slots into the days the picker shows as a strip.
 *
 * A selector rather than inline grouping in the screen, because "which day is
 * this slot on" is a calendar question and getting it wrong is invisible
 * until someone books 03:00 Tuesday thinking it is Monday night.
 *
 * The calendar is Riyadh's, not the phone's. Slots are published in Riyadh
 * time (0024's generate_slots) and the booked screen shows Riyadh time
 * (`formatAppointment`); grouping and labelling by the phone's zone put a
 * 09:00 slot on the picker and «12:00 م» on the confirmation for anyone whose
 * phone was not set to Riyadh. Saudi Arabia has no daylight saving, so the
 * offset is a constant.
 */

import type { AppointmentSlot } from '@/features/shared/data/types';

const RIYADH_OFFSET_MS = 3 * 3_600_000;

export interface SlotDay {
  /** Riyadh calendar key, `YYYY-MM-DD`. Stable enough to use as a React key. */
  readonly key: string;
  /** Noon in Riyadh on that day; format it with `timeZone: 'Asia/Riyadh'`. */
  readonly date: Date;
  readonly slots: readonly AppointmentSlot[];
}

/** The Riyadh calendar date of an instant, as UTC fields of a shifted Date. */
function riyadhFields(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function riyadhDayKey(date: Date): string {
  const { year, month, day } = riyadhFields(date);
  return `${year}-${`${month + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

export function groupSlotsByDay(slots: readonly AppointmentSlot[]): readonly SlotDay[] {
  const byKey = new Map<string, { date: Date; slots: AppointmentSlot[] }>();

  for (const slot of slots) {
    const startsAt = new Date(slot.startsAt);
    const key = riyadhDayKey(startsAt);
    const { year, month, day } = riyadhFields(startsAt);
    const noonRiyadh = new Date(Date.UTC(year, month, day, 12) - RIYADH_OFFSET_MS);

    const bucket = byKey.get(key);
    if (bucket === undefined) {
      byKey.set(key, { date: noonRiyadh, slots: [slot] });
    } else {
      bucket.slots.push(slot);
    }
  }

  return [...byKey.entries()]
    .map(([key, bucket]) => ({
      key,
      date: bucket.date,
      slots: [...bucket.slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** How many Riyadh calendar days from today — not 24-hour blocks. */
export function daysFromToday(date: Date, now: Date = new Date()): number {
  const then = riyadhFields(date);
  const today = riyadhFields(now);
  return Math.round(
    (Date.UTC(then.year, then.month, then.day) - Date.UTC(today.year, today.month, today.day)) /
      86_400_000,
  );
}
