// Metro config for the pnpm monorepo — the standard Expo monorepo shape
// (https://docs.expo.dev/guides/monorepos/): watch the workspace root so
// changes in packages/* are picked up, and look up node_modules both locally
// and at the workspace root, since pnpm hoists shared deps there.
//
// Nothing in this repo has ever actually been bundled before (see the
// project history) — this file did not exist, so Metro had no path to
// `@habba/ui` or `@habba/core` at all beyond the app's own node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The workspace packages (@habba/core, @habba/ui, @habba/i18n) are TypeScript
// source consumed directly — no build step — and their internal imports use
// explicit `.js` extensions (e.g. `export * from './tokens.js'`), which is
// correct for `tsc`'s Node-style module resolution but not something Metro's
// resolver rewrites to `.ts` on its own. Retry a failed `.js` resolution
// against the extensionless specifier so Metro's normal `sourceExts`
// probing (which includes `ts`/`tsx`) finds the real file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
