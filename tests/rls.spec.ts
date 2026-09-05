/**
 * tests/rls.spec.ts — the RLS suite the build prompt asks for by name (§6.9),
 * plus the Amendment A6 assertions about roles (§5.1.3).
 *
 * Why this exists alongside supabase/tests/*.sql: those run as a database role
 * in psql, which is the right place to prove a policy's logic. This runs the
 * way an attacker would — over HTTP, through PostgREST, holding a real signed
 * JWT — which is the only way to prove that what the policy says is also what
 * the API does. A policy can be correct in psql and still be reachable through
 * a route nobody checked.
 *
 * Every request here is deliberately raw supabase-js rather than the app's
 * repository. The app is not the thing under test; the server is. A test that
 * went through the repository would prove only that the app asks nicely.
 *
 * Requires the local harness:
 *   pnpm db:reset && pnpm api:start
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { mintTestJwt } from '../apps/mobile/src/features/shared/data/test-jwt.js';

/**
 * HABBA_POSTGREST_URL has exactly one meaning: **the origin supabase-js is
 * given**, with no `/rest/v1` on it.
 *
 * Locally that is bare PostgREST, which serves the tables at its own root.
 * Hosted it is the project URL, and Supabase's gateway routes `/rest/v1` to
 * PostgREST behind it. supabase-js appends `/rest/v1` either way, so the two
 * shapes are reconciled in exactly one place — `restFetch()` below — and every
 * other request in this file, the reachability probe included, goes through it.
 *
 * The first hosted run had the two meanings mixed: the probe wanted the value
 * with `/rest/v1`, `createClient` wanted it without, and no single value
 * satisfied both.
 */
const POSTGREST_URL = process.env.HABBA_POSTGREST_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET = process.env.HABBA_JWT_SECRET ?? 'habba-local-development-jwt-secret-do-not-use';

/**
 * Set by `supabase/scripts/verify-hosted.sh` when this runs against a real
 * project rather than the local harness.
 *
 * The ASSERTIONS are identical in both modes — that is the whole point of
 * running it hosted, and any divergence there would make the exercise
 * pointless. What differs is fixture creation, which cannot be identical:
 *
 *   - locally, auth.users rows come from `test_seed_auth_user`, a shim defined
 *     in supabase_shim.sql and deliberately never in a migration
 *   - hosted, they come from GoTrue's admin API, and provider approval comes
 *     from a privileged SQL statement — both done by the script BEFORE this
 *     suite runs, because they need credentials a test file should not hold
 *
 * If the shim ever appeared on a hosted project it would BE the privilege
 * escalation that 0036 and 0040 exist to prevent, so "just deploy the helpers"
 * is not an option.
 */
const HOSTED = process.env.HABBA_HOSTED === '1';
const ANON_KEY = process.env.HABBA_ANON_KEY ?? '';

/** A customer who never applies for anything. */
const CUSTOMER_ID = 'aa000000-0000-4000-8000-000000000001';
/** A customer who applies and is left pending — approval is what counts. */
const APPLICANT_ID = 'aa000000-0000-4000-8000-000000000002';
/** An approved technician. */
const PROVIDER_ID = 'aa000000-0000-4000-8000-000000000003';
/** Another customer, whose data nobody else may see. */
const STRANGER_ID = 'aa000000-0000-4000-8000-000000000004';

/**
 * Bare PostgREST serves at the root; Supabase routes `/rest/v1` to it through a
 * gateway. Locally the prefix is stripped, hosted it is left alone — and the
 * rewrite lives here rather than in the app precisely so the app runs
 * unmodified against both.
 */
function restFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return fetch(HOSTED ? raw : raw.replace('/rest/v1/', '/'), init);
}

/**
 * Hosted, nothing may be defaulted. The defaults above point at localhost, so a
 * hosted run that lost one variable would have quietly proved the local harness
 * correct and reported 17 green — the most expensive kind of passing test. The
 * first real hosted run did exactly that.
 */
if (HOSTED) {
  for (const name of ['HABBA_POSTGREST_URL', 'HABBA_JWT_SECRET', 'HABBA_ANON_KEY'] as const) {
    if ((process.env[name] ?? '') === '') {
      throw new Error(
        `${name} is empty but HABBA_HOSTED=1. A hosted run must not fall back to the ` +
          `local harness — run this through supabase/scripts/verify-hosted.sh.`,
      );
    }
  }
  if (POSTGREST_URL.includes('/rest/v1')) {
    throw new Error(
      `HABBA_POSTGREST_URL must be the project origin (https://<ref>.supabase.co), not ` +
        `${POSTGREST_URL}. supabase-js appends /rest/v1 itself.`,
    );
  }
}

type Probe = { ok: true } | { ok: false; detail: string };

