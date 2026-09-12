import { fireEvent, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
import { reviewKeyOf } from './useIdeaReviews'
import { newHeader, newReview, reduceHeader, reduceReview, type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent } from '../../engine/idea/review'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import { newEdits, reduceEdits, ideaEditKey, type IdeaEdits } from '../../engine/idea/edits'
import type { GateResult } from '../../engine/gate'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
  xrefs: new Map(),
})

/** A passed verdict, the way `PlanScreen.test.tsx` builds one. */
const GATE = {
  html: '<h2>Nutrients</h2><p>The body needs six major nutrients.</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as CompiledSection['gate']

const section = (id: string, title: string): CompiledSection => ({
  id, title, html: '<p>compiled but unaudited</p>', notes: [], queue: [], gate: GATE,
})

const compiled = (title: string): CompiledChapter => ({
  chapter: chapter(title), sections: [section(`${title}-s1`, 'Nutrients')], queue: [],
})

function renderScreen({
  chapters = [compiled('4: Nutrition'), compiled('5: Digestion')],
  reviews = new Map<string, IdeaReview>(),
  header = newHeader(),
}: { chapters?: CompiledChapter[]; reviews?: Map<string, IdeaReview>; header?: IdeaHeader } = {}) {
  const onEvent = vi.fn<(key: string, e: IdeaReviewEvent) => void>()
  const onHeaderEvent = vi.fn<(e: IdeaHeaderEvent) => void>()
  const onForget = vi.fn()
  const onExport = vi.fn<(key: string, f: 'md' | 'json') => string>().mockReturnValue('idea-rubric1-x.md')
  render(
    <IdeaScreen
      chapters={chapters} reviews={reviews} header={header} onEvent={onEvent} onHeaderEvent={onHeaderEvent} onForget={onForget} onExport={onExport}
      edits={new Map()} pending={new Set()} onEditEvent={vi.fn()}
    />,
  )
  return { onEvent, onHeaderEvent, onForget, onExport }
}

test('with nothing prepared it says so', () => {
  renderScreen({ chapters: [] })
  expect(screen.getByText('Nothing to review yet. Prepare chapters first.')).toBeInTheDocument()
})

test('the eight categories render in order with only the first open', () => {
  renderScreen()
  const headers = screen.getAllByRole('button', { name: /^7\.\d / })
  expect(headers.map((h) => h.textContent?.slice(0, 3))).toEqual(['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8'])
  expect(headers[0]).toHaveAttribute('aria-expanded', 'true')
  expect(headers[1]).toHaveAttribute('aria-expanded', 'false')
})

test('opening a panel closes the one that was open', () => {
  renderScreen()
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  expect(screen.getByRole('button', { name: /^7\.6 / })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: /^7\.1 / })).toHaveAttribute('aria-expanded', 'false')
})

// The instructor reads what they rate, on the same screen.
test('the chapter is readable beside the panels, without the accessibility verdicts', () => {
  renderScreen()
  const render = screen.getByRole('complementary', { name: 'Chapter as it will be published' })
  expect(within(render).getByText('The body needs six major nutrients.')).toBeInTheDocument()
  expect(within(render).queryByRole('heading', { name: 'Accessibility' })).not.toBeInTheDocument()
})

test('the chapter switcher changes which review and which chapter the screen shows', () => {
  const k5 = reviewKeyOf(chapter('5: Digestion'))
  const reviews = new Map([[k5, reduceReview(newReview(), { type: 'note', categoryId: '7.1', notes: 'digestion note' })]])
  renderScreen({ reviews })
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter under review' }), { target: { value: '1' } })
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('digestion note')
  expect(screen.getByRole('heading', { name: '5: Digestion' })).toBeInTheDocument()
})

test('events are dispatched with the current chapter key', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'hi' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'note', categoryId: '7.1', notes: 'hi' })
})

test('summary and suggestions are chapter-level and dispatch with the current key', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'ok' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'summary', text: 'ok' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Suggestions' }), { target: { value: 'more' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'suggestions', text: 'more' })
})

test('assessor and benchmark dispatch header events, not chapter events', () => {
  const { onEvent, onHeaderEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'A. Lee' } })
  expect(onHeaderEvent).toHaveBeenCalledWith({ type: 'assessor', assessor: { name: 'A. Lee' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'BIPOC benchmark' }), { target: { value: '62' } })
  expect(onHeaderEvent).toHaveBeenCalledWith({ type: 'benchmark', bipocPercent: 62 })
  expect(onEvent).not.toHaveBeenCalled()
})

