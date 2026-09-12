import { act, renderHook, waitFor } from '@testing-library/react'
import { useIdeaRecompile, type IdeaRecompileDeps } from './useIdeaRecompile'
import { ideaEditKey, newEdits, reduceEdits, type IdeaEdits } from '../../engine/idea/edits'
import { reviewKeyOf } from './useIdeaReviews'
import { OPENSTAX } from '../../engine/compile/context'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import type { QueueAnswer } from '../../engine/compile/answers'

const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: 'C', xrefs: new Map(),
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] },
  sections: [
    { id: 's1', title: 'S1', order: 0, html: '<p>crazy</p>' },
    { id: 's2', title: 'S2', order: 1, html: '<p>fine</p>' },
  ],
}
const gate = (html: string): GateResult =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const section = (id: string, html: string): CompiledSection => ({ id, title: id, html, notes: [], queue: [], gate: gate(html) })
// One identity across renders, as `App` holds it in state: the hook recompiles
// edited sections when the answers CHANGE, so a fresh map per render would loop.
const answers = new Map<string, QueueAnswer>()
const prepared: CompiledChapter[] = [{ chapter, sections: [section('s1', '<p id="b2c-blk-0">crazy</p>'), section('s2', '<p id="b2c-blk-0">fine</p>')], queue: [] }]

test('an edit recompiles only its section, re-audits it, and reports the rebuilt section with a gate', async () => {
  const recompile = vi.fn<IdeaRecompileDeps['recompile']>().mockImplementation((_c, ids) =>
    ids.map((id) => ({ id, title: id, html: `<p id="b2c-blk-0">wild</p>`, notes: [], queue: [] })),
  )
  const audit = vi.fn<IdeaRecompileDeps['audit']>().mockImplementation(async (html) => gate(html))
  const onRebuilt = vi.fn()
  const key = reviewKeyOf(chapter)
  let edits = new Map<string, IdeaEdits>()
  const { result, rerender } = renderHook(
    ({ e }) => useIdeaRecompile({ prepared, answers, edits: e, profileOf: () => OPENSTAX, onRebuilt, deps: { recompile, audit } }),
    { initialProps: { e: edits } },
  )
  expect(recompile).not.toHaveBeenCalled()

  edits = new Map([[key, reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy'), replacement: 'wild' })]])
  rerender({ e: edits })
  expect(recompile).toHaveBeenCalledWith(chapter, ['s1'], expect.objectContaining({ profile: OPENSTAX }))
  expect(result.current.pending.has('s1')).toBe(true)
  await waitFor(() => expect(onRebuilt).toHaveBeenCalledTimes(1))
  const [k, sections] = onRebuilt.mock.calls[0]!
  expect(k).toBe(key)
  expect(sections[0].gate?.html).toBe('<p id="b2c-blk-0">wild</p>')
  await waitFor(() => expect(result.current.pending.size).toBe(0))
})

test('undoing the last edit for a section recompiles that section too', async () => {
  const recompile = vi.fn<IdeaRecompileDeps['recompile']>().mockImplementation((_c, ids) =>
    ids.map((id) => ({ id, title: id, html: '<p id="b2c-blk-0">crazy</p>', notes: [], queue: [] })),
  )
  const audit = vi.fn<IdeaRecompileDeps['audit']>().mockImplementation(async (html) => gate(html))
  const key = reviewKeyOf(chapter)
  const k = ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy')
  const withEdit = new Map([[key, reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })]])
  const { rerender } = renderHook(
    ({ e }) => useIdeaRecompile({ prepared, answers, edits: e, profileOf: () => OPENSTAX, onRebuilt: vi.fn(), deps: { recompile, audit } }),
    { initialProps: { e: withEdit } },
  )
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(1))
  rerender({ e: new Map([[key, reduceEdits(withEdit.get(key)!, { type: 'undo', key: k })]]) })
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(2))
  expect(recompile.mock.calls[1]![1]).toEqual(['s1'])
})

test('a section whose run was superseded mid-flight is carried into the next run, so nothing stays pending', async () => {
  // Undo s1's last edit; before its audit lands, edit s2. The first run is
  // cancelled and must not report, but s1 still has to come back gated.
  const waiting: (() => void)[] = []
  const recompile = vi.fn<IdeaRecompileDeps['recompile']>().mockImplementation((_c, ids) =>
    ids.map((id) => ({ id, title: id, html: `<p id="b2c-blk-0">${id}</p>`, notes: [], queue: [] })),
  )
  // Every audit blocks until released, so each run is still in flight when
  // the next edit arrives.
  const audit = vi.fn<IdeaRecompileDeps['audit']>().mockImplementation(async (html) => {
    await new Promise<void>((r) => waiting.push(r))
    return gate(html)
  })
  const onRebuilt = vi.fn()
  const key = reviewKeyOf(chapter)
  const k1 = ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy')
  const k2 = ideaEditKey('s2', 'b2c-blk-0', 0, 'fine')
  const withEdit = new Map([[key, reduceEdits(newEdits(), { type: 'replace', key: k1, replacement: 'wild' })]])
  const { result, rerender } = renderHook(
    ({ e }) => useIdeaRecompile({ prepared, answers, edits: e, profileOf: () => OPENSTAX, onRebuilt, deps: { recompile, audit } }),
    { initialProps: { e: withEdit } },
  )
  await waitFor(() => expect(result.current.pending.has('s1')).toBe(true))
  const undone = reduceEdits(withEdit.get(key)!, { type: 'undo', key: k1 })
  rerender({ e: new Map([[key, undone]]) })
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(2))
  rerender({ e: new Map([[key, reduceEdits(undone, { type: 'replace', key: k2, replacement: 'good' })]]) })
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(3))
  expect([...recompile.mock.calls[2]![1]].sort()).toEqual(['s1', 's2'])
  // Audits run one at a time, so each poll releases whatever is waiting.
  await waitFor(() => {
    act(() => waiting.splice(0).forEach((r) => r()))
    expect(result.current.pending.size).toBe(0)
  })
  const reported = onRebuilt.mock.calls.flatMap(([, sections]) => (sections as CompiledSection[]).map((s) => s.id))
  expect(reported).toContain('s1')
  expect(reported).toContain('s2')
})
