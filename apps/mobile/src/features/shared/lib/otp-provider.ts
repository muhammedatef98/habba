/**
 * OTP delivery, behind an interface.
 *
 * Two implementations, chosen by configuration in `otp.ts`:
 *
 *   - `SupabaseOtpProvider` — real phone auth. Supabase Auth generates,
 *     expires and verifies the code and issues the session; delivery goes
 *     through the `send-sms-hook` Edge Function, which sends via Unifonic and
 *     enforces the 5/hour per-phone limit in Postgres (0042, ADR-0018).
 *   - `DevOtpProvider` — a fixed code, for working offline and in CI.
 *
 * The interface exists so the app never learns which one it has. Note what it
 * does NOT expose: any way to read a code. The client sends a number and later
 * submits what the user typed; it is never told what the right answer is.
 *
 * The same abstraction shape applies to Nafath in Phase 3 (build prompt §3).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseSaudiPhone } from '@habba/core';

export type OtpSendResult =
  | { readonly ok: true; readonly expiresInSeconds: number }
  | { readonly ok: false; readonly reason: 'invalid_phone' | 'rate_limited' | 'transport_failed' };

export type OtpVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_code' | 'expired' | 'too_many_attempts' };

export interface OtpProvider {
  send(phoneE164: string): Promise<OtpSendResult>;
  verify(phoneE164: string, code: string): Promise<OtpVerifyResult>;
}

/**
 * Six digits, because that is what Supabase Auth sends.
 *
 * This constant drives the input boxes on the verify screen, so it is not
 * cosmetic: four boxes against a six-digit SMS is an app nobody can sign into.
 * If the project's OTP length is ever changed in the dashboard (Authentication
 * → Providers → Phone), it must be changed here in the same breath.
 */
export const OTP_LENGTH = 6;
/** Matches the dashboard's OTP expiry. Keep the two in step for the same reason. */
export const OTP_TTL_SECONDS = 120;
export const OTP_MAX_ATTEMPTS = 5;
/** Matches the resend cooldown shown in the UI. */
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

interface PendingOtp {
  readonly code: string;
  readonly expiresAt: number;
  attempts: number;
}

/**
 * Development provider. Accepts a fixed code so the flow is exercisable
 * offline and in CI, and enforces the same expiry and attempt limits the real
 * provider will — a stub that is more permissive than production hides bugs
 * until launch.
 */
export class DevOtpProvider implements OtpProvider {
  static readonly FIXED_CODE = '123456';

  private readonly pending = new Map<string, PendingOtp>();
  private readonly lastSentAt = new Map<string, number>();

  async send(phoneE164: string): Promise<OtpSendResult> {
    if (!parseSaudiPhone(phoneE164).ok) {
      return { ok: false, reason: 'invalid_phone' };
    }

    const previous = this.lastSentAt.get(phoneE164);
    const now = Date.now();
    if (previous !== undefined && now - previous < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      return { ok: false, reason: 'rate_limited' };
    }

    this.lastSentAt.set(phoneE164, now);
    this.pending.set(phoneE164, {
      code: DevOtpProvider.FIXED_CODE,
      expiresAt: now + OTP_TTL_SECONDS * 1000,
      attempts: 0,
    });

    return { ok: true, expiresInSeconds: OTP_TTL_SECONDS };
  }

  async verify(phoneE164: string, code: string): Promise<OtpVerifyResult> {
    const entry = this.pending.get(phoneE164);
    if (entry === undefined) return { ok: false, reason: 'expired' };

    if (Date.now() > entry.expiresAt) {
      this.pending.delete(phoneE164);
      return { ok: false, reason: 'expired' };
    }

    if (entry.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: 'too_many_attempts' };
    }

    entry.attempts += 1;

    if (code !== entry.code) return { ok: false, reason: 'invalid_code' };

    this.pending.delete(phoneE164);
    return { ok: true };
  }
}

/**
 * Supabase Auth phone OTP.
 *
 * Every rule that matters is server-side: the code, its expiry, the attempt
 * count, the per-phone send limit, and the session. This class translates the
 * two calls and maps errors onto the same result type the dev provider
 * returns, so screens behave identically against either.
 *
 * Nothing here logs. `error.message` from GoTrue does not contain the code,
 * but the discipline is worth keeping at the boundary rather than trusting an
 * upstream string to stay code-free (ADR-0018).
 */
export class SupabaseOtpProvider implements OtpProvider {
  constructor(private readonly client: SupabaseClient) {}

  async send(phoneE164: string): Promise<OtpSendResult> {
    if (!parseSaudiPhone(phoneE164).ok) {
      return { ok: false, reason: 'invalid_phone' };
    }

    const { error } = await this.client.auth.signInWithOtp({
      phone: phoneE164,
      // Sign-in and sign-up are the same act for a phone-first product: a new
      // number becomes an account, and everyone starts as a customer (§5.1.1).
      options: { shouldCreateUser: true },
    });

    if (error === null) return { ok: true, expiresInSeconds: OTP_TTL_SECONDS };

    // 429 covers both GoTrue's own limit and the hook refusing on ours; from
    // the user's side they are the same event and get the same message.
    if (error.status === 429 || /rate|limit|too many/i.test(error.message)) {
      return { ok: false, reason: 'rate_limited' };
    }

    if (/phone|number|invalid/i.test(error.message)) {
      return { ok: false, reason: 'invalid_phone' };
    }

    return { ok: false, reason: 'transport_failed' };
  }

  async verify(phoneE164: string, code: string): Promise<OtpVerifyResult> {
    const { error } = await this.client.auth.verifyOtp({
      phone: phoneE164,
      token: code,
      type: 'sms',
    });

    if (error === null) return { ok: true };

    if (error.status === 429 || /too many/i.test(error.message)) {
      return { ok: false, reason: 'too_many_attempts' };
    }

    // GoTrue answers a wrong code and an expired code with ONE message —
    // "Token has expired or is invalid" — deliberately, because telling them
    // apart would confirm that a code was issued for that number.
    //
    // So `expired` is claimed only when the provider says expiry and nothing
    // else. The ambiguous case is reported as `invalid_code`, whose copy covers
    // both ("الرمز غير صحيح أو انتهت صلاحيته"). The alternative — calling every
    // mistyped digit "expired" — sends the user to request a new SMS, spending
    // one of their five hourly sends to fix a typo.
    if (/expired/i.test(error.message) && !/invalid/i.test(error.message)) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: false, reason: 'invalid_code' };
  }
}
