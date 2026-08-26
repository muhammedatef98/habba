/**
 * Serves تقرير هبّة at a public URL.
 *
 * GET /functions/v1/report/<token>
 *
 * No authentication: the token IS the credential (build prompt §7.3 — "the
 * public page must work without login"). A buyer standing next to a car opens
 * a link, and that is the entire interaction.
 *
 * Deno / Supabase Edge Functions. The rendering itself lives in @habba/core so
 * it is unit-tested in Node without deploying anything; this file is only
 * transport.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { renderHabbaReport, type HabbaReport } from '../_shared/report.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_BASE = Deno.env.get('HABBA_PUBLIC_BASE_URL') ?? 'https://habba.sa';

/**
 * Deliberately identical for "no such token", "expired" and "revoked".
 * Distinguishing them would confirm which tokens once existed, turning a
 * 404 into an oracle.
 */
function notFound(): Response {
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>تقرير غير متاح</title>
     <style>body{font-family:system-ui,sans-serif;line-height:1.7;padding:32px;
     max-width:520px;margin:0 auto;color:#1A1917}</style></head>
     <body><h1>التقرير غير متاح</h1>
     <p>هذا الرابط غير صحيح أو انتهت صلاحيته أو ألغاه صاحب السيارة.</p>
     <p>اطلب من صاحب السيارة رابطاً جديداً.</p></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const token = url.pathname.split('/').filter(Boolean).pop() ?? '';

  // Cheap shape check before touching the database, so a scanner spraying
  // short tokens costs us nothing.
  if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return notFound();
  }

  const client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // get_habba_report is SECURITY DEFINER and token-scoped: it returns the
  // frozen payload or null, and there is no way to enumerate from it.
  const { data, error } = await client.rpc('get_habba_report', { p_token: token });

  if (error !== null) {
    console.error('report lookup failed', error.message);
    return new Response('Internal error', { status: 500 });
  }

  if (data === null) return notFound();

  const html = renderHabbaReport(data as HabbaReport, {
    publicUrl: `${PUBLIC_BASE}/r/${token}`,
  });

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The payload is frozen at generation, so it is safe to cache — but
      // revocation must take effect quickly, hence a short TTL rather than
      // immutable.
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    },
  });
});
