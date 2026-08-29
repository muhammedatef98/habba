/**
 * Phase 6 acceptance, executed.
 *
 * "A vehicle with history receives a correctly-timed alert; a completed order
 * produces a ZATCA-valid invoice with a scannable QR."
 *
 * The QR is decoded back into its TLV tags here rather than trusted, because
 * a QR that encodes the wrong bytes still renders as a perfectly scannable
 * square — the failure is invisible until a tax audit.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const OWNER_ID = 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee';
const SHOP_ID = 'ffffffff-6666-4666-8666-ffffffffffff';
const OPS_ID = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';

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

/**
 * Decodes a ZATCA TLV payload back into tag → value.
 *
 * Written independently of the encoder on purpose: a decoder that shares the
 * encoder's assumptions confirms nothing.
 */
function decodeTlv(base64: string): Map<number, string> {
  const bytes = Buffer.from(base64, 'base64');
  const tags = new Map<number, string>();

  let offset = 0;
  while (offset + 2 <= bytes.length) {
    const tag = bytes[offset]!;
    const length = bytes[offset + 1]!;
    const value = bytes.subarray(offset + 2, offset + 2 + length).toString('utf8');
    tags.set(tag, value);
    offset += 2 + length;
  }

  return tags;
}

function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `6HGBH41JX${safe}`.slice(0, 17).padEnd(17, '0');
}

let vehicleId = '';
let providerId = '';
let serviceId = '';
let orderId = '';

beforeAll(async () => {
  if (!harnessUp) return;

  const owner = clientFor(OWNER_ID);
  for (const [id, phone] of [
    [OWNER_ID, '+966506660001'],
    [SHOP_ID, '+966506660002'],
    [OPS_ID, '+966506660003'],
  ] as const) {
    await owner.rpc('test_seed_auth_user', { p_id: id, p_phone: phone });
  }

  await owner
    .from('profiles')
    .upsert({ id: OWNER_ID, full_name: 'مالك الصيانة', phone: '+966506660001' });

  const shop = clientFor(SHOP_ID);
  await shop.from('profiles').upsert({
    id: SHOP_ID,
    full_name: 'ورشة الصيانة',
    phone: '+966506660002',
    role: 'workshop_admin',
  });

  const ops = clientFor(OPS_ID);
  await ops
    .from('profiles')
    .upsert({ id: OPS_ID, full_name: 'مشغّل', phone: '+966506660003', role: 'ops' });

  const cities = await owner.from('cities').select('id').eq('name_en', 'Riyadh');
  const cityId = (cities.data ?? [])[0]?.id as string;

  const makes = await owner.from('vehicle_makes').select('id').eq('name_en', 'Toyota');
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await owner
    .from('vehicle_models')
    .select('id')
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
      plate_en: 'RSX 6060',
      vin: uniqueVin(),
      current_mileage: 60000,
      created_by: OWNER_ID,
    })
    .select()
    .single();

  if (vehicle.error !== null) throw new Error(`fixture vehicle: ${vehicle.error.message}`);
  vehicleId = (vehicle.data as { id: string }).id;

  const existing = await shop
    .from('providers')
    .select('id')
    .eq('owner_profile_id', SHOP_ID)
    .limit(1);

  if ((existing.data ?? []).length > 0) {
    providerId = (existing.data as { id: string }[])[0]!.id;
  } else {
    const created = await shop
      .from('providers')
      .insert({
        owner_profile_id: SHOP_ID,
        provider_type: 'workshop',
        business_name_ar: 'ورشة الصيانة الدورية',
        cr_number: '1010404040',
        city_id: cityId,
      })
      .select('id')
      .single();
    providerId = (created.data as { id: string }).id;
  }

  await owner.rpc('test_approve_provider', { p_provider_id: providerId });

  const services = await owner.from('services').select('id').eq('name_en', 'Oil and filter change');
  serviceId = (services.data ?? [])[0]?.id as string;

  await shop.from('provider_services').upsert({ provider_id: providerId, service_id: serviceId });

  const workshop = await shop.rpc('upsert_workshop', {
    p_address_ar: 'طريق الملك فهد',
    p_lon: 46.676,
    p_lat: 24.714,
    p_bay_count: 2,
    p_opening_hours: { sun: [['08:00', '20:00']] },
  });
  if (workshop.error !== null) {
    throw new Error(`fixture workshop: ${workshop.error.message}`);
  }
});