/**
 * Reports *why* it could not reach the API, not merely that it could not.
 * "RLS harness unreachable" hid a real 401 for several runs of the first hosted
 * attempt, which is a whole class of debugging nobody should repeat.
 */
async function probeHarness(): Promise<Probe> {
  let detail = 'no response';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await restFetch(`${POSTGREST_URL}/rest/v1/vehicle_makes?limit=1`, {
        signal: AbortSignal.timeout(1500),
        ...(HOSTED && ANON_KEY !== ''
          ? { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
          : {}),
      });
      if (response.ok) return { ok: true };

      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      detail = `HTTP ${response.status} ${response.statusText} — ${body}`;

      // A 4xx is an answer: the server is up and is refusing us. Retrying it
      // seven more times only delays the diagnosis.
      if (response.status < 500) break;
    } catch (error) {
      detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { ok: false, detail };
}

// Module scope, not beforeAll: `describe.skipIf` is evaluated during
// collection, so a flag set in a hook is always still false.
const probe = await probeHarness();
const harnessUp = probe.ok;

if (process.env.HABBA_REQUIRE_HARNESS === '1' && !probe.ok) {
  throw new Error(
    `RLS API unreachable at ${POSTGREST_URL} — ${probe.detail}\n` +
      (HOSTED
        ? 'Hosted: a 401 usually means the apikey header is missing or the anon key does ' +
          'not belong to this project; a 403/42501 means the migrations ran but the role ' +
          'grants on schema public did not (see docs/supabase-setup.md § Resetting).'
        : 'Start it with `pnpm db:reset && pnpm api:start`.'),
  );
}

function clientFor(userId: string | null): SupabaseClient {
  const token =
    userId === null
      ? mintTestJwt(JWT_SECRET, { sub: '00000000-0000-4000-8000-000000000000', role: 'anon' })
      : mintTestJwt(JWT_SECRET, { sub: userId, role: 'authenticated' });

  return createClient(POSTGREST_URL, token, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        // The hosted gateway wants an apikey header alongside the bearer
        // token. The minted JWT stays the thing RLS reads — the apikey only
        // gets the request past the edge.
        ...(HOSTED && ANON_KEY !== '' ? { apikey: ANON_KEY } : {}),
      },
      fetch: restFetch,
    },
  });
}

// Fixed ids so the suite is idempotent: it is normally run after `pnpm
// db:reset`, but a re-run against a dirty database must still be meaningful
// rather than failing in setup for reasons that have nothing to do with RLS.
const VEHICLE_ID = 'bb000000-0000-4000-8000-000000000001';
const STRANGER_VEHICLE_ID = 'bb000000-0000-4000-8000-000000000002';
const APPLICANT_PROVIDER_ID = 'cc000000-0000-4000-8000-000000000001';
const PROVIDER_RECORD_ID = 'cc000000-0000-4000-8000-000000000002';
let cityId = '';

beforeAll(async () => {
  if (!harnessUp) return;

  const seed = clientFor(CUSTOMER_ID);
  const phones: Record<string, string> = {
    [CUSTOMER_ID]: '+966590000001',
    [APPLICANT_ID]: '+966590000002',
    [PROVIDER_ID]: '+966590000003',
    [STRANGER_ID]: '+966590000004',
  };

  for (const [id, phone] of Object.entries(phones)) {
    // Hosted, these users were created through GoTrue by verify-hosted.sh.
    if (!HOSTED) await seed.rpc('test_seed_auth_user', { p_id: id, p_phone: phone });
    await clientFor(id).from('profiles').upsert({
      id,
      full_name: 'مستخدم اختبار',
      phone,
    });
  }

  const cities = await seed.from('cities').select('id').eq('name_en', 'Dammam').limit(1);
  cityId = (cities.data ?? [])[0]?.id as string;

  const makes = await seed.from('vehicle_makes').select('id').eq('name_en', 'Toyota').limit(1);
  const makeId = (makes.data ?? [])[0]?.id as string;
  const models = await seed
    .from('vehicle_models')
    .select('id')
    .eq('make_id', makeId)
    .eq('name_en', 'Camry')
    .limit(1);
  const modelId = (models.data ?? [])[0]?.id as string;

  await seed.from('vehicles').upsert({
    id: VEHICLE_ID,
    owner_id: CUSTOMER_ID,
    make_id: makeId,
    model_id: modelId,
    year: 2020,
    plate_en: 'RLS 1111',
  });

  await clientFor(STRANGER_ID).from('vehicles').upsert({
    id: STRANGER_VEHICLE_ID,
    owner_id: STRANGER_ID,
    make_id: makeId,
    model_id: modelId,
    year: 2021,
    plate_en: 'RLS 2222',
  });

  // The applicant applies and stays pending. The provider applies and is
  // approved through the harness shim, which stands in for the ops console.
  for (const [id, providerId, name] of [
    [APPLICANT_ID, APPLICANT_PROVIDER_ID, 'متقدّم'],
    [PROVIDER_ID, PROVIDER_RECORD_ID, 'فنّي معتمد'],
  ] as const) {
    // insert, not upsert: 0037 leaves `authenticated` without a table-wide
    // UPDATE grant on providers, so an upsert is refused outright. A duplicate
    // key on a re-run is the expected, harmless outcome (0041) — anything else
    // is a setup failure worth seeing.
    const written = await clientFor(id).from('providers').insert({
      id: providerId,
      owner_profile_id: id,
      provider_type: 'individual',
      business_name_ar: name,
      city_id: cityId,
      national_id_encrypted: 'enc:dev:test',
      iban_encrypted: 'enc:dev:test',
    });

    if (written.error !== null && written.error.code !== '23505') {
      throw new Error(
        `RLS suite setup: could not create provider record — ${written.error.message}`,
      );
    }
  }

  // Approval is privileged: the column guard (0034) is ENABLE ALWAYS, so even a
  // service key cannot set verification_status without declaring a privileged
  // write. Locally the shim does it; hosted, verify-hosted.sh does it in SQL
  // before this runs.
  if (!HOSTED) {
    await clientFor(PROVIDER_ID).rpc('test_approve_provider', {
      p_provider_id: PROVIDER_RECORD_ID,
    });
  }
});

