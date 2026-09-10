/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @habba/ui and @habba/core ship TypeScript sources rather than a build step;
  // Next has to compile them like first-party code.
  transpilePackages: ['@habba/ui', '@habba/core', '@habba/i18n'],
};

export default nextConfig;
