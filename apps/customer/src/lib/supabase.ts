/**
 * Supabase client construction.
 *
 * Returns null when the app has not been pointed at a project, which is the
 * current state: the region decision (ADR-0010) is still open and is chosen
 * once, at project creation, with a costly migration if reversed.
 *
 * Callers fall back to the in-memory repository, so the app runs end-to-end
 * today and switches over with configuration alone.
 */

import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface HabbaExtra {
  readonly supabaseUrl?: string;
  readonly supabaseAnonKey?: string;
}

const PLACEHOLDERS = new Set(['', 'dev-anon-key', 'http://localhost:54321']);

function readExtra(): HabbaExtra {
  return (Constants.expoConfig?.extra ?? {}) as HabbaExtra;
}

export function isSupabaseConfigured(): boolean {
  const { supabaseUrl, supabaseAnonKey } = readExtra();
  return (
    supabaseUrl !== undefined &&
    supabaseAnonKey !== undefined &&
    !PLACEHOLDERS.has(supabaseUrl) &&
    !PLACEHOLDERS.has(supabaseAnonKey)
  );
}

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cached !== null) return cached;

  const { supabaseUrl, supabaseAnonKey } = readExtra();

  cached = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
    auth: {
      // React Native has no localStorage; a storage adapter is wired when auth
      // becomes real. Until then sessions are not persisted, which is correct
      // for a client that cannot yet sign anyone in.
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return cached;
}
