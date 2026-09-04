/**
 * Provider route group (§5.1.4).
 *
 * This gate is a rendering decision, not a security control. It exists so a
 * customer-only user never SEES provider UI; what stops them READING provider
 * data is RLS, which does not consult this file or anything else on the device
 * (§5.1.3). If this check were deleted tomorrow, a customer navigating here by
 * hand would get empty screens and refused requests — not a job feed.
 *
 * `useIsApprovedProvider()` answers two questions at once: does the server say
 * this user holds a provider role, and is ENABLE_PROVIDER_MODE on. Both must be
 * true — the flag is off for the logbook launch (ADR-0017), so this whole group
 * is unreachable regardless of role.
 *
 * It fails closed in both directions: while the roles query is loading, and if
 * it errors, `useIsApprovedProvider()` is false and the group is unreachable.
 * Showing provider UI on an unanswered question is the one outcome that must
 * not happen.
 */

import { Redirect, Stack } from 'expo-router';
import { useIsApprovedProvider, useRoles } from '@/features/shared/hooks/use-roles';
import { useIsAuthenticated } from '@/features/shared/state/session';

export default function ProviderLayout() {
  const isAuthenticated = useIsAuthenticated();
  const roles = useRoles();
  const isProvider = useIsApprovedProvider();

  if (!isAuthenticated) return <Redirect href="/" />;

  // Wait for the answer rather than guessing at it. A flash of the job feed
  // for a suspended technician is a broken promise about who they are.
  if (roles.isPending) return null;

  if (!isProvider) return <Redirect href="/vehicles" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />;
}
