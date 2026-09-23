/**
 * Delivers what the outbox says is due.
 *
 * POST /functions/v1/push-tick
 *
 * Transport only, like dispatch-tick. Who is told what, in which language,
 * and until when it is still worth telling them is decided in Postgres
 * (0066) and tested there; how a message is shaped and what Expo's answer
 * means is in _shared/push.ts, vendored from @habba/core and tested in Node.
 * This file claims, posts, and reports back.
 *
 * Two callers, both with the shared secret:
 *   - a Database Webhook on INSERT into notification_outbox, so a job offer
 *     leaves within a second of being made;
 *   - a schedule of about a minute, which catches retries and anything the
 *     webhook missed. Claims are leased, so the two never double-send.
 * docs/supabase-setup.md has both.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { apiKeyOnlyFetch, resolveSecretKey } from '../_shared/api-keys.ts';
import {
  chunk,
  EXPO_PUSH_URL,
  settle,
  toExpoMessage,
  type ClaimedPush,
  type ExpoTicket,
} from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = resolveSecretKey({
  secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  legacy: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});

/**
 * The function drains everyone's notifications with the service role, so it
 * must never answer a stranger. Absent secret means it refuses everything.
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

  if (TICK_SECRET === '' || request.headers.get('x-habba-tick') !== TICK_SECRET) {
    return new Response('Not found', { status: 404 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { fetch: apiKeyOnlyFetch(SERVICE_KEY, fetch) },
  });

  const claim = await db.rpc('claim_push_notifications', { p_limit: 300 });
  if (claim.error !== null) {
    return json({ error: claim.error.message }, 500);
  }

  const rows = (claim.data ?? []) as ClaimedPush[];
  const sent: string[] = [];
  const retry: string[] = [];
  const deadTokens: string[] = [];
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
  }

  const record = await db.rpc('record_push_results', {
    p_sent: [...new Set(sent)],
    p_retry: [...new Set(retry)].filter((id) => !sent.includes(id)),
    p_dead_tokens: deadTokens,
    p_error: errors[0] ?? null,
  });

  if (record.error !== null) {
    // The messages went out but the outbox does not know. The lease expires
    // in two minutes and they would be sent again — so this is a 500, loudly.
    return json({ error: record.error.message, sent: sent.length }, 500);
  }

  return json(
    {
      claimed: rows.length,
      sent: sent.length,
      retry: retry.length,
      retired: deadTokens.length,
      errors,
    },
    errors.length > 0 && sent.length === 0 && rows.length > 0 ? 502 : 200,
  );
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
