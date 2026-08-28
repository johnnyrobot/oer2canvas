import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const { compileChapter, downloadCartridge } = vi.hoisted(() => ({
  compileChapter: vi.fn(async (chapter: any, options: any) => {
    const sections = chapter.sections.map((section: any, index: number) => {
      const compiled = {
        id: section.id,
        title: section.title,
        html: section.html,
        notes: [],
        queue: [],
        gate: {
          html: section.html,
          conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
          badgeWithheld: false,
        },
      }
      options.onSection?.(compiled, index)
      return compiled
    })
    options.onProgress?.({ phase: 'done', done: sections.length, total: sections.length, title: '' })
    return { chapter, sections, queue: [] }
  }),
  downloadCartridge: vi.fn(async () => 'week-1-notes.imscc'),
}))

vi.mock('./engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine')>()),
  compileAndAuditChapter: compileChapter,
}))

vi.mock('./engine/export/download', () => ({ downloadCartridge }))

test('sanitized Markdown travels from Content through Review and Plan to a cartridge download', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Content')
  fireEvent.click(screen.getByRole('tab', { name: 'Text / Markdown / HTML' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Week 1 notes' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: { value: '# Cell structure notes\n\n<script>globalThis.importExecuted=true</script>' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare this page' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(await screen.findByText('Cell structure notes')).toBeVisible()
  expect(compileChapter).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'document', title: 'Week 1 notes' }),
    expect.objectContaining({ profile: expect.objectContaining({ id: 'document' }) }),
  )

  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))
  expect(screen.getByText('1 chapter becomes 1 page in a cartridge file.')).toBeVisible()
  expect(screen.getByText('Packaged assets: 0.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Import findings' })).toBeVisible()
  expect(screen.getByText(/Removed active content that could execute or submit data/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Download cartridge — 1 page' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Result'))
  expect(downloadCartridge).toHaveBeenCalledTimes(1)
  expect(screen.getByText('week-1-notes.imscc')).toBeVisible()
})

test('choosing a publisher clears a prepared document before its catalog loads', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Text / Markdown / HTML' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Stale notes' } })
  fireEvent.change(screen.getByLabelText('Content to import'), { target: { value: 'Must not reach Plan.' } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create one-page preview' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare this page' }))
  await screen.findByText('Must not reach Plan.')

  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).startsWith('/relay')) {
      return Response.json({
        archiveUrl: '/apps/archive/20240520.155823',
        books: {
          '13ac107a-f15f-49d2-97e8-60ab2e3b519c': { defaultVersion: '1.0' },
        },
      })
    }
    return Response.json({
      title: 'Algebra and Trigonometry',
      tree: {
        id: 'root',
        title: 'Algebra and Trigonometry',
        contents: [{
          id: 'chapter-1',
          title: 'Chapter 1',
          toc_type: 'chapter',
          contents: [{ id: 'page-1', title: '1.1 Page', toc_type: 'book-content' }],
        }],
      },
    })
  }) as typeof globalThis.fetch

  fireEvent.click(screen.getByRole('button', { name: /^Content/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Algebra and Trigonometry' }))

  await waitFor(() => expect(screen.getByText('Chapter 1')).toBeVisible())
  expect(screen.getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByText('Must not reach Plan.')).not.toBeInTheDocument()
})
