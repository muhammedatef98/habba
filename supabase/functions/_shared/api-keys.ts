// GENERATED FILE — DO NOT EDIT.
// Source: packages/core/src/supabase/api-keys.ts
// Regenerate: ./supabase/scripts/sync-edge-shared.sh
//
// Edge Functions run on Deno and cannot import pnpm workspace packages, so
// this module is vendored here. CI runs this script with --check, so drift
// fails the build rather than quietly shipping stale behaviour.

/**
 * Telling Supabase's two generations of API key apart, and sending each the way
 * it has to be sent.
 *
 * Legacy `anon` and `service_role` keys are JWTs signed with the project's JWT
 * secret. The new publishable (`sb_publishable_…`) and secret (`sb_secret_…`)
 * keys are opaque strings, independent of the signing key — which is the whole
 * reason to move to them: a leaked key can then be revoked on its own, without
 * rotating the secret that signs every user's session.
 *
 * The difference is not cosmetic at the wire level. supabase-js sends the key
 * on BOTH `apikey` and `Authorization: Bearer`. For a JWT key that is correct.
 * For a secret key the platform tries to parse the bearer token as a JWT and
 * rejects the request with `Invalid JWT` — so a swap that changes only the
 * value of an environment variable fails on the first request, and fails in a
 * way that reads like an auth bug rather than a header bug.
 *
 * Everything here is deliberately shaped so the same code is correct before and
 * after the swap: a JWT key keeps supabase-js's default behaviour untouched.
 */

/**
 * True for a key the platform will accept as a bearer token.
 *
 * Structural, not a prefix check on `sb_`: what matters is whether the string
 * is a JWT, and a future key format that is neither today's shape would still
 * be classified correctly. Three non-empty dot-separated segments beginning
 * with a base64url-encoded `{"alg"…` header is the JWT wire format.
 */
export function isJwtApiKey(key: string): boolean {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  if (parts.some((part) => part.length === 0)) return false;
  // `eyJ` is base64url for `{"`, which every JWT header begins with.
  return parts[0]?.startsWith('eyJ') === true;
}

export interface SecretKeySource {
  /**
   * `SUPABASE_SECRET_KEYS` as Supabase injects it into an Edge Function: a JSON
   * object of key name → secret key, not a bare string.
   */
  readonly secretKeys?: string | undefined;
  /** `SUPABASE_SERVICE_ROLE_KEY`, the legacy single value. */
  readonly legacy?: string | undefined;
  /** Which named key to use. Supabase creates `default` on migration. */
  readonly name?: string | undefined;
}

/**
 * Picks the secret key to use, preferring the new keys when the project has
 * them.
 *
 * Both variables are present on a migrated project, so preferring the new one
 * means a function starts using it the moment the project is migrated, with no
 * redeploy — and keeps working on a project that has not migrated yet. That
 * ordering is what lets the legacy key be disabled without a synchronised
 * deploy.
 *
 * Returns an empty string when neither is available rather than throwing: the
 * callers here are servers that must decide for themselves how to fail, and a
 * module-scope throw would take the whole function down at import time.
 */
export function resolveSecretKey(source: SecretKeySource): string {
  const name = source.name ?? 'default';

  if (source.secretKeys !== undefined && source.secretKeys !== '') {
    try {
      const parsed: unknown = JSON.parse(source.secretKeys);
      if (typeof parsed === 'object' && parsed !== null) {
        const value = (parsed as Record<string, unknown>)[name];
        if (typeof value === 'string' && value !== '') return value;
      }
    } catch {
      // Malformed JSON falls through to the legacy key. A broken variable
      // should not be more fatal than an absent one.
    }
  }

  return source.legacy ?? '';
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Wraps `fetch` so a non-JWT secret key travels on `apikey` alone.
 *
 * For a JWT key this returns the given fetch unchanged — supabase-js's default
 * headers are already right, and a wrapper that rewrote them would be a second
 * thing to keep correct.
 *
 * Pass the result as `global.fetch` to `createClient`. Overriding
 * `global.headers` instead does not work: supabase-js would still send its own
 * `Authorization`, and an empty-string header is not the same as an absent one.
 */
export function apiKeyOnlyFetch(key: string, inner: FetchLike): FetchLike {
  if (isJwtApiKey(key)) return inner;

  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('Authorization');
    headers.set('apikey', key);
    return inner(input, { ...init, headers });
  };
}
