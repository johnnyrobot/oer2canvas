import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from './ImportPlanEditor'
import { importPdfDocument } from '../import/pdf'
import { pdfFixturePages } from '../import/testing/pdf-fixture'
import type { ImportResult } from '../import/types'

const metadata = {
  title: 'Biology handout',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

/** The same controlled harness `ImportPlanEditor.test.tsx` uses. */
function Harness({ initial }: { initial: ImportDraft }) {
  const [draft, setDraft] = useState(initial)
  return (
    <ImportPlanEditor draft={draft} onChange={setDraft} onConfirm={() => {}} onDiscard={() => {}} />
  )
}

async function importPdf(pages: Parameters<typeof pdfFixturePages>[0]): Promise<ImportResult> {
  const file = new File([pdfFixturePages(pages)], 'chapter.pdf', { type: 'application/pdf' })
  return importPdfDocument(file, { metadata })
}

test('a pdf whose scanned pages sit among readable ones leaves nothing publishable', async () => {
  /*
   * Criterion 4 is about the second half of that sentence. `ImportPlanEditor`
   * disables the confirm control on `blockers.length > 0`, and that ONE
   * `disabled` attribute is the entire enforcement point: `confirmImport` never
   * inspects severity and `buildPlan` takes no findings at all. So this asserts
   * the control, not the finding.
   *
   * The document has readable pages either side of the scanned ones, so it
   * imports rather than failing outright — which is what puts a blocker in front
   * of a plan the user can otherwise see and edit.
   *
   * TWO scanned pages, not one, and that is not incidental. Measured 2026-08-29:
   * the module only populates `pagesNeedingOcr` once the scanned fraction is
   * high enough for it to call the document `Mixed`. At 1 scanned page in 3 it
   * reports `TextBased` with an EMPTY `pagesNeedingOcr`, and this feature
   * currently warns about that page instead of blocking it. That gap is real and
   * is recorded against the issue; it is not what this test is for, and using a
   * fixture that does not block would prove nothing about the control.
   */
  const imported = await importPdf(['text', 'scanned', 'scanned', 'text'])
  render(<Harness initial={createImportDraft(imported)} />)

  expect(screen.getByRole('button', { name: /^Prepare / })).toBeDisabled()
  expect(screen.getByText(/images of text with no text layer/)).toBeInTheDocument()
})

test('a pdf with a figure stays publishable, and says where the figure was', async () => {
  const imported = await importPdf(['text', 'text-and-figure'])
  render(<Harness initial={createImportDraft(imported)} />)

  expect(screen.getByRole('button', { name: /^Prepare / })).toBeEnabled()
  expect(screen.getByText(/could not be imported/)).toBeInTheDocument()
  expect(imported.work.sections[0]!.html).toContain('[Embedded image: Figure on page 2]')
})
