import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { semanticDocxFixture } from './import/testing/docx-fixture'

test('a user takes a local text DOCX through the shared Review and Plan workflow', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Word document' }))
  const file = new File([await semanticDocxFixture()], 'cells.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  fireEvent.change(screen.getByLabelText('Word document'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect DOCX' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare this document' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(await screen.findByText('Stores DNA')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))
  expect(screen.getByText('1 chapter becomes 1 page in a cartridge file.')).toBeVisible()
  expect(screen.getByText('Packaged assets: 0.')).toBeVisible()
})

test('a recoverable DOCX extraction warning remains visible in Plan', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Word document' }))
  const file = new File([await semanticDocxFixture({ unresolvedLink: true })], 'warning.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  fireEvent.change(screen.getByLabelText('Word document'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect DOCX' }))

  expect(await screen.findByText(/unresolved link could not be preserved/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare this document' }))
  await screen.findByText('Stores DNA')
  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))

  expect(screen.getByRole('heading', { name: 'Import findings' })).toBeVisible()
  expect(screen.getByText(/unresolved link could not be preserved/i)).toBeVisible()
})
