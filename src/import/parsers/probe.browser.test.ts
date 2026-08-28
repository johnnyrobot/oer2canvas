import { probeParser } from './probe'
import { pdfFixture } from '../testing/pdf-fixture'

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
