import { describe, expect, test } from 'vitest';
import {
  AUTHENTICA_DEFAULT_BASE_URL,
  buildAuthenticaRequest,
  parseAuthenticaResponse,
} from './authentica.js';

const MESSAGE = { toE164: '+966512345678', otp: '482913', body: 'رمز الدخول إلى هبّة: 482913' };

describe('buildAuthenticaRequest', () => {
  test('without a sender name: send-otp, on a template, carrying the code GoTrue made', () => {
    const request = buildAuthenticaRequest({ apiKey: 'k' }, MESSAGE);

    expect(request.url).toBe(`${AUTHENTICA_DEFAULT_BASE_URL}/api/v2/send-otp`);
    expect(request.method).toBe('POST');
    expect(request.headers['x-authorization']).toBe('k');
    expect(request.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request.body)).toEqual({
      method: 'sms',
      phone: '+966512345678',
      template_id: 1,
      otp: '482913',
    });
  });

  test('a configured template is used', () => {
    const request = buildAuthenticaRequest({ apiKey: 'k', templateId: 4 }, MESSAGE);
    expect(JSON.parse(request.body)).toMatchObject({ template_id: 4 });
  });

  test('with a sender name: send-sms, with our own text', () => {
    const request = buildAuthenticaRequest(
      { apiKey: 'k', senderName: 'Habba', baseUrl: 'https://example.test/' },
      MESSAGE,
    );

    expect(request.url).toBe('https://example.test/api/v2/send-sms');
    expect(JSON.parse(request.body)).toEqual({
      phone: '+966512345678',
      message: MESSAGE.body,
      sender_name: 'Habba',
    });
  });

  test('a blank sender name is no sender name', () => {
    const request = buildAuthenticaRequest({ apiKey: 'k', senderName: '  ' }, MESSAGE);
    expect(request.url).toMatch(/send-otp$/);
  });

  test('refuses a number that is not E.164, and a code that is not digits', () => {
    for (const bad of ['0512345678', '966512345678', '+966 51 234 5678', '']) {
      expect(
        () => buildAuthenticaRequest({ apiKey: 'k' }, { ...MESSAGE, toE164: bad }),
        bad,
      ).toThrow(/E.164/);
    }
    expect(() => buildAuthenticaRequest({ apiKey: 'k' }, { ...MESSAGE, otp: '12ab' })).toThrow(
      /digits/,
    );
  });
});

describe('parseAuthenticaResponse', () => {
  test('success needs both a 2xx and success: true', () => {
    expect(parseAuthenticaResponse(200, '{"success":true,"message":"OTP sent"}')).toEqual({
      ok: true,
      messageId: null,
    });
    expect(parseAuthenticaResponse(200, '{"success":false,"message":"x"}').ok).toBe(false);
    expect(parseAuthenticaResponse(500, '{"success":true}').ok).toBe(false);
  });

  test('keeps a message id when there is one', () => {
    expect(parseAuthenticaResponse(200, '{"success":true,"data":{"id":77}}')).toEqual({
      ok: true,
      messageId: '77',
    });
  });

  test('a bad key, or no balance, is ours', () => {
    expect(parseAuthenticaResponse(401, '')).toMatchObject({ ok: false, reason: 'unauthorised' });
    expect(parseAuthenticaResponse(402, '{"success":false}')).toMatchObject({
      reason: 'unauthorised',
    });
  });

  test('a validation error on the phone is the recipient', () => {
    expect(
      parseAuthenticaResponse(
        422,
        '{"success":false,"errors":{"phone":["The phone format is invalid."]}}',
      ),
    ).toEqual({ ok: false, reason: 'invalid_recipient', code: '422' });
    expect(
      parseAuthenticaResponse(422, '{"success":false,"errors":{"template_id":["invalid"]}}'),
    ).toMatchObject({ reason: 'rejected' });
  });

  test('an unrecognised body is a failure, never a pass', () => {
    for (const body of ['', '<html>', 'null', '"ok"']) {
      expect(parseAuthenticaResponse(200, body).ok, body).toBe(false);
    }
  });
});
