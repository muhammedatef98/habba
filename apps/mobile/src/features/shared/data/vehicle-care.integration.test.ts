/**
 * The care section across the seam: app code → supabase-js → HTTP → PostgREST
 * → RLS → Postgres.
 *
 * `supabase/tests/36` already proves the rules in SQL. What it cannot prove is
 * the seam, and this slice puts two things through it that the rest of the app
 * does not:
 *
 *  1. `vehicle_maintenance_status` and `vehicle_document_status` return
 *     `setof <composite type>` rather than a `returns table` list. That is a
 *     different shape on the wire, and a repository mapping written against the
 *     wrong one fails only here — never in psql, never in a unit test.
 *  2. `start_vehicle_care` takes four parameters, three of them optional and
 *     nullable. PostgREST resolves an overload by the argument NAMES in the
 *     body, so a single typo'd `p_` key is a 404 at runtime and a green
 *     typecheck.
 *
 * Requires the local harness:
 *   pnpm db:reset && ./supabase/scripts/postgrest.sh start
 *
 * Skips itself when PostgREST is down, and fails hard under
 * HABBA_REQUIRE_HARNESS=1 — the same bargain the other integration suites make.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { SupabaseRepository } from './supabase-repository.js';
import { mintTestJwt } from './test-jwt.js';
import { maintenanceLine } from '@/features/shared/lib/care-language.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const OWNER_ID = 'cafe0001-7777-4777-8777-cafe00010001';
const STRANGER_ID = 'cafe0002-7777-4777-8777-cafe00010002';

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Module scope, not beforeAll: `describe.skipIf` is evaluated during
// collection, so a flag set in a hook stays false and skips the whole file —
// the failure mode where a suite looks green because it never ran.
const harnessUp = await isHarnessUp();

if (process.env.HABBA_REQUIRE_HARNESS === '1' && !harnessUp) {
  throw new Error(`Integration harness unreachable at ${POSTGREST_URL}.`);
}

function restFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return fetch(raw.replace('/rest/v1/', '/'), init);
}

function clientFor(userId: string): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, { sub: userId, role: 'authenticated' });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `7HGBH41JX${safe}`.slice(0, 17).padEnd(17, '0');
}

let vehicleId = '';

beforeAll(async () => {
  if (!harnessUp) return;

  const owner = clientFor(OWNER_ID);
  await owner.rpc('test_seed_auth_user', { p_id: OWNER_ID, p_phone: '+966508880011' });
  await owner.rpc('test_seed_auth_user', { p_id: STRANGER_ID, p_phone: '+966508880012' });

  // Errors are surfaced rather than swallowed: a fixture that fails quietly
  // produces a suite that fails three tests later with an unrelated message.
  const ownerProfile = await owner
    .from('profiles')
    .upsert({ id: OWNER_ID, full_name: 'مالك العناية', phone: '+966508880011' });
  if (ownerProfile.error !== null) throw new Error(`fixture owner: ${ownerProfile.error.message}`);

  const stranger = clientFor(STRANGER_ID);
  const strangerProfile = await stranger
    .from('profiles')
    .upsert({ id: STRANGER_ID, full_name: 'غريب', phone: '+966508880012' });
  if (strangerProfile.error !== null) {
    throw new Error(`fixture stranger: ${strangerProfile.error.message}`);
  }

  const makes = await owner.from('vehicle_makes').select('id').eq('name_en', 'Toyota');
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await owner
    .from('vehicle_models')
    .select('id')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry');
  const modelId = (models.data ?? [])[0]?.id as string;

  const repo = new SupabaseRepository(owner, () => OWNER_ID);
  const vehicle = await repo.addVehicle({
    makeId,
    modelId,
    year: 2021,
    plate: 'RSX 7070',
    currentMileage: 80000,
  });
  vehicleId = vehicle.id;

  await owner.from('vehicles').update({ vin: uniqueVin() }).eq('id', vehicleId);
});

describe.skipIf(!harnessUp)('the care section against real PostgREST + RLS', () => {
  test('the cold start seeds both halves of the one job', async () => {
    const repo = new SupabaseRepository(clientFor(OWNER_ID), () => OWNER_ID);

    // Four named parameters, three of them nullable. This call is the one that
    // catches a `p_` key that does not match the function's signature.
    await repo.startVehicleCare(vehicleId, {
      odometerKm: 80000,
      lastOilKm: 76000,
      lastOilAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const items = await repo.listMaintenanceItems(vehicleId);
    expect(items.map((item) => item.itemType).sort()).toEqual(['engine_oil', 'oil_filter']);

    const oil = items.find((item) => item.itemType === 'engine_oil');
    // Every field of the composite comes back mapped, not just the ones a
    // happy-path render happens to touch.
    expect(oil?.lastDoneKm).toBe(76000);
    expect(oil?.intervalKm).toBe(7000);
    expect(oil?.dueAtKm).toBe(83000);
    expect(oil?.serviceId).not.toBeNull();
    expect(oil?.dueByKm).toBe(false);
    expect(oil?.dueByDate).toBe(false);
  });

  test('a reading that crosses the due point makes the item due on distance only', async () => {
    const repo = new SupabaseRepository(clientFor(OWNER_ID), () => OWNER_ID);

    await repo.recordMileage(vehicleId, 83400);

    const oil = (await repo.listMaintenanceItems(vehicleId)).find(
      (item) => item.itemType === 'engine_oil',
    );
    expect(oil?.dueByKm).toBe(true);
    // Two months into a six-month interval: the date axis is nowhere near.
    expect(oil?.dueByDate).toBe(false);

    // ADR-0022, end to end. The split survives the composite type, the wire and
    // the repository mapping, and the copy that comes out the far side is still
    // hedged rather than stated as a date.
    const line = maintenanceLine(oil!);
    expect(line.certain).toBe(false);
    expect(line.key).toBe('care.item.likelyDue');
  });

  test('a reading below the head is refused, and does not move the series', async () => {
    const repo = new SupabaseRepository(clientFor(OWNER_ID), () => OWNER_ID);

    await expect(repo.recordMileage(vehicleId, 60000)).rejects.toThrow();

    const oil = (await repo.listMaintenanceItems(vehicleId)).find(
      (item) => item.itemType === 'engine_oil',
    );
    expect(oil?.kmRemaining).toBe(83000 - 83400);
  });

  test('«تم» clears the due state and the snooze', async () => {
    const repo = new SupabaseRepository(clientFor(OWNER_ID), () => OWNER_ID);

    const before = (await repo.listMaintenanceItems(vehicleId)).find(
      (item) => item.itemType === 'engine_oil',
    );
    await repo.snoozeMaintenanceItem(before!.itemId, 14);

    const snoozed = (await repo.listMaintenanceItems(vehicleId)).find(
      (item) => item.itemType === 'engine_oil',
    );
    expect(snoozed?.snoozedUntil).not.toBeNull();

    await repo.markMaintenanceItemDone(before!.itemId);

    const after = (await repo.listMaintenanceItems(vehicleId)).find(
      (item) => item.itemType === 'engine_oil',
    );
    expect(after?.isDue).toBe(false);
    expect(after?.lastDoneKm).toBe(83400);
    // Nothing is outstanding any more, so there is nothing to be asked about.
    expect(after?.snoozedUntil).toBeNull();
  });

  test('documents come back with their expiry computed, and read as certain', async () => {
    const owner = clientFor(OWNER_ID);
    const repo = new SupabaseRepository(owner, () => OWNER_ID);

    const expires = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inserted = await owner
      .from('vehicle_documents')
      .upsert(
        { vehicle_id: vehicleId, doc_type: 'insurance', expires_at: expires, created_by: OWNER_ID },
        { onConflict: 'vehicle_id,doc_type' },
      );
    expect(inserted.error).toBeNull();

    const documents = await repo.listVehicleDocuments(vehicleId);
    const insurance = documents.find((document) => document.docType === 'insurance');
    expect(insurance?.daysRemaining).toBe(5);
    expect(insurance?.isExpiring).toBe(true);
    expect(insurance?.isExpired).toBe(false);
    // `file_path` is reserved and written by nothing in this slice (0060).
    expect(documents.every((document) => 'documentId' in document)).toBe(true);
  });

  test('a stranger gets nothing back from either read, not an error', async () => {
    // The gate is inside the SECURITY DEFINER function (0059/0060), so a
    // caller who does not own the car is answered with an empty list rather
    // than a refusal — which would tell them the car exists.
    const repo = new SupabaseRepository(clientFor(STRANGER_ID), () => STRANGER_ID);

    expect(await repo.listMaintenanceItems(vehicleId)).toHaveLength(0);
    expect(await repo.listVehicleDocuments(vehicleId)).toHaveLength(0);
  });

  test('and cannot write the odometer series directly', async () => {
    // The series is closed to clients entirely (0058). Asserted over HTTP
    // because that is the surface an attacker actually has.
    const stranger = clientFor(STRANGER_ID);
    const written = await stranger
      .from('vehicle_odometer_readings')
      .insert({ vehicle_id: vehicleId, km: 999999, source: 'manual' });

    expect(written.error).not.toBeNull();
  });
});
