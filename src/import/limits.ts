/**
 * Browser parser budgets selected from the committed 2026-08-27 desktop
 * Chrome/Firefox release matrix. These are browser application limits, not
 * Cloudflare limits: source bytes never reach a Worker deployment.
 */
export const DOCUMENT_IMPORT_LIMITS = PARSER_PROBE_LIMITS

export const DOCUMENT_IMPORT_LIMIT_EVIDENCE = {
  report: 'docs/evidence/document-parser-benchmark-2026-08-27.json',
  slowestSuccessfulParseMs: 4287,
  largestMeasuredWasmMemoryBytes: 97_845_248,
  measuredInputBytes: 16_777_205,
  measuredPdfPages: 200,
  measuredAssetCount: 64,
  measuredAssetBytes: 8_388_592,
  measuredLargestAssetBytes: 4_194_304,
} as const

/**
 * This ticket proves parser feasibility; later format tickets enable the UI.
 * The initial release matrix intentionally excludes Safari and mobile browsers.
 */
export const DOCUMENT_IMPORT_BROWSER_SUPPORT = {
  supportedReleaseProfiles: ['chrome-desktop', 'firefox-desktop'],
  unsupported: ['safari', 'mobile'],
} as const
import { PARSER_PROBE_LIMITS } from './parser-limit-values'
