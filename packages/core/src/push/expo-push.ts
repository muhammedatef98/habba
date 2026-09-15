/**
 * Expo Push transport — request building and response parsing, as pure
 * functions.
 *
 * Same shape and the same reasoning as `sms/unifonic.ts`: no `fetch` in here
 * and no logging, so the caller performs the request and this module stays
 * unit-testable in Node. It is vendored into `supabase/functions/_shared` by
 * `sync-edge-shared.sh`, and CI fails on drift.
 *
 * Expo Push is the right transport rather than talking to FCM and APNs
 * directly (build prompt §3 names it), and it is the only one that works with
 * the tokens `expo-notifications` hands the app.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo's documented maximum per request. Exceeding it fails the whole batch. */
export const EXPO_PUSH_CHUNK_SIZE = 100;

/**
 * Android notification channels, created on the device at registration.
 *
 * `job-offers` is separate from everything else on purpose: it is the only
 * notification that has to survive Do Not Disturb and ring, because it is a
 * person waiting at the roadside. Everything else is ordinary. One channel for
 * both would force the technician to choose between missing work and being
 * woken by a receipt.
 */
export const PUSH_CHANNEL_JOB_OFFERS = 'job-offers';
export const PUSH_CHANNEL_DEFAULT = 'default';

export interface ExpoPushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /**
   * Values are strings only. This is what the app reads to route the tap, and
   * a nested object would have to be parsed on a cold start before the router
   * exists.
   */
  readonly data?: Readonly<Record<string, string>> | undefined;
  readonly channelId?: string | undefined;
  readonly sound?: 'default' | null | undefined;
  readonly priority?: 'default' | 'normal' | 'high' | undefined;
  /**
   * Seconds. ⚠️ Not optional in spirit for anything time-critical.
   *
   * A job offer delivered eleven minutes late, after the phone comes back on
   * the network, is worse than one never delivered: the job has been taken, the
   * technician drives to a cancelled call, and they learn to distrust the
   * notification. Without a TTL the push services will happily hold and deliver
   * it. Set per notification by `enqueue_notification` in 0065 — a job offer
   * gets exactly the dispatch silence window.
   */
  readonly ttlSeconds?: number | undefined;
}

export interface PushRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type PushFailure =
  /** The app was uninstalled, or the token belongs to a build that no longer exists. */
  | 'device_not_registered'
  | 'message_too_big'
  | 'rate_exceeded'
  | 'unauthorised'
  | 'rejected'
  | 'transport_failed';

export type PushTicket =
  | { readonly ok: true; readonly id: string | null }
  | { readonly ok: false; readonly reason: PushFailure; readonly code: string | null };

/**
 * Whether a string is shaped like a token Expo will accept.
 *
 * Worth checking before storing rather than on send: a malformed token in the
 * table produces a failure on every future batch it lands in, and the cause is
 * a registration that happened days earlier on a different device.
 *
 * Both spellings are real — `ExponentPushToken[...]` is what the SDK returns
 * today and `ExpoPushToken[...]` appears in older builds still in the wild.
 */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\s\]]+\]$/.test(token);
}

/** Splits a batch into request-sized pieces, preserving order. */
export function chunkPushMessages(
  messages: readonly ExpoPushMessage[],
  size: number = EXPO_PUSH_CHUNK_SIZE,
): readonly (readonly ExpoPushMessage[])[] {
  if (size < 1) throw new Error('expo-push: chunk size must be at least 1');

  const chunks: ExpoPushMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}

/**
 * @param accessToken Expo access token, when the project enforces one. Null
 *   sends unauthenticated, which Expo still accepts — but a project with
 *   "enhanced security" on rejects it, so this is configuration rather than a
 *   constant.
 */