describe.skipIf(!harnessUp)("RLS: a user cannot read another user's rows", () => {
  test('harness is reachable', () => {
    expect(harnessUp).toBe(true);
  });

  test('vehicles: a stranger sees only their own', async () => {
    const stranger = clientFor(STRANGER_ID);
    const rows = await stranger.from('vehicles').select('id');

    expect(rows.error).toBeNull();
    expect((rows.data ?? []).map((row) => (row as { id: string }).id)).not.toContain(VEHICLE_ID);
  });

  test('vehicles: naming the row directly does not help', async () => {
    // The interesting case is not "the list is filtered" but "asking for the
    // exact id still returns nothing" — a filtered list with a reachable row
    // is the shape of most RLS bugs.
    const rows = await clientFor(STRANGER_ID).from('vehicles').select('id').eq('id', VEHICLE_ID);
    expect(rows.data ?? []).toHaveLength(0);
  });

  test('vehicle_timeline: a stranger reads none of it', async () => {
    const rows = await clientFor(STRANGER_ID)
      .from('vehicle_timeline')
      .select('id')
      .eq('vehicle_id', VEHICLE_ID);
    expect(rows.data ?? []).toHaveLength(0);
  });

  test('profiles: a user reads only their own row', async () => {
    const rows = await clientFor(CUSTOMER_ID).from('profiles').select('id');
    const ids = (rows.data ?? []).map((row) => (row as { id: string }).id);

    expect(ids).toEqual([CUSTOMER_ID]);
  });

  test('anonymous reads the catalogue and nothing personal', async () => {
    const anon = clientFor(null);

    const makes = await anon.from('vehicle_makes').select('id');
    expect((makes.data ?? []).length).toBeGreaterThan(0);

    for (const table of ['vehicles', 'vehicle_timeline', 'profiles', 'orders', 'user_roles']) {
      const rows = await anon.from(table).select('*');
      expect(rows.data ?? [], `${table} must be closed to anonymous`).toHaveLength(0);
    }
  });

  test("a stranger cannot write to someone else's vehicle", async () => {
    const attempt = await clientFor(STRANGER_ID)
      .from('vehicles')
      .update({ nickname: 'مسروقة' })
      .eq('id', VEHICLE_ID)
      .select('id');

    // Refused either by an error or by matching zero rows; both are a refusal,
    // and RLS expresses it as the latter.
    expect(attempt.data ?? []).toHaveLength(0);

    const owner = await clientFor(CUSTOMER_ID)
      .from('vehicles')
      .select('nickname')
      .eq('id', VEHICLE_ID)
      .single();
    expect((owner.data as { nickname: string | null }).nickname).not.toBe('مسروقة');
  });

  test('the timeline cannot be written directly, by anyone', async () => {
    // ADR-0003: appends go through a SECURITY DEFINER function. A forged row
    // is not constructible from a client even by the vehicle's owner.
    const attempt = await clientFor(CUSTOMER_ID)
      .from('vehicle_timeline')
      .insert({
        vehicle_id: VEHICLE_ID,
        event_type: 'service_completed',
        summary_ar: 'صيانة ملفقة',
        summary_en: 'Forged service',
      })
      .select('id');

    expect(attempt.error).not.toBeNull();
  });
});

