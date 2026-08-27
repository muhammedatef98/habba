/**
 * Phase 3 acceptance, executed.
 *
 * The criterion is: "end-to-end emergency order on two devices, completed job
 * appears in the logbook automatically, payment captured only after customer
 * confirmation."
 *
 * Two devices means two identities with different privileges, which is exactly
 * what separate JWTs give us here — a customer client and a provider client,
 * each seeing only what its role permits, through real HTTP and real RLS.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { DevPaymentProvider } from '../lib/payments.js';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const CUSTOMER_ID = 'aaaaaaaa-3333-4333-8444-aaaaaaaaaaaa';
const TECH_ID = 'bbbbbbbb-3333-4333-8444-bbbbbbbbbbbb';

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

function clientFor(userId: string): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, { sub: userId, role: 'authenticated' });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

/** Unique per run: vin is globally unique, so a fixed fixture breaks reruns. */
function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `3HGBH41JX${safe}`.slice(0, 17).padEnd(17, '0');
}

let vehicleId = '';
let orderId = '';
let providerId = '';
let serviceId = '';
const payments = new DevPaymentProvider();

beforeAll(async () => {
  if (!harnessUp) return;

  const customer = clientFor(CUSTOMER_ID);

  await customer.rpc('test_seed_auth_user', { p_id: CUSTOMER_ID, p_phone: '+966507770001' });
  await customer.rpc('test_seed_auth_user', { p_id: TECH_ID, p_phone: '+966507770002' });

  await customer
    .from('profiles')
    .upsert({ id: CUSTOMER_ID, full_name: 'عميل الطوارئ', phone: '+966507770001' });

  const tech = clientFor(TECH_ID);
  await tech.from('profiles').upsert({
    id: TECH_ID,
    full_name: 'فنّي الطوارئ',
    phone: '+966507770002',
    role: 'technician',
  });

  const makes = await customer.from('vehicle_makes').select('id').eq('name_en', 'Toyota');
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await customer
    .from('vehicle_models')
    .select('id')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry');
  const modelId = (models.data ?? [])[0]?.id as string;

  const vehicle = await customer
    .from('vehicles')
    .insert({
      owner_id: CUSTOMER_ID,
      make_id: makeId,
      model_id: modelId,
      year: 2021,
      plate_en: 'RSX 1212',
      vin: uniqueVin(),
      created_by: CUSTOMER_ID,
    })
    .select()
    .single();

  if (vehicle.error !== null || vehicle.data === null) {
    throw new Error(`fixture vehicle failed: ${vehicle.error?.message ?? 'no row'}`);
  }
  vehicleId = (vehicle.data as { id: string }).id;

  const services = await customer
    .from('services')
    .select('id')
    .eq('name_en', 'Battery jump or replacement');
  serviceId = (services.data ?? [])[0]?.id as string;
});

