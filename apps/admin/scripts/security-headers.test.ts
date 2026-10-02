import { describe, expect, test } from 'vitest';
import nextConfig, { securityHeaders } from '../next.config.mjs';

describe('security headers', () => {
  test('no page of the console can be framed', () => {
    const csp = securityHeaders.find((header) => header.key === 'Content-Security-Policy');
    expect(csp?.value).toContain("frame-ancestors 'none'");
    expect(securityHeaders).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
  });

  test('apply to every path, the public /legal pages included', async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }]);
  });
});
