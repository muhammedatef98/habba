/**
 * Parity between the client job-flow mirror and the database state machine.
 *
 * `nextJobStep` in @habba/core duplicates knowledge that lives authoritatively
 * in `order_transitions`. Duplication is deliberate — the app must not offer a
 * button the server will reject, because a technician who taps "arrived" and
 * gets a Postgres error stops trusting the app at the roadside.
 *
 * But a mirror that drifts is worse than no mirror: it offers the wrong action
 * confidently. This reads the real table and asserts the two agree, so a
 * change to the server's transitions fails here rather than in someone's hands.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';
import { nextJobStep, type FulfilmentMode, type OrderStatus } from '@habba/core';
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

function client(): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, {
    sub: '00000000-0000-4000-8000-00000000ffff',
    role: 'authenticated',
  });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

const MODES: FulfilmentMode[] = ['mobile_ondemand', 'mobile_scheduled', 'workshop'];

const PROVIDER_REACHABLE: OrderStatus[] = [
  'searching',
  'quoted',
  'accepted',
  'en_route',
  'arrived',
  'checked_in',
  'in_progress',
  'awaiting_approval',
];

describe.skipIf(!harnessUp)('job flow mirrors the database state machine', () => {
  test('every action the app offers is a transition the server allows', async () => {
    const rows = await client()
      .from('order_transitions')
      .select('fulfilment_mode, from_status, to_status');

    expect(rows.error).toBeNull();

    const allowed = new Set(
      (rows.data as { fulfilment_mode: string; from_status: string; to_status: string }[]).map(
        (row) => `${row.fulfilment_mode}:${row.from_status}->${row.to_status}`,
      ),
    );

    expect(allowed.size).toBeGreaterThan(0);

    const offered: string[] = [];
    for (const mode of MODES) {
      for (const status of PROVIDER_REACHABLE) {
        const step = nextJobStep(status, mode);
        if (step.toStatus === null) continue;

        const key = `${mode}:${status}->${step.toStatus}`;
        offered.push(key);
        expect(allowed.has(key), `app offers ${key}, which the server rejects`).toBe(true);
      }
    }

    // Guard against the mirror quietly going silent: if a refactor made
    // nextJobStep return `none` everywhere, every assertion above would pass
    // vacuously.
    expect(offered.length).toBeGreaterThanOrEqual(15);
  });

  test('the app never offers a transition to completed', async () => {
    // Only the customer confirms completion (ADR-0006). The server enforces
    // it; this asserts the app does not even suggest it.
    for (const mode of MODES) {
      for (const status of PROVIDER_REACHABLE) {
        expect(nextJobStep(status, mode).toStatus).not.toBe('completed');
      }
    }
  });

  test('workshop mode never offers driving, and mobile never offers check-in', async () => {
    for (const status of PROVIDER_REACHABLE) {
      expect(nextJobStep(status, 'workshop').toStatus).not.toBe('en_route');
      expect(nextJobStep(status, 'workshop').toStatus).not.toBe('arrived');

      expect(nextJobStep(status, 'mobile_ondemand').toStatus).not.toBe('checked_in');
      expect(nextJobStep(status, 'mobile_scheduled').toStatus).not.toBe('checked_in');
    }
  });
});
