import { probeParser } from './probe'
import {
  encryptedPdfFixture,
  malformedPdfFixture,
  pdfFixture,
  pdfFixturePages,
} from '../testing/pdf-fixture'

test('real module workers run both local parsers and return probe evidence', async () => {
  const phases: string[] = []
  const rtf = new TextEncoder().encode('{\\rtf1\\ansi\\fs32 Worker probe\\par\\fs24 Browser-only text.}').buffer
  const anydoc = await probeParser({
    parser: 'anydoc',
    bytes: rtf,
    formatHint: 'rtf',
    onProgress: (progress) => phases.push(progress.phase),
  })

  expect(rtf.byteLength).toBe(0)
  expect(anydoc).toMatchObject({
    parser: 'anydoc',
    parserVersion: '0.2.4',
    detectedFormat: 'rtf',
    counts: { blocks: expect.any(Number), assets: 0 },
  })
  expect(anydoc.counts.blocks).toBeGreaterThan(0)
  expect(anydoc.wasmMemoryBytes).toBeGreaterThan(0)
  expect(phases).toEqual(['loading-parser', 'parser-ready', 'parsing', 'complete'])
  const pdf = pdfFixture(1, 'PDF Inspector probe').buffer
  const inspected = await probeParser({ parser: 'pdf-inspector', bytes: pdf, formatHint: 'pdf' })
  expect(pdf.byteLength).toBe(0)
  expect(inspected).toMatchObject({
    parser: 'pdf-inspector',
    parserVersion: expect.any(String),
    detectedFormat: 'pdf',
    pageCount: 1,
    pagesNeedingOcr: [],
  })
  expect(inspected.outputBytes).toBeGreaterThan(0)
  expect(inspected.wasmMemoryBytes).toBeGreaterThan(0)
})

test('a real parser failure leaves a clean retry path', async () => {
  await expect(probeParser({
    parser: 'anydoc',
    bytes: new TextEncoder().encode('not a supported document').buffer,
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'unsupported' })

  await expect(probeParser({
    parser: 'anydoc',
    bytes: new TextEncoder().encode('{\\rtf1 Retry works.}').buffer,
    formatHint: 'rtf',
  })).resolves.toMatchObject({ parser: 'anydoc', detectedFormat: 'rtf' })
})

/*
 * The runtime shape every later PDF decision rests on, asserted against the real
 * module rather than read from its `.d.ts`. `pdfType` COULD have been serialised
 * snake_case, the marker text could have been anything, and the image
 * placeholder's alt could have been a caption. It is none of those, and this is
 * where a version bump says so.
 */
test('the pdf module reports pages, figures and scanned pages the way this feature assumes', async () => {
  const bytes = pdfFixturePages(['text', 'text-and-figure', 'scanned', 'blank']).buffer
  const inspected = await probeParser({ parser: 'pdf-inspector', bytes, formatHint: 'pdf' })

  expect(inspected.detection).toMatchObject({
    pdfType: 'Mixed',
    pageCount: 4,
    pagesNeedingOcr: [3],
    ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }],
  })
  // 0-1, and for a TextBased document it tracked the fraction of pages that
  // produced text in every measurement. Asserted as a RANGE, because nothing
  // upstream documents it and no threshold may be built on it.
  expect(inspected.detection!.confidence).toBeGreaterThan(0)
  expect(inspected.detection!.confidence).toBeLessThanOrEqual(1)

  const markdown = inspected.markdown ?? ''
  // Pages 3 and 4 produced no text, so they produced NO MARKER. The numbers are
  // read, never counted.
  expect(markdown.match(/<!-- Page \d+ -->/g)).toEqual(['<!-- Page 1 -->', '<!-- Page 2 -->'])
  // `includeImages` is on, and this is the exact placeholder form it emits: the
  // alt is the PDF XObject's resource name, and the "url" is the literal word.
  expect(markdown).toContain('![Image: Im1](image)')
})

test('encrypted and malformed pdfs keep their distinct, correctly retryable failures', async () => {
  // `encrypted` must stay NON-retryable: `actionableFailure` decides that from
  // the code, and the code is decided by a regex over an English error message.
  // If an upstream wording change ever downgraded this to `parse-failed`, the
  // user would be told to retry a file that can never succeed.
  await expect(probeParser({
    parser: 'pdf-inspector', bytes: encryptedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'encrypted', retryable: false })

  await expect(probeParser({
    parser: 'pdf-inspector', bytes: malformedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'malformed', retryable: true })
})
