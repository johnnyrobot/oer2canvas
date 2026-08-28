// Type declaration for the plain-JS probe generator, so the shared raster
// fixtures (`src/import/testing/raster-fixtures.test.ts`) can import its
// `ASSETS` export without the app project falling back to `any`. Kept
// minimal — just the shape the fixture test actually reads — rather than
// mirroring the whole module, since this file exists only to satisfy the
// compiler, not to document the generator.
//
// Extension is `.d.mts`, not `.d.ts`: under this project's `bundler` module
// resolution, TypeScript only pairs a declaration file with an `.mjs`
// implementation file when the declaration itself is `.d.mts` — a plain
// `.d.ts` sibling is silently ignored and the import falls back to `any`.
export declare const ASSETS: ReadonlyArray<{
  path: string
  mediaType: string
  data: Uint8Array
}>
