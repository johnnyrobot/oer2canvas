import { importPdfDocument } from './pdf'
import { pdfFixture, pdfFixturePages } from './testing/pdf-fixture'
import { createImportDraft } from '../components/ImportPlanEditor'
import { confirmImport } from './page-plan'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'

const metadata = {
  title: 'Biology handout',
  author: 'Ada Instructor',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test('cancelling a pdf import stops the parse', async () => {
  // The benchmark records one cancellation per browser profile, not per fixture,
  // so it was not proven that the cancelled parse was ever the PDF one.
  const file = new File([pdfFixture(120, 'Cancellation')], 'big.pdf', { type: 'application/pdf' })
  const controller = new AbortController()
  const running = importPdfDocument(file, { metadata, signal: controller.signal })
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})

test('a text-based pdf exports the exact bytes the gate audited', async () => {
  const file = new File([pdfFixture(3, 'Parity')], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })
  const draft = createImportDraft(imported)
  const confirmed = confirmImport(imported, draft.plan, {
    ...metadata,
    rightsAuthority: 'own',
    rightsAcknowledged: true,
  })
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  const entries = buildCartridge([compiled])

  /*
   * Criterion 6. The split happens BEFORE sanitization precisely so that no
   * PDF-specific token — no page marker, no sentinel — ever exists in the bytes
   * the gate audits, and so nothing has to be rewritten after it. If either were
   * untrue, the audited html and the published html would diverge here.
   *
   * A failure means something rewrote html after the gate. Find it; do not relax
   * the assertion.
   */
  expect(compiled.sections.length).toBeGreaterThan(0)
  for (const section of compiled.sections) {
    const audited = section.gate?.html ?? ''
    expect(audited).not.toBe('')
    expect(audited).not.toMatch(/<!-- Page \d+ -->/)
    const entry = entries.find((candidate) => new TextDecoder().decode(candidate.data).includes(audited))
    expect(entry, `no cartridge entry contains the audited bytes for "${section.title}"`).toBeDefined()
  }
})

test('a scanned pdf never reaches a cartridge at all', async () => {
  // The wholly scanned document has no readable page, so it fails in the
  // importer rather than arriving as a blocker on a plan someone could confirm.
  const file = new File([pdfFixturePages(['scanned', 'scanned'])], 'scan.pdf', { type: 'application/pdf' })
  await expect(importPdfDocument(file, { metadata })).rejects.toThrow(/OCR/)
})

test('a scanned page the module does not flag still blocks', async () => {
  /*
   * The hole this closes. Measured 2026-08-29: at one scanned page in three the
   * module reports `pdfType: TextBased` with an EMPTY `pagesNeedingOcr`, so
   * nothing in its own classification distinguishes that page from blank paper —
   * and it would have published as a silent gap in the chapter.
   *
   * The page-restricted re-parse settles it with no threshold to invent: page 2
   * alone yields an image placeholder, so it is an image of text and blocks.
   */
  const file = new File([pdfFixturePages(['text', 'scanned', 'text'])], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })

  const blocker = imported.report.findings.find((finding) => finding.code === 'pdf-ocr-required')
  expect(blocker?.severity).toBe('blocker')
  expect(blocker?.message).toMatch(/page 2/)
  expect(blocker?.sourcePage).toBe(2)
  // And it is NOT also reported as blank paper.
  expect(imported.report.findings.some((finding) => finding.code === 'pdf-page-empty')).toBe(false)
  // The scanned page's placeholder lands in page 1's slice; it must not be
  // counted as a figure that page actually has.
  expect(imported.report.findings.some((finding) => finding.code === 'pdf-figure-not-imported')).toBe(false)
})

test('a genuinely blank page still only warns', async () => {
  // The negative control, and the reason the re-parse is needed rather than a
  // rule that blocks every page which produced no marker: a chapter divider must
  // not refuse the whole book.
  const file = new File([pdfFixturePages(['text', 'blank', 'text'])], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })

  expect(imported.report.findings.some((finding) => finding.code === 'pdf-ocr-required')).toBe(false)
  const empty = imported.report.findings.find((finding) => finding.code === 'pdf-page-empty')
  expect(empty?.severity).toBe('warning')
  expect(empty?.sourcePage).toBe(2)
})

test('a figure on a readable page is still counted as a figure', async () => {
  // Guards the subtraction: it must remove only images belonging to an un-marked
  // page, never a figure that really is on the page it was found in.
  const file = new File([pdfFixturePages(['text', 'text-and-figure'])], 'chapter.pdf', { type: 'application/pdf' })
  const imported = await importPdfDocument(file, { metadata })

  const figure = imported.report.findings.find((finding) => finding.code === 'pdf-figure-not-imported')
  expect(figure?.severity).toBe('warning')
  expect(figure?.message).toMatch(/1 figure/)
  expect(figure?.sourcePage).toBe(2)
})
