/**
 * Who is operating the console.
 *
 * ⚠️ READ THIS BEFORE TRUSTING ANYTHING HERE. This module decides what the UI
 * shows. It is NOT the security boundary and must never be treated as one.
 *
 * The boundary is `is_ops()` (0013), evaluated inside the database on every
 * policy and every ops-only function. A person who bypasses this screen
 * entirely — devtools, a crafted request, a stale bundle — reaches a database
 * that will not return them a single provider row or accept a single decision.
 * That is the design: the console is a convenience over an API that is already
 * safe without it.
 *
 * What this module is for is not showing an operator a queue of controls that
 * will fail when they use them, and not leaving a signed-in technician staring
 * at a console they have no business seeing.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export type OpsRole = 'ops' | 'super_admin';

export interface Operator {
  readonly id: string;
  readonly email: string | null;
  readonly fullName: string;
  readonly role: OpsRole;
}

export type SignInResult =
  | { readonly ok: true; readonly operator: Operator }
  /**
   * Credentials were right and a second factor is required to finish.
   *
   * ⚠️ There is no session to use at this point. `signIn` leaves the partial
   * session in place ONLY so `verifySecondFactor` can complete it; every read
   * the console performs before that will be refused by RLS anyway, because
   * Supabase issues an `aal1` token and the ops policies are reached at `aal2`.
   */
  | { readonly ok: false; readonly reason: 'needs_second_factor'; readonly factorId: string }
  | {
      readonly ok: false;
      readonly reason:
        | 'bad_credentials'
        | 'not_ops'
        /** An ops account with no enrolled factor. Amendment B makes 2FA mandatory. */
        | 'second_factor_not_enrolled'
        | 'transport_failed';
    };

/**
 * How long a console session may live (Amendment B §5.1.6: "Sessions expire
 * after 8 hours. There is no 'remember me'.").
 *
 * Enforced on the client because that is where the session object is, and NOT
 * relied upon: a token still valid at the platform is still valid, so this
 * shortens the window rather than closing it. The real limit is the project's
 * JWT expiry, which the runbook sets — see `apps/admin/README.md`.
 */
export const OPS_SESSION_MAX_SECONDS = 8 * 60 * 60;

export interface OpsAuth {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Completes a sign-in that returned `needs_second_factor`. */
  verifySecondFactor(factorId: string, code: string): Promise<SignInResult>;
  currentOperator(): Promise<Operator | null>;
  signOut(): Promise<void>;
}

/**
 * Whether a session has outlived the console's own limit.
 *
 * Pure so it can be tested without a clock or a Supabase project — this is the
 * rule Amendment B states, and a rule nobody can test is a rule nobody can rely
 * on.
 */
export function isSessionExpired(
  issuedAtSeconds: number | undefined,
  nowMs: number = Date.now(),
): boolean {
  // No issue time is not a young session; it is a session we cannot vouch for.
  if (issuedAtSeconds === undefined) return true;
  return nowMs / 1000 - issuedAtSeconds > OPS_SESSION_MAX_SECONDS;
}

