/**
 * A workshop's opening hours, as the «ورشتي» screen edits them and as
 * `workshops.opening_hours` stores them: `{"sun": [["08:00","20:00"]], ...}`,
 * a missing day being closed (0018).
 *
 * The screen offers one daily window and the days it applies to — most
 * workshops keep one schedule. Hours saved some other way (split shifts, a
 * different Thursday) read back as the first window found, so the screen
 * never shows nothing; saving then writes the one window.
 */

export const WEEK_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekKey = (typeof WEEK_KEYS)[number];

export type OpeningHours = Readonly<Record<string, readonly (readonly [string, string])[]>>;

function clock(minute: number): string {
  const bounded = Math.min(Math.max(minute, 0), 1440);
  return `${`${Math.floor(bounded / 60)}`.padStart(2, '0')}:${`${bounded % 60}`.padStart(2, '0')}`;
}

function minutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function hoursFromWindow(
  days: readonly WeekKey[],
  startMinute: number,
  endMinute: number,
): OpeningHours {
  const window: readonly [string, string] = [clock(startMinute), clock(endMinute)];
  return Object.fromEntries(
    WEEK_KEYS.filter((key) => days.includes(key)).map((key) => [key, [window]]),
  );
}

export function windowFromHours(
  hours: OpeningHours,
): { days: readonly WeekKey[]; startMinute: number; endMinute: number } | null {
  const days = WEEK_KEYS.filter((key) => (hours[key]?.length ?? 0) > 0);
  const first = days.map((key) => hours[key]?.[0]).find((window) => window !== undefined);
  if (first === undefined) return null;
  const start = minutes(first[0]);
  const end = minutes(first[1]);
  if (start === null || end === null || end <= start) return null;
  return { days, startMinute: start, endMinute: end };
}