describe.skipIf(!harnessUp)('Amendment A6: roles are enforced server-side', () => {
  test('a customer-only user cannot grant themselves a role', async () => {
    const customer = clientFor(CUSTOMER_ID);

    for (const role of ['technician', 'workshop_admin', 'ops', 'super_admin']) {
      const attempt = await customer.from('user_roles').insert({ user_id: CUSTOMER_ID, role });
      expect(attempt.error, `granting ${role} must be refused`).not.toBeNull();
    }

    const held = await customer.from('user_roles').select('role').is('revoked_at', null);
    expect((held.data ?? []).map((row) => (row as { role: string }).role)).toEqual(['customer']);
  });

  test('a customer reads only their own roles — the operator list is not public', async () => {
    const rows = await clientFor(CUSTOMER_ID).from('user_roles').select('user_id');
    const owners = new Set((rows.data ?? []).map((row) => (row as { user_id: string }).user_id));

    expect([...owners]).toEqual([CUSTOMER_ID]);
  });

  test('a customer-only user cannot read the open-order feed', async () => {
    // §5.1.3, stated as a request rather than as a screen: this is the RPC the
    // provider surface is built on, called directly.
    //
    // Asserted as an outright refusal, not merely an empty list: an empty list
    // would also be the result if the feed happened to have nothing in it,
    // which would make this test pass for the wrong reason forever.
    const feed = await clientFor(CUSTOMER_ID).rpc('list_open_orders_for_provider');
    expect(feed.error?.code).toBe('42501');

    // The same call by an approved provider is allowed (and empty, because no
    // orders are searching) — so the refusal above is about the caller, not
    // about the RPC being broken.
    const providerFeed = await clientFor(PROVIDER_ID).rpc('list_open_orders_for_provider');
    expect(providerFeed.error).toBeNull();
  });

  test('a customer-only user cannot read provider_locations or payouts', async () => {
    const customer = clientFor(CUSTOMER_ID);

    const locations = await customer.from('provider_locations').select('provider_id');
    expect(locations.data ?? []).toHaveLength(0);

    const payouts = await customer.from('payouts').select('id');
    expect(payouts.data ?? []).toHaveLength(0);
  });

  test('a PENDING applicant has exactly the access of a customer', async () => {
    // The hole 0040 closed: current_provider_id() used to match any providers
    // row, so applying was enough to hold provider-side access.
    const applicant = clientFor(APPLICANT_ID);

    const roles = await applicant.from('user_roles').select('role').is('revoked_at', null);
    expect((roles.data ?? []).map((row) => (row as { role: string }).role)).toEqual(['customer']);

    // The applicant is refused differently from a plain customer — the RPC
    // recognises the record and returns nothing, rather than rejecting the
    // caller outright (0021). Either way the feed is empty, which is the
    // property that matters; asserting the exact shape here documents that the
    // difference is known rather than accidental.
    const feed = await applicant.rpc('list_open_orders_for_provider');
    expect(feed.error).toBeNull();
    expect(feed.data ?? []).toHaveLength(0);

    const locations = await applicant.from('provider_locations').select('provider_id');
    expect(locations.data ?? []).toHaveLength(0);
  });

  test('an applicant cannot approve themselves', async () => {
    const applicant = clientFor(APPLICANT_ID);

    const attempt = await applicant
      .from('providers')
      .update({ verification_status: 'approved' })
      .eq('owner_profile_id', APPLICANT_ID)
      .select('id');

    expect(attempt.data ?? []).toHaveLength(0);

    const roles = await applicant.from('user_roles').select('role').is('revoked_at', null);
    expect((roles.data ?? []).map((row) => (row as { role: string }).role)).toEqual(['customer']);
  });

  test('approval — and only approval — grants the provider role', async () => {
    const provider = clientFor(PROVIDER_ID);
    const roles = await provider.from('user_roles').select('role').is('revoked_at', null);
    const held = (roles.data ?? []).map((row) => (row as { role: string }).role).sort();

    expect(held).toEqual(['customer', 'technician']);
  });

  test("an approved provider still cannot read another user's logbook", async () => {
    // Being a provider is not a master key: without a live order on the
    // vehicle, a technician is a stranger to it (§6.9).
    const provider = clientFor(PROVIDER_ID);

    const vehicles = await provider.from('vehicles').select('id').eq('id', STRANGER_VEHICLE_ID);
    expect(vehicles.data ?? []).toHaveLength(0);

    const timeline = await provider
      .from('vehicle_timeline')
      .select('id')
      .eq('vehicle_id', STRANGER_VEHICLE_ID);
    expect(timeline.data ?? []).toHaveLength(0);
  });

  test('provider KYC columns are not on the client read surface at all', async () => {
    // 0037: a column-level REVOKE is a silent no-op against a table-level
    // grant, so this asks for the column by name and expects the request to
    // fail rather than to return null.
    const attempt = await clientFor(PROVIDER_ID)
      .from('providers')
      .select('national_id_encrypted, iban_encrypted');

    expect(attempt.error).not.toBeNull();
  });
});
