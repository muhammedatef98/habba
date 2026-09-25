import { describe, expect, test } from 'vitest';
import {
  checkAuthorisation,
  fetchPaymentRequest,
  interpretOperation,
  isPaymentId,
  operationRequest,
  toHalalas,
  type MoyasarPayment,
} from './moyasar.js';

const ORDER = '0f1e2d3c-4b5a-4968-8776-655443322110';

function payment(overrides: Partial<MoyasarPayment> = {}): MoyasarPayment {
  return {
    id: 'pay_7a1b2c3d4e5f',
    status: 'authorized',
    amount: 15870,
    currency: 'SAR',
    metadata: { order_id: ORDER },
    ...overrides,
  };
}

describe('Moyasar amounts', () => {
  test('SAR becomes integer halalas', () => {
    expect(toHalalas('158.70')).toBe(15870);
    expect(toHalalas('506')).toBe(50600);
    expect(toHalalas('0.5')).toBe(50);
  });

  test('anything that is not a plain amount is refused', () => {
    expect(() => toHalalas('-5.00')).toThrow();
    expect(() => toHalalas('1.005')).toThrow();
    expect(() => toHalalas('abc')).toThrow();
  });
});

describe('an authorisation the phone reports', () => {
  const expected = { orderId: ORDER, amountHalalas: 15870 };

  test('is accepted only as the exact hold for this order', () => {
    expect(checkAuthorisation(payment(), expected)).toEqual({ ok: true });
  });

  test('a payment that was charged, failed or only initiated is not a hold', () => {
    for (const status of ['paid', 'failed', 'initiated', 'captured', 'voided']) {
      expect(checkAuthorisation(payment({ status }), expected)).toEqual({
        ok: false,
        reason: 'not_authorised',
      });
    }
  });

  test('a smaller or larger amount is refused, not rounded', () => {
    expect(checkAuthorisation(payment({ amount: 100 }), expected)).toMatchObject({
      reason: 'wrong_amount',
    });
    expect(checkAuthorisation(payment({ amount: 15871 }), expected)).toMatchObject({
      reason: 'wrong_amount',
    });
  });

  test("someone else's payment id cannot pay for this order", () => {
    expect(
      checkAuthorisation(payment({ metadata: { order_id: 'another-order' } }), expected),
    ).toMatchObject({ reason: 'wrong_order' });
    expect(checkAuthorisation(payment({ metadata: null }), expected)).toMatchObject({
      reason: 'wrong_order',
    });
  });

  test('a foreign currency is refused', () => {
    expect(checkAuthorisation(payment({ currency: 'USD' }), expected)).toMatchObject({
      reason: 'wrong_currency',
    });
  });
});

describe('requests to Moyasar', () => {
  test('authenticate with the secret key as the Basic user name', () => {
    const request = fetchPaymentRequest('sk_test_abc', 'pay_7a1b2c3d4e5f');
    expect(request.url).toBe('https://api.moyasar.com/v1/payments/pay_7a1b2c3d4e5f');
    expect(request.init.headers['Authorization']).toBe(`Basic ${btoa('sk_test_abc:')}`);
  });

  test('a payment id from the phone never shapes the URL', () => {
    expect(isPaymentId('../../invoices')).toBe(false);
    expect(() => fetchPaymentRequest('sk', '../../invoices')).toThrow();
  });

  test('no secret key, no request', () => {
    expect(() => fetchPaymentRequest('', 'pay_7a1b2c3d4e5f')).toThrow();
  });

  test('capture and refund send halalas; void sends nothing', () => {
    const capture = operationRequest('sk', 'capture', 'pay_7a1b2c3d4e5f', '506.00');
    expect(capture.url.endsWith('/payments/pay_7a1b2c3d4e5f/capture')).toBe(true);
    expect(JSON.parse(capture.init.body ?? '{}')).toEqual({ amount: 50600 });

    const refund = operationRequest('sk', 'refund', 'pay_7a1b2c3d4e5f', '20.50');
    expect(JSON.parse(refund.init.body ?? '{}')).toEqual({ amount: 2050 });

    const voided = operationRequest('sk', 'void', 'pay_7a1b2c3d4e5f', '0.00');
    expect(voided.init.body).toBeUndefined();
  });
});

describe("Moyasar's answer to a queued operation", () => {
  test('success is the payment left in the intended state', () => {
    expect(interpretOperation('capture', 200, { id: 'pay_1', status: 'captured' })).toEqual({
      ok: true,
      reference: 'pay_1',
    });
    expect(interpretOperation('void', 200, { id: 'pay_1', status: 'voided' })).toMatchObject({
      ok: true,
    });
  });

  test('a 2xx that left the payment elsewhere is a failure', () => {
    expect(interpretOperation('capture', 200, { id: 'pay_1', status: 'authorized' })).toMatchObject(
      { ok: false },
    );
  });

  test("an error keeps Moyasar's message for the operator", () => {
    expect(
      interpretOperation('capture', 400, {
        type: 'invalid_request_error',
        message: 'Amount exceeds',
      }),
    ).toEqual({ ok: false, error: 'Moyasar 400: Amount exceeds' });
  });
});
