/**
 * A service request, end to end, the way the app actually makes it.
 *
 * The other integration suites call RPCs directly, in the order the database
 * expects — which is how the app's own sequence went unexamined. It created
 * an emergency and never sent it, never held the payment, never told the
 * server where the technician was, and "accepted" through a table UPDATE that
 * RLS silently turned into nothing. Every one of those suites passed.
 *
 * This walks both flows through the repositories the screens use — the
 * customer's SupabaseRepository and the technician's SupabaseProviderRepository
 * — method by method, screen by screen, with two identities over real HTTP.
 * The provider's next action comes from `nextJobStep`, exactly as the job
 * screen derives its button. The one step stood in for is the photo upload's
 * transport: the harness runs no Storage API, so `test_upload_completion_photos`
 * inserts the objects as the technician, under the real storage policy.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { addSar, nextJobStep, sarOrThrow, type CompletionMediaItem } from '@habba/core';
import { SupabaseRepository } from '@/features/shared/data/supabase-repository.js';
import { mintTestJwt } from '@/features/shared/data/test-jwt.js';
import { priceWithVat } from '@/features/shared/lib/order-price.js';
import { SupabaseProviderRepository } from './provider-repository.js';

const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

const CUSTOMER_ID = 'aaaaaaaa-6666-4666-8666-aaaaaaaaaaa1';
const TECH_ID = 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbb1';
const RIVAL_ID = 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbb2';
const WORKSHOP_ID = 'cccccccc-6666-4666-8666-ccccccccccc1';

/** Where the customer's car is, and where each technician's phone reports. */
const CAR = { lon: 50.105, lat: 26.422 };

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

const customer = () => new SupabaseRepository(clientFor(CUSTOMER_ID), () => CUSTOMER_ID);

/** What push-tick connects as: the service role, the only caller the queue answers. */
function sender(): SupabaseClient {
  const token = mintTestJwt(JWT_SECRET, { sub: CUSTOMER_ID, role: 'service_role' });
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: restFetch },
  });
}

const CUSTOMER_PHONE = 'ExponentPushToken[flow-customer-phone]';
const TECH_PHONE = 'ExponentPushToken[flow-technician-ph]';
const technician = (id: string) => new SupabaseProviderRepository(clientFor(id));

function uniqueVin(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  const safe = suffix.replace(/I/g, '1').replace(/O/g, '0').replace(/Q/g, '9');
  return `5YJ3E1EA7K${safe}`.slice(0, 17).padEnd(17, '0');
}

/** Creates a provider for `ownerId` (or reuses the one a previous run made) and approves it. */
async function approvedProvider(
  ownerId: string,
  type: 'individual' | 'workshop',
  name: string,
  serviceId: string,
): Promise<string> {
  const owner = clientFor(ownerId);
  const cities = await owner.from('cities').select('id').eq('name_en', 'Dammam');
  const cityId = (cities.data ?? [])[0]?.id as string;

  const existing = await owner.from('providers').select('id').eq('owner_profile_id', ownerId);
  let providerId = (existing.data as { id: string }[] | null)?.[0]?.id;

  if (providerId === undefined) {
    const created = await owner
      .from('providers')
      .insert({
        owner_profile_id: ownerId,
        provider_type: type,
        business_name_ar: name,
        city_id: cityId,
        ...(type === 'workshop' ? { cr_number: '6060606060' } : {}),
      })
      .select('id')
      .single();
    if (created.error !== null) throw new Error(`fixture provider: ${created.error.message}`);
    providerId = (created.data as { id: string }).id;
  }

  // Ops approval — the admin console's job; the shim stands in for it.
  await owner.rpc('test_approve_provider', { p_provider_id: providerId });
  await owner.from('provider_services').upsert({ provider_id: providerId, service_id: serviceId });
  return providerId;
}

/**
 * Drives a job forward the way the job screen does — `nextJobStep` decides
 * the button — until it reaches the hand-back, recording evidence on the way.
 */
