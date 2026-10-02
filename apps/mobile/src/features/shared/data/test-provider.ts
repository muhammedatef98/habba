/**
 * Integration-test fixture: a provider application, made the only way the
 * server allows (0089) — through submit_provider_application, with a national
 * ID and IBAN that pass the server's checks.
 *
 * Each owner gets its own identity, derived from their id, because one
 * identity may back only one provider account. Derived rather than random so
 * a re-run against the same database finds the record it made last time
 * instead of colliding with it.
 *
 * Test-only, like test-jwt.ts: nothing in the app imports it.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Digits from a hash of the seed: test ids differ in one character. */
function digitsFrom(seed: string, count: number, salt: string): string {
  const hex = createHash('sha256').update(`${salt}:${seed}`).digest('hex');
  let out = '';
  for (let i = 0; out.length < count; i++) out += String(parseInt(hex[i % hex.length]!, 16) % 10);
  return out;
}

/** A valid citizen ID (leading 1, Luhn-style check digit) for this seed. */
export function testNationalId(seed: string): string {
  const first = `1${digitsFrom(seed, 8, 'id')}`;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = first.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  return `${first}${(10 - (sum % 10)) % 10}`;
}

/** A valid Saudi IBAN (mod-97) for this seed. */
export function testIban(seed: string): string {
  const bban = `80${digitsFrom(seed, 18, 'iban')}`;
  // SA = 28 10; check digits computed over BBAN + "SA00".
  const check = 98 - Number(BigInt(`${bban}281000`) % 97n);
  return `SA${String(check).padStart(2, '0')}${bban}`;
}

export interface FixtureApplication {
  readonly ownerId: string;
  readonly providerType: 'individual' | 'workshop';
  readonly businessNameAr: string;
  readonly cityId: string;
  readonly crNumber?: string;
}

/**
 * Applies as `client` and returns the provider record's id, or throws with
 * the server's message.
 */
export async function applyAsTestProvider(
  client: SupabaseClient,
  application: FixtureApplication,
): Promise<{ id: string; verificationStatus: string }> {
  const applied = await client.rpc('submit_provider_application', {
    p_provider_type: application.providerType,
    p_business_name_ar: application.businessNameAr,
    p_city_id: application.cityId,
    p_national_id: testNationalId(application.ownerId),
    p_iban: testIban(application.ownerId),
    p_cr_number: application.crNumber ?? null,
  });
  if (applied.error !== null) throw new Error(`fixture provider: ${applied.error.message}`);

  const row = await client
    .from('providers')
    .select('id')
    .eq('owner_profile_id', application.ownerId)
    .single();
  if (row.error !== null) throw new Error(`fixture provider: ${row.error.message}`);

  return {
    id: (row.data as { id: string }).id,
    verificationStatus: (applied.data as { verification_status: string }).verification_status,
  };
}
