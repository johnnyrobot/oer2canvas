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
  parserTimeoutMs: 30_000,
  maximumWasmMemoryBytes: 128 * 1024 * 1024,
})
