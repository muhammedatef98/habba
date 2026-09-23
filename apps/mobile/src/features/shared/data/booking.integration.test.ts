/**
 * Phase 4 acceptance, executed.
 *
 * `order.integration.test.ts` proves Phase 3's criterion — an emergency order
 * on two real identities, through real HTTP and real RLS. Phase 4 had no
 * equivalent: `supabase/tests/08_scheduling.sql` proves the same RPCs work,
 * but it switches actors with `test.become()` inside one Postgres session,
 * which is a convenience for SQL, not the boundary the app actually runs
 * against. This is that proof for the workshop path — a customer client and a
 * workshop client, each seeing only what its role permits.
 *
 * The criterion (docs/ROADMAP.md, Phase 4): two clients cannot book the same
 * slot (proved separately, by `supabase/scripts/slot-concurrency-test.sh`);
 * check-in replaces en_route/arrived for a workshop order; a completed job
 * writes to the logbook like any other; and a warranty claim inside the
 * window creates a free order auto-routed back to the SAME provider.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { DevPaymentProvider } from '@/features/shared/lib/payments.js';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const CUSTOMER_ID = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaab';
const WORKSHOP_ID = 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbc';
/** Nobody. Needs no auth.users row — RLS reads auth.uid() from the JWT claim. */
const STRANGER_ID = 'cccccccc-4444-4444-8444-ccccccccccce';

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
  return `1HGCM82633A${safe}`.slice(0, 17).padEnd(17, '0');
}

let vehicleId = '';
let orderId = '';
let claimId = '';
let providerId = '';
let serviceId = '';
let slotId = '';
const payments = new DevPaymentProvider();

