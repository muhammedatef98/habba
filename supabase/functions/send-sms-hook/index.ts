/**
 * Supabase Auth "Send SMS" hook — delivers the OTP through Authentica, or
 * Unifonic when that is what is configured.
 *
 * Supabase Auth (GoTrue) owns the OTP itself: it generates the code, sets the
 * expiry, counts the attempts, verifies it, and issues the session. This hook
 * is only the transport. That division is deliberate — hand-rolling an OTP
 * store would mean hand-rolling session issuance, and inventing our own auth
 * tokens is the single worst idea available here.
 *
 * Two Habba-specific things happen before the message is handed over:
 *
 *   1. The per-phone rate limit (5/hour) is claimed in Postgres, not counted
 *      here. Edge Functions are stateless and scale horizontally, so a counter
 *      in this process is not a limit (0042).
 *   2. If the gateway rejects the message, the attempt is released. The user got
 *      no SMS, so charging them one of five would lock them out over our
 *      outage.
 *
 * ⚠️ THE OTP IS NEVER LOGGED. Not on success, not on failure, not in an error
 * object that happens to carry the payload. Every log line below names the
 * phone number and an error code, and nothing else. A code in a log is a code
 * in whatever ingests that log (ADR-0018).
 *
 * Secrets: the function's environment, or Vault (0088) — `send_sms_hook_secret`
 * and `authentica_api_key`. Authentica wins when its key is present; without
 * it, the Unifonic variables are used as before.
 *
 * Deploy:  supabase functions deploy send-sms-hook --no-verify-jwt
 * Wire up: Dashboard → Authentication → Hooks → Send SMS → this function's URL.
 * `--no-verify-jwt` is correct here and only here: GoTrue calls this with a
 * webhook signature, not a user JWT, and that signature is verified below.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import {
  buildSendRequest,
  otpMessageBody,
  parseSendResponse,
  UNIFONIC_DEFAULT_BASE_URL,
  type SmsRequest,
  type SmsSendResult,
} from '../_shared/sms.ts';
import { buildAuthenticaRequest, parseAuthenticaResponse } from '../_shared/authentica.ts';
import { apiKeyOnlyFetch, resolveSecretKey, resolveTickSecret } from '../_shared/api-keys.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// Prefers the new secret key when the project has one, so disabling the legacy
// service_role key needs no redeploy (_shared/api-keys.ts).
const SERVICE_KEY = resolveSecretKey({
  secretKeys: Deno.env.get('SUPABASE_SECRET_KEYS'),
  legacy: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});

const UNIFONIC_APP_SID = Deno.env.get('UNIFONIC_APP_SID') ?? '';
const UNIFONIC_SENDER_ID = Deno.env.get('UNIFONIC_SENDER_ID') ?? '';
const UNIFONIC_BASE_URL = Deno.env.get('UNIFONIC_BASE_URL') ?? UNIFONIC_DEFAULT_BASE_URL;

const AUTHENTICA_API_KEY = Deno.env.get('AUTHENTICA_API_KEY') ?? '';
/** Optional: an approved sender name switches to our own message text. */
const AUTHENTICA_SENDER_NAME = Deno.env.get('AUTHENTICA_SENDER_NAME') ?? '';
const AUTHENTICA_TEMPLATE_ID = Number(Deno.env.get('AUTHENTICA_TEMPLATE_ID') ?? '1') || 1;

/**
 * The signing secret GoTrue uses for this hook, from the dashboard. Supabase
 * presents it as `v1,whsec_…`; the library wants the base64 part.
 */
const HOOK_SECRET = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? '';

interface SendSmsPayload {
  readonly user: { readonly phone?: string };
  readonly sms: { readonly otp: string };
}

/**
 * Deliberately identical for every failure the caller could probe with.
 * GoTrue surfaces this to the client, and distinguishing "rate limited" from
 * "not a Habba number" would turn the auth endpoint into a way to ask whether
 * a phone number has an account.
 */
