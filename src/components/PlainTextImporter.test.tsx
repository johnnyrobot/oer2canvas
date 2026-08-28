import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlainTextImporter } from './PlainTextImporter'

test('a user can preview escaped pasted text and confirm its metadata for preparation', async () => {
  const onConfirm = vi.fn()
  const { container } = render(<PlainTextImporter onConfirm={onConfirm} />)

  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'Week 1 notes' },
  })
  fireEvent.change(screen.getByLabelText('Text to import'), {
    target: { value: 'Cells < tissues\n\n<script>alert("no")</script>' },
  })
  fireEvent.change(screen.getByLabelText('Author or organization'), {
    target: { value: 'Ada Instructor' },
  })
  fireEvent.change(screen.getByLabelText('Publisher or source'), {
    target: { value: 'Biology Department' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  expect(await screen.findByRole('heading', { name: 'Preview: Week 1 notes' })).toBeVisible()
  expect(screen.getByText('Cells < tissues')).toBeVisible()
  expect(screen.getByText('<script>alert("no")</script>')).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.getByText(/Biology Department/)).toBeVisible()
  expect(screen.getByText(/Ada Instructor/)).toBeVisible()
  expect(screen.getByText(/Native browser parser/i)).toBeVisible()
  expect(screen.getByText(/0 packaged assets/i)).toBeVisible()
  expect(screen.getByText('No extraction warnings or blockers.')).toBeVisible()
  expect(onConfirm).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare this page' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
    work: {
      title: 'Week 1 notes',
      provenance: {
        author: 'Ada Instructor',
        sourceName: 'Biology Department',
        rights: { authority: 'own', acknowledged: true },
      },
    },
    report: { parser: 'native', format: 'text' },
  })
})

test('a user can select a UTF-8 text file without uploading it', async () => {
  render(<PlainTextImporter onConfirm={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a .txt file' }))
  const file = new File(['Local file content.'], 'local-notes.txt', { type: 'text/plain' })
  fireEvent.change(screen.getByLabelText(/^Text file/), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I have permission to republish or adapt it' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  expect(await screen.findByRole('heading', { name: 'Preview: local-notes' })).toBeVisible()
  expect(screen.getByText('Local file content.')).toBeVisible()
  expect(screen.getByText(/local-notes\.txt/)).toBeVisible()
})

test('an import blocker receives focus and keeps the form recoverable', async () => {
  render(<PlainTextImporter onConfirm={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a .txt file' }))
  fireEvent.change(screen.getByLabelText(/^Text file/), {
    target: { files: [new File(['# Markdown'], 'notes.md', { type: 'text/plain' })] },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveFocus()
  expect(alert).toHaveTextContent('.txt extension')
  expect(screen.getByRole('button', { name: 'Create one-page preview' })).toBeEnabled()
})
