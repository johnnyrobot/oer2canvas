/**
 * Provisional parser-probe budgets selected from the committed 2026-08-27
 * Chrome/Firefox/WebKit desktop-engine matrix. Safari and physical mobile
 * validation remain release gates. These are browser application limits, not
 * Cloudflare limits: source bytes never reach a Worker deployment.
 */
export const DOCUMENT_IMPORT_LIMITS = PARSER_PROBE_LIMITS

export const DOCUMENT_IMPORT_LIMIT_EVIDENCE = {
  report: 'docs/evidence/document-parser-benchmark-2026-08-27.json',
  slowestSuccessfulParseMs: 4300,
  largestMeasuredWasmMemoryBytes: 97_845_248,
  measuredInputBytes: 16_777_205,
  measuredPdfPages: 200,
  measuredAssetCount: 64,
  measuredAssetBytes: 8_388_592,
  measuredLargestAssetBytes: 4_194_304,
} as const

/**
 * This ticket proves parser feasibility; it does not enable document import in
 * the release UI. These names describe the committed benchmark environments,
 * not a claim that Playwright WebKit is identical to shipping Safari.
 */
export const DOCUMENT_IMPORT_BROWSER_SUPPORT = {
  benchmarkedDesktopProfiles: ['chrome-desktop', 'firefox-desktop', 'webkit-desktop'],
  safari: 'not-release-validated',
  mobile: 'not-release-validated',
  releaseRequirement: 'Run the committed matrix in current Safari and on physical mobile-class devices before enabling document parsers.',
} as const
import { PARSER_PROBE_LIMITS } from './parser-limit-values'
