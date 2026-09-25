/**
 * The console's calls, against the real database (the local harness).
 *
 * The SQL suites (42, 43) prove what each server function does. This proves
 * the console calls them correctly: that every parameter name, every table
 * name and every returned shape in api.ts matches the functions as they
 * exist — the one class of mistake no unit test and no type-checker catches,
 * because PostgREST reports it only at runtime.
 */

import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { createApi, type ConsoleApi } from './api';
import { ApiError, SupabaseTransport, explain } from './transport';

const POSTGREST_URL = process.env['HABBA_POSTGREST_URL'] ?? 'http://127.0.0.1:54321';
const JWT_SECRET =
  process.env['HABBA_JWT_SECRET'] ?? 'habba-local-development-jwt-secret-do-not-use';

const OPS_ID = 'aaaaaaaa-7070-4070-8070-aaaaaaaaaaaa';
const CUSTOMER_ID = 'bbbbbbbb-7070-4070-8070-bbbbbbbbbbbb';

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

const harnessUp = await isHarnessUp();

if (process.env['HABBA_REQUIRE_HARNESS'] === '1' && !harnessUp) {
  throw new Error(`Integration harness unreachable at ${POSTGREST_URL}.`);
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** The token GoTrue would issue after a password and a TOTP code, a moment ago. */
function tokenFor(userId: string, secondFactor: boolean): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      role: 'authenticated',
      iat: now,
      exp: now + 3600,
      aal: secondFactor ? 'aal2' : 'aal1',
      amr: [
        { method: 'password', timestamp: now },
        ...(secondFactor ? [{ method: 'totp', timestamp: now }] : []),
      ],
    }),
  );
  const signature = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

function clientFor(userId: string, secondFactor = true): SupabaseClient {
  const token = tokenFor(userId, secondFactor);
  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      // The harness serves PostgREST at the root, not under /rest/v1.
      fetch: (input, init) => {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return fetch(raw.replace('/rest/v1/', '/'), init);
      },
    },
  });
}

