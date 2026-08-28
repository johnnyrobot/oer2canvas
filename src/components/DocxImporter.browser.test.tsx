import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { semanticDocxFixture } from '../import/testing/docx-fixture'
import { DocxImporter } from './DocxImporter'

async function chooseDocx(name = 'cells.docx', embeddedImage = false) {
  const file = new File([await semanticDocxFixture({ embeddedImage })], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  fireEvent.change(screen.getByLabelText('Word document'), { target: { files: [file] } })
}

function completeRights() {
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

test('a user inspects a local DOCX and confirms its safe semantic preview', async () => {
  const onConfirm = vi.fn()
  render(<DocxImporter onConfirm={onConfirm} />)
  await chooseDocx()
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect DOCX' }))

  expect(await screen.findByRole('heading', { name: 'Preview: cells' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Cell Biology' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Read the cell guide' })).toHaveAttribute(
    'href',
    'https://example.edu/cells',
  )
  expect(screen.getByText(/AnyDoc 0\.2\.4/i)).toBeVisible()
  expect(screen.getByText('No extraction warnings or blockers.')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare this document' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
    work: { title: 'cells', format: 'docx', assets: [] },
    report: { parser: 'anydoc', format: 'docx' },
  })
})

test('a DOCX with embedded content shows the blocker and cannot be confirmed', async () => {
  const onConfirm = vi.fn()
  render(<DocxImporter onConfirm={onConfirm} />)
  await chooseDocx('diagram.docx', true)
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect DOCX' }))

  expect(await screen.findByRole('heading', { name: 'Preview: diagram' })).toBeVisible()
  expect(screen.getByText(/text-only DOCX workflow cannot publish it yet/i)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare this document' })).toBeDisabled()
  expect(onConfirm).not.toHaveBeenCalled()
})
