/**
 * Who may see, and reach, the provider side.
 *
 * Every gate in the app funnels through these three functions rather than each
 * screen writing its own condition. Two reasons:
 *
 *   1. There are now two independent gates — the `ENABLE_PROVIDER_MODE` flag
 *      and the role the server granted — and "hidden unless BOTH allow it" is
 *      the sort of condition that gets one of its halves dropped during a
 *      refactor of an unrelated screen.
 *   2. They are pure, so the gating is unit-testable. React Native components
 *      are not tested in this repo (no RNTL, no jest preset), which would
 *      otherwise leave the most consequential branch in the app —
 *      "is the KYC form reachable?" — proven by nothing.
 *
 * None of this is a security control. It decides what renders; RLS decides
 * what the server answers (§5.1.3), and the two are independent by design.
 */

import { isProviderModeEnabled } from '@/features/shared/lib/flags';
import type { UserRole } from '@/features/shared/data/types';

const PROVIDER_ROLES: readonly UserRole[] = ['technician', 'workshop_admin'];

export interface ProviderAccessInput {
  /** Roles the SERVER says are held. Empty while loading, and on error. */
  readonly roles: readonly UserRole[];
  /** Defaults to the configured flag; injectable so tests need no config. */
  readonly providerModeEnabled?: boolean;
}

function flagOf(input: ProviderAccessInput): boolean {
  return input.providerModeEnabled ?? isProviderModeEnabled();
}

export function holdsProviderRole(roles: readonly UserRole[]): boolean {
  return roles.some((role) => PROVIDER_ROLES.includes(role));
}

/**
 * Whether to show «اشتغل معنا كفنّي» and let the KYC form open.
 *
 * False while the flag is off — the point of the flag is that no ID or IBAN is
 * collected until the vault is real (ADR-0017) — and false for someone who
 * already holds the role, who has nothing left to apply for.
 */
export function canApplyAsProvider(input: ProviderAccessInput): boolean {
  return flagOf(input) && !holdsProviderRole(input.roles);
}

/**
 * Whether the mode switcher renders and the `(provider)` group is reachable.
 *
 * Requires the flag AND an approved provider role. A customer-only user must
 * never see the switcher even with the flag on; a real provider must not see
 * it while the flow is off, because the surface behind it depends on an ops
 * console that does not exist yet.
 */
export function canEnterProviderMode(input: ProviderAccessInput): boolean {
  return flagOf(input) && holdsProviderRole(input.roles);
}

/**
 * Server-side of the same gate, for the data layer.
 *
 * The screens are gated already; this exists so that a KYC payload cannot
 * leave the device through a code path added later that forgets to ask. It
 * throws rather than returning false because there is no sensible partial
 * outcome: either the application is allowed or the values must not be sent.
 */
export function assertProviderApplicationsAllowed(): void {
  if (!isProviderModeEnabled()) {
    throw new Error('provider_mode_disabled');
  }
}
