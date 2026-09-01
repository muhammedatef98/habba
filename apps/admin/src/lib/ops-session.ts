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
  | {
      readonly ok: false;
      readonly reason: 'bad_credentials' | 'not_ops' | 'transport_failed';
    };

export interface OpsAuth {
  signIn(email: string, password: string): Promise<SignInResult>;
  currentOperator(): Promise<Operator | null>;
  signOut(): Promise<void>;
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

    return { ok: true, operator };
  }

  async currentOperator(): Promise<Operator | null> {
    const { data } = await this.client.auth.getSession();
    if (data.session === null) return null;
    return this.operatorFor(data.session);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  /**
   * Reads the role from `profiles`, not from the JWT.
   *
   * A role baked into a token at sign-in stays true until the token expires,
   * so revoking someone's access would not take effect until then. Reading the
   * row means a revoked operator loses the console on their next action, which
   * is the behaviour anyone revoking access assumes they are getting.
   */
  private async operatorFor(session: Session): Promise<Operator | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error !== null || data === null) return null;

    const row = data as { id: string; full_name: string; email: string | null; role: string };
    if (row.role !== 'ops' && row.role !== 'super_admin') return null;

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
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

  private signedIn = false;

  async signIn(email: string, password: string): Promise<SignInResult> {
    if (email.trim().toLowerCase() !== DevOpsAuth.OPERATOR.email) {
      // Anything else is treated as a real account without the role, so the
      // screen's "not ops" branch is reachable in development.
      return { ok: false, reason: 'not_ops' };
    }
    if (password.length < 8) return { ok: false, reason: 'bad_credentials' };

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
