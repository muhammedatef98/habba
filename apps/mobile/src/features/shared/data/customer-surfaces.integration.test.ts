/**
 * The customer's screens, read through the app's own repository against the
 * real database.
 *
 * Written after the order history turned out to show every service with an
 * empty name: the query was right, the mapping read the embed in the wrong
 * shape, and nothing noticed because no test read the history back through
 * SupabaseRepository. These are the methods behind screens that had the same
 * gap — each one is called the way the screen calls it, and what the screen
 * would show is asserted.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { SupabaseRepository } from './supabase-repository.js';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const SELLER_ID = 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
const BUYER_ID = 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb';
const SELLER_PHONE = '+966507750001';
const BUYER_PHONE = '+966507750002';

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

function repoFor(userId: string): SupabaseRepository {
  return new SupabaseRepository(clientFor(userId), () => userId);
}

let vehicleId = '';
let serviceId = '';

beforeAll(async () => {
  if (!harnessUp) return;

  const seller = clientFor(SELLER_ID);
  await seller.rpc('test_seed_auth_user', { p_id: SELLER_ID, p_phone: SELLER_PHONE });
  await seller.rpc('test_seed_auth_user', { p_id: BUYER_ID, p_phone: BUYER_PHONE });
  await seller.from('profiles').upsert({ id: SELLER_ID, full_name: 'البائع', phone: SELLER_PHONE });
  await clientFor(BUYER_ID)
    .from('profiles')
    .upsert({ id: BUYER_ID, full_name: 'المشتري', phone: BUYER_PHONE });

  const repo = repoFor(SELLER_ID);
  const makes = await repo.listMakes();
  const toyota = makes.find((make) => make.nameEn === 'Toyota');
  const models = await repo.listModels(toyota?.id ?? '');
  const camry = models.find((model) => model.nameEn === 'Camry');

  const vehicle = await repo.addVehicle({
    makeId: toyota?.id ?? '',
    modelId: camry?.id ?? '',
    year: 2019,
    plate: 'RSX 5151',
  });
  vehicleId = vehicle.id;

  const services = await repo.listEmergencyServices();
  serviceId = services.find((service) => service.nameEn.startsWith('Battery'))?.id ?? '';
});

describe.skipIf(!harnessUp)('what the customer screens read back', () => {
  test('the account screen knows who is signed in', async () => {
    const profile = await repoFor(SELLER_ID).getProfile();
    expect(profile?.fullName).toBe('البائع');
    expect(profile?.phone).toBe(SELLER_PHONE);
  });

  test('the catalogue screens have cities and every model', async () => {
    const repo = repoFor(SELLER_ID);
    expect((await repo.listCities()).length).toBeGreaterThan(0);
    const models = await repo.listAllModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.nameAr ?? '').not.toBe('');
  });

  test('a past service entered by the owner lands in the logbook', async () => {
    const repo = repoFor(SELLER_ID);
    await repo.recordPastService({
      vehicleId,
      summaryAr: 'تغيير زيت في ورشة خارجية',
      occurredAt: new Date('2025-03-01T08:00:00Z'),
      mileage: 41000,
    });
    const timeline = await repo.listTimeline(vehicleId);
    const entry = timeline.find((event) => event.summaryAr === 'تغيير زيت في ورشة خارجية');
    expect(entry?.provenance).toBe('self_reported');
  });

  test('تقرير هبّة names the car, not its ids', async () => {
    const repo = repoFor(SELLER_ID);
    const token = await repo.generateReport(vehicleId);
    const report = await repo.getReport(token);
    expect(report?.vehicle.make_ar).toBe('تويوتا');
    expect(report?.vehicle.model_en).toBe('Camry');
    expect(report?.coverage.total ?? 0).toBeGreaterThan(0);
  });

  test('the logbook has no alerts to show for a new car, without failing', async () => {
    expect(await repoFor(SELLER_ID).listMaintenanceAlerts(vehicleId)).toEqual([]);
  });

  test('a cancelled request reads back as cancelled', async () => {
    const repo = repoFor(SELLER_ID);
    const orderId = await repo.createEmergencyOrder({
      serviceId,
      lon: 50.1033,
      lat: 26.2172,
      vehicleId,
      addressAr: 'الدمام',
    });
    await repo.cancelOrder(orderId, 'لم أعد أحتاج الخدمة');
    const order = await repo.getOrder(orderId);
    expect(order?.status).toBe('cancelled');
  });

  // The least each form lets through. The add-car screen called the plate
  // optional and the database refused every car without one; these hold the
  // other forms to what they actually allow.
  test('an emergency with no address and no description still goes out', async () => {
    const repo = repoFor(SELLER_ID);
    const orderId = await repo.createEmergencyOrder({
      serviceId,
      lon: 50.1033,
      lat: 26.2172,
      vehicleId,
    });
    expect(await repo.submitOrder(orderId)).toBe('searching');
    await repo.cancelOrder(orderId);
    expect((await repo.getOrder(orderId))?.status).toBe('cancelled');
  });

  test('a past service with no odometer reading is still recorded', async () => {
    const repo = repoFor(SELLER_ID);
    await repo.recordPastService({
      vehicleId,
      summaryAr: 'تبديل مساحات',
      occurredAt: new Date('2025-05-01T08:00:00Z'),
    });
    const timeline = await repo.listTimeline(vehicleId);
    expect(timeline.some((event) => event.summaryAr === 'تبديل مساحات')).toBe(true);
  });

  test('a handover: seller starts it, buyer sees the car, accepts, and owns it', async () => {
    const seller = repoFor(SELLER_ID);
    const minted = await seller.initiateTransfer({ vehicleId, phone: BUYER_PHONE });
    expect(minted.code).toMatch(/^\d{6}$/);

    const outgoing = await seller.getOutgoingTransfer(vehicleId);
    expect(outgoing?.id).toBe(minted.id);
    expect(outgoing?.status).toBe('pending');

    const buyer = repoFor(BUYER_ID);
    const incoming = await buyer.getIncomingTransfer();
    expect(incoming?.transferId).toBe(minted.id);
    expect(incoming?.makeAr).toBe('تويوتا');
    expect(incoming?.recordsTotal ?? 0).toBeGreaterThan(0);

    const owned = await buyer.acceptTransfer(minted.id, minted.code);
    expect(owned).toBe(vehicleId);
    expect((await buyer.listVehicles()).some((vehicle) => vehicle.id === vehicleId)).toBe(true);
    expect((await seller.listVehicles()).some((vehicle) => vehicle.id === vehicleId)).toBe(false);
  });
});
