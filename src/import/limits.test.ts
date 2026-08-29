import {
  DOCUMENT_IMPORT_BROWSER_SUPPORT,
  DOCUMENT_IMPORT_LIMITS,
  DOCUMENT_IMPORT_LIMIT_EVIDENCE,
} from './limits'

test('browser import guardrails are the conservative bounds selected from the committed matrix', () => {
  expect(DOCUMENT_IMPORT_LIMITS).toEqual({
    maximumInputBytes: 16 * 1024 * 1024,
    inputWarningBytes: 8 * 1024 * 1024,
    maximumPdfPages: 200,
    maximumAssetCount: 64,
    maximumAssetBytes: 8 * 1024 * 1024,
    maximumIndividualAssetBytes: 4 * 1024 * 1024,
    maximumAssetPixels: 40_000_000,
    parserTimeoutMs: 30_000,
    maximumWasmMemoryBytes: 128 * 1024 * 1024,
  })
  expect(DOCUMENT_IMPORT_LIMIT_EVIDENCE).toMatchObject({
    report: 'docs/evidence/document-parser-benchmark-2026-08-29.json',
    slowestSuccessfulParseMs: 4229,
    largestMeasuredWasmMemoryBytes: 97_845_248,
    measuredPdfPages: 200,
    measuredAssetCount: 64,
  })
  // The classification pass is a fraction of the whole parse in every profile,
  // which is what makes putting the page budget ahead of extraction affordable.
  for (const engine of ['chrome', 'firefox', 'webkit'] as const) {
    expect(DOCUMENT_IMPORT_LIMIT_EVIDENCE.measuredPdfDetectMs[engine])
      .toBeLessThan(DOCUMENT_IMPORT_LIMIT_EVIDENCE.measuredPdfParseMs[engine] / 4)
  }
  expect(DOCUMENT_IMPORT_BROWSER_SUPPORT).toEqual({
    supportedReleaseProfiles: ['chrome-desktop', 'firefox-desktop'],
    unsupported: ['safari', 'mobile'],
  })
})
