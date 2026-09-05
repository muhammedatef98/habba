/**
 * Which face of the app is showing — customer or provider (§5.1.4).
 *
 * This is UI state, so it lives in Zustand (build prompt §3) and is persisted
 * so a technician who closes the app mid-shift comes back to their shift, not
 * to their own car's logbook.
 *
 * What this store is NOT is a permission. Setting `mode` to `provider` renders
 * provider screens; it grants nothing. Every provider read is refused by RLS
 * unless the user actually holds an approved provider record (§5.1.3), so the
 * worst a tampered value can do is show empty screens.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type AppMode = 'customer' | 'provider';

const STORAGE_KEY = 'habba.mode';

interface ModeState {
  readonly mode: AppMode;
  /** False until the persisted value has been read, so nothing flashes. */
  readonly restored: boolean;
  setMode: (mode: AppMode) => void;
  restore: () => Promise<void>;
}

export const useMode = create<ModeState>((set) => ({
  mode: 'customer',
  restored: false,

  setMode: (mode) => {
    set({ mode });
    // Fire-and-forget: a failed write costs the user one restored preference,
    // and blocking a mode switch on the keychain would be worse.
    void SecureStore.setItemAsync(STORAGE_KEY, mode).catch(() => undefined);
  },

  restore: async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      set({ mode: stored === 'provider' ? 'provider' : 'customer', restored: true });
    } catch {
      // SecureStore is unavailable on web and in tests. Customer is the right
      // default: it is what every account starts as (§5.1.1).
      set({ mode: 'customer', restored: true });
    }
  },
}));

export const useIsProviderMode = () => useMode((state) => state.mode === 'provider');
