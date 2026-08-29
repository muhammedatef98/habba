/**
 * Phase 5 acceptance, executed.
 *
 * "A pre-purchase inspection produces a shareable report; if the buyer
 * purchases, the report converts into a new `vehicles` row with the inspection
 * as its first timeline event."
 *
 * Three identities: the buyer who commissions it, the inspector who files it,
 * and an anonymous reader with nothing but the link — which is how a report
 * actually gets read.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { renderInspectionReport, type InspectionReport } from '@habba/core';
import { mintTestJwt } from './test-jwt.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const BUYER_ID = 'cccccccc-5555-4555-8555-cccccccccccc';
const INSPECTOR_ID = 'dddddddd-5555-4555-8555-dddddddddddd';

const ARTIFACT = resolve(process.cwd(), '.tmp/habba-inspection.html');

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

/** The car being inspected — unique per run, since VIN is globally unique. */
function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `5HGBH41JX${safe}`.slice(0, 17).padEnd(17, '0');
}

let providerId = '';
let serviceId = '';
let orderId = '';
let reportId = '';
let shareToken = '';
let makeId = '';
let modelId = '';
const subjectVin = uniqueVin();

beforeAll(async () => {
  if (!harnessUp) return;

  const buyer = clientFor(BUYER_ID);
  await buyer.rpc('test_seed_auth_user', { p_id: BUYER_ID, p_phone: '+966509990001' });
  await buyer.rpc('test_seed_auth_user', { p_id: INSPECTOR_ID, p_phone: '+966509990002' });

  await buyer
    .from('profiles')
    .upsert({ id: BUYER_ID, full_name: 'مشتري السيارة', phone: '+966509990001' });

  const inspector = clientFor(INSPECTOR_ID);
  await inspector.from('profiles').upsert({
    id: INSPECTOR_ID,
    full_name: 'الفاحص المعتمد',
    phone: '+966509990002',
    role: 'technician',
  });

  const cities = await buyer.from('cities').select('id').eq('name_en', 'Riyadh');
  const cityId = (cities.data ?? [])[0]?.id as string;

  const existing = await inspector
    .from('providers')
    .select('id')
    .eq('owner_profile_id', INSPECTOR_ID)
    .limit(1);

  if ((existing.data ?? []).length > 0) {
    providerId = (existing.data as { id: string }[])[0]!.id;
  } else {
    const created = await inspector
      .from('providers')
      .insert({
        owner_profile_id: INSPECTOR_ID,
        provider_type: 'individual',
        business_name_ar: 'مركز الفحص المعتمد',
        city_id: cityId,
      })
      .select('id')
      .single();
    providerId = (created.data as { id: string }).id;
  }

  await buyer.rpc('test_approve_provider', { p_provider_id: providerId });

  const services = await buyer
    .from('services')
    .select('id')
    .eq('name_en', 'Pre-purchase inspection');
  serviceId = (services.data ?? [])[0]?.id as string;

  await inspector
    .from('provider_services')
    .upsert({ provider_id: providerId, service_id: serviceId });

  const makes = await buyer.from('vehicle_makes').select('id').eq('name_en', 'Toyota');
  makeId = (makes.data ?? [])[0]?.id as string;
  const models = await buyer
    .from('vehicle_models')
    .select('id')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry');
  modelId = (models.data ?? [])[0]?.id as string;
});

