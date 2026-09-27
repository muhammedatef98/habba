import { describe, expect, test } from 'vitest';
import {
  createCardPaymentRequest,
  luhnValid,
  readCreatedPayment,
  validateCard,
} from './moyasar-card.js';

const NOW = new Date('2026-09-27T00:00:00Z');
const GOOD = { name: 'Mohammed Atef', number: '4111 1111 1111 1111', expiry: '09/28', cvc: '123' };

describe('validateCard', () => {
  test('a good card comes back normalised', () => {
    expect(validateCard(GOOD, NOW)).toEqual({
      ok: true,
      card: { name: 'Mohammed Atef', number: '4111111111111111', month: 9, year: 2028, cvc: '123' },
    });
  });

  test('Arabic-Indic digits are read as digits', () => {
    const result = validateCard(
      { ...GOOD, number: '٤١١١١١١١١١١١١١١١', expiry: '٠٩/٢٨', cvc: '١٢٣' },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  test('names each wrong field', () => {
    const result = validateCard(
      { name: 'Mohammed', number: '4111111111111112', expiry: '13/28', cvc: '12' },
      NOW,
    );
    expect(result).toEqual({ ok: false, errors: ['name', 'number', 'expiry', 'cvc'] });
  });

  test('a card that expired last month is refused, this month is not', () => {
    expect(validateCard({ ...GOOD, expiry: '08/26' }, NOW).ok).toBe(false);
    expect(validateCard({ ...GOOD, expiry: '09/26' }, NOW).ok).toBe(true);
    expect(validateCard({ ...GOOD, expiry: '0928' }, NOW).ok).toBe(true);
    expect(validateCard({ ...GOOD, expiry: '09/2028' }, NOW).ok).toBe(true);
  });
});

describe('luhnValid', () => {
  test('the check digit catches a single typo', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111121')).toBe(false);
    expect(luhnValid('41111')).toBe(false);
  });
});

describe('createCardPaymentRequest', () => {
  const card = {
    name: 'Mohammed Atef',
    number: '4111111111111111',
    month: 9,
    year: 2028,
    cvc: '123',
  };
  const order = {
    orderId: '0b7c1a51-7f5f-4b8e-9a60-9d51c7f8f001',
    amountHalalas: 50600,
    description: 'هبّة — طلب 0b7c1a51',
    callbackUrl: 'https://habba-admin.vercel.app/pay/return',
  };

  test('authorises only, with 3-D Secure, for this order', () => {
    const request = createCardPaymentRequest('pk_test_abc', order, card);
    expect(request.url).toBe('https://api.moyasar.com/v1/payments');
    expect(request.init.headers['Authorization']).toBe(`Basic ${btoa('pk_test_abc:')}`);
    const body = JSON.parse(request.init.body);
    expect(body).toMatchObject({
      amount: 50600,
      currency: 'SAR',
      callback_url: order.callbackUrl,
      metadata: { order_id: order.orderId },
      source: { type: 'creditcard', manual: true, '3ds': true, month: 9, year: 2028 },
    });
  });

  test('refuses a secret key, which must never reach a phone', () => {
    expect(() => createCardPaymentRequest('sk_live_abc', order, card)).toThrow(/publishable/);
  });

  test('refuses an amount that is not whole halalas', () => {
    expect(() =>
      createCardPaymentRequest('pk_test_abc', { ...order, amountHalalas: 10.5 }, card),
    ).toThrow();
  });
});

describe('readCreatedPayment', () => {
  test('authorised straight away', () => {
    expect(readCreatedPayment(201, '{"id":"pay_123456789","status":"authorized"}')).toEqual({
      kind: 'authorised',
      paymentId: 'pay_123456789',
    });
  });

  test('3-D Secure first, and only on a Moyasar page', () => {
    expect(
      readCreatedPayment(
        201,
        '{"id":"pay_123456789","status":"initiated","source":{"transaction_url":"https://api.moyasar.com/v1/transaction_auths/x/form"}}',
      ),
    ).toEqual({
      kind: 'needs_3ds',
      paymentId: 'pay_123456789',
      url: 'https://api.moyasar.com/v1/transaction_auths/x/form',
    });
    expect(
      readCreatedPayment(
        201,
        '{"id":"pay_123456789","status":"initiated","source":{"transaction_url":"https://evil.example/x"}}',
      ).kind,
    ).toBe('failed');
  });

  test("a decline carries Moyasar's message", () => {
    expect(
      readCreatedPayment(
        201,
        '{"id":"pay_1","status":"failed","source":{"message":"INSUFFICIENT_FUNDS"}}',
      ),
    ).toEqual({ kind: 'failed', message: 'INSUFFICIENT_FUNDS' });
    expect(
      readCreatedPayment(400, '{"type":"invalid_request_error","message":"Validation Failed"}'),
    ).toEqual({
      kind: 'failed',
      message: 'Validation Failed',
    });
    expect(readCreatedPayment(500, '<html>').kind).toBe('failed');
  });
});
