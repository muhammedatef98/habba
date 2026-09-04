import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DevOtpProvider,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
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
