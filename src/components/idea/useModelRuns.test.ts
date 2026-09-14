import { act, renderHook, waitFor } from '@testing-library/react'
import { useModelRuns, bookRunKey, planRunKey } from './useModelRuns'
import type { SectionInput } from '../../engine/idea/llm/prompts'
import { complete as defaultComplete, LlmError } from '../../engine/idea/llm/client'
import { newReview } from '../../engine/idea/review'

const settings = { provider: 'openrouter' as const, key: 'k', model: 'm' }
const input: SectionInput = { sectionId: 's1', sectionTitle: 'S', chapterTitle: 'C', text: 'The chairman spoke.', images: [], metadata: [] }
const html = '<p id="b2c-blk-0">The chairman spoke.</p>'

test('a category run posts once, parses, and stores draft findings; nothing runs without a click', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ summary: 's', items: [{ evidence: 'chairman', inference: 'gendered', suggestion: 'chair', original: 'chairman', replacement: 'chair' }] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  expect(complete).not.toHaveBeenCalled()
  act(() => result.current.runCategory('ch', '7.2', input, html))
  expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('running')
  await waitFor(() => expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('done'))
  const done = result.current.runs.get('ch::s1::7.2')
  expect(done?.status === 'done' && done.findings.map((f) => f.kind)).toEqual(['observation', 'edit'])
  expect(complete).toHaveBeenCalledTimes(1)
})

test('a failure is stored with its mapped state', async () => {
  const complete = vi.fn(async () => { throw new LlmError('bad-key', 'rejected') })
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  await waitFor(() => expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('failed'))
  expect(result.current.runs.get('ch::s1::7.2')).toMatchObject({ failure: 'bad-key' })
})

test('a second click while running is ignored; cancel aborts', async () => {
  let resolve: (v: { text: string }) => void = () => {}
  const complete = vi.fn(() => new Promise<{ text: string }>((r) => { resolve = r }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  expect(complete).toHaveBeenCalledTimes(1)
  act(() => result.current.cancel('ch::s1::7.2'))
  expect(result.current.runs.get('ch::s1::7.2')?.status).toBe('idle')
  resolve({ text: '{}' })
})

test('the rubric run stores a draft per chapter', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runRubric('ch', 'C', [input]))
  await waitFor(() => expect(result.current.rubricDrafts.get('ch')?.areas).toEqual([
    { id: '7.1', rows: [{ id: '7.1.a', rating: null }, { id: '7.1.b', rating: null }, { id: '7.1.c', rating: null }], notes: 'n' },
  ]))
})

test('nothing runs without settings', () => {
  const complete = vi.fn()
  const { result } = renderHook(() => useModelRuns({ settings: undefined, deps: { complete } }))
  act(() => result.current.runCategory('ch', '7.2', input, html))
  expect(complete).not.toHaveBeenCalled()
  expect(result.current.runs.size).toBe(0)
})

const bookChapters = [{ chapterKey: 'ch', chapterTitle: 'C', review: newReview(), sections: [input] }]
const planInput = { chapterTitle: 'C', bookTitle: 'B', licence: 'CC BY 4.0', region: '', review: newReview(), applied: [], drafts: [] }

test('runBook posts once with the long timeout and stores the draft by book title with provenance', async () => {
  const complete = vi.fn<typeof defaultComplete>(async () => ({ text: JSON.stringify({ summary: 's', areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }], revisions: [] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runBook('Human Biology', bookChapters, ''))
  expect(result.current.runs.get(bookRunKey('Human Biology'))?.status).toBe('running')
  await waitFor(() => expect(result.current.runs.get(bookRunKey('Human Biology'))?.status).toBe('done'))
  expect(complete).toHaveBeenCalledTimes(1)
  expect(complete.mock.calls[0]![4]).toMatchObject({ timeoutMs: 180_000 })
  const stored = result.current.bookDrafts.get('Human Biology')!
  expect(stored.draft.areas).toEqual([{ area: '7.1', rating: 'inclusive', notes: 'n' }])
  expect(stored.provider).toBe('OpenRouter')
  expect(stored.at).toBeGreaterThan(0)
})

test('runBook refuses a prompt over the provider ceiling without calling', () => {
  const complete = vi.fn()
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  const huge = [{ ...bookChapters[0]!, sections: [{ ...input, text: 'x'.repeat(100_000 * 4 + 1) }] }]
  act(() => result.current.runBook('Big', huge, ''))
  expect(complete).not.toHaveBeenCalled()
  expect(result.current.runs.get(bookRunKey('Big'))).toBeUndefined()
})

test('runPlan stores the plan by chapter key; a prose reply fails the run', async () => {
  const complete = vi.fn(async () => ({ text: JSON.stringify({ plan: [{ priority: 1, where: 'w', issue: 'i', revision: 'r', rationale: 'y', licence: 'l' }], studentText: [] }) }))
  const { result } = renderHook(() => useModelRuns({ settings, deps: { complete } }))
  act(() => result.current.runPlan('ch', planInput))
  await waitFor(() => expect(result.current.planDrafts.get('ch')?.draft.plan).toHaveLength(1))
  expect(result.current.runs.get(planRunKey('ch'))?.status).toBe('done')

  const prose = vi.fn(async () => ({ text: 'Sure, here is a plan.' }))
  const second = renderHook(() => useModelRuns({ settings, deps: { complete: prose } }))
  act(() => second.result.current.runPlan('ch', planInput))
  await waitFor(() => expect(second.result.current.runs.get(planRunKey('ch'))?.status).toBe('failed'))
  expect(second.result.current.planDrafts.has('ch')).toBe(false)
})

test('unmount aborts a book run in flight', () => {
  let signal: AbortSignal | undefined
  const complete = vi.fn((_p: unknown, _s: unknown, _m: unknown, s: AbortSignal) => { signal = s; return new Promise<{ text: string }>(() => {}) })
  const { result, unmount } = renderHook(() => useModelRuns({ settings, deps: { complete: complete as never } }))
  act(() => result.current.runBook('B', bookChapters, ''))
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
})