describe.skipIf(!harnessUp)('Phase 5 acceptance — pre-purchase inspection', () => {
  test('a buyer orders an inspection for a car they do not own', async () => {
    const buyer = clientFor(BUYER_ID);

    // A pre-purchase inspection is scheduled work, not on-demand — the
    // catalogue says so, and create_emergency_order correctly refuses it. It
    // is booked against one of the inspector's published slots.
    // A distinct future day per run. generate_slots is idempotent, so reusing
    // one window means the second run finds the first run's slot already
    // booked — the suite must not depend on a freshly reset database.
    const dayOffset = 1 + (Math.floor(Date.now() / 1000) % 25);
    const inspector = clientFor(INSPECTOR_ID);
    await inspector.rpc('generate_slots', {
      p_from: new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10),
      p_days: 1,
      p_start_hour: 9,
      p_end_hour: 11,
      p_capacity: 2,
    });

    const slots = await buyer
      .from('appointment_slots')
      .select('id')
      .eq('provider_id', providerId)
      .eq('is_blocked', false)
      .eq('booked_count', 0)
      .gt('starts_at', new Date().toISOString())
      .limit(1);

    const slotId = (slots.data as { id: string }[])[0]?.id;
    expect(slotId).toBeDefined();

    const created = await buyer.rpc('book_appointment', {
      p_slot_id: slotId,
      p_service_id: serviceId,
      // No vehicle. The whole point: nobody in Habba owns this car.
      p_vehicle_id: null,
      p_problem: 'فحص قبل الشراء',
      p_lon: 46.6753,
      p_lat: 24.7136,
      p_address_ar: 'معرض السيارات، طريق الملك عبدالله',
    });

    expect(created.error).toBeNull();
    orderId = created.data as string;

    const order = await buyer.from('orders').select('vehicle_id').eq('id', orderId).single();
    expect((order.data as { vehicle_id: string | null }).vehicle_id).toBeNull();

    // Drive it to in_progress so the inspector can file. A scheduled mobile
    // order goes draft → quoted → accepted → en_route, with no search step:
    // the customer chose this provider.
    // book_appointment set the price from the catalogue; the customer cannot
    // write amounts at all (0033).
    await buyer.from('orders').update({ status: 'quoted' }).eq('id', orderId);
    // Payment state is written only by the payment function (0033); a client
    // declaring its own order paid was the vulnerability that closed.
    await buyer.rpc('authorise_order_payment', {
      p_order_id: orderId,
      p_payment_intent_id: 'insp_intent_int',
    });
    await buyer.from('orders').update({ status: 'accepted' }).eq('id', orderId);

    for (const status of ['en_route', 'arrived', 'in_progress']) {
      const step = await inspector.from('orders').update({ status }).eq('id', orderId);
      expect(step.error, status).toBeNull();
    }
  });

  test('the inspector files a structured report and it is scored', async () => {
    const inspector = clientFor(INSPECTOR_ID);

    const template = await inspector
      .from('inspection_templates')
      .select('sections')
      .eq('key', 'pre_purchase_v1')
      .single();

    const sections = (template.data as { sections: { key: string; items: { key: string }[] }[] })
      .sections;

    // A realistic car: mostly sound, with a documented accident repair and
    // some wear. Not a fabricated perfect score.
    const results: Record<string, Record<string, { rating: string; note?: string }>> = {};
    for (const section of sections) {
      results[section.key] = {};
      for (const item of section.items) {
        results[section.key]![item.key] = { rating: 'pass' };
      }
    }
    results['history']!['accident_evidence'] = {
      rating: 'fail',
      note: 'إصلاح وإعادة دهان في الرفرف الأمامي الأيسر',
    };
    results['engine']!['oil_leaks'] = { rating: 'attention', note: 'ترشيح خفيف من غطاء البلوف' };
    results['tyres']!['tread'] = { rating: 'attention' };

    const submitted = await inspector.rpc('submit_inspection_report', {
      p_order_id: orderId,
      p_template_key: 'pre_purchase_v1',
      p_results: results,
      p_subject_vin: subjectVin,
      p_subject_plate: 'ا ب ح ٣٣٣٣',
      p_subject_make_ar: 'تويوتا',
      p_subject_model_ar: 'كامري',
      p_subject_year: 2018,
      p_subject_mileage: 120000,
    });

    expect(submitted.error).toBeNull();
    reportId = submitted.data as string;

    const report = await inspector
      .from('inspection_reports')
      .select('overall_score, recommendation, public_token, vehicle_id')
      .eq('id', reportId)
      .single();

    const row = report.data as {
      overall_score: number;
      recommendation: string;
      public_token: string;
      vehicle_id: string | null;
    };

    shareToken = row.public_token;

    // Confirmed accident repair is a critical finding, so it caps the score
    // and forces `avoid` no matter how sound the rest of the car is. Weighted
    // averaging alone put this car at 92% and `buy`, which is the kind of
    // number that sends a buyer into a bad purchase feeling reassured.
    expect(row.overall_score).toBeLessThanOrEqual(45);
    expect(row.recommendation).toBe('avoid');
    expect(row.vehicle_id).toBeNull();
  });

  test('anyone with the link can read and render it — no login', async () => {
    const anonymous = clientFor(null);

    const { data, error } = await anonymous.rpc('get_inspection_report', {
      p_token: shareToken,
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const report = data as InspectionReport;
    expect(report.subject.vin).toBe(subjectVin);

    // The report is about the CAR — the buyer paid for it, but a seller
    // forwarding it must not be forwarding the buyer's identity.
    const wire = JSON.stringify(report);
    expect(wire).not.toContain('مشتري السيارة');
    expect(wire).not.toContain('+966509990001');

    const html = renderInspectionReport(report, {
      publicUrl: `https://habba.sa/i/${shareToken}`,
    });

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    writeFileSync(ARTIFACT, html, 'utf8');

    expect(html).toContain('إصلاح وإعادة دهان');
    expect(html).toContain(subjectVin);
  });

  test('THE acceptance: the buyer purchases and the inspection opens their logbook', async () => {
    const buyer = clientFor(BUYER_ID);

    await buyer.from('orders').update({ status: 'awaiting_approval' }).eq('id', orderId);
    const completed = await buyer.from('orders').update({ status: 'completed' }).eq('id', orderId);
    expect(completed.error).toBeNull();

    const converted = await buyer.rpc('convert_inspection_to_vehicle', {
      p_report_id: reportId,
      p_make_id: makeId,
      p_model_id: modelId,
      p_nickname: 'كامري الجديدة',
    });

    expect(converted.error).toBeNull();
    const vehicleId = converted.data as string;

    const vehicle = await buyer
      .from('vehicles')
      .select('owner_id, vin, current_mileage, year')
      .eq('id', vehicleId)
      .single();

    const row = vehicle.data as {
      owner_id: string;
      vin: string;
      current_mileage: number;
      year: number;
    };
    expect(row.owner_id).toBe(BUYER_ID);
    expect(row.vin).toBe(subjectVin);
    expect(row.current_mileage).toBe(120000);

    // The buyer's brand-new logbook is not empty. It opens with a
    // Habba-verified assessment of the car they just bought — which is the
    // zero-CAC acquisition loop, working.
    const timeline = await buyer
      .from('vehicle_timeline')
      .select('event_type, provenance, details')
      .eq('vehicle_id', vehicleId);

    const events = timeline.data as {
      event_type: string;
      provenance: string;
      details: Record<string, unknown>;
    }[];

    expect(events).toHaveLength(2);

    const inspection = events.find((e) => e.event_type === 'inspection_completed');
    expect(inspection).toBeDefined();
    expect(inspection?.provenance).toBe('habba_verified');
    expect(inspection?.details['inspection_score']).toBeLessThanOrEqual(45);

    const verify = await buyer.rpc('verify_vehicle_timeline', { p_vehicle_id: vehicleId });
    const chain = Array.isArray(verify.data) ? verify.data[0] : verify.data;
    expect(chain?.is_valid).toBe(true);

    // And it can immediately produce a تقرير هبّة — the buyer became a
    // customer with something worth reporting on from day one.
    const report = await buyer.rpc('generate_habba_report', { p_vehicle_id: vehicleId });
    expect(report.error).toBeNull();
  });
});
