/**
 * Shared executable boundaries for the browser probe and its production-build
 * benchmark. Keeping the fixture sizes here prevents evidence from silently
 * exercising a stale value after a guardrail changes.
 *
 * NOT EVERY VALUE HERE IS A FIXTURE SIZE. `maximumAssetPixels` is a reasoned
 * bound with no benchmark fixture and no `DOCUMENT_IMPORT_LIMIT_EVIDENCE`
 * entry — see its own comment. Only the values the benchmark actually exercises
 * appear in that evidence record.
 */
export const PARSER_PROBE_LIMITS = Object.freeze({
  maximumInputBytes: 16 * 1024 * 1024,
  inputWarningBytes: 8 * 1024 * 1024,
  maximumPdfPages: 200,
  maximumAssetCount: 64,
  maximumAssetBytes: 8 * 1024 * 1024,
  maximumIndividualAssetBytes: 4 * 1024 * 1024,
  /*
   * A bound on the DECODED bitmap of ONE image, which the byte budgets do not
   * give. Compression means a small file can declare an enormous image: a
   * flat-colour PNG well under `maximumIndividualAssetBytes` can claim
   * 20000x20000 and decode to roughly 1.6 GB of RGBA when the preview renders
   * it.
   *
   * 40 MP is about 8000x5000 — comfortably beyond any legitimate textbook
   * figure or full-page scan, while capping ONE image's decoded RGBA near
   * 160 MB.
   *
   * TWO LIMITS OF THAT BOUND, stated because an earlier version of this comment
   * implied more than it delivers. First, it binds only where the size we sniff
   * is the size the browser decodes; `sniffRaster` earns that for JPEG by
   * refusing any marker chain it cannot walk the way libjpeg does, rather than
   * guessing (see `jpeg()` in `src/import/assets.ts`). Second, it is PER IMAGE
   * and nothing caps the document total: `maximumAssetCount` (64) images each
   * just under this cap declare ~2.5 Gpx together. That aggregate is a known,
   * deliberate residual — recorded in the issue's `## Answer` and the design's
   * Non-goals — not something this constant covers.
   *
   * Unlike the byte and count budgets above, this is a REASONED bound, not a
   * measured one: it has no `DOCUMENT_IMPORT_LIMIT_EVIDENCE` entry and no
   * benchmark fixture, because no legitimate document was ever observed near it.
   */
  maximumAssetPixels: 40_000_000,
  parserTimeoutMs: 30_000,
  maximumWasmMemoryBytes: 128 * 1024 * 1024,
})
