import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextContentImporter } from './TextContentImporter'
import type { ImportResult } from '../import/types'

function completeRights(name = 'I created or own this content') {
  fireEvent.click(screen.getByRole('radio', { name }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
}

async function handedOff(onImported: ReturnType<typeof vi.fn>): Promise<ImportResult> {
  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  return onImported.mock.calls[0]![0] as ImportResult
}

test('pasted text is escaped and handed off with its metadata for page planning', async () => {
  const onImported = vi.fn()
  render(<TextContentImporter onImported={onImported} />)

  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Week 1 notes' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: { value: 'Cells < tissues\n\n<script>alert("no")</script>' },
  })
  fireEvent.change(screen.getByLabelText('Author or organization'), { target: { value: 'Ada Instructor' } })
  fireEvent.change(screen.getByLabelText('Publisher or source'), { target: { value: 'Biology Department' } })
  completeRights()
  expect(onImported).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  const result = await handedOff(onImported)
  expect(result).toMatchObject({
    work: {
      title: 'Week 1 notes',
      provenance: {
        author: 'Ada Instructor',
        sourceName: 'Biology Department',
        rights: { authority: 'own', acknowledged: true },
      },
    },
    report: { parser: 'native', format: 'text', findings: [] },
  })
  expect(result.work.sections[0]!.html).toBe(
    '<p>Cells &lt; tissues</p><p>&lt;script&gt;alert(&quot;no&quot;)&lt;/script&gt;</p>',
  )
})

test('pasted Markdown is parsed with every sanitization finding reported for the plan', async () => {
  const onImported = vi.fn()
  render(<TextContentImporter onImported={onImported} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Study guide' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: {
      value: '# Cell structure\n\n- Membrane\n- Nucleus\n\n<script>globalThis.importExecuted=true</script>',
    },
  })
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  const result = await handedOff(onImported)
  expect(result).toMatchObject({
    work: { format: 'markdown' },
    report: {
      format: 'markdown',
      findings: [{ code: 'import-active-content-removed', severity: 'warning' }],
    },
  })
  expect(result.work.sections[0]!.html).toContain('<h1>Cell structure</h1>')
  expect(result.work.sections[0]!.html).not.toContain('<script')
})

test('a user can select a UTF-8 HTML file without uploading it', async () => {
  const onImported = vi.fn()
  render(<TextContentImporter onImported={onImported} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a text, Markdown, or HTML file' }))
  const file = new File(['<h2>Local file content</h2>'], 'local-notes.html', { type: 'text/html' })
  fireEvent.change(screen.getByLabelText(/^Content file/), { target: { files: [file] } })
  completeRights('I have permission to republish or adapt it')
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  const result = await handedOff(onImported)
  expect(result.work.title).toBe('local-notes')
  expect(result.work.provenance).toMatchObject({ kind: 'local-file', originalName: 'local-notes.html' })
  expect(result.work.sections[0]!.html).toBe('<h2>Local file content</h2>')
})

test('active-only HTML is handed off with its blocker rather than silently emptied', async () => {
  const onImported = vi.fn()
  render(<TextContentImporter onImported={onImported} />)
  fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Unsafe source' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: { value: '<script>globalThis.importExecuted=true</script>' },
  })
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  const result = await handedOff(onImported)
  expect(result.report.findings).toContainEqual(
    expect.objectContaining({ code: 'import-no-supported-content', severity: 'blocker' }),
  )
})

test('an import blocker receives focus and keeps the form recoverable', async () => {
  const onImported = vi.fn()
  render(<TextContentImporter onImported={onImported} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Upload a text, Markdown, or HTML file' }))
  fireEvent.change(screen.getByLabelText(/^Content file/), {
    target: { files: [new File(['{\\rtf1}'], 'notes.rtf', { type: 'text/plain' })] },
  })
  completeRights()
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))

  const alert = await screen.findByRole('alert')
  // Focus lands in an effect after the alert commits; the sibling importers' tests wait the same way.
  await waitFor(() => expect(alert).toHaveFocus())
  expect(alert).toHaveTextContent('text, Markdown, or HTML file')
  expect(screen.getByRole('button', { name: 'Create page plan' })).toBeEnabled()
  expect(onImported).not.toHaveBeenCalled()
})
