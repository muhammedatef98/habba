/**
 * Expo config, driven by environment variables.
 *
 * `app.json` held the Supabase URL and anon key as literals. That is wrong for
 * three reasons, and the third is the one that bites:
 *
 *   1. A staging build and a production build differ only in configuration, so
 *      configuration must not live in a versioned file.
 *   2. Rotating a key should not be a commit.
 *   3. A literal in a versioned file is a literal in every fork, every clone,
 *      and every screenshot of the repository. The anon key is public by
 *      design, but "public by design" and "committed by habit" are different
 *      postures, and only one of them survives someone pasting the wrong key.
 *
 * `app.json` keeps everything that is genuinely part of the app's identity —
 * name, slug, scheme, bundle identifiers — and Expo merges it with what this
 * file returns. Only the parts that vary by environment are here.
 *
 * ⚠️ Everything in `extra` ships INSIDE THE BUNDLE and is readable by anyone
 * with the app. That is fine for the Supabase URL and the anon key, which are
 * designed to be public and are useless without RLS being wrong. It is not fine
 * for anything else: the service-role key, the Unifonic app SID and the SMS
 * hook secret are server-side only and never appear here (CLAUDE.md §5.1.6 says
 * the same thing about the admin app).
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Reads a public build variable. Empty is treated as unset. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'هبّة',
  slug: config.slug ?? 'habba',

  extra: {
    ...config.extra,

    // Absent → the app runs on the in-memory repository and the dev OTP stub,
    // which is what makes `pnpm start` work on a laptop with no project.
    supabaseUrl: env('EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: env('EXPO_PUBLIC_SUPABASE_ANON_KEY'),

    // Off unless explicitly enabled (ADR-0017). Parsed as a strict equality
    // against 'true' so a typo, `1`, or `yes` leaves the flow off rather than
    // opening a KYC form we cannot yet protect.
    enableProviderMode: env('EXPO_PUBLIC_ENABLE_PROVIDER_MODE') === 'true',

    // Where تقرير هبّة is served, for the share link the app shows.
    reportBaseUrl: env('EXPO_PUBLIC_REPORT_BASE_URL') ?? 'https://habba.sa/r',
  },
});
