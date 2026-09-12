import { act, renderHook, waitFor } from '@testing-library/react'
import { useModelRuns } from './useModelRuns'
import type { SectionInput } from '../../engine/idea/llm/prompts'
import { LlmError } from '../../engine/idea/llm/client'

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