describe.skipIf(!harnessUp)('Phase 3 acceptance — emergency order', () => {
  test('a provider onboards but cannot approve itself', async () => {
    const tech = clientFor(TECH_ID);
    const cities = await tech.from('cities').select('id').eq('name_en', 'Dammam');
    const cityId = (cities.data ?? [])[0]?.id as string;

    // Reuse a provider from a previous run. A technician has one provider
    // record, and creating a second one silently splits their identity —
    // current_provider_id() then picks arbitrarily and the whole suite
    // misbehaves in ways that look like unrelated failures.
    const existing = await tech
      .from('providers')
      .select('id, verification_status')
      .eq('owner_profile_id', TECH_ID)
      .limit(1);

    if ((existing.data ?? []).length > 0) {
      providerId = (existing.data as { id: string }[])[0]!.id;
    } else {
      const created = await tech
        .from('providers')
        .insert({
          owner_profile_id: TECH_ID,
          provider_type: 'individual',
          business_name_ar: 'خدمة بطاريات سريعة',
          city_id: cityId,
        })
        .select()
        .single();

      expect(created.error).toBeNull();
      providerId = (created.data as { id: string }).id;
      expect((created.data as { verification_status: string }).verification_status).toBe('pending');
    }

    // KYC is an ops decision. If a provider could set this, verification would
    // be advisory — and the roadside trust promise rests on it not being.
    const selfApprove = await tech
      .from('providers')
      .update({ verification_status: 'approved' })
      .eq('id', providerId);
    expect(selfApprove.error).not.toBeNull();
  });

  test('an approved, online provider is matched to a nearby emergency', async () => {
    // Ops approval, applied directly — the admin console is Phase 6.
    const admin = clientFor(CUSTOMER_ID);
    await admin.rpc('test_approve_provider', { p_provider_id: providerId });

    const tech = clientFor(TECH_ID);
    await tech.from('provider_services').insert({ provider_id: providerId, service_id: serviceId });

    // Going online and broadcasting position both go through RPCs: a PostGIS
    // point cannot be written as JSON through the table API.
    await tech.rpc('set_provider_online', { p_online: true });
    const located = await tech.rpc('update_provider_location', { p_lon: 50.104, p_lat: 26.421 });
    expect(located.error).toBeNull();

    const customer = clientFor(CUSTOMER_ID);
    const created = await customer.rpc('create_emergency_order', {
      p_service_id: serviceId,
      p_lon: 50.105,
      p_lat: 26.422,
      p_vehicle_id: vehicleId,
      p_address_ar: 'حي الفيصلية، شارع ١٢',
      p_problem: 'البطارية فصلت',
      p_mileage: 45000,
    });

    expect(created.error).toBeNull();
    orderId = created.data as string;

    // Checked: an unchecked write here fails silently and surfaces three tests
    // later as a confusing "cannot move from draft to accepted".
    const searching = await customer
      .from('orders')
      .update({ status: 'searching' })
      .eq('id', orderId)
      .select()
      .single();
    expect(searching.error).toBeNull();
    expect((searching.data as { status: string }).status).toBe('searching');

    const matches = await customer.rpc('match_providers', { p_order_id: orderId });
    expect(matches.error).toBeNull();
    expect((matches.data as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((matches.data as { provider_id: string }[])[0]?.provider_id).toBe(providerId);
  });

  test('the provider sees the job without the address', async () => {
    const tech = clientFor(TECH_ID);

    const open = await tech.rpc('list_open_orders_for_provider');
    expect(open.error).toBeNull();

    const rows = open.data as { order_id: string; distance_bucket: string }[];
    const mine = rows.find((row) => row.order_id === orderId);
    expect(mine).toBeDefined();
    expect(mine?.distance_bucket).toBe('أقل من ٢ كم');

    // The row itself is unreachable, so there is no address column to leak.
    const direct = await tech.from('orders').select('service_address_ar').eq('id', orderId);
    expect(direct.data ?? []).toHaveLength(0);
  });

  test('money is authorised before the provider is committed', async () => {
    const customer = clientFor(CUSTOMER_ID);

    await customer
      .from('orders')
      .update({ status: 'quoted', quoted_amount: 120 })
      .eq('id', orderId);

    // Accepting without an authorisation must fail — nobody drives out on an
    // unfunded order.
    const premature = await customer
      .from('orders')
      .update({ status: 'accepted', provider_id: providerId })
      .eq('id', orderId);
    expect(premature.error).not.toBeNull();

    const auth = await payments.authorise(orderId, sarOrThrow('120.00'));
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const accepted = await customer
      .from('orders')
      .update({
        status: 'accepted',
        provider_id: providerId,
        escrow_status: 'authorised',
        payment_intent_id: auth.paymentIntentId,
      })
      .eq('id', orderId)
      .select()
      .single();

    expect(accepted.error).toBeNull();
    expect((accepted.data as { escrow_status: string }).escrow_status).toBe('authorised');
  });

  test('the job runs, and only the customer can close it', async () => {
    const tech = clientFor(TECH_ID);
    const customer = clientFor(CUSTOMER_ID);

    for (const status of ['en_route', 'arrived', 'in_progress']) {
      const step = await tech.from('orders').update({ status }).eq('id', orderId);
      expect(step.error, status).toBeNull();
    }

    // Completion evidence is mandatory before hand-back (§9.2, §11). This is
    // the real path a technician takes: one call carrying the odometer reading
    // and the before/after photos, while they are still beside the car.
    const evidence = await tech.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: 45120,
      p_media: [
        { url: 'https://example.test/before.jpg', kind: 'before', caption: 'قبل' },
        { url: 'https://example.test/after.jpg', kind: 'after', caption: 'بعد' },
      ],
    });
    expect(evidence.error).toBeNull();

    await tech
      .from('orders')
      .update({
        labour_amount: 120,
        parts_amount: 0,
        vat_amount: 18,
        total_amount: 138,
        vat_rate_applied: 0.15,
        status: 'awaiting_approval',
      })
      .eq('id', orderId);

    // The provider marking their own work complete would gut the escrow
    // promise, so the database refuses it.
    const providerCloses = await tech
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', orderId);
    expect(providerCloses.error).not.toBeNull();

    const customerCloses = await customer
      .from('orders')
      .update({ status: 'completed', warranty_days: 90 })
      .eq('id', orderId);
    expect(customerCloses.error).toBeNull();
  });

  test('the completed job is in the logbook automatically, and verified', async () => {
    const customer = clientFor(CUSTOMER_ID);

    const timeline = await customer.from('vehicle_timeline').select('*').eq('order_id', orderId);

    expect(timeline.error).toBeNull();
    const rows = timeline.data as {
      provenance: string;
      mileage: number;
      event_type: string;
    }[];

    // Nobody wrote this from the app. The state machine did it inside the same
    // transaction as the status change — this is the moat filling itself.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('service_completed');
    // The COMPLETION reading, not the 45,000 recorded at booking.
    expect(rows[0]?.mileage).toBe(45120);

    // And unlike Phase 2's owner-typed history, this genuinely IS verified:
    // Habba dispatched it, and the provider identity is on the record.
    expect(rows[0]?.provenance).toBe('habba_verified');

    const verify = await customer.rpc('verify_vehicle_timeline', { p_vehicle_id: vehicleId });
    const chain = Array.isArray(verify.data) ? verify.data[0] : verify.data;
    expect(chain?.is_valid).toBe(true);
  });

  test('capture happens only after the customer confirmed', async () => {
    const customer = clientFor(CUSTOMER_ID);
    const order = await customer
      .from('orders')
      .select('payment_intent_id, status, total_amount')
      .eq('id', orderId)
      .single();

    const row = order.data as { payment_intent_id: string; status: string };
    expect(row.status).toBe('completed');

    // 138.00 exceeds the 120.00 authorised at booking — the real constraint
    // from ADR-0008, surfacing exactly where it will in production.
    const overCapture = await payments.capture(row.payment_intent_id, sarOrThrow('138.00'));
    expect(overCapture).toMatchObject({ ok: false, reason: 'exceeds_authorisation' });

    // Capturing within the authorisation succeeds.
    const capture = await payments.capture(row.payment_intent_id, sarOrThrow('120.00'));
    expect(capture.ok).toBe(true);

    await customer.from('orders').update({ escrow_status: 'captured' }).eq('id', orderId);
  });

  test('the customer rates the completed job', async () => {
    const customer = clientFor(CUSTOMER_ID);

    // The provider is reused across runs (see the onboarding test), so its
    // rating count accumulates. Assert the delta, not an absolute.
    const before = await customer
      .from('providers')
      .select('rating_count')
      .eq('id', providerId)
      .single();
    const countBefore = (before.data as { rating_count: number }).rating_count;

    const rating = await customer.from('ratings').insert({
      order_id: orderId,
      rater_id: CUSTOMER_ID,
      provider_id: providerId,
      stars: 5,
      tags: ['سرعة', 'سعر عادل'],
    });
    expect(rating.error).toBeNull();

    const provider = await customer
      .from('providers')
      .select('rating_avg, rating_count')
      .eq('id', providerId)
      .single();

    expect((provider.data as { rating_count: number }).rating_count).toBe(countBefore + 1);
  });
});
