/**
 * The `payments` Edge Function, run for real against the local harness.
 *
 *   pnpm api:start && node supabase/scripts/payments-e2e.mjs
 *
 * Runs the function under Deno (DENO, or `deno` on PATH) with a stand-in
 * gateway in front of it: the harness's PostgREST behind /rest/v1, a
 * JWT-checking /auth/v1/user, and a fake Moyasar. Then drives it the way the
 * app and the scheduler do — confirm a hold, refuse the wrong ones, capture
 * from the queue — and reads the outcome back from Postgres.
 *
 * Not part of `pnpm verify`: the harness has no Deno. It is the check to run
 * before switching `payments_gateway` to moyasar, and after changing the
 * function. Skips with a message when Deno is absent.
 */
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const SECRET = 'habba-local-development-jwt-secret-do-not-use';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(sub, role) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({
    sub,
    role,
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = token.split('.');
  if (createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  return JSON.parse(Buffer.from(p, 'base64url').toString());
}
const DENO = process.env.DENO ?? 'deno';
try {
  execFileSync(DENO, ['--version']);
} catch {
  console.log('payments-e2e: Deno not found (set DENO=/path/to/deno). Skipped.');
  process.exit(0);
}

// Deno reads pnpm-workspace.yaml near the functions and rewrites the root
// package.json to match — so it runs on a copy, outside the repository.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORK = mkdtempSync(join(tmpdir(), 'habba-payments-e2e-'));
cpSync(join(ROOT, 'supabase', 'functions'), join(WORK, 'functions'), { recursive: true });
writeFileSync(join(WORK, 'deno.json'), '{"nodeModulesDir":"auto"}');

const psql = (sql) =>
  execFileSync('psql', [
    '-h',
    process.env.PGHOST ?? 'localhost',
    '-p',
    process.env.PGPORT ?? '54329',
    '-d',
    process.env.PGDATABASE ?? 'habba_dev',
    '-X',
    '-q',
    '-A',
    '-t',
    '-c',
    sql,
  ])
    .toString()
    .trim();

const payments = new Map();
const calls = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/rest/v1/')) {
    const target = `http://127.0.0.1:54321${url.pathname.slice(8)}${url.search}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') ?? 'application/json',
    });
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === '/auth/v1/user') {
    const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!claims || claims.role !== 'authenticated') {
      res.writeHead(401);
      res.end('{"msg":"invalid"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: claims.sub, aud: 'authenticated', role: 'authenticated' }));
    return;
  }
  if (url.pathname.startsWith('/moyasar/')) {
    calls.push(
      `${req.method} ${url.pathname} ${body.toString()} auth=${req.headers.authorization}`,
    );
    const m = url.pathname.match(/^\/moyasar\/payments\/([^/]+)(\/(capture|void|refund))?$/);
    const p = m && payments.get(m[1]);
    if (!p) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"type":"record_not_found","message":"Not found"}');
      return;
    }
    if (m[3] === 'capture') {
      const amount = JSON.parse(body.toString() || '{}').amount;
      if (amount > p.amount) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('{"message":"Amount exceeds authorized"}');
        return;
      }
      p.status = 'captured';
    }
    if (m[3] === 'void') p.status = 'voided';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(p));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(54345, r));

const fn = spawn(
  DENO,
  ['run', '--allow-net', '--allow-env', join(WORK, 'functions', 'payments', 'index.ts')],
  {
    env: {
      ...process.env,
      SUPABASE_URL: 'http://127.0.0.1:54345',
      SUPABASE_SERVICE_ROLE_KEY: jwt('00000000-0000-4000-8000-000000000000', 'service_role'),
      MOYASAR_SECRET_KEY: 'sk_test_e2e',
      HABBA_PAYMENTS_TICK_SECRET: 'tick-e2e',
      MOYASAR_API_BASE_OVERRIDE: 'http://127.0.0.1:54345/moyasar',
    },
    cwd: WORK,
  },
);
let fnOut = '';
fn.stdout.on('data', (d) => (fnOut += d));
fn.stderr.on('data', (d) => (fnOut += d));
for (let i = 0; i < 60; i++) {
  try {
    await fetch('http://127.0.0.1:8000', { method: 'GET' });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ' — ' + detail}`);
};
const call = async (body, headers = {}) => {
  const r = await fetch('http://127.0.0.1:8000', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  // Fresh people, car and payment ids every run: the harness may hold anything.
  const CUSTOMER = randomUUID();
  const STRANGER = randomUUID();
  const phone = () => `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const PHONE_1 = phone();
  const PHONE_2 = phone();
  const RUN = Date.now().toString(36);
  const GOOD = `pay_good_${RUN}`;
  const SMALL = `pay_small_${RUN}`;
  const OTHER = `pay_other_${RUN}`;
  const MISSING = `pay_missing_${RUN}`;
  psql(`insert into auth.users (id, phone) values ('${CUSTOMER}', '${PHONE_1}'), ('${STRANGER}', '${PHONE_2}');
        insert into public.profiles (id, full_name, phone) values ('${CUSTOMER}', 'عميل', '${PHONE_1}'), ('${STRANGER}', 'غريب', '${PHONE_2}');
        update public.platform_settings set value = '"moyasar"' where key = 'payments_gateway';`);
  const vehicle = psql(`insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
        select '${CUSTOMER}', m.make_id, m.id, 2020, 'KND 9911' from public.vehicle_models m limit 1 returning id;`).split(
    '\n',
  )[0];
  const svc = psql(`select id from public.services where name_en = 'Battery jump or replacement'`);
  const mkOrder = () =>
    psql(`select set_config('request.jwt.claim.sub', '${CUSTOMER}', false);
        select public.create_emergency_order('${svc}', 50.1, 26.4, '${vehicle}', 'الدمام', null, null, '[]'::jsonb);`)
      .split('\n')
      .pop();
  const order = mkOrder();
  const hold = psql(`select public.order_hold_amount('${order}')`);
  const halalas = Math.round(Number(hold) * 100);

  payments.set(GOOD, {
    id: GOOD,
    status: 'authorized',
    amount: halalas,
    currency: 'SAR',
    metadata: { order_id: order },
  });
  payments.set(SMALL, {
    id: SMALL,
    status: 'authorized',
    amount: 100,
    currency: 'SAR',
    metadata: { order_id: order },
  });
  payments.set(OTHER, {
    id: OTHER,
    status: 'authorized',
    amount: halalas,
    currency: 'SAR',
    metadata: { order_id: 'someone-else' },
  });

  const cust = { authorization: `Bearer ${jwt(CUSTOMER, 'authenticated')}` };
  const stranger = { authorization: `Bearer ${jwt(STRANGER, 'authenticated')}` };

  let r = await call({ action: 'confirm', order_id: order, payment_id: GOOD });
  check('no session, no confirmation', r.status === 401, JSON.stringify(r));
  r = await call({ action: 'confirm', order_id: order, payment_id: GOOD }, stranger);
  check("a stranger cannot confirm someone else's order", r.status === 404, JSON.stringify(r));
  r = await call({ action: 'confirm', order_id: order, payment_id: SMALL }, cust);
  check(
    'a payment for less than the hold is refused',
    r.status === 402 && r.body?.error === 'wrong_amount',
    JSON.stringify(r),
  );
  r = await call({ action: 'confirm', order_id: order, payment_id: OTHER }, cust);
  check(
    'a payment made for another order is refused',
    r.status === 402 && r.body?.error === 'wrong_order',
    JSON.stringify(r),
  );
  r = await call({ action: 'confirm', order_id: order, payment_id: MISSING }, cust);
  check('an unknown payment id is refused', r.status === 402, JSON.stringify(r));
  r = await call({ action: 'confirm', order_id: order, payment_id: '../../x' }, cust);
  check('a malformed payment id never reaches Moyasar', r.status === 400, JSON.stringify(r));
  check(
    'Moyasar is asked with Basic auth on the secret key',
    calls.some((c) => c.includes(`auth=Basic ${Buffer.from('sk_test_e2e:').toString('base64')}`)),
    calls.join('\n'),
  );

  r = await call({ action: 'confirm', order_id: order, payment_id: GOOD }, cust);
  check(
    'the right payment is accepted',
    r.status === 200 && r.body?.ok === true,
    JSON.stringify(r),
  );
  check(
    'and recorded as the hold on the order',
    psql(
      `select escrow_status || '/' || payment_intent_id || '/' || (select count(*) from public.payment_holds where order_id = '${order}') from public.orders where id = '${order}'`,
    ) === `authorised/${GOOD}/1`,
  );
  r = await call({ action: 'confirm', order_id: order, payment_id: GOOD }, cust);
  check('the same payment cannot be recorded twice', r.status === 409, JSON.stringify(r));

  // Queue a capture as completion would, then run the tick.
  psql(`insert into public.payment_operations (order_id, kind, amount, reason, payment_id)
        values ('${order}', 'capture', ${hold}, 'e2e', '${GOOD}')`);
  r = await call({ action: 'tick' }, { 'x-habba-tick': 'wrong' });
  check('the tick refuses a wrong secret', r.status === 404, JSON.stringify(r));
  r = await call({ action: 'tick' }, { 'x-habba-tick': 'tick-e2e' });
  check(
    'the tick captures the queued payment',
    r.status === 200 && r.body?.succeeded === 1,
    JSON.stringify(r),
  );
  check(
    'Moyasar was asked to capture exactly the hold, in halalas',
    calls.some(
      (c) =>
        c.startsWith(`POST /moyasar/payments/${GOOD}/capture`) && c.includes(`"amount":${halalas}`),
    ),
    calls.join('\n'),
  );
  check(
    'and the order is captured',
    psql(`select escrow_status from public.orders where id = '${order}'`) === 'captured',
  );

  // A capture Moyasar refuses stays visible, with its reason.
  psql(`insert into public.payment_operations (order_id, kind, amount, reason, payment_id)
        values ('${order}', 'refund', 1.00, 'e2e', '${MISSING}')`);
  r = await call({ action: 'tick' }, { 'x-habba-tick': 'tick-e2e' });
  check(
    'a refused operation is marked failed',
    r.status === 200 && r.body?.failed === 1,
    JSON.stringify(r),
  );
  check(
    "with Moyasar's message kept",
    psql(
      `select last_error from public.payment_operations where payment_id = '${MISSING}'`,
    ).includes('Not found'),
  );
} finally {
  psql(`update public.platform_settings set value = '"dev"' where key = 'payments_gateway'`);
  fn.kill();
  server.close();
  console.log(results.join('\n'));
  if (results.some((l) => l.startsWith('FAIL'))) {
    console.log('--- function output ---\n' + fnOut);
    process.exitCode = 1;
  }
}