async function workTheJob(
  techId: string,
  orderId: string,
  mileage: number,
  warrantyDays: number,
): Promise<string[]> {
  const repo = technician(techId);
  const walked: string[] = [];

  for (let guard = 0; guard < 10; guard++) {
    const job = await repo.getJob(orderId);
    if (job === null) throw new Error('the technician lost sight of their own job');

    const step = nextJobStep(job.status, job.fulfilmentMode);
    if (step.toStatus === null) break;

    if (step.action === 'submit_for_approval') {
      // The evidence screen: photos, the odometer, and the warranty given.
      const photos = await clientFor(techId).rpc('test_upload_completion_photos', {
        p_order_id: orderId,
      });
      if (photos.error !== null) throw new Error(`photo upload: ${photos.error.message}`);
      await repo.recordEvidence(
        orderId,
        mileage,
        photos.data as CompletionMediaItem[],
        warrantyDays,
      );
    }

    if (step.action === 'check_in_vehicle') await repo.checkInVehicle(orderId);
    else await repo.advanceJob(orderId, step.toStatus);

    walked.push(step.toStatus);
    if (step.action === 'submit_for_approval') break;
  }

  return walked;
}

let vehicleId = '';
let batteryServiceId = '';
let oilServiceId = '';

beforeAll(async () => {
  if (!harnessUp) return;

  const seeder = clientFor(CUSTOMER_ID);
  for (const [id, phone] of [
    [CUSTOMER_ID, '+966507760001'],
    [TECH_ID, '+966507760002'],
    [RIVAL_ID, '+966507760003'],
    [WORKSHOP_ID, '+966507760004'],
  ] as const) {
    await seeder.rpc('test_seed_auth_user', { p_id: id, p_phone: phone });
    await clientFor(id).from('profiles').upsert({ id, full_name: 'مستخدم', phone });
  }

  const makes = await seeder.from('vehicle_makes').select('id').eq('name_en', 'Toyota');
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await seeder
    .from('vehicle_models')
    .select('id')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry');

  const vehicle = await seeder
    .from('vehicles')
    .insert({
      owner_id: CUSTOMER_ID,
      make_id: makeId,
      model_id: (models.data ?? [])[0]?.id as string,
      year: 2023,
      plate_en: 'ZXK 6060',
      vin: uniqueVin(),
      created_by: CUSTOMER_ID,
    })
    .select('id')
    .single();
  if (vehicle.error !== null) throw new Error(`fixture vehicle: ${vehicle.error.message}`);
  vehicleId = (vehicle.data as { id: string }).id;

  // The services the customer's screens list — found the way they find them.
  const emergency = await customer().listEmergencyServices();
  batteryServiceId = emergency.find((s) => s.nameEn === 'Battery jump or replacement')!.id;
  const bookable = await customer().listBookableServices();
  oilServiceId = bookable.find((s) => s.nameEn === 'Oil and filter change')!.id;
});

