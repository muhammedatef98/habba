/**
 * Response headers for every page, the console and the public /legal pages
 * alike.
 *
 * The console acts with an operator's session: suspend accounts, refund,
 * erase. A page that can be framed can be clickjacked — another site shows it
 * invisibly and steers the operator's clicks — so no page here may be framed,
 * by anyone (frame-ancestors, and X-Frame-Options for older browsers). The
 * rest closes what the console never uses: plugins, a <base> that re-points
 * relative URLs, forms posting elsewhere, the camera and microphone, and
 * sending the console's URLs (with order ids in the hash) to other sites.
 *
 * Scripts and styles are not restricted to a list: Next's own inline runtime
 * and the Google Fonts stylesheet would need nonces threaded through every
 * render. What is here is what can be enforced identically in development
 * and on Vercel — there is no production-only branch (CLAUDE.md §5.1.6).
 */
export const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @habba/ui and @habba/core ship TypeScript sources rather than a build step;
  // Next has to compile them like first-party code.
  transpilePackages: ['@habba/ui', '@habba/core', '@habba/i18n'],
  // No "X-Powered-By: Next.js": it tells a visitor what to look up.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
