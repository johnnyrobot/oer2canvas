import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocumentImporter } from './DocumentImporter'
import { semanticDocxFixture } from '../import/testing/docx-fixture'
import {
  malformedStructuredFixture,
} from '../import/testing/structured-document-fixtures'
import { DOCUMENT_FIXTURE_CASES } from '../import/testing/document-fixture-cases'
import { capabilityForFormat } from '../import/capability'
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
    message: expect.stringMatching(/cannot package|corrupt/i),
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