class SupabaseOpsAuth implements OpsAuth {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });

    if (error !== null || data.session === null) {
      return { ok: false, reason: 'bad_credentials' };
    }

    const operator = await this.operatorFor(data.session);
    if (operator === null) {
      // ⚠️ Sign the session out again. A non-ops user who authenticates
      // successfully is still authenticated — leaving the session in place
      // would hand the console's own fetches a valid token belonging to a
      // customer, and every subsequent failure would look like a bug rather
      // than a refusal.
      await this.client.auth.signOut();
      return { ok: false, reason: 'not_ops' };
    }

    /**
     * ⚠️ 2FA is mandatory here, not offered (Amendment B §5.1.6).
     *
     * An operator can approve providers, read every order and change what
     * everyone is charged. A stolen password must not be enough, and an account
     * with no enrolled factor is REFUSED rather than waved through — an
     * exemption for "the one account that hasn't set it up yet" is how a
     * mandatory control becomes an optional one.
     */
    const factors = await this.client.auth.mfa.listFactors();
    const verified = factors.data?.totp?.find((factor) => factor.status === 'verified');

    if (verified === undefined) {
      await this.client.auth.signOut();
      return { ok: false, reason: 'second_factor_not_enrolled' };
    }

    const { error: challengeError } = await this.client.auth.mfa.challenge({
      factorId: verified.id,
    });
    if (challengeError !== null) {
      await this.client.auth.signOut();
      return { ok: false, reason: 'transport_failed' };
    }

    return { ok: false, reason: 'needs_second_factor', factorId: verified.id };
  }

  async verifySecondFactor(factorId: string, code: string): Promise<SignInResult> {
    const challenge = await this.client.auth.mfa.challenge({ factorId });
    if (challenge.error !== null || challenge.data === null) {
      return { ok: false, reason: 'transport_failed' };
    }

    const { error } = await this.client.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });

    if (error !== null) return { ok: false, reason: 'bad_credentials' };

    const { data } = await this.client.auth.getSession();
    if (data.session === null) return { ok: false, reason: 'transport_failed' };

    const operator = await this.operatorFor(data.session);
    if (operator === null) {
      await this.client.auth.signOut();
      return { ok: false, reason: 'not_ops' };
    }

    return { ok: true, operator };
  }

  async currentOperator(): Promise<Operator | null> {
    const { data } = await this.client.auth.getSession();
    if (data.session === null) return null;

    // The 8-hour limit, checked on every read rather than on a timer: a console
    // left open overnight must not still be operating in the morning, and a
    // timer does not survive the tab being suspended.
    if (
      isSessionExpired(
        data.session.user.last_sign_in_at === null
          ? undefined
          : Math.floor(new Date(data.session.user.last_sign_in_at ?? 0).getTime() / 1000),
      )
    ) {
      await this.client.auth.signOut();
      return null;
    }

    // ⚠️ `aal2` or nothing. A session that stopped at the password is not an
    // operator session, whatever the role rows say.
    const level = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level.data?.currentLevel !== 'aal2') {
      return null;
    }

    return this.operatorFor(data.session);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  /**
   * Reads the role from `user_roles`, not from the JWT and not from `profiles`.
   *
   * ⚠️ This used to select `profiles.role`. Amendment A (§5.1.2) replaced that
   * column with the `user_roles` join table and 0040 dropped it, so against a
   * real project the select errored, `operatorFor` returned null, and EVERY
   * operator was told they were not ops. The console had never been run against
   * the migrated schema — the dev stand-in below has no such column and so
   * never noticed.
   *
   * Reading the rows rather than a token claim is the other half: a role baked
   * into a JWT at sign-in stays true until it expires, so revoking someone's
   * access would not take effect until then. Reading means a revoked operator
   * loses the console on their next action, which is what anyone revoking
   * access assumes they are getting.
   */
  private async operatorFor(session: Session): Promise<Operator | null> {
    const [profile, roles] = await Promise.all([
      this.client
        .from('profiles')
        .select('id, full_name, email')
        .eq('id', session.user.id)
        .maybeSingle(),
      this.client
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .is('revoked_at', null)
        .in('role', ['ops', 'super_admin']),
    ]);

    if (profile.error !== null || profile.data === null) return null;
    if (roles.error !== null) return null;

    const held = ((roles.data ?? []) as { role: string }[]).map((row) => row.role);
    // `super_admin` wins when someone holds both, so the console does not
    // quietly downgrade its own operator.
    const role: OpsRole | null = held.includes('super_admin')
      ? 'super_admin'
      : held.includes('ops')
        ? 'ops'
        : null;

    if (role === null) return null;

    const row = profile.data as { id: string; full_name: string; email: string | null };

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role,
    };
  }
}

/**
 * Development stand-in.
 *
 * Accepts one fixed operator so the console is usable before a project exists,
 * and refuses everything else — including a plausible-looking technician
 * address, so the `not_ops` path is exercised rather than assumed.
 */
class DevOpsAuth implements OpsAuth {
  private static readonly OPERATOR: Operator = {
    id: 'ops-dev-1',
    email: 'ops@habba.sa',
    fullName: 'مشغّل التطوير',
    role: 'ops',
  };

  /** The code the dev stub accepts. Never a real secret; see the class note. */
  private static readonly DEV_TOTP = '000000';
  private static readonly DEV_FACTOR = 'dev-totp-factor';

  private signedIn = false;

  async signIn(email: string, password: string): Promise<SignInResult> {
    if (email.trim().toLowerCase() !== DevOpsAuth.OPERATOR.email) {
      // Anything else is treated as a real account without the role, so the
      // screen's "not ops" branch is reachable in development.
      return { ok: false, reason: 'not_ops' };
    }
    if (password.length < 8) return { ok: false, reason: 'bad_credentials' };

    // ⚠️ The stub demands the second factor too. A development path that signs
    // straight in would leave the 2FA branch of the screen unexercised until
    // the first real operator hit it, which is the worst moment to discover it
    // does not render — and it would quietly teach whoever builds here next
    // that 2FA is optional.
    return { ok: false, reason: 'needs_second_factor', factorId: DevOpsAuth.DEV_FACTOR };
  }

  async verifySecondFactor(factorId: string, code: string): Promise<SignInResult> {
    if (factorId !== DevOpsAuth.DEV_FACTOR) return { ok: false, reason: 'transport_failed' };
    if (code !== DevOpsAuth.DEV_TOTP) return { ok: false, reason: 'bad_credentials' };

    this.signedIn = true;
    return { ok: true, operator: DevOpsAuth.OPERATOR };
  }

  async currentOperator(): Promise<Operator | null> {
    return this.signedIn ? DevOpsAuth.OPERATOR : null;
  }

  async signOut(): Promise<void> {
    this.signedIn = false;
  }
}

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

export const opsAuth: OpsAuth =
  url !== '' && key !== '' ? new SupabaseOpsAuth(createClient(url, key)) : new DevOpsAuth();
