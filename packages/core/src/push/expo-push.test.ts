import { describe, expect, test } from 'vitest';
import {
  buildPushRequest,
  chunkPushMessages,
  EXPO_PUSH_CHUNK_SIZE,
  EXPO_PUSH_URL,
  isExpoPushToken,
  isTokenDead,
  parsePushResponse,
  type ExpoPushMessage,
} from './expo-push.js';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';

function message(to: string): ExpoPushMessage {
  return { to, title: 'طلب جديد قريب منك', body: 'بطارية · أقل من ٢ كم · 120.00 ريال' };
}

describe('isExpoPushToken', () => {
  test('accepts both spellings in the wild', () => {
    expect(isExpoPushToken(TOKEN_A)).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
  });

  test('rejects anything else', () => {
    // An FCM token is the plausible mistake — it is a long opaque string that
    // looks like it ought to work, and it fails on every future batch.
    expect(isExpoPushToken('fMEr8...:APA91bH')).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[has space]')).toBe(false);
    expect(isExpoPushToken('')).toBe(false);
  });

  // The database re-states this as a CHECK constraint. If the two disagree, one
  // of them is letting a token through that the other rejects.
  test('agrees with the shape device_push_tokens enforces', () => {
    const constraint = /^Expo(nent)?PushToken\[[^\]]+\]$/;
    for (const candidate of [TOKEN_A, 'ExpoPushToken[x]', 'nope', 'ExponentPushToken[]']) {
      expect(isExpoPushToken(candidate)).toBe(constraint.test(candidate));
    }
  });
});

describe('chunkPushMessages', () => {
  test('preserves order across chunks', () => {
    const messages = Array.from({ length: 5 }, (_, index) => message(`t${index}`));
    const chunks = chunkPushMessages(messages, 2);

    expect(chunks.map((chunk) => chunk.map((m) => m.to))).toEqual([
      ['t0', 't1'],
      ['t2', 't3'],
      ['t4'],
    ]);
  });

  test('an empty batch produces no requests', () => {
    expect(chunkPushMessages([])).toEqual([]);
  });

  test('defaults to the size Expo actually accepts', () => {
    const messages = Array.from({ length: EXPO_PUSH_CHUNK_SIZE + 1 }, () => message(TOKEN_A));
    expect(chunkPushMessages(messages)).toHaveLength(2);
  });
});

describe('buildPushRequest', () => {
  test('sends the fields Expo names, and omits the ones not set', () => {
    const request = buildPushRequest(null, [
      { ...message(TOKEN_A), channelId: 'job-offers', priority: 'high', ttlSeconds: 45 },
    ]);

    expect(request.url).toBe(EXPO_PUSH_URL);
    expect(JSON.parse(request.body)).toEqual([
      {
        to: TOKEN_A,
        title: 'طلب جديد قريب منك',
        body: 'بطارية · أقل من ٢ كم · 120.00 ريال',
        channelId: 'job-offers',
        priority: 'high',
        // Expo's field is `ttl`, not `ttlSeconds` — the rename is the reason
        // this assertion is on the wire format rather than the input.
        ttl: 45,
      },
    ]);
  });

  test('authorises only when a token is configured', () => {
    expect(buildPushRequest(null, [message(TOKEN_A)]).headers['authorization']).toBeUndefined();
    expect(buildPushRequest('', [message(TOKEN_A)]).headers['authorization']).toBeUndefined();
    expect(buildPushRequest('abc', [message(TOKEN_A)]).headers['authorization']).toBe('Bearer abc');
  });

  test('refuses a batch larger than one request', () => {
    const tooMany = Array.from({ length: EXPO_PUSH_CHUNK_SIZE + 1 }, () => message(TOKEN_A));
    expect(() => buildPushRequest(null, tooMany)).toThrow(/at most/);
  });

  test('refuses an empty batch rather than sending `[]`', () => {
    expect(() => buildPushRequest(null, [])).toThrow(/nothing to send/);
  });
});

describe('parsePushResponse', () => {
  test('a ticket per message, in the order sent', () => {
    const body = JSON.stringify({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      ],
    });

    const tickets = parsePushResponse(200, body, 2);

    expect(tickets[0]).toEqual({ ok: true, id: 'ticket-1' });
    expect(tickets[1]).toEqual({
      ok: false,
      reason: 'device_not_registered',
      code: 'DeviceNotRegistered',
    });
  });

  // ⚠️ The assertion this module exists for.
  //
  // The caller disables a token by POSITION. A response with more or fewer
  // tickets than messages would retire the wrong technician's device —
  // silently, permanently, and looking exactly like "they stopped getting
  // offers for no reason".
  test('a length mismatch fails the whole batch instead of guessing', () => {
    const short = JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] });
    const tickets = parsePushResponse(200, short, 2);

    expect(tickets).toHaveLength(2);
    expect(tickets.every((ticket) => !ticket.ok)).toBe(true);
    expect(tickets.every((ticket) => !ticket.ok && ticket.reason === 'transport_failed')).toBe(
      true,
    );
    // And nothing in that batch is treated as a dead device.
    expect(tickets.some(isTokenDead)).toBe(false);
  });

  test('per-message failures arrive with HTTP 200, so the status is never the answer', () => {
    const body = JSON.stringify({
      data: [{ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }],
    });

    expect(parsePushResponse(200, body, 1)[0]).toEqual({
      ok: false,
      reason: 'message_too_big',
      code: 'MessageTooBig',
    });
  });

  test('a request-level rejection fails every message in it', () => {
    const body = JSON.stringify({ errors: [{ code: 'UNAUTHORIZED', message: 'bad token' }] });
    const tickets = parsePushResponse(200, body, 3);

    expect(tickets).toHaveLength(3);
    expect(tickets.every((t) => !t.ok && t.reason === 'unauthorised')).toBe(true);
  });

  test('auth and rate-limit statuses are read from the status code', () => {
    expect(parsePushResponse(401, '', 1)[0]).toMatchObject({ reason: 'unauthorised' });
    expect(parsePushResponse(429, '', 2)).toHaveLength(2);
    expect(parsePushResponse(429, '', 1)[0]).toMatchObject({ reason: 'rate_exceeded' });
  });

  test('an unparseable body is a failure, never a pass', () => {
    // A proxy's HTML error page. Treating this as success would mark the
    // notification sent and it would never be retried.
    expect(parsePushResponse(200, '<html>502</html>', 1)[0]).toMatchObject({
      ok: false,
      reason: 'transport_failed',
    });
  });

  test('falls back to the message when Expo omits details.error', () => {
    const body = JSON.stringify({
      data: [{ status: 'error', message: '"..." is not a registered push notification recipient' }],
    });

    expect(parsePushResponse(200, body, 1)[0]).toMatchObject({ reason: 'device_not_registered' });
  });
});

describe('isTokenDead', () => {
  test('only an unregistered device retires a token', () => {
    expect(isTokenDead({ ok: false, reason: 'device_not_registered', code: null })).toBe(true);
  });

  test('a transient failure never does', () => {
    // Retiring a working device over a rate limit takes a technician out of
    // dispatch permanently for a fault that lasted a second.
    for (const reason of [
      'rate_exceeded',
      'transport_failed',
      'unauthorised',
      'rejected',
    ] as const) {
      expect(isTokenDead({ ok: false, reason, code: null })).toBe(false);
    }
    expect(isTokenDead({ ok: true, id: 'x' })).toBe(false);
  });
});
