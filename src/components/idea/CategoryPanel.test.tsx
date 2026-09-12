import { fireEvent, render, screen, within } from '@testing-library/react'
import { CategoryPanel } from './CategoryPanel'
import { categoryById } from '../../engine/idea/framework'
import { newReview, reduceReview, type IdeaReviewEvent } from '../../engine/idea/review'
import type { EditFinding, ObservationFinding } from '../../engine/idea/findings'

function renderPanel(id: '7.1' | '7.2' | '7.6' = '7.6', open = true) {
  const onEvent = vi.fn<(e: IdeaReviewEvent) => void>()
  const review = newReview().categories[id]
  const utils = render(
    <CategoryPanel category={categoryById(id)} review={review} open={open} onToggle={vi.fn()} onEvent={onEvent} />,
  )
  return { ...utils, onEvent }
}

test('the header is a button that reports expanded state and the category title', () => {
  renderPanel('7.6', false)
  const header = screen.getByRole('button', { name: /7\.6 Appropriate Terminology/ })
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('group', { name: /Rubric 1/ })).not.toBeInTheDocument()
})

test('open, it shows the restorative requirement, the checklist, the rubric rows, and notes', () => {
  renderPanel('7.6')
  expect(screen.getByText(/References to people, groups, populations/)).toBeInTheDocument()
  const checklist = screen.getByRole('group', { name: 'Elements for consideration' })
  expect(within(checklist).getAllByRole('radiogroup')).toHaveLength(categoryById('7.6').elements.length)
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getAllByRole('radiogroup')).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
})

test('7.1 renders three rubric rows, each its own radio group', () => {
  renderPanel('7.1')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getAllByRole('radiogroup')).toHaveLength(3)
})

test('clicking a rating dispatches a rate event for that row and nothing else', () => {
  const { onEvent } = renderPanel('7.6')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  fireEvent.click(within(rubric).getByRole('radio', { name: /^Emerging Inclusive/ }))
  expect(onEvent).toHaveBeenCalledTimes(1)
  expect(onEvent).toHaveBeenCalledWith({ type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'emerging' })
})

test('each rating radio carries the Rubric 1 wording for its column', () => {
  renderPanel('7.2')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getByRole('radio', { name: /Less than 30% of names reflect BIPOC culture/ })).toBeInTheDocument()
  expect(within(rubric).getByRole('radio', { name: /Not Applicable/ })).toBeInTheDocument()
})

test('a checklist answer dispatches a check event', () => {
  const { onEvent } = renderPanel('7.6')
  const checklist = screen.getByRole('group', { name: 'Elements for consideration' })
  const first = within(checklist).getAllByRole('radiogroup')[0]!
  fireEvent.click(within(first).getByRole('radio', { name: 'Unsure' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'check', categoryId: '7.6', elementId: '7.6.1', answer: 'unsure' })
})

test('typing notes dispatches a note event with the full text', () => {
  const { onEvent } = renderPanel('7.6')
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'p. 12' } })
  expect(onEvent).toHaveBeenCalledWith({ type: 'note', categoryId: '7.6', notes: 'p. 12' })
})

test('the current review is reflected as checked state', () => {
  let review = newReview()
  review = reduceReview(review, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'inclusive' })
  review = reduceReview(review, { type: 'check', categoryId: '7.6', elementId: '7.6.2', answer: 'no' })
  render(
    <CategoryPanel category={categoryById('7.6')} review={review.categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getByRole('radio', { name: /^Inclusive/ })).toBeChecked()
  const groups = within(screen.getByRole('group', { name: 'Elements for consideration' })).getAllByRole('radiogroup')
  expect(within(groups[1]!).getByRole('radio', { name: 'No' })).toBeChecked()
})

test('the header summary reads "rated" for a one-row category and counts rows otherwise', () => {
  let review = newReview()
  review = reduceReview(review, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'inclusive' })
  review = reduceReview(review, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'inclusive' })
  const { unmount } = render(
    <CategoryPanel category={categoryById('7.6')} review={review.categories['7.6']} open={false} onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  // 7.6 has a rule finder, so its header also carries the suggestion count.
  expect(screen.getByRole('button', { name: /7\.6 .*rated· 0 suggestions$/ })).toBeInTheDocument()
  expect(screen.queryByText(/1 of 1/)).not.toBeInTheDocument()
  unmount()
  render(
    <CategoryPanel category={categoryById('7.1')} review={review.categories['7.1']} open={false} onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /1 of 3 rows rated/ })).toBeInTheDocument()
})

