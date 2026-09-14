import { fireEvent, render, screen, within } from '@testing-library/react'
import { BookPatterns } from './BookPatterns'
import { providerById } from '../../engine/idea/llm/providers'
import { newReview } from '../../engine/idea/review'
import type { SectionInput, BookChapterInput } from '../../engine/idea/llm/prompts'

const section = (text: string): SectionInput => ({ sectionId: 's', sectionTitle: 'S', chapterTitle: 'C', text, images: [], metadata: [] })
const ch = (key: string, text = 'one two three'): BookChapterInput => ({ chapterKey: key, chapterTitle: key, review: newReview(), sections: [section(text)] })
const base = {
  bookTitle: 'Human Biology', region: '', provider: providerById('openrouter'), state: { status: 'idle' as const }, stored: undefined,
  firstRun: true, onSend: vi.fn(), onCancel: vi.fn(), onExport: vi.fn(() => 'idea-book-patterns-x.md'), onAnnounce: vi.fn(),
}

test('renders nothing with fewer than two chapters', () => {
  const { container } = render(<BookPatterns {...base} chapters={[ch('a')]} />)
  expect(container).toBeEmptyDOMElement()
})

test('states the size, sends once on click, and names the provider', () => {
  const onSend = vi.fn()
  render(<BookPatterns {...base} chapters={[ch('a'), ch('b')]} onSend={onSend} />)
  expect(screen.getByRole('region', { name: /^Across the chapters/ })).toBeInTheDocument()
  expect(screen.getByText(/This sends the text of 2 chapters \(about 6 words\)/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Send the book to OpenRouter' }))
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('over the ceiling the button is disabled and the sentence names both numbers', () => {
  render(<BookPatterns {...base} chapters={[ch('a', 'x'.repeat(400_001)), ch('b')]} />)
  const button = screen.getByRole('button', { name: 'Send the book to OpenRouter' })
  expect(button).toBeDisabled()
  expect(screen.getByText(/OpenRouter accepts 100,000/)).toBeInTheDocument()
  expect(screen.getByText(/Deselect chapters on Content/)).toBeInTheDocument()
})

test('a result renders the summary, two tables with the draft chip and no radio, and the downloads announce', () => {
  const stored = { draft: { summary: 'Weak on 7.4.', areas: [{ area: '7.4' as const, rating: 'exclusive' as const, notes: 'few' }, { area: '7.1' as const, rating: null, notes: '' }], revisions: [{ where: 'Ch 5', revision: 'cite', rationale: 'why' }] }, provider: 'OpenRouter', at: 1 }
  const onAnnounce = vi.fn()
  render(<BookPatterns {...base} chapters={[ch('a'), ch('b')]} state={{ status: 'done', findings: [], at: 1 }} stored={stored} onAnnounce={onAnnounce} />)
  expect(screen.getByText('Weak on 7.4.')).toBeInTheDocument()
  const areas = screen.getByRole('table', { name: 'Areas' })
  expect(within(areas).getByText('Exclusive')).toBeInTheDocument()
  expect(within(areas).getByText('no draft')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Prioritized revisions or supplements' })).toHaveTextContent('Ch 5')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(document.querySelector('.b2c-idea-draft')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Download patterns (Markdown)' }))
  expect(base.onExport).toHaveBeenCalledWith('md')
  expect(onAnnounce).toHaveBeenCalledWith('Downloaded idea-book-patterns-x.md.')
})

test('a failure renders the mapped message', () => {
  render(<BookPatterns {...base} chapters={[ch('a'), ch('b')]} state={{ status: 'failed', failure: 'timeout', message: 'x' }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('did not answer in time')
})
