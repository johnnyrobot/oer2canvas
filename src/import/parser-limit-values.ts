/**
 * Shared executable boundaries for the browser probe and its production-build
 * benchmark. Keeping the fixture sizes here prevents evidence from silently
 * exercising a stale value after a guardrail changes.
 */
export const PARSER_PROBE_LIMITS = Object.freeze({
  maximumInputBytes: 16 * 1024 * 1024,
  inputWarningBytes: 8 * 1024 * 1024,
  maximumPdfPages: 200,
  maximumAssetCount: 64,
  maximumAssetBytes: 8 * 1024 * 1024,
  maximumIndividualAssetBytes: 4 * 1024 * 1024,
  /*
   * A bound on the DECODED bitmap, which the byte budgets do not give.
   * Compression means a small file can declare an enormous image: a flat-colour
   * PNG well under `maximumIndividualAssetBytes` can claim 20000x20000 and
   * decode to roughly 1.6 GB of RGBA when the preview renders it.
   *
   * 40 MP is about 8000x5000 — comfortably beyond any legitimate textbook
   * figure or full-page scan, while capping decoded RGBA near 160 MB.
   */
  maximumAssetPixels: 40_000_000,
  parserTimeoutMs: 30_000,
  maximumWasmMemoryBytes: 128 * 1024 * 1024,
})
