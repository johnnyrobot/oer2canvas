import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocumentImporter } from './DocumentImporter'
import { semanticDocxFixture } from '../import/testing/docx-fixture'
import {
  malformedStructuredFixture,
} from '../import/testing/structured-document-fixtures'
import { DOCUMENT_FIXTURE_CASES } from '../import/testing/document-fixture-cases'
import { pdfFixturePages } from '../import/testing/pdf-fixture'
import { capabilityForFormat } from '../import/capability'
import { buildXlsx } from '../import/testing/spreadsheet-fixtures'
import type { ImportResult } from '../import/types'

async function chooseFile(name: string, bytes: Uint8Array<ArrayBuffer>) {
  fireEvent.change(screen.getByLabelText('Document file'), {
    target: { files: [new File([bytes], name)] },
  })
}

function completeRights() {
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

test.each(DOCUMENT_FIXTURE_CASES)('$format is exposed from the tested capability table and hands off semantic content', async ({ format, fixture }) => {
  const label = capabilityForFormat(format)!.label
  const onImported = vi.fn()
  render(<DocumentImporter onImported={onImported} />)
  await chooseFile(`cells.${format}`, await fixture())

  expect(screen.getByText(new RegExp(`${label} limitation`, 'i'))).toBeVisible()
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  const result = onImported.mock.calls[0]![0] as ImportResult
  expect(result).toMatchObject({
    work: { title: 'cells', format, assets: [] },
    report: { parser: 'anydoc', parserVersion: '0.2.4', format },
  })
  const html = new DOMParser().parseFromString(result.work.sections[0]!.html, 'text/html')
  expect([...html.querySelectorAll('h1, h2, h3')].map((heading) => heading.textContent)).toContain('Cell Biology')
  expect(html.querySelector('a')?.getAttribute('href')).toBe('https://example.edu/cells')
})

test('a packageable embedded image is handed off as a cartridge reference, not a blocker', async () => {
  const onImported = vi.fn()
  render(<DocumentImporter onImported={onImported} />)
  await chooseFile('diagram.docx', await semanticDocxFixture({ embeddedImage: true }))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  const result = onImported.mock.calls[0]![0] as ImportResult
  expect(result.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
  expect(result.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
})

test('embedded content the workflow cannot package is handed off as a blocking finding, never dropped', async () => {
  const onImported = vi.fn()
  render(<DocumentImporter onImported={onImported} />)
  await chooseFile('diagram.docx', await semanticDocxFixture({ unsupportedImage: true }))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  const result = onImported.mock.calls[0]![0] as ImportResult
  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'embedded-content',
    severity: 'blocker',
    message: expect.stringMatching(/could not be packaged/i),
  }))
  expect(result.work.sections[0]?.html).toContain('[Embedded image: Unsupported diagram]')
})

test.each(['epub', 'odt', 'rtf'] as const)('%s malformed input produces a focused recoverable error', async (format) => {
  render(<DocumentImporter onImported={() => {}} />)
  await chooseFile(`broken.${format}`, malformedStructuredFixture(format))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  const alert = await screen.findByRole('alert')
  await waitFor(() => expect(alert).toHaveFocus())
  expect(alert).toHaveTextContent(/could not inspect|not recognized|no readable structured content/i)
  expect(screen.getByRole('button', { name: 'Inspect document' })).toBeEnabled()
})

test('a selected pdf is routed to the pdf importer and reaches the plan editor', async () => {
  const onImported = vi.fn()
  render(<DocumentImporter onImported={onImported} />)
  await chooseFile('cells.pdf', pdfFixturePages(['text', 'text-and-figure']))

  expect(screen.getByText(/PDF limitation/i)).toBeVisible()
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  const result = onImported.mock.calls[0]![0] as ImportResult
  // Routed on the capability's parser, so the anydoc importer never saw it.
  expect(result).toMatchObject({
    work: { title: 'cells', format: 'pdf' },
    report: { parser: 'pdf-inspector', format: 'pdf', pageCount: 2 },
  })
  // The figure is recovered and packaged, not marked and abandoned.
  expect(result.work.assets).toHaveLength(1)
  expect(result.work.sections[0]!.html).toMatch(/<img[^>]+\$IMS-CC-FILEBASE\$\/oer2canvas\//)
  expect(result.report.findings.some((finding) => finding.severity === 'blocker')).toBe(false)
})

test('a scanned pdf refuses with the reason, and stays retryable', async () => {
  render(<DocumentImporter onImported={() => {}} />)
  await chooseFile('scan.pdf', pdfFixturePages(['scanned', 'scanned']))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  const alert = await screen.findByRole('alert')
  await waitFor(() => expect(alert).toHaveFocus())
  expect(alert).toHaveTextContent(/OCR/i)
  expect(screen.getByRole('button', { name: 'Inspect document' })).toBeEnabled()
})

test('a spreadsheet says it is unavailable before the user submits it', async () => {
  // Issue 16 left the four spreadsheet formats `probe-only`, so the picker's
  // `accept` never offers one — but a user can still choose one by hand, and
  // "Excel workbook limitation:" would read as a caveat on a supported format
  // rather than as the refusal it actually is.
  render(<DocumentImporter onImported={() => {}} />)
  await chooseFile('enrollment.xlsx', await buildXlsx([
    { name: 'Enrollment', rows: [['Term', 'Students'], ['Fall', 120]] },
  ]))

  expect(screen.getByText(/Excel workbook is not available in this release/i)).toBeVisible()
  expect(screen.getByText(/Spreadsheets are not imported in this release/i)).toBeVisible()
  expect(screen.queryByText(/Excel workbook limitation/i)).not.toBeInTheDocument()

  // And submitting still refuses. The message NAMES the format and the way out
  // rather than listing the extensions that do work: issue 15 gave every
  // known-but-disabled capability that treatment in `enabledCapabilityFor`,
  // and a spreadsheet is one, so it inherits it rather than falling through to
  // the generic list.
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/Excel workbook: Spreadsheets are not imported in this release/i)
  expect(alert).toHaveTextContent(/Markdown tab/i)
})
