import { act, renderHook, waitFor } from '@testing-library/react'
import { SAVE_DELAY_MS, reviewKeyOf, useIdeaReviews } from './useIdeaReviews'
import { IDEA_STORAGE_KEY, restore, toPersisted } from '../../engine/idea/store'
import { newHeader, newReview, reduceReview } from '../../engine/idea/review'
import type { KeyValueStore } from '../../canvas/credentials'
import type { Chapter } from '../../sources/types'
import { ideaEditKey, newEdits, reduceEdits } from '../../engine/idea/edits'
import type { ImportedAsset } from '../../import/types'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] },
  xrefs: new Map(),
})

/** An in-memory KeyValueStore: what IndexedDB is to the app, a Map is to this test. */
function memoryStore(initial?: unknown) {
  const map = new Map<string, unknown>()
  if (initial !== undefined) map.set(IDEA_STORAGE_KEY, initial)
  const store: KeyValueStore = {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, value) },
    remove: async (key) => { map.delete(key) },
  }
  return { map, store }
}

test('the key is stable for a chapter and distinct across chapters', () => {
  expect(reviewKeyOf(chapter('4: Nutrition'))).toBe(reviewKeyOf(chapter('4: Nutrition')))
  expect(reviewKeyOf(chapter('4: Nutrition'))).not.toBe(reviewKeyOf(chapter('5: Digestion')))
})

test('with no store, a review is created on first dispatch and kept per key', () => {
  const { result } = renderHook(() => useIdeaReviews())
  const k = reviewKeyOf(chapter('4: Nutrition'))
  expect(result.current.loaded).toBe(true)
  expect(result.current.reviews.size).toBe(0)
  expect(result.current.reviewFor(k).summary).toBe('')
  act(() => result.current.dispatch(k, { type: 'rate', categoryId: '7.2', rowId: '7.2.a', rating: 'inclusive' }))
  expect(result.current.reviews.get(k)?.categories['7.2'].ratings.get('7.2.a')).toBe('inclusive')
  act(() => result.current.dispatch(reviewKeyOf(chapter('5: Digestion')), { type: 'note', categoryId: '7.1', notes: 'x' }))
  expect(result.current.reviews.size).toBe(2)
  expect(result.current.reviews.get(k)?.categories['7.1'].notes).toBe('')
})

test('the header is one per session, not per chapter', () => {
  const { result } = renderHook(() => useIdeaReviews())
  expect(result.current.header.benchmark.bipocPercent).toBe(77)
  act(() => result.current.dispatchHeader({ type: 'assessor', assessor: { name: 'A. Lee' } }))
  act(() => result.current.dispatchHeader({ type: 'benchmark', bipocPercent: 62 }))
  expect(result.current.header).toEqual({ assessor: { name: 'A. Lee', title: '', college: '' }, benchmark: { bipocPercent: 62 } })
})

test('a saved document is restored on mount', async () => {
  const k = reviewKeyOf(chapter('4: Nutrition'))
  const saved = reduceReview(newReview(), { type: 'note', categoryId: '7.6', notes: 'from last week' })
  const { store } = memoryStore(toPersisted(newHeader(), new Map([[k, saved]]), new Map()))
  const { result } = renderHook(() => useIdeaReviews(store))
  expect(result.current.loaded).toBe(false)
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.reviews.get(k)?.categories['7.6'].notes).toBe('from last week')
})

test('a change is written to the store after the save delay, in the persisted shape', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  const k = reviewKeyOf(chapter('4: Nutrition'))
  act(() => result.current.dispatch(k, { type: 'note', categoryId: '7.1', notes: 'a' }))
  act(() => result.current.dispatch(k, { type: 'note', categoryId: '7.1', notes: 'ab' }))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  const back = restore(map.get(IDEA_STORAGE_KEY))!
  expect(back.reviews.get(k)?.categories['7.1'].notes).toBe('ab')
})

// A keystroke that lands before the read returns must not overwrite last
// week's reviews with one note.
test('nothing is written before the load has settled', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const { map, store } = memoryStore()
  const slow: KeyValueStore = { ...store, get: async (key) => { await gate; return store.get(key) } }
  const { result } = renderHook(() => useIdeaReviews(slow))
  act(() => result.current.dispatch('k', { type: 'summary', text: 'early' }))
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
  release()
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.reviews.get('k')?.summary).toBe('early')
})

test('forgetAll empties every review and the header and removes the stored document', async () => {
  const { map, store } = memoryStore(toPersisted(newHeader(), new Map([['a', newReview()]]), new Map()))
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.reviews.size).toBe(1))
  act(() => result.current.dispatchHeader({ type: 'benchmark', bipocPercent: 50 }))
  act(() => result.current.forgetAll())
  expect(result.current.reviews.size).toBe(0)
  expect(result.current.header.benchmark.bipocPercent).toBe(77)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(false))
  // And the pending debounce from the benchmark change does not resurrect it.
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
})

test('a store that fails leaves the hook usable and unsaved', async () => {
  const broken: KeyValueStore = {
    get: async () => { throw new Error('no indexedDB here') },
    set: async () => { throw new Error('no indexedDB here') },
    remove: async () => { throw new Error('no indexedDB here') },
  }
  const { result } = renderHook(() => useIdeaReviews(broken))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  act(() => result.current.dispatch('k', { type: 'summary', text: 'still works' }))
  expect(result.current.reviews.get('k')?.summary).toBe('still works')
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  act(() => result.current.forgetAll())
  expect(result.current.reviews.size).toBe(0)
})

test('edits are kept per chapter key, saved with the document, and forgotten with it', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  const k = ideaEditKey('s1', 'a', 0, 'crazy')
  expect(result.current.editsFor('ch1').edits.size).toBe(0)
  act(() => result.current.dispatchEdit('ch1', { type: 'replace', key: k, replacement: 'wild' }))
  expect(result.current.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  expect(result.current.editsFor('ch2').edits.size).toBe(0)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  expect(restore(map.get(IDEA_STORAGE_KEY))!.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  act(() => result.current.forgetAll())
  expect(result.current.edits.size).toBe(0)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(false))
})

test('a saved edit is restored on mount', async () => {
  const k = ideaEditKey('s1', 'a', 0, 'crazy')
  const e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })
  const { store } = memoryStore(toPersisted(newHeader(), new Map(), new Map([['ch1', e]])))
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
})

const asset: ImportedAsset = {
  id: 'idea-abc', mediaType: 'image/png', extension: 'png', bytes: new Uint8Array([137, 80, 78, 71]), sha256: 'abc', originPart: 'idea/commons/File:Dot.png', name: 'dot-abc12345.png',
}

test('an added asset is kept per chapter, saved with the document, restored, and forgotten with it', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.assetsFor('ch1')).toEqual([])
  act(() => result.current.addAsset('ch1', asset))
  expect(result.current.assetsFor('ch1')).toEqual([asset])
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  expect(restore(map.get(IDEA_STORAGE_KEY))!.assets.get('ch1')).toEqual([asset])
  const again = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(again.result.current.assetsFor('ch1')).toEqual([asset]))
  act(() => again.result.current.forgetAll())
  expect(again.result.current.assetsFor('ch1')).toEqual([])
})

test('adding an asset with a name already present replaces it rather than duplicating', () => {
  const { result } = renderHook(() => useIdeaReviews())
  act(() => result.current.addAsset('ch1', asset))
  act(() => result.current.addAsset('ch1', { ...asset, sha256: 'def' }))
  expect(result.current.assetsFor('ch1')).toHaveLength(1)
  expect(result.current.assetsFor('ch1')[0]!.sha256).toBe('def')
})
