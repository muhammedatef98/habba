/**
 * The payment gateway's server side. Holds the Moyasar secret key; the phone
 * never does.
 *
 * POST /functions/v1/payments
 *
 *   { "action": "confirm", "order_id": "…", "payment_id": "…" }
 *     Authorization: Bearer <the customer's session>
 *
 *     The customer's card form returned a Moyasar payment id. That id proves
 *     nothing on its own — the phone could send any id — so this fetches the
 *     payment from Moyasar and records the hold only if it is an authorised
 *     payment, in SAR, for exactly order_hold_amount(), made for this order
 *     (checkAuthorisation, unit-tested in @habba/core). The order must be the
 *     caller's: the session is verified here, and the database checks again.
 *
 *   { "action": "confirm_top_up", "order_id": "…", "payment_id": "…" }
 *     Authorization: Bearer <the customer's session>
 *
 *     The same check for the second hold a job needs when approved parts
 *     took the final bill past the first (0078): the payment must be for
 *     exactly order_top_up_due().
 *
 *   { "action": "tick" }
 *     x-habba-tick: <HABBA_PAYMENTS_TICK_SECRET>
 *
 *     Carries out the queued captures, voids and refunds (0077). Each is
 *     marked succeeded only when Moyasar's answer shows the payment in the
 *     state it was meant to reach; a failure keeps Moyasar's message for the
 *     operator, who sees it in the console's finance page. Run it on the same
 *     schedule as dispatch-tick.
 *
 * Deploy:
 *   supabase secrets set MOYASAR_SECRET_KEY=sk_live_… HABBA_PAYMENTS_TICK_SECRET=…
 *   supabase functions deploy payments
 *
 * Then set `payments_gateway` to `moyasar` in the console's settings. Until
 * that setting changes, nothing here is on the payment path.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { apiKeyOnlyFetch, resolveSecretKey } from '../_shared/api-keys.ts';
import {
  checkAuthorisation,
  fetchPaymentRequest,
  interpretOperation,
  isPaymentId,
  operationRequest,
  toHalalas,
  type MoyasarPayment,
  type OperationKind,
} from '../_shared/moyasar.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = resolveSecretKey({
  secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  legacy: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});
const MOYASAR_SECRET_KEY = Deno.env.get('MOYASAR_SECRET_KEY') ?? '';
const TICK_SECRET = Deno.env.get('HABBA_PAYMENTS_TICK_SECRET') ?? '';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (MOYASAR_SECRET_KEY === '') return json({ error: 'gateway_not_configured' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { fetch: apiKeyOnlyFetch(SERVICE_KEY, fetch) },
  });

  if (body['action'] === 'confirm') return confirm(request, body, db, 'initial');
  if (body['action'] === 'confirm_top_up') return confirm(request, body, db, 'top_up');
  if (body['action'] === 'tick') {
    if (TICK_SECRET === '' || request.headers.get('x-habba-tick') !== TICK_SECRET) {
      return new Response('Not found', { status: 404 });
    }
    return tick(db);
  }
  return json({ error: 'bad_request' }, 400);
});

async function confirm(
  request: Request,
  body: Record<string, unknown>,
  db: SupabaseClient,
  purpose: 'initial' | 'top_up',
): Promise<Response> {
  const orderId = typeof body['order_id'] === 'string' ? body['order_id'] : '';
  const paymentId = typeof body['payment_id'] === 'string' ? body['payment_id'] : '';
  if (!UUID.test(orderId) || !isPaymentId(paymentId)) return json({ error: 'bad_request' }, 400);

  // Who is asking: the session they sent, verified by Supabase Auth.
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const user = await db.auth.getUser(token);
  if (user.error !== null || user.data.user === null) return json({ error: 'unauthorised' }, 401);
  const customerId = user.data.user.id;

  const order = await db
    .from('orders')
    .select('id, customer_id, escrow_status')
    .eq('id', orderId)
    .maybeSingle();
  if (order.error !== null) return json({ error: 'unavailable' }, 503);
  // One answer for "no such order" and "not yours": telling them apart would
  // confirm which order ids exist.
  if (order.data === null || order.data.customer_id !== customerId) {
    return json({ error: 'not_found' }, 404);
  }

  // What this payment must be for: the first hold, or the difference the
  // final bill left (0078) — computed here, never taken from the phone.
  const expected = await db.rpc(purpose === 'initial' ? 'order_hold_amount' : 'order_top_up_due', {
    p_order_id: orderId,
  });
  if (expected.error !== null || expected.data === null) return json({ error: 'unavailable' }, 503);
  const holdSar = Number(expected.data).toFixed(2);
  if (Number(holdSar) <= 0) return json({ error: 'nothing_due' }, 409);

  const fetchRequest = fetchPaymentRequest(MOYASAR_SECRET_KEY, paymentId);
  let payment: MoyasarPayment;
  try {
    const response = await fetch(fetchRequest.url, fetchRequest.init);
    if (!response.ok) return json({ error: 'payment_not_found' }, 402);
    payment = (await response.json()) as MoyasarPayment;
  } catch {
    return json({ error: 'gateway_unreachable' }, 503);
  }

  const check = checkAuthorisation(payment, { orderId, amountHalalas: toHalalas(holdSar) });
  if (!check.ok) return json({ error: check.reason }, 402);

  const recorded = await db.rpc(
    purpose === 'initial' ? 'record_payment_authorisation' : 'record_payment_top_up',
    {
      p_order_id: orderId,
      p_customer_id: customerId,
      p_payment_id: payment.id,
      p_amount: holdSar,
    },
  );
  if (recorded.error !== null) return json({ error: recorded.error.message }, 409);

  return json({ ok: true, payment_id: payment.id }, 200);
}

interface ClaimedOperation {
  readonly operation_id: string;
  readonly order_id: string;
  readonly kind: OperationKind;
  readonly amount: number | string;
  readonly payment_id: string;
}

async function tick(db: SupabaseClient): Promise<Response> {
  const claim = await db.rpc('claim_payment_operations', { p_limit: 20 });
  if (claim.error !== null) return json({ error: claim.error.message }, 500);

  let succeeded = 0;
  let failed = 0;
  for (const operation of (claim.data ?? []) as ClaimedOperation[]) {
    let outcome: { ok: boolean; reference: string | null; error: string | null };
    try {
      const call = operationRequest(
        MOYASAR_SECRET_KEY,
        operation.kind,
        operation.payment_id,
        Number(operation.amount).toFixed(2),
      );
      const response = await fetch(call.url, call.init);
      const answer = interpretOperation(operation.kind, response.status, await response.json());
      outcome = answer.ok
        ? { ok: true, reference: answer.reference, error: null }
        : { ok: false, reference: null, error: answer.error };
    } catch (cause) {
      // Unreachable is not "failed": nothing is known to have happened, so the
      // lease simply expires and the next tick asks again.
      if (cause instanceof TypeError) continue;
      outcome = { ok: false, reference: null, error: String(cause) };
    }

    const settled = await db.rpc('settle_payment_operation', {
      p_operation_id: operation.operation_id,
      p_ok: outcome.ok,
      p_reference: outcome.reference,
      p_error: outcome.error,
    });
    if (settled.error === null) {
      if (outcome.ok) succeeded += 1;
      else failed += 1;
    }
  }

  return json({ succeeded, failed }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
