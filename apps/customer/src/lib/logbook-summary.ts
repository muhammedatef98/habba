/**
 * What the home screen says about a car's logbook without opening it.
 *
 * A selector rather than inline `.filter().sort()` in the screen: these two
 * numbers are the moat's shop window (§1), and "which events count as a
 * service" is a product decision that should be stated once, in a place a test
 * can reach, instead of being re-derived on whichever screen needs it next.
 */

import type { TimelineEvent, TimelineEventType } from '@/data/types';

/**
 * Events that mean somebody worked on the car. `mileage_recorded` and
 * `alert_raised` are logbook entries but not services — counting them would
 * make a car that has only ever been looked at appear to have been serviced.
 */
const SERVICE_EVENTS: ReadonlySet<TimelineEventType> = new Set([
  'service_completed',
  'parts_replaced',
  'inspection_completed',
  'warranty_claimed',
]);

export interface LogbookSummary {
  /** Every entry, because the logbook's size is itself the thing being sold. */
  readonly recordCount: number;
  /** ISO timestamp of the most recent service, or null if there has been none. */
  readonly lastServiceAt: string | null;
}

export function summariseLogbook(events: readonly TimelineEvent[]): LogbookSummary {
  let lastServiceAt: string | null = null;

  for (const event of events) {
    if (!SERVICE_EVENTS.has(event.eventType)) continue;
    if (lastServiceAt === null || event.occurredAt > lastServiceAt) {
      lastServiceAt = event.occurredAt;
    }
  }

  return { recordCount: events.length, lastServiceAt };
}
