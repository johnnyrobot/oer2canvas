import {
  DEFAULT_BIPOC_PERCENT, isCategoryRated, newHeader, newReview, ratedCount, ratingCounts, reduceHeader, reduceReview,
  type IdeaReview,
} from './review'
import { IDEA_CATEGORY_IDS } from './framework'

test('a new review has every category, nothing rated, and empty chapter-level fields', () => {
  const r = newReview()
  expect(Object.keys(r.categories)).toEqual(IDEA_CATEGORY_IDS)
  for (const id of IDEA_CATEGORY_IDS) {
    expect(r.categories[id].ratings.size).toBe(0)
    expect(r.categories[id].notes).toBe('')
    expect(r.categories[id].checklist.size).toBe(0)
  }
  expect(r.summary).toBe('')
  expect(r.suggestions).toBe('')
  expect(ratedCount(r)).toBe(0)
})

test('a new header carries the 77% benchmark and an empty assessor', () => {
  const h = newHeader()
  expect(h.benchmark.bipocPercent).toBe(DEFAULT_BIPOC_PERCENT)
  expect(h.assessor).toEqual({ name: '', title: '', college: '' })
})

test('rating a row records it and clearing removes it', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.2', rowId: '7.2.a', rating: 'emerging' })
  expect(r.categories['7.2'].ratings.get('7.2.a')).toBe('emerging')
  expect(isCategoryRated(r, '7.2')).toBe(true)
  r = reduceReview(r, { type: 'clear-rating', categoryId: '7.2', rowId: '7.2.a' })
  expect(r.categories['7.2'].ratings.has('7.2.a')).toBe(false)
  expect(isCategoryRated(r, '7.2')).toBe(false)
})

// 7.1 has three rubric rows. Two of three is not rated — the sidebar count and
// the export both promise a complete row set when they say "rated".
test('a category with several rubric rows is rated only when every row is', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'exclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.b', rating: 'inclusive' })
  expect(isCategoryRated(r, '7.1')).toBe(false)
  expect(ratedCount(r)).toBe(0)
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.c', rating: 'na' })
  expect(isCategoryRated(r, '7.1')).toBe(true)
  expect(ratedCount(r)).toBe(1)
})

test('a rating for a row that is not in the category is refused, not stored', () => {
  const r = reduceReview(newReview(), { type: 'rate', categoryId: '7.2', rowId: '7.1.a', rating: 'inclusive' })
  expect(r.categories['7.2'].ratings.size).toBe(0)
  expect(r.categories['7.1'].ratings.size).toBe(0)
})

test('notes and checklist answers are stored per category', () => {
  let r = reduceReview(newReview(), { type: 'note', categoryId: '7.6', notes: 'p. 12 uses "hermaphroditism"' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.1', answer: 'no' })
  expect(r.categories['7.6'].notes).toBe('p. 12 uses "hermaphroditism"')
  expect(r.categories['7.6'].checklist.get('7.6.1')).toBe('no')
  expect(r.categories['7.5'].notes).toBe('')
})

test('a checklist answer for an element not in the category is refused', () => {
  const r = reduceReview(newReview(), { type: 'check', categoryId: '7.6', elementId: '7.1.1', answer: 'yes' })
  expect(r.categories['7.6'].checklist.size).toBe(0)
})

test('summary and suggestions are chapter-level text', () => {
  let r = reduceReview(newReview(), { type: 'summary', text: 'Strong on 7.5, weak on 7.1.' })
  r = reduceReview(r, { type: 'suggestions', text: 'Replace the two stock photos in 4.2.' })
  expect(r.summary).toBe('Strong on 7.5, weak on 7.1.')
  expect(r.suggestions).toBe('Replace the two stock photos in 4.2.')
})

// Rubric 1's "Category Count" block: how many rows landed in each column.
test('rating counts cover every rubric row, rated or not', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'na' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.8', rowId: '7.8.a', rating: 'inclusive' })
  expect(ratingCounts(r)).toEqual({ na: 1, exclusive: 0, emerging: 1, inclusive: 1, notRated: 7 })
})

// Framework §9.0: colleges may adjust the standard to their own demographics.
test('the benchmark is editable, clamped to a percentage, and unmoved by a non-number', () => {
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 }).benchmark.bipocPercent).toBe(62)
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 140 }).benchmark.bipocPercent).toBe(100)
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: -3 }).benchmark.bipocPercent).toBe(0)
  const at62 = reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 })
  expect(reduceHeader(at62, { type: 'benchmark', bipocPercent: Number.NaN }).benchmark.bipocPercent).toBe(62)
})

test('assessor fields merge', () => {
  let h = reduceHeader(newHeader(), { type: 'assessor', assessor: { name: 'A. Lee' } })
  h = reduceHeader(h, { type: 'assessor', assessor: { college: 'Foothill College' } })
  expect(h.assessor).toEqual({ name: 'A. Lee', title: '', college: 'Foothill College' })
})

test('the reducers never mutate their input', () => {
  const before: IdeaReview = newReview()
  const snap = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x))
  const snapshot = snap(before)
  reduceReview(before, { type: 'rate', categoryId: '7.3', rowId: '7.3.a', rating: 'inclusive' })
  reduceReview(before, { type: 'note', categoryId: '7.3', notes: 'x' })
  reduceReview(before, { type: 'summary', text: 'x' })
  expect(snap(before)).toBe(snapshot)
  const header = newHeader()
  const hsnap = snap(header)
  reduceHeader(header, { type: 'assessor', assessor: { name: 'x' } })
  expect(snap(header)).toBe(hsnap)
})
