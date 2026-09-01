import { importPdfDocument } from './pdf'
import { MAX_TEXT_IMPORT_BYTES } from './text'
import type { ParserDetection, ParserProbeResult } from './parsers/probe'
import type { ImportMetadata } from './types'

const metadata: ImportMetadata = {
  title: 'Chapter one',
  rightsAuthority: 'own',
  rightsAcknowledged: true,
}

const detection = (over: Partial<ParserDetection> = {}): ParserDetection => ({
  pdfType: 'TextBased', pageCount: 1, confidence: 1, pagesNeedingOcr: [], ocrReasonsByPage: [],
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] }, ...over,
})

const pdfFile = () =>
  new File([new TextEncoder().encode('%PDF-1.4 fixture')], 'chapter.pdf', { type: 'application/pdf' })

let probeCalls = 0

/** A probe that answers with exactly what the module would have returned. */
function stub(over: { markdown?: string; detection?: ParserDetection; hasEncodingIssues?: boolean }) {
  return async (): Promise<ParserProbeResult> => {
    probeCalls += 1
    const markdown = over.markdown ?? ''
    return {
      parser: 'pdf-inspector',
      parserVersion: '1.17.0',
      detectedFormat: 'pdf',
      inputBytes: 16,
      outputBytes: new TextEncoder().encode(markdown).byteLength,
      parseMs: 4,
      counts: { blocks: 1, headings: 0, tables: 0, images: 0, assets: 0 },
      markdown,
      detection: over.detection ?? detection(),
      ...(over.hasEncodingIssues === undefined ? {} : { hasEncodingIssues: over.hasEncodingIssues }),
    }
  }
}

beforeEach(() => {
  probeCalls = 0
})

test('a file that is not a pdf is refused on its content, not its name', async () => {
  const file = new File([new TextEncoder().encode('%ZIP-1.4 nope')], 'chapter.pdf', { type: 'application/pdf' })
  await expect(importPdfDocument(file, { metadata, probe: stub({}) })).rejects.toThrow(/not a PDF/i)
  // Refused BEFORE a Worker started: no probe call was made at all.
  expect(probeCalls).toBe(0)
})

test('extracted text over the main-thread limit is refused, naming the limit', async () => {
  const oversize = 'x'.repeat(MAX_TEXT_IMPORT_BYTES + 1)
  await expect(importPdfDocument(pdfFile(), { metadata, probe: stub({ markdown: oversize }) }))
    .rejects.toThrow(/2 MiB/)
})

test('a text-based pdf becomes one section of sanitized html with a page count', async () => {
  const result = await importPdfDocument(pdfFile(), { metadata, probe: stub({
    markdown: '<!-- Page 1 -->\n\n# Chapter one\n\nText.\n\n<!-- Page 2 -->\n\nMore text.\n',
    detection: detection({ pageCount: 2 }),
  }) })
  expect(result.work.sections).toHaveLength(1)
  expect(result.work.sections[0]!.html).toContain('<h1>Chapter one</h1>')
  expect(result.work.sections[0]!.html).toContain('More text.')
  // Declared in `types.ts` since this issue was written and until now written nowhere.
  expect(result.report.pageCount).toBe(2)
  expect(result.report.parser).toBe('pdf-inspector')
  expect(result.work.assets).toEqual([])
})

test('a figure survives as a visible placeholder and a warning, and the page still publishes', async () => {
  const result = await importPdfDocument(pdfFile(), { metadata, probe: stub({
    markdown: '<!-- Page 1 -->\n\nBefore.\n\n![Image: Im1](image)\n\nAfter.\n',
    detection: detection({ pageCount: 1 }),
  }) })
  expect(result.work.sections[0]!.html).toContain('[Embedded image: Figure on page 1]')
  expect(result.report.findings.every((finding) => finding.severity === 'warning')).toBe(true)
  expect(result.report.counts.images).toBe(1)
  expect(result.report.counts.unavailableAssets).toBe(1)
})

test('a pdf with no readable text at all fails the import outright', async () => {
  // There is no page to edit, no plan to review and nothing to publish, so this
  // belongs in the importer's error path — where the anydoc importer puts the
  // same condition — rather than as a blocker on an empty plan.
  await expect(importPdfDocument(pdfFile(), { metadata, probe: stub({
    markdown: '', detection: detection({ pdfType: 'Scanned', pageCount: 3, pagesNeedingOcr: [1, 2, 3] }),
  }) })).rejects.toThrow(/OCR/)
})

