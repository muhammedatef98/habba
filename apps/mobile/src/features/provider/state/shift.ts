/**
 * The provider's shift state.
 *
 * Build prompt §9.2: "Online toggle. Prominent. Location broadcast only while
 * online (battery + privacy)."
 *
 * Both halves of that parenthesis are real. A technician's phone is their
 * livelihood and a dead battery ends their day; and a background location
 * feed that keeps running after a shift is surveillance of someone who did
 * not agree to it. Going offline therefore stops the broadcast AND clears the
 * stored position server-side (set_provider_online does the delete).
 */

import { create } from 'zustand';

/** How often position is pushed while online. */
export const LOCATION_INTERVAL_MS = 20_000;

/**
 * The matcher ignores fixes older than five minutes, so a slower cadence than
 * this would quietly make a provider invisible to dispatch while they believe
 * they are online.
 */
export const LOCATION_STALE_AFTER_MS = 5 * 60_000;

/**
 * Why the position did not reach the server, in the three shapes that need
 * different words on the screen.
 *
 *   * `permission_denied` — the technician refused location access, probably
 *     months ago and to a different screen. Nothing on this phone will change
 *     that except a trip to Settings.
 *   * `unavailable` — no fix right now: a basement, a tunnel, airplane mode. It
 *     resolves itself the moment they drive out.
 *   * `rejected` — a fix was obtained and the server would not take it. That is
 *     the network, or an account that is no longer an approved provider.
 */
export type BroadcastFailure = 'permission_denied' | 'unavailable' | 'rejected';

/**
 * Whether retrying is pointless.
 *
 * A denial does not resolve itself, so the loop stops rather than waking the
 * GPS every twenty seconds for an answer that cannot change — which would cost
 * battery on the phone whose battery is the technician's working day, and bury
 * the one message that would actually fix it under a retry that never succeeds.
 */
export function isBroadcastBlocked(failure: BroadcastFailure | null): boolean {
  return failure === 'permission_denied';
}

interface ShiftState {
  readonly isOnline: boolean;
  readonly lastBroadcastAt: number | null;
  readonly broadcastError: BroadcastFailure | null;

  setOnline: (online: boolean) => void;
  markBroadcast: (at: number) => void;
  setBroadcastError: (failure: BroadcastFailure | null) => void;
}

export const useShift = create<ShiftState>((set) => ({
  isOnline: false,
  lastBroadcastAt: null,
  broadcastError: null,

  setOnline: (isOnline) => set({ isOnline, lastBroadcastAt: null, broadcastError: null }),
  markBroadcast: (lastBroadcastAt) => set({ lastBroadcastAt, broadcastError: null }),
  setBroadcastError: (broadcastError) => set({ broadcastError }),
}));

/**
 * Whether the provider is online but has not successfully reported a position
 * recently enough for dispatch to see them.
 *
 * This is the state worth surfacing loudly: the technician believes they are
 * working, and no jobs are arriving because the server considers their fix
 * stale. Silence looks identical to a quiet night.
 */
export function isBroadcastStale(lastBroadcastAt: number | null, now = Date.now()): boolean {
  if (lastBroadcastAt === null) return true;
  return now - lastBroadcastAt > LOCATION_STALE_AFTER_MS;
}
