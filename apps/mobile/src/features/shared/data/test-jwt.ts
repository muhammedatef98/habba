/**
 * HS256 JWT minting, for integration tests only.
 *
 * Supabase's GoTrue issues these in production. The local harness has no
 * GoTrue (it needs Docker), so tests mint the same shape of token directly and
 * PostgREST verifies it with the shared secret — which means role switching
 * and RLS are exercised for real, not simulated.
 *
 * Hand-rolled rather than pulling in a JWT library: it is ~20 lines, it is
 * test-only, and adding a dependency for it would be the larger cost.
 */

import { createHmac } from 'node:crypto';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface TestJwtClaims {
  readonly sub: string;
  readonly role: 'authenticated' | 'anon';
  readonly expiresInSeconds?: number;
}

export function mintTestJwt(secret: string, claims: TestJwtClaims): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);

  const payload = base64url(
    JSON.stringify({
      sub: claims.sub,
      role: claims.role,
      iat: now,
      exp: now + (claims.expiresInSeconds ?? 3600),
    }),
  );

  const signature = base64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());

  return `${header}.${payload}.${signature}`;
}
