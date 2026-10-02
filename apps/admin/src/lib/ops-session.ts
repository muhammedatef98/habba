/**
 * Who is operating the console, and how far through signing in they are.
 *
 * ⚠️ READ THIS BEFORE TRUSTING ANYTHING HERE. This module decides what the UI
 * shows. It is NOT the security boundary and must never be treated as one.
 *
 * The boundary is `is_ops()` in the database (0068): an operator role, AND a
 * second factor verified in this session, AND within the last eight hours.
 * Someone who skips these screens reaches an API that returns them nothing
 * and accepts nothing. What this module is for is walking a real operator
 * through the same three conditions the server checks, in order, so they are
 * never shown controls that would fail:
 *
 *   signed_out → password → enrol (first time) or verify → ready
 *
 * CLAUDE.md §5.1.6: 2FA is mandatory, sessions last eight hours, and there is
 * no "remember me". The session lives in sessionStorage, so closing the
 * browser ends it, and the server's eight hours run from the second factor —
 * after which is_ops() is false and this module sends the operator back to
 * verify.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type OpsRole = 'ops' | 'super_admin';

export interface Operator {
  readonly id: string;
  readonly email: string | null;
  readonly fullName: string;
  readonly role: OpsRole;
  /** When the server stops treating this session as ops (0068). */
  readonly expiresAt: Date;
}

export interface TotpEnrolment {
  readonly factorId: string;
  /** An `image/svg+xml` data URI, ready for an <img>. */
  readonly qrCode: string | null;
  /** For typing in by hand when the camera is not an option. */
  readonly secret: string;
}

export type OpsState =
  | { readonly stage: 'signed_out' }
  | { readonly stage: 'enrol'; readonly enrolment: TotpEnrolment }
  | { readonly stage: 'verify'; readonly factorId: string }
  | { readonly stage: 'ready'; readonly operator: Operator };

export type SignInResult =
  | { readonly ok: true; readonly state: OpsState }
  | { readonly ok: false; readonly reason: 'bad_credentials' | 'not_ops' | 'transport_failed' };

export type VerifyResult =
  | { readonly ok: true; readonly state: OpsState }
  | { readonly ok: false; readonly reason: 'bad_code' | 'transport_failed' };

export interface OpsAuth {
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Where an already-open tab stands, re-read from the server. */
  current(): Promise<OpsState>;
  verify(factorId: string, code: string): Promise<VerifyResult>;
  signOut(): Promise<void>;
}

interface WhoAmI {
  readonly role: OpsRole | null;
  readonly session_ok: boolean;
  readonly expires_at: string | null;
}

