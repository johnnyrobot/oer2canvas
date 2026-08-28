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
    parserTimeoutMs: 30_000,
    maximumWasmMemoryBytes: 128 * 1024 * 1024,
  })
  expect(DOCUMENT_IMPORT_LIMIT_EVIDENCE).toMatchObject({
    report: 'docs/evidence/document-parser-benchmark-2026-08-27.json',
    slowestSuccessfulParseMs: 4300,
    largestMeasuredWasmMemoryBytes: 97_845_248,
    measuredPdfPages: 200,
    measuredAssetCount: 64,
  })
  expect(DOCUMENT_IMPORT_BROWSER_SUPPORT).toEqual({
    benchmarkedDesktopProfiles: ['chrome-desktop', 'firefox-desktop', 'webkit-desktop'],
    safari: 'not-release-validated',
    mobile: 'not-release-validated',
    releaseRequirement: expect.stringMatching(/Safari.*physical mobile-class devices/i),
  })
})
