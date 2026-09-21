/**
 * Feature flags.
 *
 * `ENABLE_PROVIDER_MODE`, default **false**, and a dev-only companion to it.
 *
 * The provider side is built and tested, and `apps/admin` now carries the
 * verification queue that grants the role. What is still a placeholder is the
 * KYC vault (ADR-0017): shipping the logbook launch with the upgrade flow
 * visible would collect national IDs and IBANs into a column sealed by a dev
 * digest. So the flow stays off until the vault is real — which waits on
 * ADR-0010 — and the flag is the switch, not a rewrite.
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
  readonly devApproveProvider?: boolean;
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

/**
 * `EXPO_PUBLIC_DEV_APPROVE_PROVIDER` — approve your own application, in the
 * in-memory build only.
 *
 * الفحص is the one flow that needs two actors on one record: an inspector
 * files a document and a buyer reads it. The dev build is one process and one
 * account, and a provider role is granted by approval — correctly, since
 * `applyAsProvider` leaves an application `pending` on purpose so the screens
 * that handle waiting are not hidden behind a stub that approves instantly.
 * The consequence is that the inspector's half of the flow cannot be reached
 * on a laptop at all without a database and an ops console.
 *
 * This flag removes that, and nothing else. It is read ONLY by
 * `InMemoryRepository`, which is the repository that exists because no project
 * does (ADR-0010). Point the app at Supabase and `listRoles()` comes from
 * `SupabaseRepository`, where this flag is not read and could not matter: the
 * server decides what roles a user holds and RLS decides what they may do
 * (§5.1.3). A client that lies to itself about its roles still gets refused.
 *
 * Off by default, and strict equality against 'true' for the same reason as
 * the flag above: a typo must leave it off.
 */
export function isDevProviderApprovalEnabled(): boolean {
  try {
    const extra = (Constants.expoConfig?.extra ?? {}) as HabbaFlags;
    return extra.devApproveProvider === true;
  } catch {
    return false;
  }
}
