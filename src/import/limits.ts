/**
 * Browser parser budgets selected from the committed 2026-08-27 desktop
 * Chrome/Firefox release matrix. These are browser application limits, not
 * Cloudflare limits: source bytes never reach a Worker deployment.
 *
 * "Selected from the benchmark" is true of every budget the benchmark measured,
 * which is every budget with a `measured*` counterpart in
 * `DOCUMENT_IMPORT_LIMIT_EVIDENCE` below. `maximumAssetPixels` is the one
 * exception and has no entry there: it bounds a DECODED bitmap, which the
 * benchmark never exercised, and is reasoned rather than measured.
 */
export const DOCUMENT_IMPORT_LIMITS = PARSER_PROBE_LIMITS

export const DOCUMENT_IMPORT_LIMIT_EVIDENCE = {
  report: 'docs/evidence/document-parser-benchmark-2026-08-29.json',
  slowestSuccessfulParseMs: 4229,
  largestMeasuredWasmMemoryBytes: 97_845_248,
  measuredInputBytes: 16_777_205,
  measuredPdfPages: 200,
  measuredAssetCount: 64,
  measuredAssetBytes: 8_388_592,
  measuredLargestAssetBytes: 4_194_304,
  /*
   * The PDF parse is TWO module passes — classify, then extract — so the page
   * budget can refuse a document before its text is built. This is what that
   * costs, on the 200-page fixture, as a share of the whole parse:
   * Chrome 19.6 of 178.1 ms, Firefox 73 of 912 ms, WebKit 24 of 194 ms.
   * Roughly a tenth, which is what the design predicted from Node.
   */
  measuredPdfDetectMs: { chrome: 19.6, firefox: 73, webkit: 24 },
  measuredPdfParseMs: { chrome: 178.1, firefox: 912, webkit: 194 },
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
