/**
 * Phase 2 acceptance, executed.
 *
 * The criterion is: "an owner records 3 past services manually, generates a
 * report, opens the public link in a browser, and the hash chain verifies."
 *
 * This drives exactly that against the real database through PostgREST, then
 * writes the rendered page to `.tmp/habba-report.html` so the "opens it in a
 * browser" half is a real artifact rather than an assertion about one.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { renderHabbaReport, type HabbaReport } from '@habba/core';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const OWNER_ID = '77777777-2222-4333-8444-777777777777';
const BUYER_ID = '88888888-2222-4333-8444-888888888888';

const ARTIFACT = resolve(process.cwd(), '.tmp/habba-report.html');

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

function clientFor(userId: string | null): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, {
    sub: userId ?? '00000000-0000-4000-8000-000000000000',
    role: userId === null ? 'anon' : 'authenticated',
  });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

let vehicleId = '';
let shareToken = '';

/**
 * A VIN is globally unique in the schema, so a fixed fixture makes this suite
 * pass once and fail on every rerun against a database that was not reset.
 * `pnpm test` runs against whatever state exists, so the suite has to be
 * idempotent on its own.
 *
 * The plate stays fixed on purpose — the assertion that `ا ب ح ٤٣٢١`
 * normalises to `ABJ4321` is the point, and plates are not unique.
 */
function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().padStart(8, '0').slice(-8);
  // VIN excludes I, O and Q by standard; base36 can emit them.
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `1HGBH41JX${safe}`.slice(0, 17).padEnd(17, '0');
}

beforeAll(async () => {
  if (!harnessUp) return;

  const owner = clientFor(OWNER_ID);
  await owner.rpc('test_seed_auth_user', { p_id: OWNER_ID, p_phone: '+966505550101' });
  await owner.rpc('test_seed_auth_user', { p_id: BUYER_ID, p_phone: '+966505550102' });

  await owner.from('profiles').upsert({
    id: OWNER_ID,
    full_name: 'سعد القحطاني',
    phone: '+966505550101',
    preferred_locale: 'ar',
  });

  const makes = await owner.from('vehicle_makes').select('id, name_en').eq('name_en', 'Toyota');
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await owner
    .from('vehicle_models')
    .select('id, name_en')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry');
  const modelId = (models.data ?? [])[0]?.id as string;

  const vehicle = await owner
    .from('vehicles')
    .insert({
      owner_id: OWNER_ID,
      make_id: makeId,
      model_id: modelId,
      year: 2019,
      plate_en: 'ا ب ح ٤٣٢١',
      vin: uniqueVin(),
      colour: 'أبيض لؤلؤي',
      created_by: OWNER_ID,
    })
    .select()
    .single();

  if (vehicle.error !== null || vehicle.data === null) {
    // Fail with the database's own message. Reading `.id` off null produces a
    // TypeError that says nothing about what actually went wrong.
    throw new Error(
      `fixture vehicle insert failed: ${vehicle.error?.message ?? 'no row returned'}`,
    );
  }

  vehicleId = (vehicle.data as { id: string }).id;

  await owner.rpc('append_vehicle_timeline_event', {
    p_vehicle_id: vehicleId,
    p_event_type: 'vehicle_registered',
    p_summary_ar: 'تم تسجيل السيارة في هبّة',
    p_summary_en: 'Vehicle registered with Habba',
  });
});

describe.skipIf(!harnessUp)('Phase 2 acceptance — تقرير هبّة', () => {
  test('an owner records three past services', async () => {
    const owner = clientFor(OWNER_ID);

    const services = [
      {
        p_summary_ar: 'تغيير زيت وفلتر',
        p_occurred_at: '2025-05-14T09:00:00Z',
        p_mileage: 62000,
        p_details: { oil_grade: '5W-30', filter_part_number: '90915-YZZE1' },
      },
      {
        p_summary_ar: 'تبديل فحمات الفرامل الأمامية',
        p_occurred_at: '2025-11-02T09:00:00Z',
        p_mileage: 71000,
        p_details: { part_number: '04465-33471', is_oem: true },
      },
      {
        p_summary_ar: 'تبديل إطارات وميزان',
        p_occurred_at: '2026-04-18T09:00:00Z',
        p_mileage: 78000,
        p_details: { tyre_size: '215/55R17' },
      },
    ];

    for (const service of services) {
      const { error } = await owner.rpc('record_past_service', {
        p_vehicle_id: vehicleId,
        ...service,
      });
      expect(error).toBeNull();
    }

    await owner.rpc('record_mileage', { p_vehicle_id: vehicleId, p_mileage: 84500 });

    const timeline = await owner
      .from('vehicle_timeline')
      .select('provenance')
      .eq('vehicle_id', vehicleId);

    expect((timeline.data ?? []).length).toBe(5);

    // None of what the owner typed may present itself as verified.
    const verified = (timeline.data ?? []).filter(
      (row) => (row as { provenance: string }).provenance === 'habba_verified',
    );
    expect(verified).toHaveLength(1); // registration only
  });

  test('the owner generates a report and the chain verifies', async () => {
    const owner = clientFor(OWNER_ID);

    const { data, error } = await owner.rpc('generate_habba_report', {
      p_vehicle_id: vehicleId,
    });
    expect(error).toBeNull();

    shareToken = data as string;
    expect(shareToken.length).toBeGreaterThan(30);

    const verify = await owner.rpc('verify_vehicle_timeline', { p_vehicle_id: vehicleId });
    const chain = Array.isArray(verify.data) ? verify.data[0] : verify.data;
    expect(chain?.is_valid).toBe(true);
  });

  test('anyone with the link can read it — no login — and it renders', async () => {
    // The buyer. No account, no session, just the link.
    const anonymous = clientFor(null);

    const { data, error } = await anonymous.rpc('get_habba_report', { p_token: shareToken });
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const report = data as HabbaReport;

    expect(report.chain.is_valid).toBe(true);
    expect(report.vehicle.plate).toBe('ABJ4321');
    expect(report.coverage.total).toBe(5);
    expect(report.coverage.habba_verified).toBe(1);
    expect(report.coverage.self_reported).toBeGreaterThanOrEqual(3);

    // The privacy rule, checked on what actually crosses the wire.
    const wire = JSON.stringify(report);
    expect(wire).not.toContain('سعد القحطاني');
    expect(wire).not.toContain('+966505550101');
    expect(wire).not.toContain(OWNER_ID);

    const html = renderHabbaReport(report, {
      publicUrl: `https://habba.sa/r/${shareToken}`,
    });

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    writeFileSync(ARTIFACT, html, 'utf8');

    expect(html).toContain('تقرير هبّة');
    expect(html).toContain('ABJ4321');
    expect(html).toContain('20%'); // 1 verified of 5
  });

  test('a bad or revoked token reveals nothing', async () => {
    const anonymous = clientFor(null);

    const { data } = await anonymous.rpc('get_habba_report', {
      p_token: 'this-token-does-not-exist',
    });
    expect(data).toBeNull();

    // Revoking is the owner's control over a link already in circulation.
    const owner = clientFor(OWNER_ID);
    await owner
      .from('habba_reports')
      .update({ revoked_at: new Date().toISOString() })
      .eq('public_token', shareToken);

    const afterRevoke = await anonymous.rpc('get_habba_report', { p_token: shareToken });
    expect(afterRevoke.data).toBeNull();
  });

  test('a non-owner cannot generate a report for the car', async () => {
    const buyer = clientFor(BUYER_ID);
    const { error } = await buyer.rpc('generate_habba_report', { p_vehicle_id: vehicleId });
    expect(error).not.toBeNull();
  });
});
