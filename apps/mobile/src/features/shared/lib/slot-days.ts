/**
 * Groups appointment slots into the days the picker shows as a strip.
 *
 * A selector rather than inline grouping in the screen, because "which day is
 * this slot on" is a local-time question and getting it wrong is invisible
 * until someone books 03:00 Tuesday thinking it is Monday night. Grouping on
 * the local Y-M-D rather than on the ISO string's date is the whole point:
 * `startsAt` is UTC, and Riyadh is +03.
 */

/**
 * The only thing grouping needs to know about a slot.
 *
 * Generic rather than tied to `AppointmentSlot`, because the workshop reads
 * its own calendar through a different shape (`ScheduleSlot`, which carries
 * the booked count and the block flag a customer must never see). Both group
 * into days by the same local-time rule, and a second copy of that rule is a
 * second chance to get the +03 boundary wrong.
 */
export interface DatedSlot {
  readonly startsAt: string;
}

export interface SlotDay<T extends DatedSlot = DatedSlot> {
  /** Local calendar key, `YYYY-MM-DD`. Stable enough to use as a React key. */
  readonly key: string;
  /** Midnight local on that day, for formatting the strip label. */
  readonly date: Date;
  readonly slots: readonly T[];
}

function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function groupSlotsByDay<T extends DatedSlot>(slots: readonly T[]): readonly SlotDay<T>[] {
  const byKey = new Map<string, { date: Date; slots: T[] }>();

  for (const slot of slots) {
    const startsAt = new Date(slot.startsAt);
    const key = localDayKey(startsAt);
    const midnight = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());

    const bucket = byKey.get(key);
    if (bucket === undefined) {
      byKey.set(key, { date: midnight, slots: [slot] });
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

/** How many days from today, in local calendar days — not in 24-hour blocks. */
export function daysFromToday(date: Date, now: Date = new Date()): number {
  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const midnightThen = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((midnightThen - midnightToday) / 86_400_000);
}
