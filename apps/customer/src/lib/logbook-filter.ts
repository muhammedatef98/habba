/**
 * The logbook's filters.
 *
 * §9.1 asks for the timeline to be filterable, and the useful cuts are the
 * questions people actually arrive with: "when was it last serviced", "has it
 * been inspected", "what has the odometer done". Filtering by the raw event
 * type would expose the schema's nine `timeline_event_type` values to a
 * customer who has no reason to know that `parts_replaced` and
 * `service_completed` are separate rows.
 *
 * A pure module so the buckets can be tested without a screen, and so adding
 * an event type forces a decision here rather than silently falling into a
 * category nobody chose — `bucketOf` is exhaustive over the union.
 */

import type { TimelineEvent, TimelineEventType } from '@/data/types';

export type LogbookFilter = 'all' | 'service' | 'inspection' | 'mileage';

export const LOGBOOK_FILTERS: readonly LogbookFilter[] = [
  'all',
  'service',
  'inspection',
  'mileage',
] as const;

/** Which filter an event belongs to, or null when it belongs to none but `all`. */
function bucketOf(eventType: TimelineEventType): Exclude<LogbookFilter, 'all'> | null {
  switch (eventType) {
    case 'service_completed':
    case 'parts_replaced':
    case 'warranty_claimed':
      return 'service';
    case 'inspection_completed':
      return 'inspection';
    case 'mileage_recorded':
      return 'mileage';
    // Registration, transfers and alerts are part of the car's story but not
    // one of the three questions above; they show only under "all".
    case 'vehicle_registered':
    case 'ownership_transferred':
    case 'alert_raised':
    case 'alert_dismissed':
      return null;
  }
}

export function filterEvents(
  events: readonly TimelineEvent[],
  filter: LogbookFilter,
): readonly TimelineEvent[] {
  if (filter === 'all') return events;
  return events.filter((event) => bucketOf(event.eventType) === filter);
}

/** How many events each filter would show — used to hide empty filters. */
export function countByFilter(
  events: readonly TimelineEvent[],
): Readonly<Record<LogbookFilter, number>> {
  const counts: Record<LogbookFilter, number> = {
    all: events.length,
    service: 0,
    inspection: 0,
    mileage: 0,
  };

  for (const event of events) {
    const bucket = bucketOf(event.eventType);
    if (bucket !== null) counts[bucket] += 1;
  }

  return counts;
}
