/**
 * OTP delivery, behind an interface.
 *
 * ⚠️ OPEN DECISION — this blocks Phase 1's acceptance criterion ("a user signs
 * up with a Saudi phone number"). Supabase Auth needs an SMS provider, and in
 * Saudi Arabia the sender ID must be registered with the CITC. Candidates are
 * Unifonic and Taqnyat (local, straightforward sender-ID registration) or
 * Twilio/MessageBird (international, more friction for KSA sender IDs).
 *
 * Until that is chosen and credentialled, `DevOtpProvider` below lets the
 * whole flow — validation, rate limiting, expiry, resend, navigation — be
 * built and tested. Only the transport is stubbed. Swapping in the real
 * provider is one implementation of this interface and no screen changes.
 *
 * The same abstraction shape applies to Nafath in Phase 3 (build prompt §3).
 */

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

export const OTP_LENGTH = 4;
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
  static readonly FIXED_CODE = '1234';

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
