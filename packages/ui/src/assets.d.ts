/**
 * Image assets resolved by Metro.
 *
 * Without this, PNG imports have no type and the only way to load them is
 * `require()`, which the lint config forbids. Metro turns the import into an
 * opaque asset reference, so `number` is the honest type — it is a registry id,
 * not a path.
 */
declare module '*.png' {
  const asset: number;
  export default asset;
}