// Clearing the field to retype must not snap it to a number under the cursor.
test('an emptied benchmark field dispatches nothing and restores on blur', () => {
  const header = reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 })
  const { onHeaderEvent } = renderScreen({ header })
  const field = screen.getByRole('spinbutton', { name: 'BIPOC benchmark' })
  expect(field).toHaveValue(62)
  fireEvent.change(field, { target: { value: '' } })
  expect(onHeaderEvent).not.toHaveBeenCalled()
  expect(field).toHaveValue(null)
  fireEvent.blur(field)
  expect(field).toHaveValue(62)
})

test('export is two plain buttons and announces the file produced', () => {
  const { onExport } = renderScreen()
  const group = screen.getByRole('group', { name: 'Export Rubric 1' })
  fireEvent.click(within(group).getByRole('button', { name: 'Download JSON' }))
  expect(onExport).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), 'json')
  expect(screen.getByRole('status')).toHaveTextContent('Downloaded idea-rubric1-x.md.')
  fireEvent.click(within(group).getByRole('button', { name: 'Download Markdown' }))
  expect(onExport).toHaveBeenLastCalledWith(reviewKeyOf(chapter('4: Nutrition')), 'md')
})

test('forgetting asks first, then forgets and announces', () => {
  const { onForget } = renderScreen()
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  expect(onForget).not.toHaveBeenCalled()
  const confirm = screen.getByRole('group', { name: 'Forget all IDEA reviews' })
  expect(within(confirm).getByText(/removes every chapter/)).toBeInTheDocument()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }))
  expect(onForget).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Forget all IDEA reviews' })).getByRole('button', { name: 'Forget' }))
  expect(onForget).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('IDEA reviews forgotten.')
})

test('the storage rule and the Framework attribution are on screen', () => {
  renderScreen()
  expect(screen.getByText(/saved in this browser on this device/)).toBeInTheDocument()
  expect(screen.getByText(/Framework text from "ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism \(IDEA\) Framework/)).toBeInTheDocument()
  expect(screen.getByText(/licensed CC BY 4\.0/)).toBeInTheDocument()
})

const gate = (html: string): GateResult => ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const withHtml = (title: string, html: string): CompiledChapter => ({
  chapter: chapter(title),
  sections: [{ id: `${title}-s1`, title: 'S1', html, notes: [], queue: [], gate: gate(html) }],
  queue: [],
})

/** Slice 1's props plus this slice's, so each test names only what it varies. */
const base = {
  reviews: new Map(), header: newHeader(), onEvent: vi.fn(), onHeaderEvent: vi.fn(), onForget: vi.fn(), onExport: () => 'x',
  edits: new Map<string, IdeaEdits>(), pending: new Set<string>(), onEditEvent: vi.fn(),
}

test('findings are computed from the prepared html and edits suppress them', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">He suffers from asthma.</p>')
  const onEditEvent = vi.fn()
  const { rerender } = render(<IdeaScreen {...base} chapters={[c]} onEditEvent={onEditEvent} />)
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  const key = ideaEditKey('4: Nutrition-s1', 'b2c-blk-0', 0, 'suffers from')
  expect(onEditEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'replace', key, replacement: 'has' })
  const edits = new Map<string, IdeaEdits>([[reviewKeyOf(chapter('4: Nutrition')), reduceEdits(newEdits(), { type: 'replace', key, replacement: 'has' })]])
  rerender(<IdeaScreen {...base} chapters={[c]} edits={edits} onEditEvent={onEditEvent} />)
  expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
  expect(screen.getByText('“suffers from” → “has”')).toBeInTheDocument()
})

test('the chapter render beside the panels shows the pending line for a section being re-checked', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">x</p>')
  render(<IdeaScreen {...base} chapters={[c]} pending={new Set(['4: Nutrition-s1'])} />)
  const aside = screen.getByRole('complementary', { name: 'Chapter as it will be published' })
  expect(within(aside).getByText('Re-checking this section…')).toBeInTheDocument()
})

test('an edit decision is announced in the status line', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">He suffers from asthma.</p>')
  render(<IdeaScreen {...base} chapters={[c]} />)
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(screen.getByRole('status')).toHaveTextContent('Applied.')
})

test('a dismissal and an undo are announced too', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">He suffers from asthma.</p>')
  const key = ideaEditKey('4: Nutrition-s1', 'b2c-blk-0', 0, 'suffers from')
  const edits = new Map<string, IdeaEdits>([[reviewKeyOf(chapter('4: Nutrition')), reduceEdits(newEdits(), { type: 'replace', key, replacement: 'has' })]])
  render(<IdeaScreen {...base} chapters={[c]} edits={edits} />)
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByRole('status')).toHaveTextContent('Undone.')
})
