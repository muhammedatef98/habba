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

/**
 * What a store build must carry. Without the first two the app falls back to
 * the in-memory repository and the dev OTP stub — a demo that looks real,
 * signs anyone in with 123456 and saves nothing — and without the third it
 * registers for no push notifications. Locally that fallback is the point;
 * in a build headed for the App Store or Google Play it is a disaster nobody
 * would notice until the reviews arrived. So a production build refuses to
 * start instead.
 */
export const REQUIRED_FOR_STORE = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY|EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EAS_PROJECT_ID',
] as const;

/** The project ID `app.json` carries, if any (`extra.eas.projectId`). */
function committedProjectId(extra: ConfigContext['config']['extra']): string | undefined {
  const eas: unknown = extra?.['eas'];
  if (typeof eas !== 'object' || eas === null) return undefined;
  const id: unknown = (eas as Record<string, unknown>)['projectId'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined;
}

/**
 * The variables a store build is missing, by name. Empty when it may proceed.
 * The EAS project ID is not a secret and identifies the app, so `app.json`
 * may carry it; the environment variable then only overrides it.
 */
export function missingForStore(extra?: ConfigContext['config']['extra']): string[] {
  return REQUIRED_FOR_STORE.filter((names) =>
    names === 'EAS_PROJECT_ID' && committedProjectId(extra) !== undefined
      ? false
      : names.split('|').every((name) => env(name) === undefined),
  ).map((names) => names.replace('|', ' or '));
}

export default ({ config }: ConfigContext): ExpoConfig => {
  // EAS sets EAS_BUILD_PROFILE on its build machines; `production` is the
  // profile the store builds use (eas.json). No map key is asked for: iOS
  // draws Apple Maps and Android draws OpenStreetMap through MapLibre, and
  // neither needs one (react-native.config.js, map/open-map.ts).
  if (process.env['EAS_BUILD_PROFILE'] === 'production') {
    const missing = missingForStore(config.extra);
    if (missing.length > 0) {
      throw new Error(
        `A store build needs ${missing.join(', ')}. Set them as EAS environment ` +
          'variables for the production environment (docs/GO-LIVE.md §7).',
      );
    }
  }
  return buildConfig(config);
};

function buildConfig(config: ConfigContext['config']): ExpoConfig {
  return {
    ...config,
    name: config.name ?? 'هبّة',
    slug: config.slug ?? 'habba',

    extra: {
      ...config.extra,

      // Absent → the app runs on the in-memory repository and the dev OTP stub,
      // which is what makes `pnpm start` work on a laptop with no project.
      supabaseUrl: env('EXPO_PUBLIC_SUPABASE_URL'),

      // Publishable key first, legacy anon key second. Both are designed to be
      // public and both work here; the publishable key is the one that survives
      // rotating the JWT signing secret, because it is not derived from it.
      // Reading both means the swap is a change of environment variable, and can
      // be reverted the same way.
      supabaseAnonKey:
        env('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? env('EXPO_PUBLIC_SUPABASE_ANON_KEY'),

      // Moyasar's publishable key — public by design, it can only start a
      // payment, never move money. Absent, the app uses the development payment
      // provider. Present, card payments go through Moyasar's form and the
      // `payments` Edge Function (lib/payment-provider.ts).
      moyasarPublishableKey: env('EXPO_PUBLIC_MOYASAR_PUBLISHABLE_KEY'),

      // The console's /pay/return page, where Moyasar sends the customer after
      // 3-D Secure (lib/moyasar-card-form.ts). Defaults to the production console.
      paymentReturnUrl: env('EXPO_PUBLIC_PAYMENT_RETURN_URL'),

      // Where push tokens come from (expo-notifications reads it here). Not a
      // secret — it identifies the project, it does not authorise anything.
      // Absent, the app runs unchanged and simply registers for no pushes.
      ...(env('EAS_PROJECT_ID') === undefined
        ? {}
        : { eas: { ...config.extra?.['eas'], projectId: env('EAS_PROJECT_ID') } }),
    },
  };
}
