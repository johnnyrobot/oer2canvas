import { newHeader, newReview, reduceHeader, reduceReview } from './review'
import { IDEA_STORAGE_KEY, restore, toPersisted } from './store'
import { ideaEditKey, newEdits, reduceEdits } from './edits'

function sample() {
  let r = newReview()
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.5', answer: 'yes' })
  r = reduceReview(r, { type: 'note', categoryId: '7.6', notes: 'p. 12' })
  r = reduceReview(r, { type: 'summary', text: 'ok' })
  let h = newHeader()
  h = reduceHeader(h, { type: 'assessor', assessor: { name: 'A. Lee' } })
  h = reduceHeader(h, { type: 'benchmark', bipocPercent: 62 })
  return { review: r, header: h }
}

test('the storage key is namespaced like the rest of the database', () => {
  expect(IDEA_STORAGE_KEY).toBe('idea.reviews')
})

test('a persisted document round-trips through restore', () => {
  const { review, header } = sample()
  const doc = toPersisted(header, new Map([['k', review]]), new Map())
  expect(doc.version).toBe(1)
  const back = restore(doc)!
  expect(back.header).toEqual(header)
  expect(back.reviews.get('k')).toEqual(review)
})

test('anything that is not a version-1 document restores to nothing', () => {
  expect(restore(undefined)).toBeUndefined()
  expect(restore(null)).toBeUndefined()
  expect(restore('x')).toBeUndefined()
  expect(restore({ version: 2 })).toBeUndefined()
})

// Restore REPLAYS through the reducers rather than trusting the bytes: a row
// or element id the current Framework does not know is dropped exactly as a
// live event naming it would be, and a value that is not a Rating is dropped
// rather than rendered as a checked radio the instructor never clicked.
test('unknown ids and malformed values are dropped, known ones kept', () => {
  const back = restore({
    version: 1,
    header: { assessor: { name: 'A', title: 7, college: null }, benchmark: { bipocPercent: '62' } },
    reviews: new Map<unknown, unknown>([
      ['k', {
        summary: 'kept',
        suggestions: 42,
        categories: {
          '7.1': { ratings: new Map([['7.1.a', 'emerging'], ['7.1.z', 'inclusive'], ['7.1.b', 'wonderful']]), notes: 'n', checklist: new Map([['7.1.1', 'yes'], ['9.9.9', 'no']]) },
          '7.6': { ratings: 'not a map', notes: null, checklist: new Map() },
          '8.1': { ratings: new Map([['8.1.a', 'inclusive']]), notes: '', checklist: new Map() },
        },
      }],
      [3, { summary: 'dropped: key is not a string' }],
    ]),
  })!
  expect(back.header.assessor).toEqual({ name: 'A', title: '', college: '' })
  expect(back.header.benchmark.bipocPercent).toBe(77)
  expect(back.reviews.size).toBe(1)
  const r = back.reviews.get('k')!
  expect(r.summary).toBe('kept')
  expect(r.suggestions).toBe('')
  expect([...r.categories['7.1'].ratings]).toEqual([['7.1.a', 'emerging']])
  expect([...r.categories['7.1'].checklist]).toEqual([['7.1.1', 'yes']])
  expect(r.categories['7.1'].notes).toBe('n')
  expect(r.categories['7.6'].ratings.size).toBe(0)
  expect(r.categories['7.6'].notes).toBe('')
  expect('8.1' in r.categories).toBe(false)
})

test('edits round-trip with the document; dismissals do not', () => {
  const { review, header } = sample()
  const k = ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy')
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })
  e = reduceEdits(e, { type: 'keep', key: ideaEditKey('s1', 'b2c-blk-1', 0, 'the blind'), context: 'as quoted' })
  e = reduceEdits(e, { type: 'dismiss', key: ideaEditKey('s1', 'b2c-blk-2', 0, 'hit the books') })
  const doc = toPersisted(header, new Map([['k', review]]), new Map([['k', e]]))
  const back = restore(doc)!
  expect(back.edits.get('k')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  expect([...back.edits.get('k')!.edits.values()]).toHaveLength(2)
  // Session-only by spec §2.3: a dismissal hides a finding for THIS session.
  expect(back.edits.get('k')?.dismissed.size).toBe(0)
})

test('a document written before edits existed restores with none', () => {
  const { review, header } = sample()
  const { edits: _drop, ...older } = toPersisted(header, new Map([['k', review]]), new Map())
  void _drop
  expect(restore(older)!.edits.size).toBe(0)
})

test('malformed edits are dropped, well-formed ones kept', () => {
  const back = restore({
    version: 1,
    header: {},
    reviews: new Map(),
    edits: new Map<string, unknown>([
      ['k', { edits: new Map<string, unknown>([
        ['s1::b2c-blk-0::0::crazy', { kind: 'replace', replacement: 'wild' }],
        ['s1::b2c-blk-1::0::x', { kind: 'keep' }],
        ['s1::b2c-blk-2::0::y', { kind: 'keep', context: 7 }],
        ['s1::b2c-blk-3::0::z', { kind: 'delete' }],
        ['not-a-key', { kind: 'replace', replacement: 'x' }],
        ['s1::b2c-blk-4::0::w', 'replace'],
      ]) }],
      ['bad', 'not a record'],
    ]),
  })!
  const e = back.edits.get('k')!
  expect([...e.edits.entries()]).toEqual([
    ['s1::b2c-blk-0::0::crazy', { kind: 'replace', replacement: 'wild' }],
    ['s1::b2c-blk-1::0::x', { kind: 'keep' }],
  ])
  expect(back.edits.has('bad')).toBe(false)
})
