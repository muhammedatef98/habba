import { describe, expect, test } from 'vitest';
import { findLeaks, findPublicSecretNames } from './check-client-bundle.mjs';

function jwt(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature_part`;
}

describe('the client bundle check', () => {
  test('passes a bundle carrying only the public anon key', () => {
    expect(findLeaks(`const key = "${jwt({ role: 'anon', iss: 'supabase' })}";`)).toEqual([]);
  });

  test('catches a legacy service key by what its payload says', () => {
    expect(findLeaks(`const k = "${jwt({ role: 'service_role' })}"`)).toContain(
      'contains a service_role JWT',
    );
  });

  test('catches a new-style secret key and the variable names', () => {
    expect(findLeaks('x="sb_secret_abcdefghijklmnop"')).toContain('contains an sb_secret_ key');
    expect(findLeaks('process.env.SUPABASE_SERVICE_ROLE_KEY')).toContain(
      'references SUPABASE_SERVICE_ROLE_KEY',
    );
  });

  test('catches the configured key verbatim, whatever its shape', () => {
    const secret = 'an-opaque-key-in-some-future-format-0123';
    expect(findLeaks(`k="${secret}"`, [secret])).toContain('contains the service key itself');
  });

  test('refuses a NEXT_PUBLIC_ variable named like a secret', () => {
    expect(findPublicSecretNames('process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY')).toHaveLength(1);
    expect(findPublicSecretNames('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')).toHaveLength(0);
  });
});
