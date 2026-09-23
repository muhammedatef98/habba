/**
 * Expo push, as data: what to send, and what Expo's answer means.
 *
 * Pure and dependency-free, because it runs in two places. The `push-tick`
 * Edge Function uses a vendored copy (supabase/functions/_shared/push.ts,
 * written by sync-edge-shared.sh); this original is unit-tested in Node,
 * where the tests already run. The rules about WHO is told WHAT live in
 * Postgres (0066). This is only the envelope and the receipt.
 */

/** One row from `claim_push_notifications()`: a notification, for one device. */
export interface ClaimedPush {
  readonly notification_id: string;
  readonly kind: string;
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ExpoPushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly sound: 'default';
  readonly priority: 'high' | 'default';
  /** Android channel; the app creates both (apps/mobile push.ts). */
  readonly channelId: 'orders' | 'reminders';
  /** Seconds the push service may hold it for an offline phone. */
  readonly ttl: number;
}

/** Expo accepts at most this many messages per request. */
export const EXPO_BATCH_SIZE = 100;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * How long the push service may hold a message for a phone that is offline.
 * Mirrors `notification_ttl()` (0066): the outbox stops claiming a stale
 * notification, and this stops Apple or Google delivering one that was
 * already in flight when the phone went into a basement car park.
 */
export function ttlSecondsFor(kind: string): number {
  if (kind === 'job_offer') return 5 * 60;
  if (kind === 'booking_confirmed' || kind === 'care_reminder') return 12 * 60 * 60;
  return 30 * 60;
}

export function toExpoMessage(row: ClaimedPush): ExpoPushMessage {
  const reminder = row.kind === 'care_reminder';
  return {
    to: row.token,
    title: row.title,
    body: row.body,
    // The id travels too, so a tap can be traced back to what was sent.
    data: { ...row.data, notificationId: row.notification_id },
    sound: 'default',
    // A job offer and a technician at the door are time-critical. An oil
    // change due next month is not, and should not wake anyone.
    priority: reminder ? 'default' : 'high',
    channelId: reminder ? 'reminders' : 'orders',
    ttl: ttlSecondsFor(row.kind),
  };
}

export function chunk<T>(items: readonly T[], size = EXPO_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Expo's per-message answer, in the order the messages were sent. */
export type ExpoTicket =
  | { readonly status: 'ok'; readonly id: string }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly details?: { readonly error?: string } | undefined;
    };

export interface PushOutcome {
  /** Reached at least one of its person's devices. */
  readonly sent: string[];
  /** Reached none; worth another tick. */
  readonly retry: string[];
  /** Installs Expo says no longer exist. */
  readonly deadTokens: string[];
}

/**
 * Reads Expo's tickets back onto the notifications they belong to.
 *
 * A notification goes to every device its person has, so it is `sent` if ANY
 * device took it — a customer with a phone and a tablet is told once, not
 * retried because the tablet is off. It is retried only when no device took
 * it. A missing ticket (a short or failed response) counts as a failure for
 * that message rather than a success nobody confirmed.
 *
 * `DeviceNotRegistered` is the one error that is about the device rather
 * than the message: the app was uninstalled. That token is retired, so the
 * next claim does not keep sending to it.
 */
export function settle(
  rows: readonly ClaimedPush[],
  tickets: readonly (ExpoTicket | undefined)[],
): PushOutcome {
  const delivered = new Set<string>();
  const failed = new Set<string>();
  const deadTokens: string[] = [];

  rows.forEach((row, index) => {
    const ticket = tickets[index];
    if (ticket?.status === 'ok') {
      delivered.add(row.notification_id);
      return;
    }
    if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      deadTokens.push(row.token);
    }
    failed.add(row.notification_id);
  });

  return {
    sent: [...delivered],
    retry: [...failed].filter((id) => !delivered.has(id)),
    deadTokens,
  };
}
