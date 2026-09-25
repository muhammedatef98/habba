/**
 * A pre-purchase inspection, through the app (0073).
 *
 * `inspection.integration.test.ts` proves the backend with RPCs called in the
 * order the database expects. This walks the screens' own repositories: the
 * buyer books and pays through SupabaseRepository, the inspector works the job
 * and files the report through SupabaseProviderRepository — with the form's
 * own completeness rule (`inspectionProgress`) deciding when it may submit —
 * and the buyer reads the report on the order and turns it into their car.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  inspectionProgress,
  nextJobStep,
  type CompletionMediaItem,
  type InspectionResultEntry,
} from '@habba/core';
import { SupabaseRepository } from '@/features/shared/data/supabase-repository.js';
import { mintTestJwt } from '@/features/shared/data/test-jwt.js';
import { SupabaseProviderRepository } from './provider-repository.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const BUYER_ID = 'aaaaaaaa-7777-4777-8777-aaaaaaaaaaa1';
const INSPECTOR_ID = 'bbbbbbbb-7777-4777-8777-bbbbbbbbbbb1';
const BUYER_NAME = 'مشتري عبر التطبيق';
const BUYER_PHONE = '+966507780001';

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

const buyer = () => new SupabaseRepository(clientFor(BUYER_ID), () => BUYER_ID);
const inspector = () => new SupabaseProviderRepository(clientFor(INSPECTOR_ID));

function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `JTDBR32E${safe}`.slice(0, 17).padEnd(17, '7');
}

let providerId = '';
let serviceId = '';
let orderId = '';
let reportId = '';
const subjectVin = uniqueVin();

beforeAll(async () => {
  if (!harnessUp) return;

  const setup = clientFor(BUYER_ID);
  await setup.rpc('test_seed_auth_user', { p_id: BUYER_ID, p_phone: BUYER_PHONE });
  await setup.rpc('test_seed_auth_user', { p_id: INSPECTOR_ID, p_phone: '+966507780002' });
  await setup.from('profiles').upsert({ id: BUYER_ID, full_name: BUYER_NAME, phone: BUYER_PHONE });
  const own = clientFor(INSPECTOR_ID);
  await own
    .from('profiles')
    .upsert({ id: INSPECTOR_ID, full_name: 'فاحص التطبيق', phone: '+966507780002' });

  const cities = await setup.from('cities').select('id').eq('name_en', 'Riyadh');
  const cityId = (cities.data ?? [])[0]?.id as string;

  const existing = await own.from('providers').select('id').eq('owner_profile_id', INSPECTOR_ID);
  providerId = (existing.data as { id: string }[] | null)?.[0]?.id ?? '';
  if (providerId === '') {
    const created = await own
      .from('providers')
      .insert({
        owner_profile_id: INSPECTOR_ID,
        provider_type: 'individual',
        business_name_ar: 'فحص قبل الشراء عبر التطبيق',
        city_id: cityId,
      })
      .select('id')
      .single();
    if (created.error !== null) throw new Error(`fixture provider: ${created.error.message}`);
    providerId = (created.data as { id: string }).id;
  }
  await own.rpc('test_approve_provider', { p_provider_id: providerId });

  const services = await setup
    .from('services')
    .select('id')
    .eq('name_en', 'Pre-purchase inspection');
  serviceId = (services.data ?? [])[0]?.id as string;
  await own.from('provider_services').upsert({ provider_id: providerId, service_id: serviceId });

  // A distinct future day per run: generate_slots is idempotent, and a slot
  // an earlier run booked is not free for this one.
  const dayOffset = 1 + (Math.floor(Date.now() / 1000) % 25);
  await own.rpc('generate_slots', {
    p_from: new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10),
    p_days: 1,
    p_start_hour: 12,
    p_end_hour: 14,
    p_capacity: 2,
  });
});

describe.skipIf(!harnessUp)('a pre-purchase inspection, through the app', () => {
  test('the buyer books an inspection of a car they do not own, and it is confirmed', async () => {
    const slots = await buyer().listSlots(providerId);
    const free = slots.find((slot) => slot.remaining > 0);
    expect(free).toBeDefined();

    orderId = await buyer().bookAppointment({
      slotId: free!.id,
      serviceId,
      problem: 'فحص قبل الشراء',
      lon: 46.6753,
      lat: 24.7136,
      addressAr: 'معرض السيارات، طريق الملك عبدالله',
    });
    expect(await buyer().submitOrder(orderId)).toBe('accepted');
  });

  test('the job tells the inspector a report is owed, and hand-back is refused without it', async () => {
    const repo = inspector();
    for (const status of ['en_route', 'arrived', 'in_progress'] as const) {
      await repo.advanceJob(orderId, status);
    }

    const job = await repo.getJob(orderId);
    expect(job?.inspectionTemplateKey).toBe('pre_purchase_v1');
    expect(job?.inspectionFiled).toBe(false);
    expect(job?.hasVehicle).toBe(false);
    expect(nextJobStep(job!.status, job!.fulfilmentMode).action).toBe('submit_for_approval');

    const photos = await clientFor(INSPECTOR_ID).rpc('test_upload_completion_photos', {
      p_order_id: orderId,
    });
    expect(photos.error).toBeNull();
    await repo.recordEvidence(orderId, 97000, photos.data as CompletionMediaItem[], 30);

    await expect(repo.advanceJob(orderId, 'awaiting_approval')).rejects.toThrow();
    expect((await repo.getJob(orderId))?.status).toBe('in_progress');
  });

  test('the form submits once every required item is rated, and the server scores it', async () => {
    const repo = inspector();
    const template = await repo.getInspectionTemplate('pre_purchase_v1');
    expect(template).not.toBeNull();

    const results: Record<string, Record<string, InspectionResultEntry>> = {};
    expect(inspectionProgress(template!.sections, results).missingRequired.length).toBeGreaterThan(
      0,
    );

    for (const section of template!.sections) {
      results[section.key] = {};
      for (const item of section.items) results[section.key]![item.key] = { rating: 'pass' };
    }
    results['tyres']!['tread'] = { rating: 'attention', note: 'الإطارات الخلفية قاربت على الحد' };
    expect(inspectionProgress(template!.sections, results).missingRequired).toEqual([]);

    const filed = await repo.submitInspection(orderId, 'pre_purchase_v1', results, {
      vin: subjectVin,
      plate: null,
      makeAr: 'تويوتا',
      modelAr: 'كامري',
      year: 2020,
      mileage: 97000,
    });
    expect(filed.score).not.toBeNull();
    expect(filed.recommendation).not.toBeNull();

    expect((await repo.getJob(orderId))?.inspectionFiled).toBe(true);
    await repo.advanceJob(orderId, 'awaiting_approval');
    expect((await repo.getJob(orderId))?.status).toBe('awaiting_approval');
  });

  test('the buyer reads the report on the order — about the car, not about them', async () => {
    const inspection = await buyer().getOrderInspection(orderId);
    expect(inspection).not.toBeNull();
    expect(inspection!.vehicleId).toBeNull();
    expect(inspection!.report.subject.vin).toBe(subjectVin);
    reportId = inspection!.reportId;

    const wire = JSON.stringify(inspection!.report);
    expect(wire).toContain('الإطارات الخلفية');
    expect(wire).not.toContain(BUYER_NAME);
    expect(wire).not.toContain(BUYER_PHONE);
  });

  test('the buyer approves, buys the car, and its logbook opens with the inspection', async () => {
    await buyer().confirmOrderCompletion(orderId);
    expect((await buyer().getOrder(orderId))?.status).toBe('completed');

    const makes = await buyer().listMakes();
    const toyota = makes.find((make) => make.nameEn === 'Toyota');
    expect(toyota).toBeDefined();
    const camry = (await buyer().listModels(toyota!.id)).find((model) => model.nameEn === 'Camry');
    expect(camry).toBeDefined();

    const vehicleId = await buyer().convertInspectionToVehicle(
      reportId,
      toyota!.id,
      camry!.id,
      'كامري المفحوصة',
    );

    const timeline = await buyer().listTimeline(vehicleId);
    expect(timeline.map((event) => event.eventType)).toContain('inspection_completed');
    expect((await buyer().getOrderInspection(orderId))?.vehicleId).toBe(vehicleId);
  });
});
