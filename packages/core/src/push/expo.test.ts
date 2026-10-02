import { describe, expect, it } from 'vitest';
import {
  chunk,
  readReceipts,
  settle,
  toExpoMessage,
  ttlSecondsFor,
  type ClaimedPush,
} from './expo.js';

function row(fields: Partial<ClaimedPush>): ClaimedPush {
  return {
    notification_id: 'n1',
    kind: 'order_arrived',
    token: 'ExponentPushToken[aaaaaaaaaaaa]',
    title: 'وصل الفنّي',
    body: 'عند سيارتك الآن.',
    data: { route: '/tracking', id: 'order-1' },
    ...fields,
  };
}

describe('toExpoMessage', () => {
  it('carries the words, the destination and the id of what was sent', () => {
    const message = toExpoMessage(row({}));
    expect(message.to).toBe('ExponentPushToken[aaaaaaaaaaaa]');
    expect(message.title).toBe('وصل الفنّي');
    expect(message.data).toEqual({ route: '/tracking', id: 'order-1', notificationId: 'n1' });
  });

  it('wakes the phone for a job or a visit, not for a reminder', () => {
    expect(toExpoMessage(row({ kind: 'job_offer' })).priority).toBe('high');
    expect(toExpoMessage(row({ kind: 'job_offer' })).channelId).toBe('orders');
    expect(toExpoMessage(row({ kind: 'care_reminder' })).priority).toBe('default');
    expect(toExpoMessage(row({ kind: 'care_reminder' })).channelId).toBe('reminders');
  });

  it('lets an offer expire in minutes and an order update in half an hour', () => {
    expect(ttlSecondsFor('job_offer')).toBe(300);
    expect(ttlSecondsFor('order_en_route')).toBe(1800);
    expect(ttlSecondsFor('care_reminder')).toBe(43_200);
  });
});

describe('chunk', () => {
  it('splits into Expo-sized batches', () => {
    const sizes = chunk(Array.from({ length: 250 }, (_, i) => i)).map((batch) => batch.length);
    expect(sizes).toEqual([100, 100, 50]);
  });
});

describe('settle', () => {
  it("counts a notification sent when any of the person's devices took it", () => {
    const outcome = settle(
      [
        row({ token: 'ExponentPushToken[phone-xxxxxx]' }),
        row({ token: 'ExponentPushToken[tablet-xxxxx]' }),
      ],
      [
        { status: 'ok', id: 't1' },
        { status: 'error', message: 'rate' },
      ],
    );
    expect(outcome.sent).toEqual(['n1']);
    expect(outcome.retry).toEqual([]);
  });

  it('retries a notification no device took', () => {
    const outcome = settle(
      [row({ notification_id: 'n2' })],
      [{ status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } }],
    );
    expect(outcome.retry).toEqual(['n2']);
    expect(outcome.deadTokens).toEqual([]);
  });

  it('retires an install that is gone', () => {
    const outcome = settle(
      [row({ notification_id: 'n3', token: 'ExponentPushToken[uninstalled-]' })],
      [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }],
    );
    expect(outcome.deadTokens).toEqual(['ExponentPushToken[uninstalled-]']);
    expect(outcome.retry).toEqual(['n3']);
  });

  it('treats a missing ticket as a failure, never as a delivery nobody confirmed', () => {
    const outcome = settle(
      [row({ notification_id: 'n4' }), row({ notification_id: 'n5' })],
      [{ status: 'ok', id: 't1' }],
    );
    expect(outcome.sent).toEqual(['n4']);
    expect(outcome.retry).toEqual(['n5']);
  });
});

describe('ttl and channel for the kinds added with the console', () => {
  it('an announcement is quiet and may wait a day; an approval reminder a few hours', () => {
    expect(ttlSecondsFor('announcement')).toBe(24 * 60 * 60);
    expect(ttlSecondsFor('approval_reminder')).toBe(6 * 60 * 60);
    const message = toExpoMessage({
      notification_id: 'n1',
      kind: 'announcement',
      token: 't1',
      title: 'تحديث',
      body: 'نص',
      data: {},
    });
    expect(message.channelId).toBe('reminders');
    expect(message.priority).toBe('default');
  });
});

describe('receipts', () => {
  it('an accepted message becomes a ticket to check later', () => {
    const outcome = settle(
      [{ notification_id: 'n1', kind: 'job_offer', token: 'tok', title: '', body: '', data: {} }],
      [{ status: 'ok', id: 'ticket-1' }],
    );
    expect(outcome.tickets).toEqual([
      { ticket_id: 'ticket-1', notification_id: 'n1', token: 'tok' },
    ]);
  });

  it('each ticket is ok, an error with its reason, or still pending', () => {
    expect(
      readReceipts(['a', 'b', 'c'], {
        a: { status: 'ok' },
        b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      }),
    ).toEqual([
      { ticket_id: 'a', status: 'ok', error: null },
      { ticket_id: 'b', status: 'error', error: 'DeviceNotRegistered' },
      { ticket_id: 'c', status: 'pending', error: null },
    ]);
  });
});