test('the one string that argues sits above the rubric', () => {
  renderPanel('7.6')
  expect(screen.getByText('Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours.')).toBeInTheDocument()
})

test('resources are links that open in a new tab and say so', () => {
  renderPanel('7.6')
  const link = screen.getByRole('link', { name: /Disability Language Style Guide \(NCDJ\)/ })
  expect(link).toHaveAttribute('href', 'https://ncdj.org/style-guide/')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})

const finding: EditFinding = {
  kind: 'edit', key: 's1::a::0::crazy', category: '7.6', sectionId: 's1', elementId: 'a', original: 'crazy',
  occurrence: 0, replacement: 'wild', inQuotation: false, rule: { id: 'ablist-crazy', source: 'terms' }, origin: 'rule',
}

test('findings render in a "What a rule found" zone above the checklist, and the header counts them', () => {
  const onEditEvent = vi.fn()
  render(
    <CategoryPanel category={categoryById('7.6')} review={newReview().categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()}
      findings={[finding]} applied={[]} sectionTitleOf={() => 'S1'} onEditEvent={onEditEvent} onFocusFinding={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /7\.6 .*1 suggestion/ })).toBeInTheDocument()
  const zone = screen.getByRole('group', { name: 'What a rule found' })
  fireEvent.click(within(zone).getByRole('button', { name: 'Replace' }))
  expect(onEditEvent).toHaveBeenCalledWith({ type: 'replace', key: finding.key, replacement: 'wild' })
})

test('with no findings the zone says so without claiming a clean bill', () => {
  render(
    <CategoryPanel category={categoryById('7.6')} review={newReview().categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()}
      findings={[]} applied={[]} sectionTitleOf={() => 'S1'} onEditEvent={vi.fn()} onFocusFinding={vi.fn()} />,
  )
  expect(screen.getByText(/That is not a clean bill/)).toBeInTheDocument()
})

test('categories with no rule finder show no findings zone at all', () => {
  render(<CategoryPanel category={categoryById('7.4')} review={newReview().categories['7.4']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={[]} applied={[]} sectionTitleOf={() => ''} />)
  expect(screen.queryByRole('group', { name: 'What a rule found' })).not.toBeInTheDocument()
})

const inventoryRows: ObservationFinding[] = [
  { kind: 'observation', key: 's1::i1::0::image', category: '7.1', sectionId: 's1', elementId: 'i1', columns: { image: 'a.png', description: 'A nurse', 'mentions people': 'yes' }, rule: { id: 'inventory-image', source: 'inventory' }, origin: 'rule' },
  { kind: 'observation', key: 's1::summary::7.1', category: '7.1', sectionId: 's1', columns: { images: '1', 'mention people': '1', decorative: '0', 'no alt text': '0' }, rule: { id: 'inventory-image-summary', source: 'inventory' }, origin: 'rule' },
]

test('7.1 shows an Inventory zone whose header line is the summary', () => {
  render(<CategoryPanel category={categoryById('7.1')} review={newReview().categories['7.1']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={inventoryRows} applied={[]} sectionTitleOf={() => 'S'} />)
  expect(screen.getByRole('button', { name: /7\.1 .*1 image · 1 mentions people/ })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Inventory' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'What a rule found' })).not.toBeInTheDocument()
})

test('7.7 shows an Inventory zone with a row count', () => {
  const rows: ObservationFinding[] = [
    { kind: 'observation', key: 's1::h1::0::heading', category: '7.7', sectionId: 's1', elementId: 'h1', columns: { kind: 'heading', text: 'Lifespan' }, rule: { id: 'inventory-heading', source: 'inventory' }, origin: 'rule' },
  ]
  render(<CategoryPanel category={categoryById('7.7')} review={newReview().categories['7.7']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={rows} applied={[]} sectionTitleOf={() => 'S'} />)
  expect(screen.getByRole('button', { name: /7\.7 .*1 item/ })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Inventory' })).toBeInTheDocument()
})
