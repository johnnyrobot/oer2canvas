import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { semanticDocxFixture } from './import/testing/docx-fixture'
import { DOCUMENT_FIXTURE_CASES } from './import/testing/document-fixture-cases'

test.each(DOCUMENT_FIXTURE_CASES)('a user takes a local $format document through the shared Review and Plan workflow', async ({ format, fixture, mediaType }) => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Document' }))
  const file = new File([await fixture()], `cells.${format}`, { type: mediaType })
  fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))
  expect(await screen.findByRole('heading', { name: 'Page plan: cells' })).toBeVisible()
  // AnyDoc surfaces the EPUB package title as a heading of its own, so that
  // format proposes two pages; the others propose one.
  const pages = screen.getAllByLabelText(/^Title of page/).length
  expect(pages).toBe(format === 'epub' ? 2 : 1)
  fireEvent.click(screen.getByRole('button', { name: `Prepare ${pages} ${pages === 1 ? 'page' : 'pages'}` }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(await screen.findByText('Stores DNA')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))
  expect(screen.getByText(`1 chapter becomes ${pages} ${pages === 1 ? 'page' : 'pages'} in a cartridge file.`)).toBeVisible()
  expect(screen.getByText('Packaged assets: 0 (1 KB of 8 MB budget).')).toBeVisible()
})

test('a recoverable DOCX extraction warning remains visible in Plan', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Document' }))
  const file = new File([await semanticDocxFixture({ unresolvedLink: true })], 'warning.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))

  expect(await screen.findByText(/unresolved link could not be preserved/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 1 page' }))
  await screen.findByText('Stores DNA')
  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))

  expect(screen.getByRole('heading', { name: 'Import findings' })).toBeVisible()
  expect(screen.getByText(/unresolved link could not be preserved/i)).toBeVisible()
})
