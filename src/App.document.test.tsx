import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const THREE_PAGE_MARKDOWN = [
  '# Cell biology',
  '',
  '## Membranes',
  'Lipid bilayer.',
  '',
  '## Nucleus',
  'Stores DNA.',
  '',
  '## Mitochondria',
  'Energy.',
].join('\n')

function pasteMarkdown(title: string, markdown: string) {
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('tab', { name: 'Text / Markdown / HTML' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('Content to import'), { target: { value: markdown } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))
}

function pageTitles(): string[] {
  return within(screen.getByRole('list', { name: 'Proposed Canvas pages' }))
    .getAllByLabelText(/^Title of page/)
    .map((input) => (input as HTMLInputElement).value)
}

beforeEach(() => {
  compileChapter.mockClear()
  downloadCartridge.mockClear()
})

test('sanitized Markdown travels from Content through the page plan, Review, and Plan to a cartridge download', async () => {
  render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Destination')
  pasteMarkdown('Week 1 notes', '# Cell structure notes\n\n<script>globalThis.importExecuted=true</script>')

  expect(await screen.findByRole('heading', { name: 'Page plan: Week 1 notes' })).toBeVisible()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Content')
  expect(screen.getByText(/Removed active content that could execute or submit data/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 1 page' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(await screen.findByText('Cell structure notes')).toBeVisible()
  expect(compileChapter).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'document', title: 'Week 1 notes' }),
    expect.objectContaining({ profile: expect.objectContaining({ id: 'document' }) }),
  )

  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))
  expect(screen.getByText('1 chapter becomes 1 page in a cartridge file.')).toBeVisible()
  expect(screen.getByText('Packaged assets: 0 (1 KB of 8 MB budget).')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Import findings' })).toBeVisible()
  expect(screen.getByText(/Removed active content that could execute or submit data/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Download cartridge — 1 page' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Result'))
  expect(downloadCartridge).toHaveBeenCalledTimes(1)
  expect(screen.getByText('week-1-notes.imscc')).toBeVisible()
})

test('only confirmed pages are prepared, and the plan survives leaving Content', async () => {
  render(<App />)
  pasteMarkdown('Cells', THREE_PAGE_MARKDOWN)

  await screen.findByRole('heading', { name: 'Page plan: Cells' })
  expect(pageTitles()).toEqual(['Membranes', 'Nucleus', 'Mitochondria'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include: Membranes' }))
  fireEvent.change(screen.getByLabelText('Title of page 2'), { target: { value: 'The nucleus' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 2 pages' }))

  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(compileChapter).toHaveBeenCalledTimes(1)
  const chapter = compileChapter.mock.calls[0]![0]
  expect(chapter.sections.map((section: any) => section.title)).toEqual(['The nucleus', 'Mitochondria'])
  expect(chapter.sections.map((section: any) => section.id)).toEqual([
    `${chapter.bookId}-page-4`,
    `${chapter.bookId}-page-6`,
  ])

  fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }))
  expect(screen.getByText('1 chapter becomes 2 pages in a cartridge file.')).toBeVisible()

  // Back to Content: the plan is still there, unchanged, and nothing was reparsed.
  fireEvent.click(screen.getByRole('button', { name: /^Content/ }))
  expect(screen.getByRole('heading', { name: 'Page plan: Cells' })).toBeVisible()
  expect(pageTitles()).toEqual(['Membranes', 'The nucleus', 'Mitochondria'])
  expect(screen.getByRole('checkbox', { name: 'Include: Membranes' })).not.toBeChecked()
})

test('changing a prepared plan discards the stale output until it is prepared again', async () => {
  render(<App />)
  pasteMarkdown('Cells', THREE_PAGE_MARKDOWN)
  await screen.findByRole('heading', { name: 'Page plan: Cells' })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 3 pages' }))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(screen.getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-disabled', 'false')

  fireEvent.click(screen.getByRole('button', { name: /^Content/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Merge with next page: Nucleus' }))

  expect(screen.getByText(/prepared pages were discarded because the plan changed/i)).toBeVisible()
  expect(screen.getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
  expect(screen.getByText(/Confirm the page plan first/)).toBeVisible()
  expect(screen.queryByText('Stores DNA.')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^Content/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 2 pages' }))
  await waitFor(() => expect(compileChapter).toHaveBeenCalledTimes(2))
  const chapter = compileChapter.mock.calls[1]![0]
  expect(chapter.sections.map((section: any) => section.title)).toEqual(['Membranes', 'Nucleus'])
  expect(chapter.sections[1]!.html).toContain('Mitochondria')
})

test('a failed preparation keeps the plan so it can be corrected and confirmed again', async () => {
  compileChapter.mockRejectedValueOnce(new Error('the audit frame was torn down'))
  render(<App />)
  pasteMarkdown('Cells', THREE_PAGE_MARKDOWN)
  await screen.findByRole('heading', { name: 'Page plan: Cells' })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 3 pages' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not prepare Cells.*torn down/)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Content')
  expect(screen.getByRole('heading', { name: 'Page plan: Cells' })).toBeVisible()
  expect(pageTitles()).toEqual(['Membranes', 'Nucleus', 'Mitochondria'])

  fireEvent.click(screen.getByRole('button', { name: 'Prepare 3 pages' }))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review'))
  expect(await screen.findByText('Stores DNA.')).toBeVisible()
})

test('choosing different content drops the plan and returns to the source browser', async () => {
  render(<App />)
  pasteMarkdown('Cells', THREE_PAGE_MARKDOWN)
  await screen.findByRole('heading', { name: 'Page plan: Cells' })
  fireEvent.click(screen.getByRole('button', { name: 'Choose different content' }))

  expect(screen.getByRole('heading', { name: 'Choose content' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Page plan: Cells' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Review/ })).toHaveAttribute('aria-disabled', 'true')
})

test('choosing a publisher clears a prepared document before its catalog loads', async () => {
  render(<App />)
  pasteMarkdown('Stale notes', 'Must not reach Plan.')
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare 1 page' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Choose different content' }))
  fireEvent.click(screen.getByRole('button', { name: 'Algebra and Trigonometry' }))

  await waitFor(() => expect(screen.getByText('Chapter 1')).toBeVisible())
  expect(screen.getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByText('Must not reach Plan.')).not.toBeInTheDocument()
})
