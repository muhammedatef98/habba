/**
 * Image assets resolved by Metro, declared once for the whole workspace.
 *
 * This lives at the root rather than inside @habba/ui because consumers compile
 * that package's sources directly: an ambient declaration inside the package is
 * not in the app's program, so the package typechecked while every app that
 * imported it failed. Referencing it per-file is the other way to solve that,
 * and the lint config forbids triple-slash references.
 *
 * Metro rewrites the import into an opaque registry id, so `number` is the
 * honest type — it is a handle, not a path.
 */
declare module '*.png' {
  const asset: number;
  export default asset;
}
