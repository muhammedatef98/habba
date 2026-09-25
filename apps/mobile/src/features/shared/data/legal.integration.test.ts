/**
 * The terms, privacy policy and provider terms (0083), through the app's own
 * repository: read signed out, filled from the settings, and accepted once.
 */

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';
import { SupabaseRepository } from './supabase-repository.js';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

async function isHarnessUp(): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(`${POSTGREST_URL}/vehicle_makes?limit=1`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const harnessUp = await isHarnessUp();

if (process.env.HABBA_REQUIRE_HARNESS === '1' && !harnessUp) {
  throw new Error(`Integration harness unreachable at ${POSTGREST_URL}.`);
}

function restFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return fetch(raw.replace('/rest/v1/', '/'), init);
}

function clientFor(
  userId: string,
  role: 'anon' | 'authenticated' = 'authenticated',
): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, { sub: userId, role });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

describe.skipIf(!harnessUp)('legal documents through the repository', () => {
  test('anyone reads the terms, with the company and the complaint window filled in', async () => {
    const signedOut = new SupabaseRepository(
      clientFor('00000000-0000-4000-8000-000000000000', 'anon'),
      () => null,
    );
    const terms = await signedOut.getLegalDocument('terms');
    expect(terms.version).toBeGreaterThanOrEqual(1);
    expect(terms.bodyAr.startsWith('# شروط وأحكام')).toBe(true);
    expect(terms.bodyAr).not.toContain('{{');
    expect(terms.bodyAr).toContain('خلال 14 يوماً');
    expect(terms.bodyEn).toContain('Habba');

    expect(await signedOut.listPendingLegalDocuments()).toEqual([]);
  });

  test('a new account accepts the terms and the privacy policy once', async () => {
    const userId = randomUUID();
    const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const client = clientFor(userId);
    await client.rpc('test_seed_auth_user', { p_id: userId, p_phone: phone });
    await client.from('profiles').upsert({ id: userId, full_name: 'الموافق', phone });
    const repo = new SupabaseRepository(client, () => userId);

    const pending = await repo.listPendingLegalDocuments();
    expect(pending.map((document) => document.kind).sort()).toEqual(['privacy', 'terms']);

    await repo.acceptLegalDocuments(pending.map((document) => document.id));
    expect(await repo.listPendingLegalDocuments()).toEqual([]);
  });
});
