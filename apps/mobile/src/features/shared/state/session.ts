/**
 * Session and UI state.
 *
 * Build prompt §3: Zustand holds UI state only. Server state belongs to
 * TanStack Query — duplicating it here is the mistake the spec's patterns
 * warn about.
 */

import { create } from 'zustand';
import { DEFAULT_LOCALE, type Locale } from '@habba/i18n';

interface SessionState {
  readonly phoneE164: string | null;
  readonly userId: string | null;
  readonly fullName: string | null;
  /**
   * A guest is signed in — they have a real uid and a real logbook (migration
   * 0039) — but has claimed no phone or email yet. Screens use this to prompt
   * for an identity at the point it actually buys something, rather than
   * gating the logbook up front (§11).
   */
  readonly isGuest: boolean;
  readonly locale: Locale;

  setPendingPhone: (phone: string) => void;
  signIn: (userId: string, fullName: string) => void;
  signInAsGuest: (userId: string, fullName: string) => void;
  /** Guest claimed an identity. Same uid, so the logbook carries over. */
  completeGuestUpgrade: (fullName: string) => void;
  signOut: () => void;
  setLocale: (locale: Locale) => void;
}

export const useSession = create<SessionState>((set) => ({
  phoneE164: null,
  userId: null,
  fullName: null,
  isGuest: false,
  locale: DEFAULT_LOCALE,

  setPendingPhone: (phoneE164) => set({ phoneE164 }),
  signIn: (userId, fullName) => set({ userId, fullName, isGuest: false }),
  signInAsGuest: (userId, fullName) => set({ userId, fullName, isGuest: true }),
  // Deliberately does not touch userId: the uid is the whole point of the
  // anonymous-auth approach, and changing it here would orphan the logbook
  // the database just kept.
  completeGuestUpgrade: (fullName) => set({ fullName, isGuest: false }),
  signOut: () => set({ userId: null, fullName: null, phoneE164: null, isGuest: false }),
  setLocale: (locale) => set({ locale }),
}));

export const useIsAuthenticated = () => useSession((state) => state.userId !== null);
export const useIsGuest = () => useSession((state) => state.isGuest);
