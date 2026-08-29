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