describe.skipIf(!harnessUp)('an emergency request, through the app', () => {
  let orderId = '';

  test('both phones register for notifications, each in its own language', async () => {
    // What registerThisDevice() sends once permission is given.
    await customer().registerPushDevice(CUSTOMER_PHONE, 'ios', 'ar');
    await new SupabaseRepository(clientFor(TECH_ID), () => TECH_ID).registerPushDevice(
      TECH_PHONE,
      'android',
      'en',
    );
  });

  test('two technicians go online, and their phones report where they are', async () => {
    for (const id of [TECH_ID, RIVAL_ID]) {
      await approvedProvider(id, 'individual', 'فنّي بطاريات', batteryServiceId);
      const repo = technician(id);
      await repo.setOnline(true);
      // What the shift screen does with the device fix every interval.
      await repo.broadcastLocation({ lon: CAR.lon + 0.002, lat: CAR.lat + 0.001 });
    }
  });

  test('a created request is not visible to anyone until it is sent', async () => {
    orderId = await customer().createEmergencyOrder({
      serviceId: batteryServiceId,
      lon: CAR.lon,
      lat: CAR.lat,
      vehicleId,
      addressAr: 'حي الشاطئ، بجانب المسجد',
      problem: 'السيارة لا تعمل',
    });

    expect((await customer().getOrder(orderId))?.status).toBe('draft');
    const open = await technician(TECH_ID).listOpenJobs();
    expect(open.some((job) => job.orderId === orderId)).toBe(false);
  });

  test('sending it holds the payment and puts it in front of nearby technicians', async () => {
    expect(await customer().submitOrder(orderId)).toBe('searching');

    const order = await customer().getOrder(orderId);
    expect(order?.escrowStatus).toBe('authorised');

    // Sending twice — a retry after a dropped response — changes nothing.
    expect(await customer().submitOrder(orderId)).toBe('searching');

    const open = await technician(TECH_ID).listOpenJobs();
    expect(open.some((job) => job.orderId === orderId)).toBe(true);
  });

  test('a technician can open the offer before it is theirs — without the address', async () => {
    const offer = await technician(TECH_ID).getJob(orderId);

    expect(offer?.status).toBe('searching');
    expect(offer?.offer?.distanceBucket).toBeTruthy();
    expect(offer?.addressAr).toBeNull();
    expect(nextJobStep(offer!.status, offer!.fulfilmentMode).action).toBe('accept');
  });

  test('one technician gets it; the other is told plainly that it is taken', async () => {
    expect(await technician(TECH_ID).acceptJob(orderId)).toBe('accepted');
    expect(await technician(RIVAL_ID).acceptJob(orderId)).toBe('taken');

    const job = await technician(TECH_ID).getJob(orderId);
    expect(job?.status).toBe('accepted');
    expect(job?.addressAr).toBe('حي الشاطئ، بجانب المسجد');

    const mine = await technician(TECH_ID).listMyJobs();
    expect(mine.some((candidate) => candidate.orderId === orderId)).toBe(true);
  });

  test('the technician works it through to hand-back, one button at a time', async () => {
    const walked = await workTheJob(TECH_ID, orderId, 41000, 90);
    expect(walked).toEqual(['en_route', 'arrived', 'in_progress', 'awaiting_approval']);
  });

  test('the customer sees the bill, the photos and the warranty before approving', async () => {
    const order = await customer().getOrder(orderId);

    expect(order?.status).toBe('awaiting_approval');
    expect(order?.totalAmount).toBe(priceWithVat(order!.quotedAmount!));
    expect(order?.completionMedia).toHaveLength(2);
    expect(order?.warrantyDays).toBe(90);
  });

  test('approving completes the job, captures the payment, and fills the logbook', async () => {
    await customer().confirmOrderCompletion(orderId);

    const order = await customer().getOrder(orderId);
    expect(order?.status).toBe('completed');
    expect(order?.escrowStatus).toBe('captured');

    await customer().rateOrder({ orderId, providerId: order!.providerId!, stars: 5 });

    const timeline = await customer().listTimeline(vehicleId);
    const entry = timeline.find((event) => event.details['order_number'] !== undefined);
    expect(entry?.provenance).toBe('habba_verified');
    expect(entry?.mileage).toBe(41000);

    const warranties = await customer().listVehicleWarranties(vehicleId);
    expect(warranties.some((warranty) => warranty.orderId === orderId)).toBe(true);
  });

  test('each phone was told what it needed to know, and nothing it did itself', async () => {
    const claimed = await sender().rpc('claim_push_notifications', { p_limit: 500 });
    expect(claimed.error).toBeNull();

    const rows = (
      claimed.data as { token: string; kind: string; title: string; data: { id?: string } }[]
    ).filter((row) => row.data.id === orderId);
    const kindsFor = (token: string) =>
      rows
        .filter((row) => row.token === token)
        .map((row) => row.kind)
        .sort();

    expect(kindsFor(CUSTOMER_PHONE)).toEqual([
      'order_accepted',
      'order_arrived',
      'order_awaiting_approval',
      'order_en_route',
    ]);
    expect(kindsFor(TECH_PHONE)).toEqual(['job_offer', 'order_completed']);

    // Arabic for the customer's phone, English for the technician's.
    expect(rows.find((row) => row.kind === 'order_arrived')?.title).toBe('وصل الفنّي');
    expect(rows.find((row) => row.kind === 'job_offer')?.title).toBe('New request near you');

    // And a customer's client cannot ask for anyone's queue.
    const denied = await clientFor(CUSTOMER_ID).rpc('claim_push_notifications', { p_limit: 5 });
    expect(denied.error).not.toBeNull();
  });
});