test('a page that printed nothing does not raise a no-supported-content blocker', async () => {
  /*
   * A whitespace-only slice sanitizes to `import-no-supported-content`, which is
   * a BLOCKER, for what is simply a page that printed nothing. Skipping the
   * slice is what keeps a blank divider page from refusing the whole import —
   * the blank page still gets its own `pdf-page-empty` warning.
   */
  const result = await importPdfDocument(pdfFile(), { metadata, probe: stub({
    markdown: '<!-- Page 1 -->\n\nReal text.\n\n<!-- Page 2 -->\n\n   \n',
    detection: detection({ pageCount: 2 }),
  }) })
  expect(result.report.findings.map((finding) => finding.code)).not.toContain('import-no-supported-content')
  expect(result.report.findings.map((finding) => finding.code)).toContain('pdf-page-empty')
  expect(result.report.findings.every((finding) => finding.severity === 'warning')).toBe(true)
})

describe('recovered figures', () => {
  const image = (page: number, order: number) => ({
    page, order, mediaType: 'image/png', width: 2, height: 2,
    // A real 2x2 PNG: `prepareAssets` sniffs the header, so invented bytes
    // would be rejected and the test would pass for the wrong reason.
    data: Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYkBBpgAGiwCA/JQdvIAAAAASUVORK5CYII=',
    ), (c) => c.charCodeAt(0)),
  })

  it('packages a recovered figure and keeps the image in the html', async () => {
    const result = await importPdfDocument(pdfFile(), {
      metadata,
      probe: stub({
        markdown: '<!-- Page 1 -->\nSome prose.\n\n![Image: x](image)\n',
        detection: detection({ pageCount: 1 }),
      }),
      extractImages: async () => [image(1, 0)],
    })
    // The bytes reach the cartridge...
    expect(result.work.assets).toHaveLength(1)
    expect(result.report.counts.packagedAssetBytes).toBeGreaterThan(0)
    // ...and the html points at them rather than at the words "Embedded image".
    expect(result.work.sections[0]!.html).toMatch(/<img[^>]+\$IMS-CC-FILEBASE\$\/oer2canvas\//)
    expect(result.work.sections[0]!.html).not.toContain('[Embedded image')
    // ...so there is nothing left to warn about.
    expect(result.report.findings.find((f) => f.code === 'pdf-figure-not-imported')).toBeUndefined()
  })

  it('still warns about the figures it could NOT recover', async () => {
    const result = await importPdfDocument(pdfFile(), {
      metadata,
      probe: stub({
        markdown: '<!-- Page 1 -->\nProse.\n\n![Image: a](image)\n\n![Image: b](image)\n',
        detection: detection({ pageCount: 1 }),
      }),
      // Only the first of the two figures came back.
      extractImages: async () => [image(1, 0)],
    })
    expect(result.work.assets).toHaveLength(1)
    const warning = result.report.findings.find((f) => f.code === 'pdf-figure-not-imported')
    expect(warning?.message).toContain('1 figure')
    // The unrecovered one still says where it was.
    expect(result.work.sections[0]!.html).toContain('[Embedded image')
  })

  it('never lets a failed recovery cost the text', async () => {
    const result = await importPdfDocument(pdfFile(), {
      metadata,
      probe: stub({
        markdown: '<!-- Page 1 -->\nThe prose must survive.\n\n![Image: x](image)\n',
        detection: detection({ pageCount: 1 }),
      }),
      extractImages: async () => { throw new Error('pdf.js blew up') },
    })
    expect(result.work.sections[0]!.html).toContain('The prose must survive.')
    expect(result.work.assets).toEqual([])
    expect(result.report.findings.find((f) => f.code === 'pdf-figure-not-imported')).toBeDefined()
  })

  it('behaves exactly as before when recovery is unavailable', async () => {
    const result = await importPdfDocument(pdfFile(), {
      metadata,
      probe: stub({
        markdown: '<!-- Page 1 -->\nProse.\n\n![Image: x](image)\n',
        detection: detection({ pageCount: 1 }),
      }),
    })
    expect(result.work.assets).toEqual([])
    expect(result.work.sections[0]!.html).toContain('[Embedded image')
  })
})
