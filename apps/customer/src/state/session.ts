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
  readonly locale: Locale;

  setPendingPhone: (phone: string) => void;
  signIn: (userId: string, fullName: string) => void;
  signOut: () => void;
  setLocale: (locale: Locale) => void;
}

export const useSession = create<SessionState>((set) => ({
  phoneE164: null,
  userId: null,
  fullName: null,
  locale: DEFAULT_LOCALE,

  setPendingPhone: (phoneE164) => set({ phoneE164 }),
  signIn: (userId, fullName) => set({ userId, fullName }),
  signOut: () => set({ userId: null, fullName: null, phoneE164: null }),
  setLocale: (locale) => set({ locale }),
}));

export const useIsAuthenticated = () => useSession((state) => state.userId !== null);