describe.skipIf(!harnessUp)('the console, against the database', () => {
  let ops: ConsoleApi;
  let customer: ConsoleApi;

  beforeAll(async () => {
    const opsClient = clientFor(OPS_ID);
    // Sign-up is GoTrue's; the harness has none, so the shim seeds the auth rows.
    for (const [id, phone] of [
      [OPS_ID, '+966507070001'],
      [CUSTOMER_ID, '+966507070002'],
    ] as const) {
      await opsClient.rpc('test_seed_auth_user', { p_id: id, p_phone: phone });
    }
    await opsClient
      .from('profiles')
      .upsert({ id: OPS_ID, full_name: 'مشغّل الاختبار', phone: '+966507070001' });
    // Only the harness shim can grant ops — there is no client path, by design.
    await opsClient.rpc('test_grant_role', { p_user_id: OPS_ID, p_role: 'ops' });

    const customerClient = clientFor(CUSTOMER_ID);
    await customerClient
      .from('profiles')
      .upsert({ id: CUSTOMER_ID, full_name: 'عميل الاختبار', phone: '+966507070002' });

    ops = createApi(new SupabaseTransport(opsClient));
    customer = createApi(new SupabaseTransport(customerClient));
  });

  test('a customer is refused, with the refusal the console explains', async () => {
    await expect(customer.dashboard()).rejects.toMatchObject({ code: '42501' });
    await expect(customer.dashboard()).rejects.toBeInstanceOf(ApiError);
  });

  test('an operator without the second factor is refused too', async () => {
    const halfSignedIn = createApi(new SupabaseTransport(clientFor(OPS_ID, false)));
    await expect(halfSignedIn.dashboard()).rejects.toMatchObject({ code: '42501' });
  });

  test('every overview and list the console shows loads', async () => {
    const dashboard = await ops.dashboard();
    expect(dashboard.by_day).toHaveLength(14);

    expect(Array.isArray(await ops.board())).toBe(true);
    expect(Array.isArray(await ops.orders({ status: 'open' }))).toBe(true);
    expect(
      Array.isArray(await ops.orders({ query: 'HB', from: '2026-01-01', to: '2030-01-01' })),
    ).toBe(true);
    expect(Array.isArray(await ops.disputes(true))).toBe(true);
    expect(Array.isArray(await ops.disputes(false))).toBe(true);
    expect(Array.isArray(await ops.providers('approved', '', null, 0))).toBe(true);
    expect(Array.isArray(await ops.ratings(false))).toBe(true);
    expect(Array.isArray(await ops.paymentOperations('pending'))).toBe(true);
    expect(Array.isArray(await ops.payouts(null))).toBe(true);
    expect(await ops.financeSummary('2026-01-01', '2030-01-01')).toHaveProperty('gross');
    for (const kind of [
      'broadcasts',
      'data_requests',
      'transfers',
      'reports',
      'notifications',
    ] as const) {
      expect(Array.isArray(await ops.records(kind)), kind).toBe(true);
    }
  });

  test('search finds a person by the phone number as they say it', async () => {
    const hits = await ops.search('0507070002');
    expect(hits.some((hit) => hit.kind === 'user' && hit.id === CUSTOMER_ID)).toBe(true);
  });

  test('the staff list and a person’s file, and opening the file is recorded', async () => {
    const staff = await ops.staff();
    expect(staff.some((member) => member.user_id === OPS_ID)).toBe(true);

    const users = await ops.users('عميل الاختبار', 'all', 0);
    expect(users.some((user) => user.id === CUSTOMER_ID)).toBe(true);

    const file = await ops.user(CUSTOMER_ID);
    expect(file.profile.full_name).toBe('عميل الاختبار');

    const log = await ops.auditLog(50, 'profiles');
    expect(log.some((entry) => entry.action === 'read' && entry.targetId === CUSTOMER_ID)).toBe(
      true,
    );
  });

  test('suspend, note and export act on the account', async () => {
    await ops.setSuspension(CUSTOMER_ID, true, 'اختبار الإيقاف من اللوحة');
    expect((await ops.user(CUSTOMER_ID)).suspended).toBe(true);
    await ops.setSuspension(CUSTOMER_ID, false, 'اختبار رفع الإيقاف');
    expect((await ops.user(CUSTOMER_ID)).suspended).toBe(false);

    await ops.addNote('profiles', CUSTOMER_ID, 'ملاحظة من اختبار اللوحة');
    expect(
      (await ops.user(CUSTOMER_ID)).notes.some((note) => note.body === 'ملاحظة من اختبار اللوحة'),
    ).toBe(true);

    const exported = await ops.exportUserData(CUSTOMER_ID, 'اختبار التصدير');
    expect(exported).toHaveProperty('profile');
  });

  test('a setting is changed within its bounds and refused outside them', async () => {
    const settings = await ops.settings();
    expect(settings.find((setting) => setting.key === 'dispatch_max_round')).toBeDefined();

    await ops.updateSetting('dispatch_max_round', 4);
    const after = await ops.settings();
    expect(after.find((setting) => setting.key === 'dispatch_max_round')?.value).toBe(4);

    await expect(ops.updateSetting('dispatch_max_round', 99)).rejects.toMatchObject({
      code: '23514',
    });
    await ops.updateSetting('dispatch_max_round', 3);
  });

  test('a link setting takes https and nothing else, and says so in Arabic', async () => {
    await ops.updateSetting('privacy_url', 'https://habba.sa/privacy');
    const after = await ops.settings();
    expect(after.find((setting) => setting.key === 'privacy_url')?.value).toBe(
      'https://habba.sa/privacy',
    );

    const refused = await ops.updateSetting('privacy_url', 'http://habba.sa/privacy').then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(refused).toMatchObject({ code: '23514' });
    expect(explain(refused)).toContain('https://');

    await ops.updateSetting('privacy_url', '');
  });

  test('the catalogue is edited through the same client', async () => {
    const services = await ops.table('services', { order: 'sort_order' });
    expect(services.length).toBeGreaterThan(0);

    await ops.insertRow('vehicle_makes', {
      name_ar: 'ماركة اختبار اللوحة',
      name_en: 'ConsoleTestMake',
    });
    const [make] = await ops.table<{ id: string; name_en: string }>('vehicle_makes', {
      eq: { name_en: 'ConsoleTestMake' },
    });
    expect(make).toBeDefined();
    await ops.updateRow('vehicle_makes', { id: make?.id ?? '' }, { sort_order: 99 });
    await ops.deleteRow('vehicle_makes', { id: make?.id ?? '' });
    expect(await ops.table('vehicle_makes', { eq: { name_en: 'ConsoleTestMake' } })).toHaveLength(
      0,
    );
  });
});
