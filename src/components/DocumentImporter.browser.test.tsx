import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocumentImporter } from './DocumentImporter'
import { semanticDocxFixture } from '../import/testing/docx-fixture'
import {
  malformedStructuredFixture,
} from '../import/testing/structured-document-fixtures'
import { DOCUMENT_FIXTURE_CASES } from '../import/testing/document-fixture-cases'
import { capabilityForFormat } from '../import/capability'

async function chooseFile(name: string, bytes: Uint8Array<ArrayBuffer>) {
  fireEvent.change(screen.getByLabelText('Document file'), {
    target: { files: [new File([bytes], name)] },
  })
}

function completeRights() {
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

test.each(DOCUMENT_FIXTURE_CASES)('$format is exposed from the tested capability table and confirms a semantic preview', async ({ format, fixture }) => {
  const label = capabilityForFormat(format)!.label
  const onConfirm = vi.fn()
  render(<DocumentImporter onConfirm={onConfirm} />)
  await chooseFile(`cells.${format}`, await fixture())

  expect(screen.getByText(new RegExp(`${label} limitation`, 'i'))).toBeVisible()
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  expect(await screen.findByRole('heading', { name: 'Preview: cells' })).toBeVisible()
  expect(screen.getAllByRole('heading', { name: 'Cell Biology' }).length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: 'Read the cell guide' })).toHaveAttribute(
    'href',
    'https://example.edu/cells',
  )
  expect(screen.getByText(new RegExp(`${label} · AnyDoc 0\.2\.4`, 'i'))).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare this document' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
    work: { title: 'cells', format, assets: [] },
    report: { parser: 'anydoc', format },
  })
})

test('embedded content remains a visible blocker in the shared document UI', async () => {
  const onConfirm = vi.fn()
  render(<DocumentImporter onConfirm={onConfirm} />)
  await chooseFile('diagram.docx', await semanticDocxFixture({ embeddedImage: true }))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  expect(await screen.findByRole('heading', { name: 'Preview: diagram' })).toBeVisible()
  expect(screen.getByText(/text-oriented document workflow cannot publish it yet/i)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare this document' })).toBeDisabled()
  expect(onConfirm).not.toHaveBeenCalled()
})

test.each(['epub', 'odt', 'rtf'] as const)('%s malformed input produces a focused recoverable error', async (format) => {
  render(<DocumentImporter onConfirm={() => {}} />)
  await chooseFile(`broken.${format}`, malformedStructuredFixture(format))
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  const alert = await screen.findByRole('alert')
  await waitFor(() => expect(alert).toHaveFocus())
  expect(alert).toHaveTextContent(/could not inspect|not recognized|no readable structured content/i)
  expect(screen.getByRole('button', { name: 'Inspect document' })).toBeEnabled()
})