beforeAll(async () => {
  if (!harnessUp) return;

  const customer = clientFor(CUSTOMER_ID);

  await customer.rpc('test_seed_auth_user', { p_id: CUSTOMER_ID, p_phone: '+966507770011' });
  await customer.rpc('test_seed_auth_user', { p_id: WORKSHOP_ID, p_phone: '+966507770012' });

  await customer
    .from('profiles')
    .upsert({ id: CUSTOMER_ID, full_name: 'عميل الورشة', phone: '+966507770011' });

  const workshopOwner = clientFor(WORKSHOP_ID);
  // No role is declared here — same as the emergency fixture, the
  // workshop_admin role arrives when the providers row below is approved
  // (migration 0040).
  await workshopOwner.from('profiles').upsert({
    id: WORKSHOP_ID,
    full_name: 'صاحب الورشة',
    phone: '+966507770012',
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
      year: 2022,
      plate_en: 'JSX 4141',
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
    .eq('name_en', 'Oil and filter change');
  serviceId = (services.data ?? [])[0]?.id as string;
});

describe.skipIf(!harnessUp)('Phase 4 acceptance — workshop booking', () => {
  test('a workshop onboards, is approved, and publishes a slot', async () => {
    const workshop = clientFor(WORKSHOP_ID);
    const cities = await workshop.from('cities').select('id').eq('name_en', 'Dammam');
    const cityId = (cities.data ?? [])[0]?.id as string;

    // Reuse a provider from a previous run, same reasoning as the emergency
    // fixture: a second providers row for the same owner splits identity and
    // current_provider_id() then picks arbitrarily.
    const existing = await workshop
      .from('providers')
      .select('id, verification_status')
      .eq('owner_profile_id', WORKSHOP_ID)
      .limit(1);

    if ((existing.data ?? []).length > 0) {
      providerId = (existing.data as { id: string }[])[0]!.id;
    } else {
      const created = await workshop
        .from('providers')
        .insert({
          owner_profile_id: WORKSHOP_ID,
          provider_type: 'workshop',
          business_name_ar: 'ورشة الاختبار الآلي',
          cr_number: '7070707070',
          city_id: cityId,
        })
        .select('id, verification_status')
        .single();

      expect(created.error).toBeNull();
      providerId = (created.data as { id: string }).id;
      expect((created.data as { verification_status: string }).verification_status).toBe(
        'pending',
      );
    }

    // Ops approval, applied directly — the admin console is Phase 6, same as
    // the emergency fixture.
    const admin = clientFor(CUSTOMER_ID);
    await admin.rpc('test_approve_provider', { p_provider_id: providerId });

    // The workshop row, provider_services and slots are all owned by
    // current_provider_id(), so they are written as the workshop, not ops.
    const workshopRow = await workshop
      .from('workshops')
      .upsert({
        provider_id: providerId,
        address_ar: 'طريق الملك عبدالعزيز، الدمام',
        location: 'POINT(50.1 26.42)',
        bay_count: 2,
        opening_hours: { sun: [['08:00', '20:00']] },
      })
      .select();
    expect(workshopRow.error).toBeNull();

    await workshop.from('provider_services').upsert({ provider_id: providerId, service_id: serviceId });

    // A wide range of slots, not one: `generate_slots` is `on conflict do
    // nothing`, so a rerun against a database that was not freshly reset (a
    // developer iterating locally, not CI's always-reset harness) would
    // otherwise regenerate the same single already-booked slot. Picking the
    // first one with room left makes the fixture idempotent either way.
    const generated = await workshop.rpc('generate_slots', {
      p_from: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      p_days: 1,
      p_start_hour: 9,
      p_end_hour: 18,
      p_slot_minutes: 60,
      p_capacity: 1,
    });
    expect(generated.error).toBeNull();

    const slots = await workshop
      .from('appointment_slots')
      .select('id, booked_count, capacity')
      .eq('provider_id', providerId)
      .gt('starts_at', new Date().toISOString())
      .order('starts_at');
    const open = (slots.data as { id: string; booked_count: number; capacity: number }[]).find(
      (slot) => slot.booked_count < slot.capacity,
    );
    expect(open).toBeDefined();
    slotId = open!.id;
  });

  test('the customer books the slot, atomically, as a workshop order', async () => {
    const customer = clientFor(CUSTOMER_ID);

    const booked = await customer.rpc('book_appointment', {
      p_slot_id: slotId,
      p_service_id: serviceId,
      p_vehicle_id: vehicleId,
      p_problem: 'صوت طقطقة عند الدوران',
      p_mileage: 32000,
    });

    expect(booked.error).toBeNull();
    orderId = booked.data as string;

    const order = await customer
      .from('orders')
      .select('fulfilment_mode, status, provider_id, workshop_id, quoted_amount')
      .eq('id', orderId)
      .single();

    expect((order.data as { fulfilment_mode: string }).fulfilment_mode).toBe('workshop');
    expect((order.data as { status: string }).status).toBe('draft');
    expect((order.data as { provider_id: string }).provider_id).toBe(providerId);
    expect((order.data as { workshop_id: string }).workshop_id).toBe(providerId);
    expect((order.data as { quoted_amount: number }).quoted_amount).toBe(180);

    // The slot is assigned immediately — there is no matching step, unlike
    // the emergency flow — so the workshop can already read its own order.
    const workshop = clientFor(WORKSHOP_ID);
    const seenByWorkshop = await workshop.from('orders').select('id').eq('id', orderId);
    expect((seenByWorkshop.data ?? []).length).toBe(1);
  });

  test('money is authorised before the workshop can accept', async () => {
    const customer = clientFor(CUSTOMER_ID);
    const workshop = clientFor(WORKSHOP_ID);

    await customer.from('orders').update({ status: 'quoted' }).eq('id', orderId);

    // A client cannot declare its own order paid (0033).
    const forged = await workshop
      .from('orders')
      .update({ escrow_status: 'authorised', payment_intent_id: 'forged' })
      .eq('id', orderId);
    expect(forged.error).not.toBeNull();

    // check_in_vehicle fails before 'accepted' regardless of who calls it —
    // there is no transition from 'quoted' to 'checked_in'.
    const premature = await workshop.rpc('check_in_vehicle', { p_order_id: orderId });
    expect(premature.error).not.toBeNull();

    const auth = await payments.authorise(orderId, sarOrThrow('180.00'));
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    const authorised = await customer.rpc('authorise_order_payment', {
      p_order_id: orderId,
      p_payment_intent_id: auth.paymentIntentId,
    });
    expect(authorised.error).toBeNull();

    const accepted = await customer.from('orders').update({ status: 'accepted' }).eq('id', orderId);
    expect(accepted.error).toBeNull();
  });

  test('a stranger cannot check the vehicle in; the workshop can', async () => {
    const stranger = clientFor(STRANGER_ID);
    const workshop = clientFor(WORKSHOP_ID);

    const denied = await stranger.rpc('check_in_vehicle', { p_order_id: orderId });
    expect(denied.error).not.toBeNull();

    const checkedIn = await workshop.rpc('check_in_vehicle', { p_order_id: orderId });
    expect(checkedIn.error).toBeNull();

    const order = await workshop.from('orders').select('status').eq('id', orderId).single();
    expect((order.data as { status: string }).status).toBe('checked_in');
  });

  test('a workshop order cannot go en_route — there is no drive', async () => {
    const workshop = clientFor(WORKSHOP_ID);
    const enRoute = await workshop.from('orders').update({ status: 'en_route' }).eq('id', orderId);
    expect(enRoute.error).not.toBeNull();
  });

  test('the job runs, and only the customer can close it', async () => {
    const workshop = clientFor(WORKSHOP_ID);
    const customer = clientFor(CUSTOMER_ID);

    const inProgress = await workshop
      .from('orders')
      .update({ status: 'in_progress' })
      .eq('id', orderId);
    expect(inProgress.error).toBeNull();

    // Completion evidence is provider-only and mandatory before hand-back —
    // same guard as the emergency flow, exercised here for the workshop path.
    const evidence = await workshop.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: 32090,
      p_media: [
        { url: 'https://example.test/workshop-before.jpg', kind: 'before', caption: 'قبل' },
        { url: 'https://example.test/workshop-after.jpg', kind: 'after', caption: 'بعد' },
      ],
    });
    expect(evidence.error).toBeNull();

    const customerCannotRecord = await customer.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: 32090,
      p_media: [{ url: 'https://example.test/forged.jpg', kind: 'before' }],
    });
    expect(customerCannotRecord.error).not.toBeNull();

    await workshop
      .from('orders')
      .update({
        labour_amount: 180,
        parts_amount: 0,
        vat_amount: 27,
        total_amount: 207,
        vat_rate_applied: 0.15,
        warranty_days: 30,
      })
      .eq('id', orderId);
    await workshop.from('orders').update({ status: 'awaiting_approval' }).eq('id', orderId);

    const workshopCloses = await workshop
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', orderId);
    expect(workshopCloses.error).not.toBeNull();

    const customerCloses = await customer
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', orderId);
    expect(customerCloses.error).toBeNull();
  });

  test('the completed job is in the logbook automatically, and verified', async () => {
    const customer = clientFor(CUSTOMER_ID);

    const timeline = await customer.from('vehicle_timeline').select('*').eq('order_id', orderId);
    expect(timeline.error).toBeNull();
    const rows = timeline.data as { provenance: string; mileage: number; event_type: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('service_completed');
    expect(rows[0]?.mileage).toBe(32090);
    expect(rows[0]?.provenance).toBe('habba_verified');

    const verify = await customer.rpc('verify_vehicle_timeline', { p_vehicle_id: vehicleId });
    const chain = Array.isArray(verify.data) ? verify.data[0] : verify.data;
    expect(chain?.is_valid).toBe(true);
  });

  test('capture happens only after the customer confirmed, and never above what was authorised', async () => {
    const customer = clientFor(CUSTOMER_ID);
    const order = await customer
      .from('orders')
      .select('payment_intent_id, status')
      .eq('id', orderId)
      .single();

    const row = order.data as { payment_intent_id: string; status: string };
    expect(row.status).toBe('completed');

    // 207.00 (labour + VAT) exceeds the 180.00 authorised at booking.
    const overCapture = await payments.capture(row.payment_intent_id, sarOrThrow('207.00'));
    expect(overCapture).toMatchObject({ ok: false, reason: 'exceeds_authorisation' });

    const capture = await payments.capture(row.payment_intent_id, sarOrThrow('180.00'));
    expect(capture.ok).toBe(true);

    const captured = await customer.rpc('capture_order_payment', { p_order_id: orderId });
    expect(captured.error).toBeNull();
  });

  test('a warranty claim inside the window is auto-routed back to the same workshop, free', async () => {
    const customer = clientFor(CUSTOMER_ID);
    const stranger = clientFor(STRANGER_ID);

    const strangerClaim = await stranger.rpc('claim_warranty', {
      p_order_id: orderId,
      p_problem: 'ليس سيارتي',
    });
    expect(strangerClaim.error).not.toBeNull();

    const claimed = await customer.rpc('claim_warranty', {
      p_order_id: orderId,
      p_problem: 'صوت الطقطقة رجع بعد أسبوع',
    });
    expect(claimed.error).toBeNull();
    claimId = claimed.data as string;

    const claim = await customer
      .from('orders')
      .select('parent_order_id, provider_id, total_amount, escrow_status, status')
      .eq('id', claimId)
      .single();
    const claimRow = claim.data as {
      parent_order_id: string;
      provider_id: string;
      total_amount: number;
      escrow_status: string;
      status: string;
    };

    expect(claimRow.parent_order_id).toBe(orderId);
    // The whole point of the feature: the SAME provider, not a competitor
    // getting paid to fix the first one's work.
    expect(claimRow.provider_id).toBe(providerId);
    expect(claimRow.total_amount).toBe(0);
    expect(claimRow.escrow_status).toBe('none');
    expect(claimRow.status).toBe('draft');

    // A second live claim on the same parent is refused.
    const secondClaim = await customer.rpc('claim_warranty', {
      p_order_id: orderId,
      p_problem: 'مطالبة ثانية',
    });
    expect(secondClaim.error).not.toBeNull();
  });

  test('the free re-service is accepted without a payment authorisation, run, and closes the loop', async () => {
    const customer = clientFor(CUSTOMER_ID);
    const workshop = clientFor(WORKSHOP_ID);

    await customer.from('orders').update({ status: 'quoted' }).eq('id', claimId);

    // No authorise_order_payment call anywhere in this test — a zero-amount
    // order must be acceptable without one, or the warranty feature is
    // unusable in practice.
    const accepted = await customer.from('orders').update({ status: 'accepted' }).eq('id', claimId);
    expect(accepted.error).toBeNull();

    await workshop.rpc('check_in_vehicle', { p_order_id: claimId });
    await workshop.from('orders').update({ status: 'in_progress' }).eq('id', claimId);

    const evidence = await workshop.rpc('record_completion_evidence', {
      p_order_id: claimId,
      p_mileage: 32200,
      p_media: [
        { url: 'https://example.test/warranty-before.jpg', kind: 'before' },
        { url: 'https://example.test/warranty-after.jpg', kind: 'after' },
      ],
    });
    expect(evidence.error).toBeNull();

    await workshop.from('orders').update({ status: 'awaiting_approval' }).eq('id', claimId);
    const closed = await customer.from('orders').update({ status: 'completed' }).eq('id', claimId);
    expect(closed.error).toBeNull();

    // Recorded as a warranty re-service, not an ordinary one — a buyer
    // reading the resale report should see that a repair had to be redone.
    const timeline = await customer
      .from('vehicle_timeline')
      .select('event_type, details')
      .eq('order_id', claimId)
      .single();

    expect((timeline.data as { event_type: string }).event_type).toBe('warranty_claimed');
    expect(
      (timeline.data as { details: { is_warranty_reservice: boolean } }).details
        .is_warranty_reservice,
    ).toBe(true);

    // The chain still verifies end to end across the scheduled, workshop and
    // warranty entries on this vehicle.
    const verify = await customer.rpc('verify_vehicle_timeline', { p_vehicle_id: vehicleId });
    const chain = Array.isArray(verify.data) ? verify.data[0] : verify.data;
    expect(chain?.is_valid).toBe(true);
  });
});
