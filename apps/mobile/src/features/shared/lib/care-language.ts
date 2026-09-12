/**
 * What القادم is allowed to say, and how sure it is allowed to sound.
 *
 * ADR-0022. The app cannot see the odometer between readings: it knows the car
 * was at 84,000 km on the 3rd and it knows nothing at all about where it is
 * today. So a distance-based item is an ESTIMATE, permanently, and writing
 * «موعد الزيت اليوم» over one is a claim the data does not support. The first
 * time an owner opens the bonnet on a false alarm, the section has spent the
 * credibility §1 is built on.
 *
 * A document expiry is the opposite. Somebody read a date off a piece of paper
 * and typed it in; the arithmetic is a subtraction. Hedging THAT would be its
 * own failure — vague where it could be exact — and it is the contrast between
 * the two registers that makes the hedged case read as honesty.
 *
 * This module exists so the rule is a function with tests rather than a
 * convention in a JSX file. Every string in the section comes from here, and
 * `certain` is what a caller must consult before it is allowed to render
 * anything that sounds like a date.
 */

import type { MaintenanceItem, VehicleDocument } from '@/features/shared/data/types';

/**
 * Mirrors `care_lead_days()` and `care_lead_km()` (0059).
 *
 * Duplicated rather than fetched because they only decide copy here — the
 * server decides what is actually sent. If they ever diverge, the screen leads
 * the notification by a few days, which is survivable; a round trip to render
 * a label is not.
 */
export const CARE_LEAD_DAYS = 14;
export const CARE_LEAD_KM = 500;

export type CareUrgency = 'overdue' | 'soon' | 'scheduled' | 'unknown';

export interface CareLine {
  /** i18n key. */
  readonly key: string;
  readonly values: Readonly<Record<string, number>>;
  /**
   * Whether this sentence may be stated as fact.
   *
   * False means it rests on a distance the app is extrapolating from an old
   * reading, and the copy behind `key` says so and asks for a new one. A caller
   * must never render a `certain: false` line with date-like emphasis.
   */
  readonly certain: boolean;
  readonly urgency: CareUrgency;
}

/**
 * The one place a maintenance item becomes a sentence.
 *
 * Order matters and is the rule itself:
 *
 *  1. Due on the DATE axis — arithmetic on two things we know exactly, when it
 *     was last done and how many months it runs. Stated plainly.
 *  2. Due on the DISTANCE axis — stated as likely, with the action that would
 *     make it certain attached.
 *  3. Approaching on the date axis — still a date, still plain.
 *  4. Approaching on the distance axis — hedged again.
 *  5. Nothing to go on. Not "fine", which we do not know: we have never been
 *     told when this was last done.
 */
export function maintenanceLine(item: MaintenanceItem): CareLine {
  if (item.dueByDate) {
    return {
      key: 'care.item.dueNow',
      values: {},
      certain: true,
      urgency: 'overdue',
    };
  }

  if (item.dueByKm) {
    return {
      key: 'care.item.likelyDue',
      values: {},
      // The distance axis, always. This is the line ADR-0022 exists for.
      certain: false,
      urgency: 'overdue',
    };
  }

  if (item.daysRemaining !== null && item.daysRemaining <= CARE_LEAD_DAYS) {
    return {
      key: 'care.item.inDays',
      values: { days: item.daysRemaining },
      certain: true,
      urgency: 'soon',
    };
  }

  if (item.kmRemaining !== null) {
    return {
      key: 'care.item.afterKm',
      values: { km: item.kmRemaining },
      certain: false,
      urgency: item.kmRemaining <= CARE_LEAD_KM ? 'soon' : 'scheduled',
    };
  }

  if (item.daysRemaining !== null) {
    return {
      key: 'care.item.inDays',
      values: { days: item.daysRemaining },
      certain: true,
      urgency: 'scheduled',
    };
  }

  return {
    key: 'care.item.unknown',
    values: {},
    certain: false,
    urgency: 'unknown',
  };
}

/**
 * A document expiry, stated as the fact it is.
 *
 * `certain` is true on every branch, and that is the point rather than an
 * oversight — see the module header.
 */
export function documentLine(document: VehicleDocument): CareLine {
  if (document.isExpired) {
    return {
      key: 'care.doc.expired',
      values: { days: Math.abs(document.daysRemaining) },
      certain: true,
      urgency: 'overdue',
    };
  }

  if (document.daysRemaining === 0) {
    return { key: 'care.doc.today', values: {}, certain: true, urgency: 'overdue' };
  }

  return {
    key: 'care.doc.inDays',
    values: { days: document.daysRemaining },
    certain: true,
    urgency: document.daysRemaining <= CARE_LEAD_DAYS ? 'soon' : 'scheduled',
  };
}

/**
 * An item the owner has asked not to be reminded about yet.
 *
 * Snoozed items stay ON the screen — the snooze silences the notification, not
 * the record. A list that hid them would leave an owner unable to find the
 * thing they deferred, which is how a deferral becomes a forgotten service.
 */
export function isSnoozed(item: MaintenanceItem, now: number = Date.now()): boolean {
  if (item.snoozedUntil === null) return false;
  const until = new Date(item.snoozedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

const URGENCY_RANK: Readonly<Record<CareUrgency, number>> = {
  overdue: 0,
  soon: 1,
  scheduled: 2,
  unknown: 3,
};

/** Worst first. The screen renders القادم in the order this returns. */
export function byUrgency(a: CareLine, b: CareLine): number {
  return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
}
