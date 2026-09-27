/**
 * Test stub for `expo-constants`.
 *
 * The real module pulls in React Native, whose source is Flow-typed and which
 * Vitest cannot parse. Only `expoConfig.extra` is read from it, and this stub
 * supplies it empty, which is also the shape a build with nothing configured
 * has.
 */

export default { expoConfig: { extra: {} } };
