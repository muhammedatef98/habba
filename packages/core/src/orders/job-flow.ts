/**
 * The provider's job flow: what happens next, and whether it is allowed yet.
 *
 * This MIRRORS the database. The state machine in `enforce_order_transition`
 * is the authority (CLAUDE.md §2.2) — nothing here decides anything. Its job
 * is to stop the app offering a button the server will reject, because a
 * technician tapping "complete" and getting a Postgres error is a technician
 * who stops trusting the app at the roadside.
 *
 * The consequence is a real duplication risk: if the server's transitions
 * change and this does not, the app silently offers the wrong actions. The
 * parity test alongside this file reads the transition table out of the
 * database and asserts the two agree.
 */

export type OrderStatus =
  | 'draft'
  | 'searching'
  | 'quoted'
  | 'accepted'
  | 'checked_in'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type FulfilmentMode = 'mobile_ondemand' | 'mobile_scheduled' | 'workshop';

/** What the provider can do next, expressed as an action rather than a status. */
export type JobAction =
  | 'accept'
  | 'start_driving'
  | 'mark_arrived'
  | 'check_in_vehicle'
  | 'start_work'
  | 'record_evidence'
  | 'submit_for_approval'
  | 'cancel'
  | 'none';

export interface JobStep {
  readonly action: JobAction;
  /** i18n key, never a literal — CLAUDE.md §12. */
  readonly labelKey: string;
  /** The status this action moves the order to, or null if it is not a transition. */
  readonly toStatus: OrderStatus | null;
}

const WAITING: JobStep = { action: 'none', labelKey: 'job.waiting', toStatus: null };

/**
 * The provider's next step.
 *
 * Workshop jobs never drive: `checked_in` replaces en_route/arrived, which is
 * why the mode has to be part of this decision rather than the status alone
 * (ADR-0006).
 */
export function nextJobStep(status: OrderStatus, mode: FulfilmentMode): JobStep {
  switch (status) {
    // `searching` is the broadcast state, which only on-demand orders enter —
    // a scheduled or workshop customer picked their provider, so there is
    // nothing to search for.
    case 'searching':
      return mode === 'mobile_ondemand'
        ? { action: 'accept', labelKey: 'job.accept', toStatus: 'accepted' }
        : WAITING;

    case 'quoted':
      return { action: 'accept', labelKey: 'job.accept', toStatus: 'accepted' };

    case 'accepted':
      return mode === 'workshop'
        ? { action: 'check_in_vehicle', labelKey: 'job.checkIn', toStatus: 'checked_in' }
        : { action: 'start_driving', labelKey: 'job.startDriving', toStatus: 'en_route' };

    // The driving statuses belong to mobile modes only, and `checked_in`
    // belongs to workshop only. A mode/status pair that cannot occur returns
    // nothing rather than guessing: the app should never be in that state, and
    // if it somehow is, offering no action is safer than offering one the
    // server rejects.
    //
    // Not hypothetical — the parity test caught this exact drift, where the
    // mirror offered `checked_in → in_progress` on a mobile job and
    // `en_route → arrived` on a workshop job.
    case 'en_route':
      return mode === 'workshop'
        ? WAITING
        : { action: 'mark_arrived', labelKey: 'job.markArrived', toStatus: 'arrived' };

    case 'arrived':
      return mode === 'workshop'
        ? WAITING
        : { action: 'start_work', labelKey: 'job.startWork', toStatus: 'in_progress' };

    case 'checked_in':
      return mode === 'workshop'
        ? { action: 'start_work', labelKey: 'job.startWork', toStatus: 'in_progress' }
        : WAITING;

    case 'in_progress':
      return {
        action: 'submit_for_approval',
        labelKey: 'job.submitForApproval',
        toStatus: 'awaiting_approval',
      };

    // The customer closes the job, not the provider (ADR-0006). Offering a
    // "complete" button here would be offering something the server refuses.
    case 'awaiting_approval':
    case 'completed':
    case 'cancelled':
    case 'disputed':
    case 'draft':
      return WAITING;
  }
}

/** Whether the job is still live for the provider. */
export function isActiveJob(status: OrderStatus): boolean {
  return !['completed', 'cancelled', 'disputed', 'draft'].includes(status);
}

/** Statuses where the provider may still record or change evidence. */
export function canRecordEvidence(status: OrderStatus): boolean {
  return ['arrived', 'checked_in', 'in_progress'].includes(status);
}

// ---------------------------------------------------------------------------
// Completion evidence
// ---------------------------------------------------------------------------

export type CompletionMediaKind = 'before' | 'after' | 'part';

export interface CompletionMediaItem {
  readonly url: string;
  readonly kind: CompletionMediaKind;
  readonly caption?: string;
}

export interface EvidenceRequirement {
  readonly requiresMileage: boolean;
  readonly requiresPhotos: boolean;
}

export type EvidenceGap = 'mileage' | 'before_photo' | 'after_photo';

/**
 * Mirrors `assert_completion_evidence`.
 *
 * Returns what is still MISSING rather than a boolean, so the screen can tell
 * the technician which of the three things to do next instead of a generic
 * "incomplete". At the roadside, "add an after photo" and "something is
 * wrong" are very different instructions.
 */
export function missingEvidence(
  requirement: EvidenceRequirement,
  mileage: number | null,
  media: readonly CompletionMediaItem[],
): readonly EvidenceGap[] {
  const gaps: EvidenceGap[] = [];

  if (requirement.requiresMileage && (mileage === null || Number.isNaN(mileage))) {
    gaps.push('mileage');
  }

  if (requirement.requiresPhotos) {
    if (!media.some((item) => item.kind === 'before')) gaps.push('before_photo');
    if (!media.some((item) => item.kind === 'after')) gaps.push('after_photo');
  }

  return gaps;
}

export function isEvidenceComplete(
  requirement: EvidenceRequirement,
  mileage: number | null,
  media: readonly CompletionMediaItem[],
): boolean {
  return missingEvidence(requirement, mileage, media).length === 0;
}

/**
 * A plausibility check on the odometer, done on-device.
 *
 * The server rejects a reading below the recorded one, but a technician
 * fat-fingering an extra digit produces a reading that is *higher* and passes
 * every server check — then poisons the maintenance estimates and shows an
 * absurd number on the resale report. Catch it while they can still look at
 * the dashboard.
 */
export type MileageWarning = 'below_recorded' | 'implausible_jump' | null;

export function checkMileage(
  entered: number,
  lastKnown: number | null,
  daysSinceLastKnown: number,
): MileageWarning {
  if (lastKnown === null) return null;
  if (entered < lastKnown) return 'below_recorded';

  // 500 km/day sustained is already the clamp used by the maintenance
  // estimator; anything beyond that over the elapsed period is a typo.
  const plausibleCeiling = lastKnown + Math.max(1, daysSinceLastKnown) * 500;
  return entered > plausibleCeiling ? 'implausible_jump' : null;
}
