/**
 * End-to-end integration: app code → supabase-js → HTTP → PostgREST → RLS → Postgres.
 *
 * This is the test that closes Phase 1's acceptance criterion. The .sql suites
 * prove the schema and the unit tests prove the app, but until something
 * crosses the seam between them, "a user signs up, adds a vehicle, sees an
 * empty logbook" has not actually been demonstrated.
 *
 * Requires the local harness:
 *   pnpm db:reset && ./supabase/scripts/postgrest.sh start
 *
 * Skips itself (rather than failing) when PostgREST is not running, so the
 * unit-test run stays fast and machine-independent. CI starts the harness and
 * therefore always executes these.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { SupabaseRepository } from './supabase-repository.js';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const OWNER_ID = '11111111-2222-4333-8444-555555555555';
const STRANGER_ID = '99999999-2222-4333-8444-555555555555';

/**
 * Probes a real relation rather than `/`: PostgREST answers the root before
 * its schema cache is loaded, so `/` reports healthy while table requests
 * still fail. Retries briefly to absorb start-up.
 */
async function isHarnessUp(): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(`${POSTGREST_URL}/vehicle_makes?limit=1`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      // fall through to retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Probed at module scope, not in beforeAll: `describe.skipIf` is evaluated
// during collection, which happens before any hook runs. Checking it in a hook
// leaves the flag false and silently skips the entire suite — the failure mode
// where a test file looks green precisely because it never ran.
const harnessUp = await isHarnessUp();

/**
 * Locally the suite skips when the harness is down, so `pnpm test` stays fast
 * and works on a machine with no Postgres. In CI that leniency is dangerous:
 * a misconfigured harness would produce a green run that verified nothing —
 * which is exactly what happened once during development. Setting
 * HABBA_REQUIRE_HARNESS=1 turns "skipped" into a hard failure.
 */
if (process.env.HABBA_REQUIRE_HARNESS === '1' && !harnessUp) {
  throw new Error(
    `Integration harness unreachable at ${POSTGREST_URL}. ` +
      'Start it with `pnpm db:reset && pnpm api:start`, or unset HABBA_REQUIRE_HARNESS to skip.',
  );
}

/**
 * supabase-js addresses `${url}/rest/v1/...`, because in a real deployment
 * Kong routes that prefix to PostgREST. Bare PostgREST serves at the root, so
 * the prefix is stripped here.
 *
 * The rewrite is confined to this shim precisely so that everything above it —
 * SupabaseRepository and the whole app — uses an unmodified supabase-js client
 * and needs no change when pointed at a real project.
 */
function restFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const rewritten = raw.replace('/rest/v1/', '/');
  return fetch(rewritten, init);
}