class SupabaseOpsAuth implements OpsAuth {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error !== null || data.session === null) return { ok: false, reason: 'bad_credentials' };

    try {
      const state = await this.resolve();
      if (state === 'not_ops') {
        // ⚠️ Sign the session out again. A non-ops user who authenticates is
        // still authenticated; leaving the session would hand the console's
        // own fetches a customer's token, and every refusal would look like a
        // bug rather than a refusal.
        await this.client.auth.signOut();
        return { ok: false, reason: 'not_ops' };
      }
      return { ok: true, state };
    } catch {
      return { ok: false, reason: 'transport_failed' };
    }
  }

  async current(): Promise<OpsState> {
    const { data } = await this.client.auth.getSession();
    if (data.session === null) return { stage: 'signed_out' };
    try {
      const state = await this.resolve();
      if (state === 'not_ops') {
        await this.client.auth.signOut();
        return { stage: 'signed_out' };
      }
      return state;
    } catch {
      return { stage: 'signed_out' };
    }
  }

  async verify(factorId: string, code: string): Promise<VerifyResult> {
    const { error } = await this.client.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });
    if (error !== null) return { ok: false, reason: 'bad_code' };
    try {
      const state = await this.resolve();
      return state === 'not_ops' ? { ok: false, reason: 'transport_failed' } : { ok: true, state };
    } catch {
      return { ok: false, reason: 'transport_failed' };
    }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  /**
   * The server says whether this is an operator and whether the session
   * counts yet (ops_whoami, 0068). The role comes from `user_roles` on every
   * call, not from the token, so revoking someone takes effect on their next
   * action rather than at token expiry.
   */
  private async resolve(): Promise<OpsState | 'not_ops'> {
    const who = await this.client.rpc('ops_whoami').single<WhoAmI>();
    if (who.error !== null) throw new Error(who.error.message);
    if (who.data.role === null) return 'not_ops';

    if (who.data.session_ok && who.data.expires_at !== null) {
      return { stage: 'ready', operator: await this.operator(who.data.role, who.data.expires_at) };
    }

    const factors = await this.client.auth.mfa.listFactors();
    if (factors.error !== null) throw new Error(factors.error.message);

    const verified = factors.data.totp.find((factor) => factor.status === 'verified');
    if (verified !== undefined) return { stage: 'verify', factorId: verified.id };

    // First sign-in: set up the authenticator. Half-finished enrolments from
    // an abandoned attempt are cleared first, or they accumulate and the next
    // enrolment is refused.
    for (const factor of factors.data.all) {
      if (factor.status !== 'verified')
        await this.client.auth.mfa.unenroll({ factorId: factor.id });
    }
    const enrolled = await this.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Habba ops console',
    });
    if (enrolled.error !== null) throw new Error(enrolled.error.message);

    return {
      stage: 'enrol',
      enrolment: {
        factorId: enrolled.data.id,
        qrCode: enrolled.data.totp.qr_code ?? null,
        secret: enrolled.data.totp.secret,
      },
    };
  }

  private async operator(role: OpsRole, expiresAt: string): Promise<Operator> {
    const { data: session } = await this.client.auth.getSession();
    const user = session.session?.user;
    const profile = await this.client
      .from('profiles')
      .select('full_name')
      .eq('id', user?.id ?? '')
      .maybeSingle<{ full_name: string }>();

    return {
      id: user?.id ?? '',
      email: user?.email ?? null,
      fullName: profile.data?.full_name ?? user?.email ?? '',
      role,
      expiresAt: new Date(expiresAt),
    };
  }
}

/**
 * Development stand-in, walking the same steps with fixed answers: the
 * operator is ops@habba.sa with any password of eight or more characters, and
 * the authenticator code is 123456. The first sign-in in a tab enrols; later
 * ones verify — so both screens are reachable before a project exists.
 */
class DevOpsAuth implements OpsAuth {
  private static readonly EMAIL = 'ops@habba.sa';
  private static readonly CODE = '123456';
  private enrolled = false;
  private state: OpsState = { stage: 'signed_out' };

  async signIn(email: string, password: string): Promise<SignInResult> {
    if (email.trim().toLowerCase() !== DevOpsAuth.EMAIL) return { ok: false, reason: 'not_ops' };
    if (password.length < 8) return { ok: false, reason: 'bad_credentials' };

    this.state = this.enrolled
      ? { stage: 'verify', factorId: 'dev-factor' }
      : {
          stage: 'enrol',
          enrolment: { factorId: 'dev-factor', qrCode: null, secret: 'JBSWY3DPEHPK3PXP' },
        };
    return { ok: true, state: this.state };
  }

  async current(): Promise<OpsState> {
    if (this.state.stage === 'ready' && this.state.operator.expiresAt.getTime() <= Date.now()) {
      this.state = { stage: 'verify', factorId: 'dev-factor' };
    }
    return this.state;
  }

  async verify(_factorId: string, code: string): Promise<VerifyResult> {
    if (code.trim() !== DevOpsAuth.CODE) return { ok: false, reason: 'bad_code' };
    this.enrolled = true;
    this.state = {
      stage: 'ready',
      operator: {
        id: 'ops-dev-1',
        email: DevOpsAuth.EMAIL,
        fullName: 'مشغّل التطوير',
        role: 'ops',
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      },
    };
    return { ok: true, state: this.state };
  }

  async signOut(): Promise<void> {
    this.state = { stage: 'signed_out' };
  }
}

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

function browserClient(): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No "remember me" (§5.1.6): the session ends with the browser tab's
      // session, not whenever a refresh token finally lapses.
      ...(typeof window === 'undefined' ? {} : { storage: window.sessionStorage }),
    },
  });
}

/** The same client the data layer uses, so its requests carry this session. */
export const opsClient: SupabaseClient | null = url !== '' && key !== '' ? browserClient() : null;

export const opsAuth: OpsAuth =
  opsClient !== null ? new SupabaseOpsAuth(opsClient) : new DevOpsAuth();
