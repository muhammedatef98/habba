/**
 * Moyasar, as far as Habba needs it: checking an authorisation the customer
 * made, and asking for a capture, a void or a refund.
 *
 * Pure: every function builds a request or reads a response, and none of them
 * sends anything. The `payments` Edge Function is the transport (it holds the
 * secret key; the phone never does), and this file is vendored into it by
 * `supabase/scripts/sync-edge-shared.sh` so the rules are unit-tested here, in
 * Node, rather than trusted to a function nobody can run locally.
 *
 * The flow (ADR-0008 still decides whether Habba may hold funds at all):
 *
 *   1. The app shows Moyasar's card form with the publishable key, `manual`
 *      set so the card is authorised and not charged, and `metadata.order_id`
 *      set to the order. Moyasar returns a payment id.
 *   2. The app sends that id to the Edge Function, which fetches the payment
 *      with the SECRET key and accepts it only if `checkAuthorisation` does:
 *      authorised, in SAR, for exactly the amount the order holds, and for
 *      this order. A payment id is not proof of anything until then — the
 *      phone could send any id, including one for a 1-riyal payment.
 *   3. Capture, void and refund are queued by the database
 *      (payment_operations) and carried out by the same function's tick.
 *
 * API reference: https://docs.moyasar.com — amounts are integer halalas,
 * authentication is HTTP Basic with the secret key as the user name.
 */

export const MOYASAR_API = 'https://api.moyasar.com/v1';

export type MoyasarStatus =
  'initiated' | 'paid' | 'authorized' | 'failed' | 'refunded' | 'captured' | 'voided' | 'verified';

/** The fields of Moyasar's payment object this code reads. */
export interface MoyasarPayment {
  readonly id: string;
  readonly status: MoyasarStatus | string;
  /** Integer halalas. */
  readonly amount: number;
  readonly currency: string;
  readonly metadata?: Readonly<Record<string, string>> | null;
}

/** "506.00" → 50600. Refuses anything that is not a plain 2dp amount. */
export function toHalalas(sar: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(sar.trim());
  if (match === null) throw new Error(`Not a SAR amount: ${sar}`);
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export type AuthorisationCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'not_authorised' | 'wrong_currency' | 'wrong_amount' | 'wrong_order';
    };

/**
 * Whether a payment the customer made is the hold this order needs.
 *
 * Exact amount, not "at least": an over-authorisation is money the customer
 * did not agree to have held, and an under-authorisation is a job that cannot
 * be paid for. Both are refused, and the app is told which.
 */
export function checkAuthorisation(
  payment: MoyasarPayment,
  expected: { readonly orderId: string; readonly amountHalalas: number },
): AuthorisationCheck {
  if (payment.status !== 'authorized') return { ok: false, reason: 'not_authorised' };
  if (payment.currency.toUpperCase() !== 'SAR') return { ok: false, reason: 'wrong_currency' };
  if (payment.amount !== expected.amountHalalas) return { ok: false, reason: 'wrong_amount' };
  if (payment.metadata?.['order_id'] !== expected.orderId) {
    return { ok: false, reason: 'wrong_order' };
  }
  return { ok: true };
}

export interface MoyasarRequest {
  readonly url: string;
  readonly init: {
    readonly method: 'GET' | 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  };
}

function basicAuth(secretKey: string): string {
  // btoa exists in Deno and in Node 16+; the key is ASCII.
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function request(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Readonly<Record<string, unknown>>,
): MoyasarRequest {
  if (secretKey.trim() === '') throw new Error('Moyasar secret key is not configured');
  return {
    url: `${MOYASAR_API}${path}`,
    init: {
      method,
      headers: {
        Authorization: basicAuth(secretKey),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  };
}

/** A payment id comes from the phone; it goes into a URL only once it is shaped like one. */
export function isPaymentId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

function paymentPath(paymentId: string, suffix = ''): string {
  if (!isPaymentId(paymentId)) throw new Error('Not a Moyasar payment id');
  return `/payments/${paymentId}${suffix}`;
}

export function fetchPaymentRequest(secretKey: string, paymentId: string): MoyasarRequest {
  return request(secretKey, 'GET', paymentPath(paymentId));
}

export type OperationKind = 'capture' | 'void' | 'refund';

/** The request that carries out a queued payment operation. */
export function operationRequest(
  secretKey: string,
  kind: OperationKind,
  paymentId: string,
  amountSar: string,
): MoyasarRequest {
  switch (kind) {
    case 'capture':
      return request(secretKey, 'POST', paymentPath(paymentId, '/capture'), {
        amount: toHalalas(amountSar),
      });
    case 'void':
      return request(secretKey, 'POST', paymentPath(paymentId, '/void'));
    case 'refund':
      return request(secretKey, 'POST', paymentPath(paymentId, '/refund'), {
        amount: toHalalas(amountSar),
      });
  }
}

const SETTLED: Readonly<Record<OperationKind, readonly string[]>> = {
  capture: ['captured', 'paid'],
  void: ['voided'],
  refund: ['refunded'],
};

export type OperationOutcome =
  | { readonly ok: true; readonly reference: string }
  | { readonly ok: false; readonly error: string };

/**
 * What Moyasar's answer means for a queued operation.
 *
 * Success is the payment in the state the operation was meant to leave it in
 * — not merely a 2xx, which Moyasar also returns for a request it accepted
 * without doing. Anything else is a failure with the message kept, for the
 * operator who will read it in the console.
 */
export function interpretOperation(
  kind: OperationKind,
  httpStatus: number,
  body: unknown,
): OperationOutcome {
  const payment = body as Partial<MoyasarPayment> & { message?: string; type?: string };
  if (httpStatus >= 200 && httpStatus < 300 && typeof payment.status === 'string') {
    if (SETTLED[kind].includes(payment.status) && typeof payment.id === 'string') {
      return { ok: true, reference: payment.id };
    }
    return { ok: false, error: `Moyasar left the payment ${payment.status}` };
  }
  const message = typeof payment.message === 'string' ? payment.message : 'no message';
  return { ok: false, error: `Moyasar ${httpStatus}: ${message}` };
}