describe.skipIf(!harnessUp)('a workshop booking, through the app', () => {
  let orderId = '';
  let slotStartsAt = '';

  test('the customer finds the workshop and a free time', async () => {
    const providerId = await approvedProvider(WORKSHOP_ID, 'workshop', 'ورشة التدفق', oilServiceId);
    const workshop = clientFor(WORKSHOP_ID);
    await workshop.from('workshops').upsert({
      provider_id: providerId,
      address_ar: 'طريق الأمير محمد بن فهد، الدمام',
      location: `POINT(${CAR.lon} ${CAR.lat})`,
      bay_count: 2,
      opening_hours: { sun: [['08:00', '20:00']] },
    });
    await workshop.rpc('generate_slots', {
      p_from: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      p_days: 1,
      p_start_hour: 8,
      p_end_hour: 18,
      p_slot_minutes: 60,
      p_capacity: 1,
    });

    const providers = await customer().listBookingProviders(oilServiceId, 'workshop');
    expect(providers.some((provider) => provider.id === providerId)).toBe(true);

    const slots = await customer().listSlots(providerId);
    const free = slots.find((slot) => slot.remaining > 0);
    expect(free).toBeDefined();
    slotStartsAt = free!.startsAt;

    orderId = await customer().bookAppointment({
      slotId: free!.id,
      serviceId: oilServiceId,
      vehicleId,
      problem: 'تغيير زيت دوري',
    });
    expect((await customer().getOrder(orderId))?.status).toBe('draft');
  });

  test('sending the booking confirms it straight away, with the time on it', async () => {
    expect(await customer().submitOrder(orderId)).toBe('accepted');

    const order = await customer().getOrder(orderId);
    expect(order?.escrowStatus).toBe('authorised');
    expect(new Date(order!.scheduledFor!).getTime()).toBe(new Date(slotStartsAt).getTime());
  });

  test("it is on the workshop's schedule with the time, ready to check in", async () => {
    const mine = await technician(WORKSHOP_ID).listMyJobs();
    const job = mine.find((candidate) => candidate.orderId === orderId);

    expect(job?.scheduledFor).not.toBeNull();
    expect(nextJobStep(job!.status, job!.fulfilmentMode).action).toBe('check_in_vehicle');
  });

  test("the workshop quotes two parts; hand-back waits for the customer's answers", async () => {
    const workshop = technician(WORKSHOP_ID);
    await workshop.checkInVehicle(orderId);
    await workshop.advanceJob(orderId, 'in_progress');

    // The parts screen.
    await workshop.addPart(orderId, {
      nameAr: 'فلتر زيت',
      partNumber: '04152-YZZA1',
      isOem: true,
      quantity: 1,
      unitPrice: sarOrThrow('45.00'),
      warrantyDays: 90,
    });
    await workshop.addPart(orderId, {
      nameAr: 'منظّف محرك',
      isOem: false,
      quantity: 1,
      unitPrice: sarOrThrow('60.00'),
    });

    // The customer's quote screen sees both, waiting.
    const quoted = await customer().listOrderParts(orderId);
    expect(quoted).toHaveLength(2);
    expect(quoted.every((line) => !line.approvedByCustomer && line.declinedAt === null)).toBe(true);

    // With answers outstanding, hand-back is refused — the job screen holds
    // the button for the same reason.
    const photos = await clientFor(WORKSHOP_ID).rpc('test_upload_completion_photos', {
      p_order_id: orderId,
    });
    await workshop.recordEvidence(orderId, 41500, photos.data as CompletionMediaItem[], 30);
    await expect(workshop.advanceJob(orderId, 'awaiting_approval')).rejects.toThrow(
      /still waiting for the customer/,
    );

    const filter = quoted.find((line) => line.nameAr === 'فلتر زيت')!;
    const flush = quoted.find((line) => line.nameAr === 'منظّف محرك')!;
    await customer().approveOrderPart(filter.id);
    await customer().declineOrderPart(flush.id);

    const answered = await workshop.listParts(orderId);
    expect(answered.map((line) => line.answer).sort()).toEqual(['approved', 'declined']);

    // A "no" stays on the record.
    await expect(workshop.removePart(flush.id)).rejects.toThrow();
  });

  test('the workshop hands back; the bill carries the part the customer approved, not the one declined', async () => {
    const walked = await workTheJob(WORKSHOP_ID, orderId, 41500, 30);
    expect(walked).toEqual(['awaiting_approval']);

    const before = await customer().getOrder(orderId);
    expect(before?.partsAmount).toBe('45.00');
    expect(before?.totalAmount).toBe(
      priceWithVat(addSar(before!.quotedAmount!, sarOrThrow('45.00'))),
    );

    await customer().confirmOrderCompletion(orderId);
    const after = await customer().getOrder(orderId);
    expect(after?.status).toBe('completed');
    expect(after?.escrowStatus).toBe('captured');
    expect(after?.warrantyDays).toBe(30);
  });
});
