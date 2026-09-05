/**
 * Email sign-in and registration, behind an interface.
 *
 * ⚠️ OPEN DECISION, same shape as `otp-provider.ts`. Real email auth is
 * Supabase Auth's `signUp` / `signInWithPassword` (or a magic link), which
 * needs a configured SMTP sender and a verified sending domain. Until that
 * exists, `DevEmailAuthProvider` lets the whole flow be built and tested.
 *
 * Note what this is NOT: a replacement for phone OTP. §9.1 specifies phone as
 * the onboarding path and the Saudi market is phone-first — email is the
 * secondary route, for people who prefer it or whose number is between SIMs.
 *
 * The password rule below is deliberately modest and enforced in ONE place.
 * A stricter policy is a product decision, not something to scatter across
 * screens; when it changes it changes here.
 */

export const MIN_PASSWORD_LENGTH = 8;

export type EmailAuthResult =
  | { readonly ok: true; readonly email: string }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_email'
        | 'weak_password'
        | 'email_taken'
        | 'unknown_email'
        | 'wrong_password'
        | 'transport_failed';
    };

export interface EmailAuthProvider {
  register(email: string, password: string): Promise<EmailAuthResult>;
  signIn(email: string, password: string): Promise<EmailAuthResult>;
}

// Matches the `profiles_email_shape` CHECK added in migration 0039. Kept in
// step deliberately: a client that accepts an address the database rejects
// produces an error at the worst possible moment.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Case-insensitive, matching the `profiles_email_lower_idx` unique index. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normaliseEmail(email));
}

/**
 * Development provider. In-memory, and enforces the same rules the real one
 * will — a stub more permissive than production hides bugs until launch.
 */
export class DevEmailAuthProvider implements EmailAuthProvider {
  private readonly accounts = new Map<string, string>();

  async register(email: string, password: string): Promise<EmailAuthResult> {
    const normalised = normaliseEmail(email);

    if (!isValidEmail(normalised)) return { ok: false, reason: 'invalid_email' };
    if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak_password' };
    if (this.accounts.has(normalised)) return { ok: false, reason: 'email_taken' };

    this.accounts.set(normalised, password);
    return { ok: true, email: normalised };
  }

  async signIn(email: string, password: string): Promise<EmailAuthResult> {
    const normalised = normaliseEmail(email);

    if (!isValidEmail(normalised)) return { ok: false, reason: 'invalid_email' };

    const stored = this.accounts.get(normalised);
    if (stored === undefined) return { ok: false, reason: 'unknown_email' };
    if (stored !== password) return { ok: false, reason: 'wrong_password' };

    return { ok: true, email: normalised };
  }
}
