// GENERATED FILE — DO NOT EDIT.
// Source: packages/core/src/sms/authentica.ts
// Regenerate: ./supabase/scripts/sync-edge-shared.sh
//
// Edge Functions run on Deno and cannot import pnpm workspace packages, so
// this module is vendored here. CI runs this script with --check, so drift
// fails the build rather than quietly shipping stale behaviour.

/**
 * Authentica SMS transport — request building and response parsing, as pure
 * functions, beside `unifonic.ts` and returning the same `SmsSendResult`.
 *
 * Authentica (authentica.sa) is a Saudi OTP gateway with a pre-registered
 * sender, so a code reaches Saudi numbers without our own CITC sender-ID
 * registration. That is the reason to prefer it at launch.
 *
 * Supabase Auth still owns the code: it generates it, expires it, counts the
 * attempts and verifies it. Authentica only carries it. So the code GoTrue
 * made is handed to Authentica — never Authentica's own `verify-otp`, which
 * would be a second OTP store answering a question GoTrue already answers.
 *
 * Two ways to hand it over, chosen by configuration:
 *   - `send-otp` with our code in `otp`, on one of Authentica's approved
 *     templates (`template_id`). Works with no sender name of our own.
 *   - `send-sms` with our own message text, once a sender name is approved on
 *     the Authentica account. The text is then exactly `otpMessageBody`.
 *
 * No `fetch` in here, and no logging, for the same reason as unifonic.ts: the
 * request body contains the code.
 *
 * ⚠️ Confirm against the Authentica account before go-live: one real send to
 * a staff phone, and check that the code received is the one GoTrue accepts.
 * `parseAuthenticaResponse` treats anything it does not recognise as a
 * failure, so a wrong field fails loudly rather than reading as delivered.
 */

import type { SmsRequest, SmsSendResult } from './sms.ts';

export const AUTHENTICA_DEFAULT_BASE_URL = 'https://api.authentica.sa';

export interface AuthenticaConfig {
  /** The account's API key, sent as `X-Authorization`. A secret. */
  readonly apiKey: string;
  readonly baseUrl?: string | undefined;
  /**
   * An approved sender name. When set, the message is sent through `send-sms`
   * with our own text; when not, through `send-otp` on a template.
   */
  readonly senderName?: string | undefined;
  /** The `send-otp` template. Authentica's default is 1. */
  readonly templateId?: number | undefined;
}

export interface AuthenticaOtp {
  /** E.164, e.g. +9665XXXXXXXX. Authentica refuses local 05… numbers. */
  readonly toE164: string;
  /** The code GoTrue generated. */
  readonly otp: string;
  /** The full message, used only on the `send-sms` path. */
  readonly body: string;
}

export function buildAuthenticaRequest(
  config: AuthenticaConfig,
  message: AuthenticaOtp,
): SmsRequest {
  if (!/^\+[1-9][0-9]{7,14}$/.test(message.toE164)) {
    // Same rule as unifonic.ts: an OTP sent to a "helpfully" reformatted
    // number is an OTP sent to someone else.
    throw new Error('authentica: recipient must be E.164');
  }
  if (!/^[0-9]{4,10}$/.test(message.otp)) {
    throw new Error('authentica: otp must be digits');
  }

  const base = (config.baseUrl ?? AUTHENTICA_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const senderName = config.senderName?.trim() ?? '';

  const payload =
    senderName === ''
      ? {
          method: 'sms',
          phone: message.toE164,
          template_id: config.templateId ?? 1,
          otp: message.otp,
        }
      : { phone: message.toE164, message: message.body, sender_name: senderName };

  return {
    url: `${base}/api/v2/${senderName === '' ? 'send-otp' : 'send-sms'}`,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-authorization': config.apiKey,
    },
    body: JSON.stringify(payload),
  };
}

interface AuthenticaBody {
  success?: unknown;
  message?: unknown;
  errors?: unknown;
  data?: { id?: unknown; message_id?: unknown } | null;
}

/**
 * Maps Authentica's answer onto `SmsSendResult`. Success needs both a 2xx and
 * `success: true`. A 2xx alone might be a validation message, and an OTP that
 * reads as delivered but never arrives leaves the user waiting.
 */
export function parseAuthenticaResponse(status: number, rawBody: string): SmsSendResult {
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'unauthorised', code: String(status) };
  }

  let parsed: AuthenticaBody;
  try {
    parsed = JSON.parse(rawBody) as AuthenticaBody;
  } catch {
    return { ok: false, reason: 'transport_failed', code: String(status) };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'transport_failed', code: String(status) };
  }

  const success = parsed.success === true || parsed.success === 'true';
  if (status >= 200 && status < 300 && success) {
    const id = parsed.data?.id ?? parsed.data?.message_id;
    return {
      ok: true,
      messageId: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
    };
  }

  // Authentica's validation errors name the field. A bad phone is the user's
  // typo; everything else is ours. Only the field names are looked at, never
  // echoed: the message could quote the request.
  const detail = JSON.stringify(parsed.errors ?? parsed.message ?? '');
  if (status === 400 || status === 422) {
    return {
      ok: false,
      reason: /phone/i.test(detail) ? 'invalid_recipient' : 'rejected',
      code: String(status),
    };
  }
  if (status === 402) {
    // Out of balance: the account, not the user.
    return { ok: false, reason: 'unauthorised', code: '402' };
  }
  return { ok: false, reason: 'rejected', code: String(status) };
}
