/**
 * Email OTP delivery, behind an interface — the same shape as `otp-provider.ts`
 * and for the same reasons.
 *
 * Why this replaces the email PASSWORD provider it sits next to: a password is
 * a second secret for the user to invent, store and lose, on an account whose
 * other route in is a six-digit code. It also needs its own reset flow, which
 * is a second delivery path to build and a second one to attack. A code to the
 * address IS the proof of the address, which is the only thing email is being
 * asked to prove here.
 *
 * The operational reason this exists at all: phone OTP needs a CITC-registered
 * sender ID, which takes weeks of calendar time (open decision 4). Email needs
 * an SMTP provider, which takes an afternoon. Email is the second way in, not
 * a replacement — §9.1 keeps phone as the Saudi market's primary path — but it
 * is the one that can carry a launch while the sender ID is in a queue.
 *
 * Note what the interface does NOT expose, exactly as the phone one does not:
 * any way to read a code. The client sends an address and later submits what
 * the user typed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailOtpSendResult =
  | { readonly ok: true; readonly expiresInSeconds: number }
  | { readonly ok: false; readonly reason: 'invalid_email' | 'rate_limited' | 'transport_failed' };

export type EmailOtpVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_code' | 'expired' | 'too_many_attempts' };

export interface EmailOtpProvider {
  send(email: string): Promise<EmailOtpSendResult>;
  verify(email: string, code: string): Promise<EmailOtpVerifyResult>;
}

/**
 * Six digits, matching `OTP_LENGTH` for phone and the `{{ .Token }}` the email
 * template renders. Drives the input boxes, so a mismatch is an app nobody can
 * sign into — see the note in `otp-provider.ts`.
 */
export const EMAIL_OTP_LENGTH = 6;

/**
 * Supabase's default email OTP validity is an hour, against two minutes for
 * SMS. That is not an oversight to correct: an email sits in an inbox the user
 * may not have open, and a two-minute code turns a normal delay into a failed
 * sign-in. Keep this in step with Authentication → Providers → Email → Email
 * OTP Expiration.
 */
export const EMAIL_OTP_TTL_SECONDS = 3600;
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;

// Matches the `profiles_email_shape` CHECK (0039) and the transfer table's
// (0045). A client that accepts an address the database rejects produces an
// error at the worst possible moment.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Case-insensitive, matching the `profiles_email_lower_idx` unique index. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normaliseEmail(email));
}

/**
 * Real email OTP through Supabase Auth.
 *
 * `signInWithOtp` sends a Magic Link or a code depending on the project's
 * template; Habba's renders `{{ .Token }}`, so it is a code. `shouldCreateUser`
 * stays at its default `true`: an address that has never signed in is a new
 * customer, and refusing them here would be a sign-up flow that only works for
 * people who already signed up.
 */
export class SupabaseEmailOtpProvider implements EmailOtpProvider {
  constructor(private readonly client: SupabaseClient) {}

  async send(email: string): Promise<EmailOtpSendResult> {
    const normalised = normaliseEmail(email);
    if (!isValidEmail(normalised)) return { ok: false, reason: 'invalid_email' };

    const { error } = await this.client.auth.signInWithOtp({ email: normalised });

    if (error !== null) {
      // GoTrue answers 429 for both its own per-address limit and the
      // project-wide email ceiling. The user's next move is the same either
      // way — wait — so they are one reason here.
      if (error.status === 429) return { ok: false, reason: 'rate_limited' };
      return { ok: false, reason: 'transport_failed' };
    }

    return { ok: true, expiresInSeconds: EMAIL_OTP_TTL_SECONDS };
  }

  async verify(email: string, code: string): Promise<EmailOtpVerifyResult> {
    const { error } = await this.client.auth.verifyOtp({
      email: normaliseEmail(email),
      token: code,
      type: 'email',
    });

    if (error === null) return { ok: true };

    if (error.status === 429) return { ok: false, reason: 'too_many_attempts' };

    // GoTrue merges "expired" and "invalid" into one message, and leads with
    // the word `invalid` even when the code has merely aged out. Same reading
    // as `SupabaseOtpProvider`: only call it expired when the message says so
    // AND does not also say invalid.
    const message = error.message.toLowerCase();
    if (message.includes('expired') && !message.includes('invalid')) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: false, reason: 'invalid_code' };
  }
}

/**
 * Development provider. A fixed code, so the flow can be walked end to end on
 * a laptop with no project and no SMTP sender.
 *
 * Deliberately enforces the same address rule as the real one: a stub more
 * permissive than production hides bugs until launch.
 */
export class DevEmailOtpProvider implements EmailOtpProvider {
  static readonly FIXED_CODE = '123456';

  private readonly pending = new Set<string>();

  async send(email: string): Promise<EmailOtpSendResult> {
    const normalised = normaliseEmail(email);
    if (!isValidEmail(normalised)) return { ok: false, reason: 'invalid_email' };

    this.pending.add(normalised);
    return { ok: true, expiresInSeconds: EMAIL_OTP_TTL_SECONDS };
  }

  async verify(email: string, code: string): Promise<EmailOtpVerifyResult> {
    const normalised = normaliseEmail(email);

    if (!this.pending.has(normalised)) return { ok: false, reason: 'expired' };
    if (code !== DevEmailOtpProvider.FIXED_CODE) return { ok: false, reason: 'invalid_code' };

    this.pending.delete(normalised);
    return { ok: true };
  }
}
