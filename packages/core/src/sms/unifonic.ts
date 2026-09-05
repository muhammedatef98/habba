/**
 * Unifonic SMS transport — request building and response parsing, as pure
 * functions.
 *
 * Unifonic is the first provider because sender-ID registration with the CITC
 * is the slow part of sending SMS in Saudi Arabia, and a local aggregator does
 * that registration as part of onboarding. Nothing here is Unifonic-specific
 * beyond this file: the app talks to an `OtpProvider`, and the server talks to
 * a `SmsTransport`. A second provider is a second file.
 *
 * No `fetch` in here, and no logging. The caller performs the request, which
 * keeps this unit-testable in Node and makes it impossible for this module to
 * accidentally emit a message body — the message body is an OTP.
 *
 * ⚠️ Endpoint shape. `buildSendRequest` targets Unifonic's REST messaging API
 * (form-encoded POST, `AppSid` + `Recipient` + `Body` + `SenderID`). The base
 * URL and the sender ID are configuration, not constants, because Unifonic
 * issues both per account and has more than one API host. **Confirm both
 * against your own Unifonic account before go-live** — a wrong host or field
 * name fails on the first real send, which is why `parseSendResponse` treats
 * an unrecognised body as a failure rather than optimistically succeeding.
 */

export const UNIFONIC_DEFAULT_BASE_URL = 'https://el.cloud.unifonic.com';

export interface UnifonicConfig {
  /** Application SID from the Unifonic console. A secret. */
  readonly appSid: string;
  /**
   * The registered sender ID shown to the recipient. In KSA this must be
   * registered with the CITC before it will deliver; an unregistered ID is
   * silently dropped by the operators.
   */
  readonly senderId: string;
  readonly baseUrl?: string;
}

export interface SmsMessage {
  /** E.164, e.g. +9665XXXXXXXX. */
  readonly toE164: string;
  readonly body: string;
}

export interface SmsRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type SmsSendResult =
  | { readonly ok: true; readonly messageId: string | null }
  | {
      readonly ok: false;
      readonly reason: 'rejected' | 'unauthorised' | 'invalid_recipient' | 'transport_failed';
      /** Provider-side code, for logs. Never contains the message body. */
      readonly code: string | null;
    };

/**
 * Unifonic wants the MSISDN without a leading `+`.
 *
 * Deliberately strict rather than forgiving: a number that is not E.164 by the
 * time it reaches the transport is a bug upstream, and "helpfully" reformatting
 * it here would hide the bug and could send an OTP to the wrong person.
 */
export function toMsisdn(phoneE164: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) {
    throw new Error('unifonic: recipient must be E.164');
  }
  return phoneE164.slice(1);
}

export function buildSendRequest(config: UnifonicConfig, message: SmsMessage): SmsRequest {
  const base = (config.baseUrl ?? UNIFONIC_DEFAULT_BASE_URL).replace(/\/+$/, '');

  const form = new URLSearchParams({
    AppSid: config.appSid,
    Recipient: toMsisdn(message.toE164),
    Body: message.body,
    SenderID: config.senderId,
    responseType: 'JSON',
  });

  return {
    url: `${base}/rest/SMS/messages`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  };
}

interface UnifonicBody {
  success?: unknown;
  errorCode?: unknown;
  message?: unknown;
  data?: { MessageID?: unknown } | null;
}

/**
 * Maps a provider response onto our own result type.
 *
 * Unifonic reports application-level failures with HTTP 200 and
 * `success: "false"`, so the status code alone is not the answer — a caller
 * that checked `response.ok` would treat a rejected message as delivered and
 * leave the user waiting for an SMS that was never sent.
 */
export function parseSendResponse(status: number, rawBody: string): SmsSendResult {
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'unauthorised', code: String(status) };
  }

  let parsed: UnifonicBody;
  try {
    parsed = JSON.parse(rawBody) as UnifonicBody;
  } catch {
    // An HTML error page, a proxy notice, an empty body: unrecognised is a
    // failure, never a pass.
    return { ok: false, reason: 'transport_failed', code: String(status) };
  }

  const success = parsed.success === true || parsed.success === 'true';
  if (success) {
    const id = parsed.data?.MessageID;
    return { ok: true, messageId: id === undefined || id === null ? null : String(id) };
  }

  const code =
    parsed.errorCode === undefined || parsed.errorCode === null ? null : String(parsed.errorCode);

  // Unifonic's ER-* codes distinguish a bad recipient from a bad account. The
  // difference matters upstream: one is the user's typo, the other is ours.
  const invalidRecipient = code !== null && /RECIPIENT|MSISDN|NUMBER/i.test(code);
  const unauthorised = code !== null && /APPSID|AUTH|SENDER/i.test(code);

  return {
    ok: false,
    reason: invalidRecipient ? 'invalid_recipient' : unauthorised ? 'unauthorised' : 'rejected',
    code,
  };
}

/**
 * The message a Habba OTP is delivered in.
 *
 * Arabic-first (§2.1), and it names Habba so the recipient knows what the code
 * is for — an unattributed code is what phishing looks like. Kept to one short
 * line: Arabic SMS is UCS-2, so 70 characters per segment, and a two-segment
 * OTP costs double for no benefit.
 */
export function otpMessageBody(code: string): string {
  return `رمز الدخول إلى هبّة: ${code}\nلا تشاركه مع أحد.`;
}
