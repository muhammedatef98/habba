/**
 * The KYC screen must be unreachable while ENABLE_PROVIDER_MODE is off.
 *
 * That claim has three parts, and this file proves all three, because any one
 * of them alone can be true while a national ID still reaches storage:
 *
 *   1. the decision — `canApplyAsProvider` / `canEnterProviderMode`
 *   2. the data path — `applyAsProvider` refuses, whatever screen called it
 *   3. the wiring — the screens actually consult the decision
 *
 * Part 3 is asserted by reading the source rather than by rendering, because
 * this repo has no React Native test renderer. That is a weaker test than
 * mounting the screen, and it is here deliberately: without it, deleting one
 * `if (!canApply) return <Redirect …/>` line would leave every other test in
 * this file green while the form asking for an IBAN became reachable again.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  assertProviderApplicationsAllowed,
  canApplyAsProvider,
  canEnterProviderMode,
  holdsProviderRole,
} from './provider-access.js';
import type { UserRole } from '@/features/shared/data/types';

const CUSTOMER: readonly UserRole[] = ['customer'];
const TECHNICIAN: readonly UserRole[] = ['customer', 'technician'];
const WORKSHOP: readonly UserRole[] = ['customer', 'workshop_admin'];

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('with ENABLE_PROVIDER_MODE off (the default)', () => {
  const off = { providerModeEnabled: false } as const;

  test('«اشتغل معنا كفنّي» is not offered to anyone', () => {
    expect(canApplyAsProvider({ roles: CUSTOMER, ...off })).toBe(false);
    expect(canApplyAsProvider({ roles: [], ...off })).toBe(false);
  });

  test('the mode switcher is hidden even from an approved provider', () => {
    // The role is real and the server would honour it. The surface behind the
    // switcher still depends on an ops console that does not exist, so the flag
    // wins.
    expect(holdsProviderRole(TECHNICIAN)).toBe(true);
    expect(canEnterProviderMode({ roles: TECHNICIAN, ...off })).toBe(false);
    expect(canEnterProviderMode({ roles: WORKSHOP, ...off })).toBe(false);
  });

  test('an application cannot be submitted at all', () => {
    // The KYC values never leave the device, so nothing is sealed with the
    // placeholder vault (ADR-0017).
    expect(() => assertProviderApplicationsAllowed()).toThrow('provider_mode_disabled');
  });
});

describe('with ENABLE_PROVIDER_MODE on', () => {
  const on = { providerModeEnabled: true } as const;

  test('a customer-only user is offered the upgrade', () => {
    expect(canApplyAsProvider({ roles: CUSTOMER, ...on })).toBe(true);
  });

  test('someone who already holds the role is not', () => {
    expect(canApplyAsProvider({ roles: TECHNICIAN, ...on })).toBe(false);
    expect(canApplyAsProvider({ roles: WORKSHOP, ...on })).toBe(false);
  });

  test('the switcher appears only for a held provider role', () => {
    expect(canEnterProviderMode({ roles: TECHNICIAN, ...on })).toBe(true);
    expect(canEnterProviderMode({ roles: WORKSHOP, ...on })).toBe(true);
    expect(canEnterProviderMode({ roles: CUSTOMER, ...on })).toBe(false);
    expect(canEnterProviderMode({ roles: ['ops'], ...on })).toBe(false);
  });

  test('an unanswered roles query renders nothing provider-shaped', () => {
    // `roles` is empty while the query is loading and after it errors. Both
    // must read as "not a provider" — showing the switcher on an unanswered
    // question is the one outcome that must not happen.
    expect(canEnterProviderMode({ roles: [], ...on })).toBe(false);
  });
});

describe('the screens are wired to the gate', () => {
  const becomeProvider = readFileSync(join(SRC, 'screens/become-provider.tsx'), 'utf8');
  const profile = readFileSync(join(SRC, 'screens/profile.tsx'), 'utf8');

  test('the KYC screen redirects before it renders a single field', () => {
    expect(becomeProvider).toContain('useCanApplyAsProvider');

    const guardAt = becomeProvider.indexOf('if (!canApply) return <Redirect');
    const firstFieldAt = becomeProvider.indexOf('<Field');

    expect(guardAt).toBeGreaterThan(-1);
    expect(firstFieldAt).toBeGreaterThan(-1);
    // Not "the fields are hidden" — the component returns before reaching them.
    expect(guardAt).toBeLessThan(firstFieldAt);
  });

  test('the profile screen gates the upgrade card on the same decision', () => {
    expect(profile).toContain('useCanApplyAsProvider');
    expect(profile).toContain('{canApply ? (');
  });

  test('the KYC screen asks for an ID and an IBAN — so the guard matters', () => {
    // If this ever stops being true the guard above is testing nothing, and
    // this file should be revisited rather than quietly passing.
    expect(becomeProvider).toContain('nationalIdLabel');
    expect(becomeProvider).toContain('ibanLabel');
  });
});
