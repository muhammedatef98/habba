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
import { canApplyAsProvider, canEnterProviderMode } from '@/features/shared/access/provider-access';
import { useIsAuthenticated } from '@/features/shared/state/session';
import { useFeatures } from '@/features/shared/hooks/use-platform';

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
 * Whether the mode switcher renders and the provider group is reachable
 * (§5.1.4), which needs both an approved role and the ENABLE_PROVIDER_MODE
 * flag.
 *
 * Defaults to false while loading and on error: a customer-only user must
 * never see provider UI, so the failure mode is "hidden", never "shown".
 */
export function useIsApprovedProvider(): boolean {
  const roles = useRoles();
  return canEnterProviderMode({ roles: roles.data ?? [] });
}

/** Whether «اشتغل معنا كفنّي» is offered and the KYC form may open. */
export function useCanApplyAsProvider(): boolean {
  const roles = useRoles();
  // The build's flag and the operators' switch (0081) must both allow it.
  const open = useFeatures().providerApplications;
  return open && canApplyAsProvider({ roles: roles.data ?? [] });
}

export function useProviderApplication() {
  const isAuthenticated = useIsAuthenticated();

  return useQuery({
    queryKey: ['provider-application'],
    queryFn: () => repository.getProviderApplication(),
    enabled: isAuthenticated,
  });
}