export function buildPushRequest(
  accessToken: string | null,
  messages: readonly ExpoPushMessage[],
): PushRequest {
  if (messages.length === 0) throw new Error('expo-push: nothing to send');
  if (messages.length > EXPO_PUSH_CHUNK_SIZE) {
    throw new Error(`expo-push: at most ${EXPO_PUSH_CHUNK_SIZE} messages per request`);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    // Expo rejects a gzipped response we cannot decode in every runtime.
    'accept-encoding': 'identity',
  };
  if (accessToken !== null && accessToken !== '') {
    headers['authorization'] = `Bearer ${accessToken}`;
  }

  return {
    url: EXPO_PUSH_URL,
    method: 'POST',
    headers,
    body: JSON.stringify(
      messages.map((message) => ({
        to: message.to,
        title: message.title,
        body: message.body,
        ...(message.data === undefined ? {} : { data: message.data }),
        ...(message.channelId === undefined ? {} : { channelId: message.channelId }),
        ...(message.sound === undefined ? {} : { sound: message.sound }),
        ...(message.priority === undefined ? {} : { priority: message.priority }),
        ...(message.ttlSeconds === undefined ? {} : { ttl: message.ttlSeconds }),
      })),
    ),
  };
}

interface ExpoTicketBody {
  status?: unknown;
  id?: unknown;
  message?: unknown;
  details?: { error?: unknown } | null;
}

interface ExpoResponseBody {
  data?: unknown;
  errors?: unknown;
}

function failureFromDetail(detail: string | null, message: string): PushFailure {
  if (detail === 'DeviceNotRegistered') return 'device_not_registered';
  if (detail === 'MessageTooBig') return 'message_too_big';
  if (detail === 'MessageRateExceeded') return 'rate_exceeded';
  if (detail === 'InvalidCredentials') return 'unauthorised';
  // Expo does not always populate `details.error`; the human-readable message
  // is the only signal left, and mis-classifying a dead token as a generic
  // rejection means retrying it forever.
  if (/not.*registered/i.test(message)) return 'device_not_registered';
  return 'rejected';
}

function allFailed(count: number, reason: PushFailure, code: string | null): readonly PushTicket[] {
  return Array.from({ length: count }, () => ({ ok: false as const, reason, code }));
}

/**
 * Maps Expo's response onto one ticket per message sent, in the same order.
 *
 * ⚠️ The ordering is the entire contract, and the length check below is not
 * defensive padding. The caller uses position to decide which TOKEN to disable,
 * so a response whose `data` array is shorter or longer than what was sent
 * would disable the wrong technician's device — silently, and permanently. A
 * mismatch is therefore treated as a transport failure for the whole batch:
 * every message is retried, and nothing is disabled on a guess.
 *
 * Expo also reports per-message failures with HTTP 200, so the status code
 * alone is never the answer.
 */
export function parsePushResponse(
  status: number,
  rawBody: string,
  sentCount: number,
): readonly PushTicket[] {
  if (status === 401 || status === 403) {
    return allFailed(sentCount, 'unauthorised', String(status));
  }
  if (status === 429) {
    return allFailed(sentCount, 'rate_exceeded', String(status));
  }

  let parsed: ExpoResponseBody;
  try {
    parsed = JSON.parse(rawBody) as ExpoResponseBody;
  } catch {
    // An HTML error page, a proxy notice, an empty body. Unrecognised is a
    // failure, never a pass.
    return allFailed(sentCount, 'transport_failed', String(status));
  }

  // Request-level rejection: nothing was sent, whatever the status said.
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0] as { code?: unknown } | undefined;
    const code = first?.code === undefined ? String(status) : String(first.code);
    const reason: PushFailure = code === 'UNAUTHORIZED' ? 'unauthorised' : 'rejected';
    return allFailed(sentCount, reason, code);
  }

  if (!Array.isArray(parsed.data) || parsed.data.length !== sentCount) {
    return allFailed(sentCount, 'transport_failed', String(status));
  }

  return (parsed.data as readonly ExpoTicketBody[]).map((ticket): PushTicket => {
    if (ticket.status === 'ok') {
      return {
        ok: true,
        id: ticket.id === undefined || ticket.id === null ? null : String(ticket.id),
      };
    }

    const detail =
      ticket.details?.error === undefined || ticket.details.error === null
        ? null
        : String(ticket.details.error);
    const message = typeof ticket.message === 'string' ? ticket.message : '';

    return { ok: false, reason: failureFromDetail(detail, message), code: detail };
  });
}

/**
 * Whether a failed ticket means the token is dead rather than the send.
 *
 * Only this one retires a token. Everything else — a rate limit, an oversized
 * payload, a transport hiccup — is about this attempt, and retiring a working
 * device over it would take a technician out of dispatch permanently for a
 * transient fault.
 */
export function isTokenDead(ticket: PushTicket): boolean {
  return !ticket.ok && ticket.reason === 'device_not_registered';
}
