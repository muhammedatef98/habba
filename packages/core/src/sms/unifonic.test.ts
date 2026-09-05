import { describe, expect, test } from 'vitest';
import {
  buildSendRequest,
  otpMessageBody,
  parseSendResponse,
  toMsisdn,
  UNIFONIC_DEFAULT_BASE_URL,
} from './unifonic.js';

const CONFIG = { appSid: 'test-app-sid', senderId: 'HABBA' } as const;

describe('toMsisdn', () => {
  test('drops the leading + and nothing else', () => {
    expect(toMsisdn('+966512345678')).toBe('966512345678');
  });

  test('refuses anything that is not E.164', () => {
    // Reformatting here would hide an upstream bug, and an OTP sent to a
    // salvaged number is an OTP sent to someone else.
    for (const bad of ['0512345678', '966512345678', '+966 51 234 5678', '+0512345678', '']) {
      expect(() => toMsisdn(bad), bad).toThrow(/E.164/);
    }
  });
});

describe('buildSendRequest', () => {
  const request = buildSendRequest(CONFIG, { toE164: '+966512345678', body: 'رمز: 1234' });

  test('posts form-encoded to the messaging endpoint', () => {
    expect(request.url).toBe(`${UNIFONIC_DEFAULT_BASE_URL}/rest/SMS/messages`);
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  test('carries the app sid, recipient, sender id and body', () => {
    const form = new URLSearchParams(request.body);

    expect(form.get('AppSid')).toBe('test-app-sid');
    expect(form.get('Recipient')).toBe('966512345678');
    expect(form.get('SenderID')).toBe('HABBA');
    expect(form.get('Body')).toBe('رمز: 1234');
  });

  test('honours a configured base URL, trailing slash or not', () => {
    // Unifonic issues more than one API host, so this is configuration.
    const custom = buildSendRequest(
      { ...CONFIG, baseUrl: 'https://api.unifonic.com/' },
      { toE164: '+966512345678', body: 'x' },
    );
    expect(custom.url).toBe('https://api.unifonic.com/rest/SMS/messages');
  });
});

describe('parseSendResponse', () => {
  test('a successful send returns the message id', () => {
    const result = parseSendResponse(
      200,
      JSON.stringify({
        success: 'true',
        message: 'Success',
        errorCode: '0',
        data: { MessageID: 42 },
      }),
    );

    expect(result).toEqual({ ok: true, messageId: '42' });
  });

  test('HTTP 200 with success:false is a FAILURE', () => {
    // The trap this test exists for: Unifonic reports application-level
    // rejections with a 200, so a caller checking `response.ok` would report
    // an undelivered OTP as sent and leave the user waiting.
    const result = parseSendResponse(
      200,
      JSON.stringify({ success: 'false', message: 'Invalid recipient', errorCode: 'ER-06' }),
    );

    expect(result.ok).toBe(false);
  });

  test('distinguishes a bad number from a bad account', () => {
    const recipient = parseSendResponse(
      200,
      JSON.stringify({ success: 'false', errorCode: 'ER-RECIPIENT' }),
    );
    const account = parseSendResponse(
      200,
      JSON.stringify({ success: 'false', errorCode: 'ER-APPSID' }),
    );

    expect(recipient).toMatchObject({ ok: false, reason: 'invalid_recipient' });
    // One is the user's typo and the other is ours; the same error message for
    // both sends a user to re-type a number that was fine.
    expect(account).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  test('401 and 403 are unauthorised without needing a body', () => {
    expect(parseSendResponse(401, '')).toMatchObject({ ok: false, reason: 'unauthorised' });
    expect(parseSendResponse(403, 'nope')).toMatchObject({ ok: false, reason: 'unauthorised' });
  });

  test('an unparseable body fails rather than optimistically passing', () => {
    // A proxy error page or an empty response must never read as delivered.
    expect(parseSendResponse(200, '<html>gateway timeout</html>')).toMatchObject({
      ok: false,
      reason: 'transport_failed',
    });
    expect(parseSendResponse(500, '')).toMatchObject({ ok: false, reason: 'transport_failed' });
  });
});

describe('otpMessageBody', () => {
  const body = otpMessageBody('1234');

  test('is Arabic, names Habba, and warns against sharing', () => {
    expect(body).toContain('هبّة');
    expect(body).toContain('1234');
    expect(body).toContain('لا تشاركه');
  });

  test('fits one UCS-2 SMS segment', () => {
    // Arabic SMS is UCS-2: 70 characters per segment. Two segments cost double
    // for a four-digit code.
    expect([...body].length).toBeLessThanOrEqual(70);
  });
});
