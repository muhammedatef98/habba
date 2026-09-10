/**
 * Widens every search that has gone quiet.
 *
 * POST /functions/v1/dispatch-tick
 *
 * §7.1 expands the radius — 8km, 15km, 25km — when nobody accepts within 45
 * seconds. A database trigger cannot do that: there is no event at 45 seconds,
 * only the absence of one, and absence does not fire. So something has to ask.
 *
 * This file is only transport. Every rule about who gets asked, when, and how
 * far lives in `expand_stale_searches()` (0044), where it is tested against
 * real Postgres rather than mocked — the same reason the report renderer lives
 * in @habba/core rather than here.
 *
 * Intended to run on a schedule of roughly 15 seconds. The window is 45, so a
 * slower tick simply delays expansion; a faster one changes nothing, because
 * the staleness test is in the query.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Shared secret for the scheduler.
 *
 * The function needs the service role to widen a search, so it must never be
 * callable by anyone who happens to find the URL — that would let a stranger
 * drive dispatch for every customer in the country. Absent secret means the
 * endpoint refuses everything rather than defaulting to open.
 */
const TICK_SECRET = Deno.env.get('HABBA_DISPATCH_TICK_SECRET') ?? '';

interface ExpandedRow {
  readonly order_id: string;
  readonly round: number;
  readonly offers_sent: number;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (TICK_SECRET === '' || request.headers.get('x-habba-tick') !== TICK_SECRET) {
    // Deliberately identical for "no secret configured" and "wrong secret":
    // distinguishing them tells a prober whether the endpoint is live.
    return new Response('Not found', { status: 404 });
  }

  const client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.rpc('expand_stale_searches');

  if (error !== null) {
    // 500 rather than a silent 200: this runs unattended, and a tick that
    // fails quietly is a dispatcher that has stopped widening without anyone
    // noticing until customers are waiting on empty searches.
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const expanded = (data ?? []) as readonly ExpandedRow[];

  return new Response(
    JSON.stringify({
      expanded: expanded.length,
      // Returned so the scheduler's logs say what happened rather than just
      // that something did. An order widening to round 3 with zero offers sent
      // is the signal that coverage in that area is the real problem.
      orders: expanded.map((row) => ({
        order: row.order_id,
        round: row.round,
        sent: row.offers_sent,
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});
