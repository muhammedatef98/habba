import { describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DevEmailOtpProvider,
  EMAIL_OTP_LENGTH,
  SupabaseEmailOtpProvider,
  isValidEmail,
  normaliseEmail,
} from './email-otp-provider.js';

describe('address handling', () => {
  test('normalises case and surrounding space, because the unique index does', () => {
    expect(normaliseEmail('  Ahmed@Example.COM ')).toBe('ahmed@example.com');
  });

  test('accepts and rejects the same shapes as the database CHECK', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('AHMED@EXAMPLE.COM')).toBe(true);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('no@tld')).toBe(false);
    expect(isValidEmail('two@at@signs.com')).toBe(false);
    expect(isValidEmail('has space@example.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('DevEmailOtpProvider', () => {
  test('refuses an address the real one would refuse', async () => {
    const provider = new DevEmailOtpProvider();
    expect(await provider.send('nope')).toEqual({ ok: false, reason: 'invalid_email' });
  });

  test('accepts the fixed code, once, for an address a code was sent to', async () => {
    const provider = new DevEmailOtpProvider();

    await provider.send('Ahmed@Example.com');
    // Normalised on both sides, so the case typed at verification does not matter.
    expect(await provider.verify('ahmed@example.com', DevEmailOtpProvider.FIXED_CODE)).toEqual({
      ok: true,
    });
    // Consumed: a second use of the same code must not sign anyone in.
    expect(await provider.verify('ahmed@example.com', DevEmailOtpProvider.FIXED_CODE)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  test('rejects a wrong code without consuming the pending one', async () => {
    const provider = new DevEmailOtpProvider();
    await provider.send('a@b.co');

    expect(await provider.verify('a@b.co', '000000')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
    expect(await provider.verify('a@b.co', DevEmailOtpProvider.FIXED_CODE)).toEqual({ ok: true });
  });

  test('verifying an address nothing was sent to is not a sign-in', async () => {
    const provider = new DevEmailOtpProvider();
    expect(await provider.verify('never@asked.com', DevEmailOtpProvider.FIXED_CODE)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  test('the fixed code is the length the screen renders', () => {
    expect(DevEmailOtpProvider.FIXED_CODE).toHaveLength(EMAIL_OTP_LENGTH);
  });
});

/** Just enough of the client for these paths; nothing here touches a network. */
function clientReturning(options: {
  readonly signIn?: { message: string; status?: number } | null;
  readonly verify?: { message: string; status?: number } | null;
}): { client: SupabaseClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const client = {
    auth: {
      signInWithOtp: (args: Record<string, unknown>) => {
        calls.push({ method: 'signInWithOtp', ...args });
        return Promise.resolve({ error: options.signIn ?? null });
      },
      verifyOtp: (args: Record<string, unknown>) => {
        calls.push({ method: 'verifyOtp', ...args });
        return Promise.resolve({ error: options.verify ?? null });
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('SupabaseEmailOtpProvider', () => {
  test('sends a normalised address and reports the expiry the screen counts down', async () => {
    const { client, calls } = clientReturning({});
    const result = await new SupabaseEmailOtpProvider(client).send(' Ahmed@Example.com ');

    expect(result).toEqual({ ok: true, expiresInSeconds: 3600 });
    expect(calls[0]).toMatchObject({ method: 'signInWithOtp', email: 'ahmed@example.com' });
  });

  test('never reaches the network for an address that cannot be one', async () => {
    const { client, calls } = clientReturning({});
    expect(await new SupabaseEmailOtpProvider(client).send('nope')).toEqual({
      ok: false,
      reason: 'invalid_email',
    });
    expect(calls).toHaveLength(0);
  });

  test('a 429 on send is rate limiting, not a transport failure', async () => {
    const { client } = clientReturning({ signIn: { message: 'rate limit exceeded', status: 429 } });
    expect(await new SupabaseEmailOtpProvider(client).send('a@b.co')).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });

  test('any other send error is a transport failure', async () => {
    const { client } = clientReturning({ signIn: { message: 'boom', status: 500 } });
    expect(await new SupabaseEmailOtpProvider(client).send('a@b.co')).toEqual({
      ok: false,
      reason: 'transport_failed',
    });
  });

  test('verifies with type "email", which is what GoTrue expects for this flow', async () => {
    const { client, calls } = clientReturning({});
    expect(await new SupabaseEmailOtpProvider(client).verify('A@B.co', '123456')).toEqual({
      ok: true,
    });
    expect(calls[0]).toEqual({
      method: 'verifyOtp',
      email: 'a@b.co',
      token: '123456',
      type: 'email',
    });
  });

  test('an expired code reads as expired only when GoTrue does not also call it invalid', async () => {
    const expired = clientReturning({ verify: { message: 'Token has expired' } });
    expect(await new SupabaseEmailOtpProvider(expired.client).verify('a@b.co', '1')).toEqual({
      ok: false,
      reason: 'expired',
    });

    // GoTrue's real wording for a bad code mentions BOTH words. Reading
    // "expired" out of it would tell the user to wait when they should retype.
    const both = clientReturning({
      verify: { message: 'Token has expired or is invalid' },
    });
    expect(await new SupabaseEmailOtpProvider(both.client).verify('a@b.co', '1')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
  });

  test('too many verification attempts is its own answer', async () => {
    const { client } = clientReturning({ verify: { message: 'too many', status: 429 } });
    expect(await new SupabaseEmailOtpProvider(client).verify('a@b.co', '1')).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });
});