describe.skipIf(!harnessUp)('Phase 6 acceptance — intelligence and compliance', () => {
  test('a vehicle with mileage history gets an estimate ahead of its last reading', async () => {
    const owner = clientFor(OWNER_ID);

    // A year of readings so there is a rate to extrapolate from.
    const readings: Array<[number, number]> = [
      [60000, 365],
      [72000, 180],
      [84000, 30],
    ];
    for (const [mileage, daysAgo] of readings) {
      const { error } = await owner.rpc('record_mileage', {
        p_vehicle_id: vehicleId,
        p_mileage: mileage,
        p_occurred_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      });
      expect(error).toBeNull();
    }

    const { data, error } = await owner.rpc('estimate_current_mileage', {
      p_vehicle_id: vehicleId,
    });
    expect(error).toBeNull();

    const estimate = data as number;
    expect(estimate).toBeGreaterThan(84000);
    expect(estimate).toBeLessThan(95000);
  });

  test('a correctly-timed alert is raised, and it is honest about its confidence', async () => {
    const owner = clientFor(OWNER_ID);
    const shop = clientFor(SHOP_ID);

    // An alert needs an interval to measure from. Without a completed service
    // the scan correctly stays silent — a car Habba has only just met must not
    // be told its oil is overdue.
    const silent = await owner.rpc('scan_vehicle_maintenance', { p_vehicle_id: vehicleId });
    expect(silent.data as number).toBe(0);

    // So: an oil change completed at 62,000 km. The generic rule is 7,000 km,
    // making it due at 69,000 — and the car is now estimated past 85,000.
    const prior = await owner
      .from('orders')
      .insert({
        customer_id: OWNER_ID,
        vehicle_id: vehicleId,
        service_id: serviceId,
        fulfilment_mode: 'workshop',
        workshop_id: providerId,
        provider_id: providerId,
        quoted_amount: 180,
        mileage_at_order: 62000,
        created_by: OWNER_ID,
      })
      .select()
      .single();
    expect(prior.error).toBeNull();
    const priorId = (prior.data as { id: string }).id;

    await owner.from('orders').update({ status: 'quoted' }).eq('id', priorId);
    // Payment state is written only by the payment function (0033); a client
    // declaring its own order paid was the vulnerability that closed.
    await owner.rpc('authorise_order_payment', {
      p_order_id: priorId,
      p_payment_intent_id: 'intel_prior',
    });
    await owner.from('orders').update({ status: 'accepted' }).eq('id', priorId);
    await shop.rpc('check_in_vehicle', { p_order_id: priorId });
    await shop.from('orders').update({ status: 'in_progress' }).eq('id', priorId);
    await shop.rpc('record_completion_evidence', {
      p_order_id: priorId,
      p_mileage: 62000,
      p_media: [
        { url: 'https://example.test/before.jpg', kind: 'before', caption: 'قبل' },
        { url: 'https://example.test/after.jpg', kind: 'after', caption: 'بعد' },
      ],
    });
    await shop
      .from('orders')
      .update({
        status: 'awaiting_approval',
        labour_amount: 180,
        vat_amount: 27,
        total_amount: 207,
        vat_rate_applied: 0.15,
      })
      .eq('id', priorId);
    const done = await owner.from('orders').update({ status: 'completed' }).eq('id', priorId);
    expect(done.error).toBeNull();

    const scan = await owner.rpc('scan_vehicle_maintenance', { p_vehicle_id: vehicleId });
    expect(scan.error).toBeNull();
    expect(scan.data as number).toBe(1);

    const alerts = await owner
      .from('maintenance_alerts')
      .select('message_ar, confidence, status, service_id')
      .eq('vehicle_id', vehicleId);

    const rows = alerts.data as {
      message_ar: string;
      confidence: string;
      status: string;
      service_id: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('open');

    // A generic interval must not present itself as manufacturer guidance —
    // that is a small lie the owner catches the first time they read their
    // service manual.
    expect(rows[0]?.confidence).toBe('generic');
    expect(rows[0]?.message_ar).toContain('تقدير عام');

    // Alert fatigue kills the feature (§7.2), so a second scan the same day
    // raises nothing.
    const rescan = await owner.rpc('scan_vehicle_maintenance', { p_vehicle_id: vehicleId });
    expect(rescan.data as number).toBe(0);
  });

  test('a completed order produces an invoice whose QR decodes to the right values', async () => {
    const owner = clientFor(OWNER_ID);
    const shop = clientFor(SHOP_ID);

    const order = await owner
      .from('orders')
      .insert({
        customer_id: OWNER_ID,
        vehicle_id: vehicleId,
        service_id: serviceId,
        fulfilment_mode: 'workshop',
        workshop_id: providerId,
        provider_id: providerId,
        quoted_amount: 180,
        created_by: OWNER_ID,
      })
      .select()
      .single();

    expect(order.error).toBeNull();
    orderId = (order.data as { id: string }).id;

    await owner.from('orders').update({ status: 'quoted' }).eq('id', orderId);
    // Payment state is written only by the payment function (0033); a client
    // declaring its own order paid was the vulnerability that closed.
    await owner.rpc('authorise_order_payment', {
      p_order_id: orderId,
      p_payment_intent_id: 'intel_http_1',
    });
    await owner.from('orders').update({ status: 'accepted' }).eq('id', orderId);
    await shop.rpc('check_in_vehicle', { p_order_id: orderId });
    await shop.from('orders').update({ status: 'in_progress' }).eq('id', orderId);
    await shop.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: 86000,
      p_media: [
        { url: 'https://example.test/before.jpg', kind: 'before', caption: 'قبل' },
        { url: 'https://example.test/after.jpg', kind: 'after', caption: 'بعد' },
      ],
    });
    await shop
      .from('orders')
      .update({
        status: 'awaiting_approval',
        labour_amount: 180,
        vat_amount: 27,
        total_amount: 207,
        vat_rate_applied: 0.15,
      })
      .eq('id', orderId);
    const completed = await owner.from('orders').update({ status: 'completed' }).eq('id', orderId);
    expect(completed.error).toBeNull();

    const issued = await owner.rpc('issue_zatca_invoice', { p_order_id: orderId });
    expect(issued.error).toBeNull();

    const invoice = await owner
      .from('zatca_invoices')
      .select('invoice_number, qr_base64, total_amount, vat_amount, net_amount')
      .eq('order_id', orderId)
      .single();

    const row = invoice.data as {
      invoice_number: string;
      qr_base64: string;
      total_amount: string;
      vat_amount: string;
      net_amount: string;
    };

    expect(row.invoice_number).toMatch(/^HB-INV-\d{4}-\d{6}$/);

    // Decoded independently. A QR encoding the wrong bytes still renders as a
    // perfectly scannable square — the failure is invisible until an audit.
    const tags = decodeTlv(row.qr_base64);

    expect(tags.get(1)).toBe('شركة هبّة للتقنية'); // seller name
    expect(tags.get(2)).toMatch(/^3\d{13}3$/); // VAT registration number
    expect(tags.get(3)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // ISO 8601 UTC
    expect(tags.get(4)).toBe('207.00'); // total including VAT
    expect(tags.get(5)).toBe('27.00'); // VAT amount

    // The amounts in the QR must equal the amounts on the invoice, or the
    // document contradicts its own machine-readable half.
    expect(tags.get(4)).toBe(Number(row.total_amount).toFixed(2));
    expect(tags.get(5)).toBe(Number(row.vat_amount).toFixed(2));
  });

  test('a payout pays commission on the net, never on the VAT', async () => {
    const owner = clientFor(OWNER_ID);
    const ops = clientFor(OPS_ID);

    // Money must actually have been taken before anyone is paid — and it is
    // taken by the payment function, not by asserting it in an UPDATE (0033).
    const captured = await owner.rpc('capture_order_payment', { p_order_id: orderId });
    expect(captured.error).toBeNull();

    // One payout per provider per period is a real constraint — a repeated
    // payout run must not pay twice. The provider is reused across test runs,
    // so each run needs its own window rather than colliding on yesterday's.
    const windowDays = 2 + (Math.floor(Date.now() / 1000) % 300);

    const built = await ops.rpc('build_payout', {
      p_provider_id: providerId,
      p_period_start: new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10),
      p_period_end: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    });
    expect(built.error).toBeNull();

    const payout = await ops
      .from('payouts')
      .select('gross_amount, commission, net_amount, order_count')
      .eq('id', built.data as string)
      .single();

    const row = payout.data as {
      gross_amount: string;
      commission: string;
      net_amount: string;
      order_count: number;
    };

    expect(row.order_count).toBe(1);
    expect(Number(row.gross_amount)).toBe(207);
    // 20% of the 180 net — taking a cut of the 27 VAT would be taking a cut of
    // money that belongs to ZATCA.
    expect(Number(row.commission)).toBe(36);
    expect(Number(row.net_amount)).toBe(171);
  });

  test("a provider cannot see another provider's earnings", async () => {
    const shop = clientFor(SHOP_ID);

    const mine = await shop.from('payouts').select('id, provider_id');
    expect(mine.error).toBeNull();
    for (const row of (mine.data ?? []) as { provider_id: string }[]) {
      expect(row.provider_id).toBe(providerId);
    }
  });
});
