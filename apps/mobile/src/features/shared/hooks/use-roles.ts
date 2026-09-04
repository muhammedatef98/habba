/**
 * The roles the server says this user holds (§5.1.3).
 *
 * Server state, so TanStack Query owns it rather than Zustand. It is refetched
 * rather than cached indefinitely because a role can be revoked while the app
 * is open — a suspended technician must lose the provider surface without
 * signing out and back in.
 *
 * Everything here answers "what should I render?". Nothing here answers "may I
 * do this?" — RLS answers that, and disagreeing with it is a blank screen, not
 * a privilege.
 */

import { useQuery } from '@tanstack/react-query';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';
import type { UserRole } from '@/features/shared/data/types';

const PROVIDER_ROLES: readonly UserRole[] = ['technician', 'workshop_admin'];

export function useRoles() {
  const isAuthenticated = useIsAuthenticated();

  return useQuery({
    queryKey: ['roles'],
    queryFn: () => repository.listRoles(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/**
 * Whether to show the mode switcher at all (§5.1.4).
 *
 * Defaults to false while loading and on error: a customer-only user must
 * never see provider UI, so the failure mode is "hidden", never "shown".
 */
export function useIsApprovedProvider(): boolean {
  const roles = useRoles();
  return (roles.data ?? []).some((role) => PROVIDER_ROLES.includes(role));
}

export function useProviderApplication() {
  const isAuthenticated = useIsAuthenticated();

  return useQuery({
    queryKey: ['provider-application'],
    queryFn: () => repository.getProviderApplication(),
    enabled: isAuthenticated,
  });
}
