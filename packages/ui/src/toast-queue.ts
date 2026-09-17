/**
 * What a toast does when another one arrives.
 *
 * Kept as pure data because the interesting behaviour here is not the
 * animation, it is the ordering — and ordering is what breaks. Three mutations
 * settling within the same second is normal on a screen that invalidates four
 * queries; without rules, that is either three banners stacked over the tab bar
 * or two confirmations the customer never sees.
 *
 * The rules, in order of how often they matter:
 *
 *  1. **One at a time.** A stack is a notification centre, and this is not one.
 *  2. **A repeat of what is already showing extends it, it does not queue.**
 *     Double-tapping "save" must not mean reading the same sentence twice.
 *  3. **An error interrupts.** A failure the customer needs to know about must
 *     not wait behind "تم الحفظ" — it goes to the front of the queue.
 *  4. **The queue is short.** Past a couple of pending messages nobody is
 *     reading them; the oldest pending one is dropped rather than the newest,
 *     because the newest is the one describing what just happened.
 */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
  /** Optional single action, e.g. «تراجع» or «عرض». */
  readonly actionLabel?: string | undefined;
  /** How long it stays once shown, in ms. */
  readonly durationMs: number;
}

export interface ToastQueueState {
  /** The one on screen, or null when nothing is showing. */
  readonly current: ToastItem | null;
  readonly pending: readonly ToastItem[];
}

export const emptyToastQueue: ToastQueueState = { current: null, pending: [] };

/** Rule 4. Two waiting is already more than anyone reads. */
export const MAX_PENDING_TOASTS = 2;

/**
 * Default dwell times.
 *
 * An error gets longer because it is the one the reader has to act on, and
 * because it tends to carry more words — Arabic error copy in this app is a
 * sentence, not a word, and a sentence at 3 seconds is a sentence half-read.
 */
export const TOAST_DURATION_MS: Readonly<Record<ToastTone, number>> = {
  success: 2600,
  info: 3200,
  error: 4800,
};

/**
 * A toast carrying an action stays longer whatever its tone: the dwell time is
 * now a deadline to decide, not a deadline to read.
 */
export const TOAST_WITH_ACTION_DURATION_MS = 5600;

export function enqueueToast(state: ToastQueueState, item: ToastItem): ToastQueueState {
  // Rule 2. Same words as the one on screen: restart it rather than repeat it.
  // The id changes, which is what tells the view to reset its timer — the
  // message is identical, so nothing visibly moves.
  if (state.current !== null && state.current.message === item.message) {
    return { ...state, current: item };
  }

  // …and the same if it is already waiting: collapse the duplicate rather than
  // making someone read it twice in a row.
  if (state.pending.some((queued) => queued.message === item.message)) {
    return state;
  }

  if (state.current === null) {
    return { current: item, pending: state.pending };
  }

  // Rule 3. A failure does not wait behind a confirmation.
  const pending = item.tone === 'error' ? [item, ...state.pending] : [...state.pending, item];

  // Rule 4. Drop from the end — the tail is the stalest thing in the queue,
  // and after an error jumped the front that is also the least relevant.
  return { current: state.current, pending: pending.slice(0, MAX_PENDING_TOASTS) };
}

/** The one on screen is done. Promote the next, if there is one. */
export function advanceToastQueue(state: ToastQueueState): ToastQueueState {
  const [next, ...rest] = state.pending;
  return { current: next ?? null, pending: rest };
}

/** Everything goes: a sign-out, a mode switch, a screen that owns the whole window. */
export function clearToastQueue(): ToastQueueState {
  return emptyToastQueue;
}
