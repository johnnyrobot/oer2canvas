import { pdfFindings } from './pdf-findings'
import type { ParserDetection } from './parsers/probe'

const detection = (over: Partial<ParserDetection> = {}): ParserDetection => ({
  pdfType: 'TextBased', pageCount: 3, confidence: 1, pagesNeedingOcr: [], ocrReasonsByPage: [],
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] }, ...over,
})
const read = (page: number, images = 0) => ({ page, textLength: 400, images })

test('a clean text-based pdf produces no findings at all', () => {
  expect(pdfFindings(detection(), [read(1), read(2), read(3)])).toEqual([])
})

test('a figure on a readable page warns, and does not block', () => {
  const findings = pdfFindings(detection(), [read(1), read(2, 1), read(3, 2)])
  const figure = findings.find((finding) => finding.code === 'pdf-figure-not-imported')!
  expect(figure.severity).toBe('warning')
  expect(figure.message).toMatch(/3 figures/)
  expect(figure.message).toMatch(/pages 2, 3/)
  expect(figure.message).toMatch(/\[Embedded image/)
  expect(findings.some((finding) => finding.severity === 'blocker')).toBe(false)
})

test('a scanned page blocks, names its pages, and says why OCR is not available', () => {
  const findings = pdfFindings(
    detection({ pdfType: 'Mixed', pageCount: 4, pagesNeedingOcr: [3], ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }] }),
    [read(1), read(2), read(4)],
  )
  const blocker = findings.find((finding) => finding.code === 'pdf-ocr-required')!
  expect(blocker.severity).toBe('blocker')
  expect(blocker.message).toMatch(/page 3/)
  expect(blocker.message).toMatch(/OCR/)
  expect(blocker.message).toMatch(/Remove those pages|text layer/)
  // Exactly one page implicated, so the declared-and-until-now-dead field is
  // finally written — and only in the one case where a single number is not a lie.
  expect(blocker.sourcePage).toBe(3)
})

test('a mixed document blocks on its scanned pages while only warning about its figures', () => {
  /*
   * THE BOUNDARY, in one document. The figure on page 2 is a gap in a page a
   * reader can still read; page 5 is a page with no content at all, and
   * publishing it would ship a blank Canvas page where a chapter section should
   * be. One document, two verdicts, and the blocker must not swallow the warning.
   */
  const findings = pdfFindings(
    detection({ pdfType: 'Mixed', pageCount: 6, pagesNeedingOcr: [5], ocrReasonsByPage: [{ page: 5, reasons: ['scanned'] }] }),
    [read(1), read(2, 1), read(3), read(4), read(6)],
  )
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')?.severity).toBe('blocker')
  expect(findings.find((finding) => finding.code === 'pdf-figure-not-imported')?.severity).toBe('warning')
  // Page 5 is named by the blocker and must NOT also be reported as a blank page.
  expect(findings.some((finding) => finding.code === 'pdf-page-empty')).toBe(false)
})

test('a wholly scanned document names every page', () => {
  const findings = pdfFindings(detection({ pdfType: 'Scanned', pageCount: 3, pagesNeedingOcr: [1, 2, 3] }), [])
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')!.message).toMatch(/pages 1–3/)
})

test('an unrecognised pdfType is treated as not text-based', () => {
  // Fail closed: a value nobody has seen is not evidence that the text is fine.
  const findings = pdfFindings(detection({ pdfType: 'SomethingNew', pageCount: 2 }), [read(1), read(2)])
  expect(findings.find((finding) => finding.code === 'pdf-ocr-required')?.severity).toBe('blocker')
})

test('a page that produced nothing and was not flagged for OCR warns rather than blocks', () => {
  // Measured: a blank page leaves `pagesNeedingOcr` empty while a scanned page
  // does not. This bucket is blank paper — a chapter divider, the back of a
  // title page — and refusing to import a book because it has one would be a
  // refusal that protects nobody.
  const findings = pdfFindings(detection({ pageCount: 3 }), [read(1), read(3)])
  const empty = findings.find((finding) => finding.code === 'pdf-page-empty')!
  expect(empty.severity).toBe('warning')
  expect(empty.message).toMatch(/page 2/)
  expect(empty.sourcePage).toBe(2)
})

test('columns and tables raise one reading-order warning naming both', () => {
  const findings = pdfFindings(
    detection({ layout: { isComplex: true, pagesWithTables: [2], pagesWithColumns: [1, 2] } }),
    [read(1), read(2), read(3)],
  )
  const layout = findings.find((finding) => finding.code === 'pdf-reading-order')!
  expect(layout.severity).toBe('warning')
  expect(layout.message).toMatch(/pages 1, 2/)
})

test('a complex layout with no page numbers still warns', () => {
  // The fallback branch. Nothing in the module's type ties `isComplex` to the
  // arrays, so it is not known whether this is reachable at runtime; it is
  // covered here so it is not silently dead, and it must not name pages it
  // does not have.
  const findings = pdfFindings(
    detection({ layout: { isComplex: true, pagesWithTables: [], pagesWithColumns: [] } }),
    [read(1)],
  )
  expect(findings.find((finding) => finding.code === 'pdf-reading-order')!.message).not.toMatch(/page \d/)
})

test('reported encoding problems warn for the whole document', () => {
  // `hasEncodingIssues` sits on `ParserProbeResult`, not on `ParserDetection` —
  // `detectPdf` does not report it — so it arrives as its own argument rather
  // than being faked onto the detection.
  const findings = pdfFindings(detection(), [read(1), read(2), read(3)], true)
  expect(findings.find((finding) => finding.code === 'pdf-encoding')!.severity).toBe('warning')
})
