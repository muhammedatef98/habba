/**
 * Who may see, and reach, the provider side.
 *
 * Every gate in the app funnels through these functions rather than each
 * screen writing its own condition. Two reasons:
 *
 *   1. There are two independent inputs — the role the server granted, and
 *      whether operators have applications open (0081) — and "hidden unless
 *      the right one allows it" is the sort of condition that gets dropped
 *      during a refactor of an unrelated screen.
 *   2. They are pure, so the gating is unit-testable. React Native components
 *      are not tested in this repo (no RNTL, no jest preset), which would
 *      otherwise leave the most consequential branch in the app —
 *      "is the KYC form reachable?" — proven by nothing.
 *
 * None of this is a security control. It decides what renders; RLS and
 * submit_provider_application() (0089) decide what the server accepts
 * (§5.1.3), and the two are independent by design.
 *
 * There used to be a build flag, ENABLE_PROVIDER_MODE, that kept all of this
 * off while the KYC seal was a placeholder (ADR-0017). The seal is now real
 * and on the server (0089), so the flag is gone: operators open and close
 * applications from the console instead.
 */

import type { UserRole } from '@/features/shared/data/types';

const PROVIDER_ROLES: readonly UserRole[] = ['technician', 'workshop_admin'];

export interface ProviderAccessInput {
  /** Roles the SERVER says are held. Empty while loading, and on error. */
  readonly roles: readonly UserRole[];
  /** `feature_provider_applications`, as the server reports it. */
  readonly applicationsOpen?: boolean;
}

export function holdsProviderRole(roles: readonly UserRole[]): boolean {
  return roles.some((role) => PROVIDER_ROLES.includes(role));
}

/**
 * Whether to show «اشتغل معنا كفنّي» and let the KYC form open: applications
 * are open, and this person does not already hold the role.
 */
export function canApplyAsProvider(input: ProviderAccessInput): boolean {
  return input.applicationsOpen !== false && !holdsProviderRole(input.roles);
}

/**
 * Whether the mode switcher renders and the `(provider)` group is reachable:
 * an approved provider role, and nothing else. A customer-only user never
 * sees the switcher. Closing applications does not lock out providers who
 * were already approved.
 */
export function canEnterProviderMode(input: ProviderAccessInput): boolean {
  return holdsProviderRole(input.roles);
}
