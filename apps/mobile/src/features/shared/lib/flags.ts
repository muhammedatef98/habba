/**
 * Feature flags.
 *
 * One flag today: `ENABLE_PROVIDER_MODE`, default **false**.
 *
 * The provider side is built and tested, but the KYC vault is a placeholder
 * (ADR-0017) and the ops console that approves an application does not exist
 * (Amendment B, Phase 6). Shipping the logbook launch with the upgrade flow
 * visible would collect national IDs and IBANs into a column sealed by a dev
 * digest, from applicants nobody can approve. So the flow is off until both
 * are real — the flag is the switch, not a rewrite.
 *
 * Read from Expo config (`expo.extra.enableProviderMode`) so a build turns it
 * on without a code change, matching how the Supabase credentials work.
 *
 * The flag decides what the app RENDERS. It is not a security control and must
 * never be treated as one: with the flag forced on, a user still holds no
 * provider role, and RLS still refuses every provider read (§5.1.3).
 */

import Constants from 'expo-constants';

interface HabbaFlags {
  readonly enableProviderMode?: boolean;
}

/**
 * Defaults to false when unset, misconfigured, or unreadable. A flag that
 * fails open is not a flag — and the failure here would be collecting KYC
 * data we cannot yet protect.
 */
export function isProviderModeEnabled(): boolean {
  try {
    const extra = (Constants.expoConfig?.extra ?? {}) as HabbaFlags;
    return extra.enableProviderMode === true;
  } catch {
    return false;
  }
}
