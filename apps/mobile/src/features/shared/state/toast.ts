/**
 * One short message at a time, over every screen.
 *
 * For the actions that had nowhere to say they failed: «تم» on a care item,
 * a technician going online, declining an offer, removing a quoted part. Each
 * failed in silence — the button stopped spinning and nothing else happened,
 * which reads as "the app ignored me" and gets tapped again. The query
 * client's mutation cache raises this for any action that has no error
 * handling of its own (app/_layout.tsx); an action that shows its error in
 * place says so with `meta: { inlineError: true }`.
 */

import { create } from 'zustand';

export type ToastTone = 'error' | 'success';

interface ToastState {
  readonly message: string | null;
  readonly tone: ToastTone;
  /** Changes on every show, so the same message twice still replays. */
  readonly serial: number;
  readonly show: (message: string, tone?: ToastTone) => void;
  readonly hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'error',
  serial: 0,
  show: (message, tone = 'error') => set((state) => ({ message, tone, serial: state.serial + 1 })),
  hide: () => set({ message: null }),
}));
