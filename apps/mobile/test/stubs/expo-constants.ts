/**
 * Test stub for `expo-constants`.
 *
 * The real module pulls in React Native, whose source is Flow-typed and which
 * Vitest cannot parse. Only one thing is read from it — `expoConfig.extra` —
 * and this stub supplies it empty, which is also the shape a build with no
 * flags configured has.
 *
 * That default matters: with no `extra`, `isProviderModeEnabled()` is false, so
 * anything that depends on the flag is tested in its shipped state rather than
 * an imagined one.
 */

export default { expoConfig: { extra: {} } };
