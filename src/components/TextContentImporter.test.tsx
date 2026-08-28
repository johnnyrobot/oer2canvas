import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextContentImporter } from './TextContentImporter'

test('a user can preview escaped pasted text and confirm its metadata for preparation', async () => {
  const onConfirm = vi.fn()
  const { container } = render(<TextContentImporter onConfirm={onConfirm} />)

  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'Week 1 notes' },
  })
  fireEvent.change(screen.getByLabelText('Content to import'), {
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

test('a user can preview Markdown semantics and review every sanitization finding', async () => {
  const onConfirm = vi.fn()
  const { container } = render(<TextContentImporter onConfirm={onConfirm} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Study guide' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: {
      value: '# Cell structure\n\n- Membrane\n- Nucleus\n\n<script>globalThis.importExecuted=true</script>',
    },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  expect(await screen.findByRole('heading', { name: 'Preview: Study guide' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Cell structure' })).toBeVisible()
  expect(screen.getByText('Membrane')).toBeVisible()
  expect(screen.getByText(/Removed active content that could execute or submit data/i)).toBeVisible()
  expect(container.querySelector('script')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare this page' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
    work: { format: 'markdown' },
    report: {
      format: 'markdown',
      findings: [{ code: 'import-active-content-removed', severity: 'warning' }],
    },
  })
})

test('a user can select a UTF-8 HTML file without uploading it', async () => {
  render(<TextContentImporter onConfirm={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a text, Markdown, or HTML file' }))
  const file = new File(['<h2>Local file content</h2>'], 'local-notes.html', { type: 'text/html' })
  fireEvent.change(screen.getByLabelText(/^Content file/), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I have permission to republish or adapt it' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  expect(await screen.findByRole('heading', { name: 'Preview: local-notes' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Local file content' })).toBeVisible()
  expect(screen.getByText(/local-notes\.html/)).toBeVisible()
})

test('active-only HTML remains visible as a blocker and cannot be prepared', async () => {
  const onConfirm = vi.fn()
  render(<TextContentImporter onConfirm={onConfirm} />)
  fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Unsafe source' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: { value: '<script>globalThis.importExecuted=true</script>' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  expect(await screen.findByText(/No supported semantic content remained/i)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare this page' })).toBeDisabled()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('an import blocker receives focus and keeps the form recoverable', async () => {
  render(<TextContentImporter onConfirm={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a text, Markdown, or HTML file' }))
  fireEvent.change(screen.getByLabelText(/^Content file/), {
    target: { files: [new File(['{\\rtf1}'], 'notes.rtf', { type: 'text/plain' })] },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveFocus()
  expect(alert).toHaveTextContent('text, Markdown, or HTML file')
  expect(screen.getByRole('button', { name: 'Create one-page preview' })).toBeEnabled()
})