function clientFor(userId: string | null): SupabaseClient {
  const token =
    userId === null
      ? mintTestJwt(JWT_SECRET, { sub: '00000000-0000-4000-8000-000000000000', role: 'anon' })
      : mintTestJwt(JWT_SECRET, { sub: userId, role: 'authenticated' });

  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

/** Seeds auth.users rows, which GoTrue would normally create on sign-up. */
async function seedAuthUsers(): Promise<void> {
  const admin = clientFor(OWNER_ID);
  await admin.rpc('test_seed_auth_user', { p_id: OWNER_ID, p_phone: '+966501234501' });
  await admin.rpc('test_seed_auth_user', { p_id: STRANGER_ID, p_phone: '+966501234502' });
}

beforeAll(async () => {
  if (harnessUp) await seedAuthUsers();
});

describe.skipIf(!harnessUp)('SupabaseRepository against real PostgREST + RLS', () => {
  test('harness is reachable', () => {
    expect(harnessUp).toBe(true);
  });

  test('anonymous can read the vehicle catalogue but no user data', async () => {
    // A new user picks their car before they have an account, so the
    // catalogue must be public — while everything personal stays closed.
    const anon = clientFor(null);

    const makes = await anon.from('vehicle_makes').select('id');
    expect(makes.error).toBeNull();
    expect((makes.data ?? []).length).toBeGreaterThan(0);

    const vehicles = await anon.from('vehicles').select('id');
    expect(vehicles.data ?? []).toHaveLength(0);

    const timeline = await anon.from('vehicle_timeline').select('id');
    expect(timeline.data ?? []).toHaveLength(0);
  });

  test('the full Phase 1 journey: profile, vehicle, logbook', async () => {
    const client = clientFor(OWNER_ID);
    const repo = new SupabaseRepository(client, () => OWNER_ID);

    const profile = await repo.upsertProfile({
      fullName: 'محمد العتيبي',
      phone: '+966501234501',
      preferredLocale: 'ar',
    });
    expect(profile.id).toBe(OWNER_ID);

    const makes = await repo.listMakes();
    expect(makes.length).toBeGreaterThan(0);

    const toyota = makes.find((make) => make.nameEn === 'Toyota');
    expect(toyota).toBeDefined();
    if (toyota === undefined) return;

    const models = await repo.listModels(toyota.id);
    const camry = models.find((model) => model.nameEn === 'Camry');
    expect(camry).toBeDefined();
    if (camry === undefined) return;

    const vehicle = await repo.addVehicle({
      makeId: toyota.id,
      modelId: camry.id,
      year: 2020,
      plate: 'أ ب ح ١٢٣٤',
      nickname: 'سيارة الشغل',
    });

    // The plate was normalised by the DATABASE, from Arabic input, to the
    // Latin search key. This is the property the logbook depends on.
    expect(vehicle.plateNormalised).toBe('ABJ1234');

    const vehicles = await repo.listVehicles();
    expect(vehicles.map((v) => v.id)).toContain(vehicle.id);

    // The logbook is not empty — registration wrote the first event, and its
    // provenance was derived server-side.
    const timeline = await repo.listTimeline(vehicle.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('vehicle_registered');
    expect(timeline[0]?.provenance).toBe('habba_verified');
  });

  test("a stranger cannot see the owner's vehicle or logbook over HTTP", async () => {
    const stranger = clientFor(STRANGER_ID);
    const strangerRepo = new SupabaseRepository(stranger, () => STRANGER_ID);

    // RLS, enforced by the database, reached through a real HTTP request with
    // a real JWT — not a mock.
    expect(await strangerRepo.listVehicles()).toHaveLength(0);

    const ownerVehicles = await new SupabaseRepository(
      clientFor(OWNER_ID),
      () => OWNER_ID,
    ).listVehicles();
    const target = ownerVehicles[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    // Even naming the exact id gets nothing back.
    expect(await strangerRepo.getVehicle(target.id)).toBeNull();
    expect(await strangerRepo.listTimeline(target.id)).toHaveLength(0);
  });

  test('a client cannot forge a timeline entry, even its own', async () => {
    const client = clientFor(OWNER_ID);
    const vehicles = await new SupabaseRepository(client, () => OWNER_ID).listVehicles();
    const target = vehicles[0];
    expect(target).toBeDefined();
    if (target === undefined) return;

    // ADR-0003: INSERT is revoked at the grant level, so this is not merely
    // "no policy allows it" — the privilege does not exist.
    const forged = await client.from('vehicle_timeline').insert({
      vehicle_id: target.id,
      event_type: 'service_completed',
      provenance: 'habba_verified',
      summary_ar: 'صيانة مزورة',
      summary_en: 'Forged service',
      created_by: OWNER_ID,
      prev_hash: 'GENESIS',
      row_hash: 'deadbeef',
    });
    expect(forged.error).not.toBeNull();

    const tampered = await client
      .from('vehicle_timeline')
      .update({ summary_en: 'Rewritten' })
      .eq('vehicle_id', target.id);
    expect(tampered.error).not.toBeNull();
  });

  test('provenance cannot be claimed through the RPC', async () => {
    const client = clientFor(OWNER_ID);
    const vehicles = await new SupabaseRepository(client, () => OWNER_ID).listVehicles();
    const target = vehicles[0];
    if (target === undefined) return;

    // An owner recording their own past service gets `self_reported`, no
    // matter what they would like it to say (ADR-0005). There is no parameter
    // to override it, and the server derives it from context.
    const { error } = await client.rpc('append_vehicle_timeline_event', {
      p_vehicle_id: target.id,
      p_event_type: 'service_completed',
      p_summary_ar: 'تغيير زيت سابق',
      p_summary_en: 'Past oil change',
      p_mileage: 42000,
    });
    expect(error).toBeNull();

    const timeline = await new SupabaseRepository(client, () => OWNER_ID).listTimeline(target.id);
    const service = timeline.find((event) => event.summaryEn === 'Past oil change');
    expect(service?.provenance).toBe('self_reported');
  });

  test('the hash chain verifies through the API', async () => {
    const client = clientFor(OWNER_ID);
    const vehicles = await new SupabaseRepository(client, () => OWNER_ID).listVehicles();
    const target = vehicles[0];
    if (target === undefined) return;

    const { data, error } = await client.rpc('verify_vehicle_timeline', {
      p_vehicle_id: target.id,
    });

    expect(error).toBeNull();
    const result = Array.isArray(data) ? data[0] : data;
    expect(result?.is_valid).toBe(true);
    expect(result?.checked_count).toBeGreaterThanOrEqual(2);
  });
});
