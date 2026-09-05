import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DevOtpProvider,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  SupabaseOtpProvider,
} from './otp-provider.js';

const PHONE = '+966501234567';

describe('DevOtpProvider', () => {
  let provider: DevOtpProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new DevOtpProvider();
  });

  test('sends to a valid Saudi number and rejects anything else', async () => {
    await expect(provider.send(PHONE)).resolves.toMatchObject({ ok: true });
    await expect(provider.send('+12025550123')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_phone',
    });
  });

  test('verifies the fixed development code', async () => {
    await provider.send(PHONE);
    await expect(provider.verify(PHONE, DevOtpProvider.FIXED_CODE)).resolves.toMatchObject({
      ok: true,
    });
  });

  test('rejects a wrong code without consuming the challenge', async () => {
    await provider.send(PHONE);
    await expect(provider.verify(PHONE, '9999')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_code',
    });
    // The user gets to try again — a typo must not force a resend.
    await expect(provider.verify(PHONE, DevOtpProvider.FIXED_CODE)).resolves.toMatchObject({
      ok: true,
    });
  });

  test('enforces the attempt limit', async () => {
    await provider.send(PHONE);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await provider.verify(PHONE, '0000');
    }
    await expect(provider.verify(PHONE, DevOtpProvider.FIXED_CODE)).resolves.toMatchObject({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  test('expires the code after its TTL', async () => {
    await provider.send(PHONE);
    vi.advanceTimersByTime((OTP_TTL_SECONDS + 1) * 1000);
    await expect(provider.verify(PHONE, DevOtpProvider.FIXED_CODE)).resolves.toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });

  test('rate limits resends, then allows one after the cooldown', async () => {
    await provider.send(PHONE);
    await expect(provider.send(PHONE)).resolves.toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });

    vi.advanceTimersByTime((OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
    await expect(provider.send(PHONE)).resolves.toMatchObject({ ok: true });
  });

  test('a code cannot be reused once verified', async () => {
    await provider.send(PHONE);
    await provider.verify(PHONE, DevOtpProvider.FIXED_CODE);
    await expect(provider.verify(PHONE, DevOtpProvider.FIXED_CODE)).resolves.toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('SupabaseOtpProvider', () => {
  interface AuthError {
    readonly message: string;
    readonly status?: number;
  }

  function providerWith(responses: { send?: AuthError | null; verify?: AuthError | null }): {
    provider: SupabaseOtpProvider;
    calls: Record<string, unknown>[];
  } {
    const calls: Record<string, unknown>[] = [];
    const client = {
      auth: {
        signInWithOtp: async (args: Record<string, unknown>) => {
          calls.push({ method: 'signInWithOtp', ...args });
          return { data: {}, error: responses.send ?? null };
        },
        verifyOtp: async (args: Record<string, unknown>) => {
          calls.push({ method: 'verifyOtp', ...args });
          return { data: {}, error: responses.verify ?? null };
        },
      },
      // Only the two auth calls are used; anything else is a bug in the class.
    } as unknown as SupabaseClient;

    return { provider: new SupabaseOtpProvider(client), calls };
  }

  test('sends through Supabase Auth and creates the account on first use', async () => {
    // Phone-first product: a new number IS a sign-up, and everyone starts as a
    // customer (§5.1.1) — there is no role to ask about.
    const { provider, calls } = providerWith({});

    await expect(provider.send('+966512345678')).resolves.toMatchObject({ ok: true });
    expect(calls[0]).toMatchObject({
      method: 'signInWithOtp',
      phone: '+966512345678',
      options: { shouldCreateUser: true },
    });
  });

  test('refuses a non-Saudi number before spending an SMS', async () => {
    const { provider, calls } = providerWith({});

    await expect(provider.send('+15551234567')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_phone',
    });
    // The point of validating locally: the request is never made, so it costs
    // nothing and cannot consume one of the five hourly sends.
    expect(calls).toHaveLength(0);
  });

  test('maps a 429 to rate_limited, whichever limit produced it', async () => {
    // GoTrue's own SMS limit and our per-phone limit in the hook (0042) both
    // surface as 429. To the user they are the same event.
    const gotrue = providerWith({ send: { message: 'Email rate limit exceeded', status: 429 } });
    await expect(gotrue.provider.send('+966512345678')).resolves.toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });

    const hook = providerWith({ send: { message: 'sms_not_sent', status: 429 } });
    await expect(hook.provider.send('+966512345678')).resolves.toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });

  test('a provider outage is transport_failed, not a bad number', async () => {
    // The distinction the user feels: "try again" versus "check the number".
    const { provider } = providerWith({ send: { message: 'sms_not_sent', status: 502 } });

    await expect(provider.send('+966512345678')).resolves.toMatchObject({
      ok: false,
      reason: 'transport_failed',
    });
  });

  test('verifies against Supabase and reports a wrong code as invalid', async () => {
    const ok = providerWith({});
    await expect(ok.provider.verify('+966512345678', '123456')).resolves.toEqual({ ok: true });
    expect(ok.calls[0]).toMatchObject({ method: 'verifyOtp', type: 'sms', token: '123456' });

    const wrong = providerWith({ verify: { message: 'Token has expired or is invalid' } });
    await expect(wrong.provider.verify('+966512345678', '000000')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_code',
    });

    const throttled = providerWith({ verify: { message: 'Too many requests', status: 429 } });
    await expect(throttled.provider.verify('+966512345678', '000000')).resolves.toMatchObject({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  test('never logs, on any path', async () => {
    // ADR-0018. The client does not hold the code, but the submitted token
    // passes through here, and a console line is a code in whatever ingests
    // the logs.
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    };

    try {
      const { provider } = providerWith({
        send: { message: 'sms_not_sent', status: 502 },
        verify: { message: 'Token has expired or is invalid' },
      });

      await provider.send('+966512345678');
      await provider.verify('+966512345678', '424242');

      expect(spies.log).not.toHaveBeenCalled();
      expect(spies.warn).not.toHaveBeenCalled();
      expect(spies.error).not.toHaveBeenCalled();
    } finally {
      spies.log.mockRestore();
      spies.warn.mockRestore();
      spies.error.mockRestore();
    }
  });
});
