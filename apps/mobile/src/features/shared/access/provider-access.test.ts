/**
 * Who reaches the KYC screen and the provider side.
 *
 * Two parts, because either alone can be true while the wrong person still
 * reaches the form:
 *
 *   1. the decision — `canApplyAsProvider` / `canEnterProviderMode`
 *   2. the wiring — the screens actually consult the decision
 *
 * Part 2 is asserted by reading the source rather than by rendering, because
 * this repo has no React Native test renderer. That is a weaker test than
 * mounting the screen, and it is here deliberately: without it, deleting one
 * `if (!canApply) return <Redirect …/>` line would leave every other test in
 * this file green while the form became reachable to someone it should not be.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { canApplyAsProvider, canEnterProviderMode, holdsProviderRole } from './provider-access.js';
import type { UserRole } from '@/features/shared/data/types';

const CUSTOMER: readonly UserRole[] = ['customer'];
const TECHNICIAN: readonly UserRole[] = ['customer', 'technician'];
const WORKSHOP: readonly UserRole[] = ['customer', 'workshop_admin'];

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('applying', () => {
  test('a customer-only user is offered the upgrade while applications are open', () => {
    expect(canApplyAsProvider({ roles: CUSTOMER, applicationsOpen: true })).toBe(true);
  });

  test('nobody is offered it while operators have applications closed', () => {
    expect(canApplyAsProvider({ roles: CUSTOMER, applicationsOpen: false })).toBe(false);
    expect(canApplyAsProvider({ roles: [], applicationsOpen: false })).toBe(false);
  });

  test('someone who already holds the role is not', () => {
    expect(canApplyAsProvider({ roles: TECHNICIAN, applicationsOpen: true })).toBe(false);
    expect(canApplyAsProvider({ roles: WORKSHOP, applicationsOpen: true })).toBe(false);
  });
});

describe('provider mode', () => {
  test('the switcher appears only for a held provider role', () => {
    expect(holdsProviderRole(TECHNICIAN)).toBe(true);
    expect(canEnterProviderMode({ roles: TECHNICIAN })).toBe(true);
    expect(canEnterProviderMode({ roles: WORKSHOP })).toBe(true);
    expect(canEnterProviderMode({ roles: CUSTOMER })).toBe(false);
    expect(canEnterProviderMode({ roles: ['ops'] })).toBe(false);
  });

  test('closing applications does not lock out a provider already approved', () => {
    expect(canEnterProviderMode({ roles: TECHNICIAN, applicationsOpen: false })).toBe(true);
  });

  test('an unanswered roles query renders nothing provider-shaped', () => {
    // `roles` is empty while the query is loading and after it errors. Both
    // must read as "not a provider" — showing the switcher on an unanswered
    // question is the one outcome that must not happen.
    expect(canEnterProviderMode({ roles: [] })).toBe(false);
  });
});

describe('the screens are wired to the gate', () => {
  const becomeProvider = readFileSync(join(SRC, 'screens/become-provider.tsx'), 'utf8');
  // The account tab, where both doors live. They were on a profile screen
  // that no other screen linked to, so neither could be reached at all.
  const account = readFileSync(join(SRC, '../customer/screens/tabs/account.tsx'), 'utf8');

  test('the KYC screen redirects before it renders a single field', () => {
    expect(becomeProvider).toContain('useCanApplyAsProvider');

    const guardAt = becomeProvider.indexOf('if (!canApply) return <Redirect');
    const firstFieldAt = becomeProvider.indexOf('<Field');

    expect(guardAt).toBeGreaterThan(-1);
    expect(firstFieldAt).toBeGreaterThan(-1);
    // Not "the fields are hidden" — the component returns before reaching them.
    expect(guardAt).toBeLessThan(firstFieldAt);
  });

  test('the account tab gates the upgrade card and the switcher on the same decisions', () => {
    expect(account).toContain('useCanApplyAsProvider');
    expect(account).toContain('canApply ? (');
    // The switcher only on the server's answer, and checked first, so an
    // approved provider is never shown the invitation to apply.
    expect(account).toContain('useIsApprovedProvider');
    expect(account.indexOf('{isProvider ? (')).toBeLessThan(account.indexOf('canApply ? ('));
    expect(account).toContain("router.push('/become-provider')");
  });

  test('the KYC screen asks for an ID and an IBAN — so the guard matters', () => {
    // If this ever stops being true the guard above is testing nothing, and
    // this file should be revisited rather than quietly passing.
    expect(becomeProvider).toContain('nationalIdLabel');
    expect(becomeProvider).toContain('ibanLabel');
  });
});
