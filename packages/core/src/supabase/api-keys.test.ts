import { describe, expect, test } from 'vitest';
import { apiKeyOnlyFetch, isJwtApiKey, resolveSecretKey } from './api-keys.js';

/** A real-shaped legacy key: three base64url segments, header first. */
const LEGACY_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';

describe('isJwtApiKey', () => {
  test('a legacy anon/service_role key is a JWT', () => {
    expect(isJwtApiKey(LEGACY_JWT)).toBe(true);
  });

  test('the new keys are not', () => {
    expect(isJwtApiKey('sb_secret_abcdefghijklmnop')).toBe(false);
    expect(isJwtApiKey('sb_publishable_abcdefghijklmnop')).toBe(false);
  });

  test('near-misses are not, either', () => {
    expect(isJwtApiKey('')).toBe(false);
    expect(isJwtApiKey('a.b')).toBe(false);
    expect(isJwtApiKey('a.b.c.d')).toBe(false);
    // Three segments, but no JWT header — a secret key that happens to contain
    // dots must not be sent as a bearer token.
    expect(isJwtApiKey('sb_secret.with.dots')).toBe(false);
    // Empty middle segment: structurally three parts, not a token.
    expect(isJwtApiKey('eyJhbGciOiJIUzI1NiJ9..signature')).toBe(false);
  });
});

describe('resolveSecretKey', () => {
  test('prefers a new secret key over the legacy one', () => {
    expect(
      resolveSecretKey({
        secretKeys: JSON.stringify({ default: 'sb_secret_new' }),
        legacy: LEGACY_JWT,
      }),
    ).toBe('sb_secret_new');
  });

  test('falls back to the legacy key on a project that has not migrated', () => {
    expect(resolveSecretKey({ secretKeys: undefined, legacy: LEGACY_JWT })).toBe(LEGACY_JWT);
    expect(resolveSecretKey({ secretKeys: '', legacy: LEGACY_JWT })).toBe(LEGACY_JWT);
  });

  test('reads a named key', () => {
    expect(
      resolveSecretKey({
        secretKeys: JSON.stringify({ default: 'sb_secret_a', sms: 'sb_secret_b' }),
        name: 'sms',
      }),
    ).toBe('sb_secret_b');
  });

  test('a name that is not there falls back rather than returning undefined', () => {
    expect(
      resolveSecretKey({
        secretKeys: JSON.stringify({ default: 'sb_secret_a' }),
        legacy: LEGACY_JWT,
        name: 'billing',
      }),
    ).toBe(LEGACY_JWT);
  });

  test('malformed JSON is not more fatal than an absent variable', () => {
    expect(resolveSecretKey({ secretKeys: '{not json', legacy: LEGACY_JWT })).toBe(LEGACY_JWT);
    expect(resolveSecretKey({ secretKeys: '"a string"', legacy: LEGACY_JWT })).toBe(LEGACY_JWT);
  });

  test('neither available is an empty string, not a throw', () => {
    expect(resolveSecretKey({})).toBe('');
  });
});

describe('apiKeyOnlyFetch', () => {
  function capture(): { calls: Headers[]; fetch: typeof globalThis.fetch } {
    const calls: Headers[] = [];
    const fetchLike = (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(new Headers(init?.headers));
      return Promise.resolve(new Response('{}'));
    };
    return { calls, fetch: fetchLike as typeof globalThis.fetch };
  }

  test('a JWT key is left entirely alone', () => {
    const { fetch } = capture();
    expect(apiKeyOnlyFetch(LEGACY_JWT, fetch)).toBe(fetch);
  });

  test('a secret key drops Authorization and sets apikey', async () => {
    const { calls, fetch } = capture();
    const wrapped = apiKeyOnlyFetch('sb_secret_xyz', fetch);

    await wrapped('https://example.supabase.co/rest/v1/cities', {
      headers: { Authorization: 'Bearer sb_secret_xyz', 'content-type': 'application/json' },
    });

    const sent = calls[0];
    expect(sent?.has('Authorization')).toBe(false);
    expect(sent?.get('apikey')).toBe('sb_secret_xyz');
    // Everything else survives — this rewrites two headers, not the request.
    expect(sent?.get('content-type')).toBe('application/json');
  });

  test('the header name is matched case-insensitively, as HTTP requires', async () => {
    const { calls, fetch } = capture();
    const wrapped = apiKeyOnlyFetch('sb_secret_xyz', fetch);

    await wrapped('https://example.supabase.co/', {
      headers: { authorization: 'Bearer sb_secret_xyz' },
    });

    expect(calls[0]?.has('authorization')).toBe(false);
  });

  test('works when the caller sent no headers at all', async () => {
    const { calls, fetch } = capture();
    await apiKeyOnlyFetch('sb_secret_xyz', fetch)('https://example.supabase.co/');
    expect(calls[0]?.get('apikey')).toBe('sb_secret_xyz');
  });
});
