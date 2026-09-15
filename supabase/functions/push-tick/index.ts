/**
 * Drains the notification outbox.
 *
 * POST /functions/v1/push-tick
 *
 * Same shape and the same discipline as `dispatch-tick`: this file is only
 * transport. What deserves a notification, to whom, in which language, and for
 * how long it stays valid all live in 0065 — `claim_notification_batch()` hands
 * back finished messages and this sends them.
 *
 * That split is not tidiness. The rules are testable against real Postgres in
 * `supabase/tests/38_push_notifications.sql`, and the Expo wire format is
 * testable in Node in `packages/core/src/push/expo-push.test.ts`. What is left
 * here — the part that cannot be tested either way — is a fetch and a loop, and
 * it is kept that small on purpose.
 *
 * Intended to run on a schedule of roughly 15 seconds, alongside dispatch-tick.
 * Overlapping runs are safe: the claim uses `for update skip locked`.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildPushRequest,
  chunkPushMessages,
  isTokenDead,
  parsePushResponse,
  type ExpoPushMessage,
} from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Shared secret for the scheduler — identical reasoning to dispatch-tick's.
 * This function holds the service role and can send a notification to every
 * device in the country; an open URL would be a megaphone.
 */
const TICK_SECRET = Deno.env.get('HABBA_PUSH_TICK_SECRET') ?? '';

/**
 * Optional. Expo accepts unauthenticated sends, but a project with "enhanced
 * security" enabled does not — and that setting is flipped in the Expo
 * dashboard, not in this repo, so it has to be configurable rather than
 * assumed.
 */
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';

/** One tick's worth. Expo's per-request cap is 100; this is several requests. */
const BATCH_LIMIT = 300;

interface ClaimedRow {
  readonly notification_id: string;
  readonly token: string;
  readonly platform: string;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string> | null;
  readonly channel_id: string;
  readonly ttl_seconds: number | null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (TICK_SECRET === '' || request.headers.get('x-habba-tick') !== TICK_SECRET) {
    // Deliberately identical for "no secret configured" and "wrong secret".
    return new Response('Not found', { status: 404 });
  }

  const client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.rpc('claim_notification_batch', { p_limit: BATCH_LIMIT });

  if (error !== null) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const rows = (data ?? []) as readonly ClaimedRow[];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ claimed: 0, sent: 0, failed: 0, retired: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const messages: ExpoPushMessage[] = rows.map((row) => ({
    to: row.token,
    title: row.title,
    body: row.body,
    data: row.data ?? undefined,
    channelId: row.channel_id,
    sound: 'default',
    // `high` on everything the outbox emits. Every one of them is either a job
    // offer that expires in 45 seconds or a status change someone is actively
    // waiting on; there is nothing in this queue that should wait for the next
    // maintenance window to wake the device.
    priority: 'high',
    ttlSeconds: row.ttl_seconds ?? undefined,
  }));

  /**
   * A notification lands on every device its recipient has registered. It counts
   * as sent if ANY of them accepted it, and as failed only if they all refused —
   * otherwise a single dead tablet would keep a notification the person already
   * read on their phone in the retry queue until its attempts ran out.
   */
  const delivered = new Set<string>();
  const refused = new Map<string, string>();
  const retired: string[] = [];

  let cursor = 0;
  for (const chunk of chunkPushMessages(messages)) {
    const sentRows = rows.slice(cursor, cursor + chunk.length);
    cursor += chunk.length;

    let status = 0;
    let rawBody = '';
    try {
      const built = buildPushRequest(EXPO_ACCESS_TOKEN === '' ? null : EXPO_ACCESS_TOKEN, chunk);
      const response = await fetch(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
      });
      status = response.status;
      rawBody = await response.text();
    } catch (cause) {
      // A network failure is not a delivery failure: nothing was refused, the
      // attempt simply did not happen. Every row in the chunk is left for the
      // next tick, which is what the attempt budget is for.
      const reason = cause instanceof Error ? cause.message : 'fetch failed';
      for (const row of sentRows) refused.set(row.notification_id, reason);
      continue;
    }

    const tickets = parsePushResponse(status, rawBody, chunk.length);

    tickets.forEach((ticket, index) => {
      const row = sentRows[index];
      if (row === undefined) return;

      if (ticket.ok) {
        delivered.add(row.notification_id);
        return;
      }

      refused.set(
        row.notification_id,
        `${ticket.reason}${ticket.code === null ? '' : `: ${ticket.code}`}`,
      );

      // ⚠️ Only an unregistered device retires a token, and `parsePushResponse`
      // guarantees the ticket at this index belongs to this row — a response
      // whose length did not match was already turned into a whole-batch
      // transport failure, precisely so this line cannot retire a stranger's
      // phone.
      if (isTokenDead(ticket)) retired.push(row.token);
    });
  }

  for (const id of delivered) refused.delete(id);

  if (delivered.size > 0) {
    await client.rpc('mark_notifications_sent', { p_ids: [...delivered] });
  }

  for (const [id, reason] of refused) {
    await client.rpc('mark_notification_failed', { p_id: id, p_error: reason });
  }

  // Deduplicated: one dead device can appear in several notifications in the
  // same tick.
  for (const token of new Set(retired)) {
    await client.rpc('disable_push_token', { p_token: token, p_reason: 'device_not_registered' });
  }

  return new Response(
    JSON.stringify({
      claimed: rows.length,
      sent: delivered.size,
      failed: refused.size,
      retired: new Set(retired).size,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