function refuse(status: number): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message: 'sms_not_sent' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    // Secret keys travel on `apikey` alone; a legacy JWT key is untouched.
    global: { fetch: apiKeyOnlyFetch(SERVICE_KEY, fetch) },
  });

  // The environment first, Vault second (0088). Read per request, so a key
  // put into Vault works without a redeploy.
  const [hookSecret, authenticaKey] = await Promise.all([
    resolveTickSecret(HOOK_SECRET, () =>
      db.rpc('edge_provider_secret', { p_name: 'send_sms_hook_secret' }),
    ),
    resolveTickSecret(AUTHENTICA_API_KEY, () =>
      db.rpc('edge_provider_secret', { p_name: 'authentica_api_key' }),
    ),
  ]);
  const signingSecret = hookSecret.replace(/^v1,whsec_/, '');
  const unifonicReady = UNIFONIC_APP_SID !== '' && UNIFONIC_SENDER_ID !== '';

  if (signingSecret === '' || (authenticaKey === '' && !unifonicReady)) {
    // Refusing to start unconfigured beats sending unsigned traffic to an SMS
    // gateway, or accepting unsigned requests as if GoTrue had made them.
    console.error('send-sms-hook: missing configuration');
    return refuse(500);
  }

  const raw = await request.text();

  let payload: SendSmsPayload;
  try {
    // The signature is what makes this endpoint safe to expose without a JWT.
    // Without it, anyone who found the URL could make us send SMS to any
    // number, at our expense.
    payload = new Webhook(signingSecret).verify(raw, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
    }) as SendSmsPayload;
  } catch {
    console.error('send-sms-hook: signature rejected');
    return refuse(401);
  }

  const phone = payload.user.phone ?? '';
  const otp = payload.sms.otp;

  // GoTrue gives the number without a `+`; everything downstream is E.164.
  const phoneE164 = phone.startsWith('+') ? phone : `+${phone}`;

  if (!/^\+9665[0-9]{8}$/.test(phoneE164)) {
    // Habba is Saudi-only today. Sending elsewhere would be a bill with no
    // possible customer at the other end.
    console.error('send-sms-hook: non-Saudi recipient refused');
    return refuse(400);
  }

  const claim = await db.rpc('claim_otp_send', { p_phone: phoneE164 });
  if (claim.error !== null) {
    console.error(`send-sms-hook: rate-limit claim failed for ${phoneE164}`, claim.error.code);
    return refuse(500);
  }
  if (claim.data !== true) {
    console.warn(`send-sms-hook: rate limited ${phoneE164}`);
    return refuse(429);
  }

  const gateway = authenticaKey !== '' ? 'authentica' : 'unifonic';
  const parse: (status: number, body: string) => SmsSendResult =
    gateway === 'authentica' ? parseAuthenticaResponse : parseSendResponse;

  let result: SmsSendResult;
  try {
    const spec: SmsRequest =
      gateway === 'authentica'
        ? buildAuthenticaRequest(
            {
              apiKey: authenticaKey,
              senderName: AUTHENTICA_SENDER_NAME,
              templateId: AUTHENTICA_TEMPLATE_ID,
            },
            { toE164: phoneE164, otp, body: otpMessageBody(otp) },
          )
        : buildSendRequest(
            { appSid: UNIFONIC_APP_SID, senderId: UNIFONIC_SENDER_ID, baseUrl: UNIFONIC_BASE_URL },
            { toE164: phoneE164, body: otpMessageBody(otp) },
          );
    const response = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      // An OTP the user waits 30 seconds for is a failed OTP. Fail fast so
      // GoTrue can report it and the user can retry.
      signal: AbortSignal.timeout(10_000),
    });
    result = parse(response.status, await response.text());
  } catch {
    // Note what is NOT logged: the caught error. A fetch error can carry the
    // request body, and the request body contains the code.
    result = { ok: false as const, reason: 'transport_failed' as const, code: null };
  }

  if (!result.ok) {
    console.error(
      `send-sms-hook: ${gateway} delivery failed for ${phoneE164} (${result.reason}/${result.code})`,
    );
    // Give the attempt back: they never received anything.
    await db.rpc('release_otp_send', { p_phone: phoneE164 });
    return refuse(502);
  }

  // Success is logged with the provider's message id and no message content —
  // that id is what support quotes to the gateway when a user says nothing arrived.
  console.log(
    `send-sms-hook: ${gateway} delivered to ${phoneE164} (${result.messageId ?? 'no id'})`,
  );

  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
});
