import { render, screen, fireEvent } from '@testing-library/react'
import { ResultScreen } from './screens'
import type { PushReport } from './screens'

const LANDED = [
  { slug: 'chapter-1-introduction', title: 'Introduction', chapterTitle: 'Chapter 1', outcome: 'updated' as const },
  { slug: 'chapter-1-polynomials', title: 'Polynomials', chapterTitle: 'Chapter 1', outcome: 'created' as const },
]

const complete: PushReport = {
  courseName: 'Intro Algebra',
  courseId: 7,
  courseBaseUrl: 'https://school.instructure.com',
  landed: [{ ...LANDED[0]!, url: 'introduction' }, { ...LANDED[1]!, url: 'polynomials' }],
  remaining: [],
}

const stopped: PushReport = {
  courseName: 'Intro Algebra',
  landed: [LANDED[0]!],
  stoppedBy: { slug: 'chapter-1-polynomials', title: 'Polynomials', reason: 'Canvas refused the request. (HTTP 500)' },
  remaining: [LANDED[1]!],
}

test('a finished push reports every page, and whether it replaced one', () => {
  render(<ResultScreen chapters={[]} push={complete} />)
  expect(screen.getByText('Introduction')).toBeInTheDocument()
  expect(screen.getByText('Replaced an existing page')).toBeInTheDocument()
  expect(screen.getByText('Created')).toBeInTheDocument()
})

/*
  The no-rollback promise, said out loud on the screen where it matters. A run
  that stopped at page 7 of 15 left those 7 in the course, and an instructor who
  is not told that will go looking for a half-imported course they think is empty.
*/
test('a push that stopped part-way says what landed, why it stopped, and offers to resume', () => {
  const onResume = vi.fn()
  render(<ResultScreen chapters={[]} push={stopped} onResume={onResume} />)

  expect(screen.getByText(/1 of 2 pages/)).toBeInTheDocument()
  expect(screen.getByText(/Canvas refused the request/)).toBeInTheDocument()
  expect(screen.getByText(/left in place/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume — 1 page left' }))
  expect(onResume).toHaveBeenCalled()
})

test('a push that finished offers nothing to resume', () => {
  render(<ResultScreen chapters={[]} push={complete} onResume={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument()
})

test('a completed push links each landed page back to Canvas', () => {
  render(<ResultScreen chapters={[]} push={complete} />)
  expect(screen.getByRole('link', { name: /View in Canvas.*Introduction/ })).toHaveAttribute(
    'href',
    'https://school.instructure.com/courses/7/pages/introduction',
  )
})

test('a cartridge result can be downloaded again', () => {
  const onDownloadAgain = vi.fn()
  render(
    <ResultScreen
      chapters={[]}
      filename="chapter-1-2026-08-24.imscc"
      onDownloadAgain={onDownloadAgain}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Download again' }))
  expect(onDownloadAgain).toHaveBeenCalledOnce()
})
