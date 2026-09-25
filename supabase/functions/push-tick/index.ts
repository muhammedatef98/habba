/**
 * Delivers what the outbox says is due.
 *
 * POST /functions/v1/push-tick
 *
 * Transport only, like dispatch-tick. Who is told what, in which language,
 * and until when it is still worth telling them is decided in Postgres
 * (0066) and tested there; how a message is shaped and what Expo's answer
 * means is in _shared/push.ts, vendored from @habba/core and tested in Node.
 * This file claims, posts, and reports back — and then asks Expo what became
 * of the messages it accepted a quarter of an hour ago (0072).
 *
 * Two callers, both with the shared secret:
 *   - a Database Webhook on INSERT into notification_outbox, so a job offer
 *     leaves within a second of being made;
 *   - a schedule of about a minute, which catches retries and anything the
 *     webhook missed. Claims are leased, so the two never double-send.
 * docs/supabase-setup.md has both.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  apiKeyOnlyFetch,
  resolveSecretKey,
  resolveTickSecret,
  secretsMatch,
} from '../_shared/api-keys.ts';
import {
  chunk,
  EXPO_PUSH_URL,
  EXPO_RECEIPTS_BATCH_SIZE,
  EXPO_RECEIPTS_URL,
  readReceipts,
  settle,
  toExpoMessage,
  type AcceptedTicket,
  type ClaimedPush,
  type ExpoReceipt,
  type ExpoTicket,
  type ReceiptResult,
} from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = resolveSecretKey({
  secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  legacy: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});

/**
 * The function drains everyone's notifications with the service role, so it
 * must never answer a stranger. Absent secret means it refuses everything.
 * Set it as a function secret, or in Vault as `push_tick_secret` (0087).
 */
const TICK_SECRET = Deno.env.get('HABBA_PUSH_TICK_SECRET') ?? '';

/**
 * Optional. Only needed once "enhanced push security" is switched on for the
 * Expo project, which it should be before launch: without it, anyone holding
 * a user's push token could send that phone a message that looks like ours.
 */
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { fetch: apiKeyOnlyFetch(SERVICE_KEY, fetch) },
  });

  const expected = await resolveTickSecret(TICK_SECRET, () =>
    db.rpc('edge_tick_secret', { p_name: 'push_tick_secret' }),
  );
  if (!secretsMatch(request.headers.get('x-habba-tick'), expected)) {
    return new Response('Not found', { status: 404 });
  }

  const claim = await db.rpc('claim_push_notifications', { p_limit: 300 });
  if (claim.error !== null) {
    return json({ error: claim.error.message }, 500);
  }

  const rows = (claim.data ?? []) as ClaimedPush[];
  const sent: string[] = [];
  const retry: string[] = [];
  const deadTokens: string[] = [];
  const accepted: AcceptedTicket[] = [];
  const errors: string[] = [];

  for (const batch of chunk(rows)) {
    let tickets: (ExpoTicket | undefined)[] = [];
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(EXPO_ACCESS_TOKEN === '' ? {} : { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` }),
        },
        body: JSON.stringify(batch.map(toExpoMessage)),
      });
      if (response.ok) {
        const payload = (await response.json()) as { data?: ExpoTicket[] };
        tickets = payload.data ?? [];
      } else {
        errors.push(`expo ${response.status}`);
      }
    } catch (cause) {
      // Nothing came back, so nothing is known to be delivered: the whole
      // batch is released for the next tick rather than marked sent.
      errors.push(cause instanceof Error ? cause.message : 'network');
    }

    const outcome = settle(batch, tickets);
    sent.push(...outcome.sent);
    retry.push(...outcome.retry);
    deadTokens.push(...outcome.deadTokens);
    accepted.push(...outcome.tickets);
  }

  const record = await db.rpc('record_push_results', {
    p_sent: [...new Set(sent)],
    p_retry: [...new Set(retry)].filter((id) => !sent.includes(id)),
    p_dead_tokens: deadTokens,
    p_error: errors[0] ?? null,
    p_tickets: accepted,
  });

  if (record.error !== null) {
    // The messages went out but the outbox does not know. The lease expires
    // in two minutes and they would be sent again — so this is a 500, loudly.
    return json({ error: record.error.message, sent: sent.length }, 500);
  }

  const receipts = await checkReceipts(db);

  return json(
    {
      receipts,
      claimed: rows.length,
      sent: sent.length,
      retry: retry.length,
      retired: deadTokens.length,
      errors,
    },
    errors.length > 0 && sent.length === 0 && rows.length > 0 ? 502 : 200,
  );
});

/**
 * Asks Expo what became of messages it accepted at least 15 minutes ago.
 * A receipt request that fails leaves those tickets `pending`, released for
 * the next tick; nothing is assumed delivered.
 */
async function checkReceipts(
  db: SupabaseClient,
): Promise<{ checked: number; failed: number; error?: string }> {
  const due = await db.rpc('claim_push_receipts', { p_limit: 1000 });
  if (due.error !== null) return { checked: 0, failed: 0, error: due.error.message };

  const ids = ((due.data ?? []) as { ticket_id: string }[]).map((row) => row.ticket_id);
  const results: ReceiptResult[] = [];

  for (const batch of chunk(ids, EXPO_RECEIPTS_BATCH_SIZE)) {
    let receipts: Record<string, ExpoReceipt> = {};
    try {
      const response = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(EXPO_ACCESS_TOKEN === '' ? {} : { authorization: `Bearer ${EXPO_ACCESS_TOKEN}` }),
        },
        body: JSON.stringify({ ids: batch }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
        receipts = payload.data ?? {};
      }
    } catch {
      // Left pending below: asked again next tick.
    }
    results.push(...readReceipts(batch, receipts));
  }

  if (results.length > 0) {
    const recorded = await db.rpc('record_push_receipts', { p_receipts: results });
    if (recorded.error !== null) {
      return { checked: results.length, failed: 0, error: recorded.error.message };
    }
  }

  return {
    checked: results.filter((result) => result.status !== 'pending').length,
    failed: results.filter((result) => result.status === 'error').length,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
