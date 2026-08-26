import { beforeEach, describe, expect, test, vi } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { AUTHORISATION_VALIDITY_DAYS, DevPaymentProvider } from './payments.js';

const ORDER = 'order-1';

describe('DevPaymentProvider', () => {
  let payments: DevPaymentProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    payments = new DevPaymentProvider();
  });

  test('authorises at booking and returns an expiry', async () => {
    const result = await payments.authorise(ORDER, sarOrThrow('506.00'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paymentIntentId).toMatch(/^dev_intent_/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('captures up to the authorised amount', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('506.00'));
    if (!auth.ok) return;

    const capture = await payments.capture(auth.paymentIntentId, sarOrThrow('506.00'));
    expect(capture).toMatchObject({ ok: true, capturedAmount: '506.00' });
  });

  test('captures less than authorised — a job can come in cheaper', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('506.00'));
    if (!auth.ok) return;

    const capture = await payments.capture(auth.paymentIntentId, sarOrThrow('400.00'));
    expect(capture.ok).toBe(true);
  });

  test('REFUSES to capture more than was authorised', async () => {
    // The constraint that shapes the whole order flow (ADR-0008). The price
    // after diagnosis routinely exceeds the booking estimate, so this path is
    // the normal case, not an edge case — the flow needs re-authorisation and
    // a second customer confirmation.
    const auth = await payments.authorise(ORDER, sarOrThrow('120.00'));
    if (!auth.ok) return;

    const capture = await payments.capture(auth.paymentIntentId, sarOrThrow('506.00'));
    expect(capture).toMatchObject({ ok: false, reason: 'exceeds_authorisation' });
  });

  test('an authorisation expires, and a late capture fails', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('506.00'));
    if (!auth.ok) return;

    vi.advanceTimersByTime((AUTHORISATION_VALIDITY_DAYS + 1) * 86_400_000);

    const capture = await payments.capture(auth.paymentIntentId, sarOrThrow('506.00'));
    expect(capture).toMatchObject({ ok: false, reason: 'authorisation_expired' });
  });

  test('cannot capture twice', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('100.00'));
    if (!auth.ok) return;

    await payments.capture(auth.paymentIntentId, sarOrThrow('100.00'));
    const second = await payments.capture(auth.paymentIntentId, sarOrThrow('100.00'));
    expect(second).toMatchObject({ ok: false, reason: 'already_captured' });
  });

  test('cannot capture an unknown intent', async () => {
    const capture = await payments.capture('nope', sarOrThrow('100.00'));
    expect(capture).toMatchObject({ ok: false, reason: 'not_authorised' });
  });

  test('refunds only what was captured, and only once', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('100.00'));
    if (!auth.ok) return;

    // A cancelled order releases the hold; it was never captured.
    expect(await payments.refund(auth.paymentIntentId, sarOrThrow('100.00'))).toMatchObject({
      ok: false,
      reason: 'not_captured',
    });

    await payments.capture(auth.paymentIntentId, sarOrThrow('100.00'));
    expect(await payments.refund(auth.paymentIntentId, sarOrThrow('100.00'))).toMatchObject({
      ok: true,
    });
    expect(await payments.refund(auth.paymentIntentId, sarOrThrow('100.00'))).toMatchObject({
      ok: false,
      reason: 'already_refunded',
    });
  });

  test('releasing an uncaptured hold succeeds — the cancellation path', async () => {
    const auth = await payments.authorise(ORDER, sarOrThrow('100.00'));
    if (!auth.ok) return;
    expect(await payments.release(auth.paymentIntentId)).toMatchObject({ ok: true });
  });
});
