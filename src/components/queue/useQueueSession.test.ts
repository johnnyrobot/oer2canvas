import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useQueueSession, type QueueSessionDeps, type Rebuilt } from './useQueueSession'
import type { CompiledChapter, CompiledSection, QueueItem, QueueKind } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

const gateOf = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

/** The verdict a section starts with... */
const GREEN = gateOf('<p>first</p>')
/** ...and the one the background re-audit replaces it with. They must not be the
 *  same object, or waiting for the commit is satisfied by the starting state and
 *  the test asserts nothing. */
const REAUDITED = gateOf('<p>re-audited</p>')

const item = (kind: QueueKind, elementId: string, sectionId: string, hash?: string): QueueItem => ({
  kind,
  elementId,
  sectionId,
  context: {},
  ...(hash ? { hash } : {}),
})

const section = (id: string, queue: QueueItem[]): CompiledSection => ({
  id,
  title: id,
  html: `<p>${id}</p>`,
  notes: [],
  queue,
  gate: GREEN,
})

const chapterOf = (sections: CompiledSection[], queue: QueueItem[]): CompiledChapter =>
  ({ chapter: { sections: [] }, sections, queue }) as unknown as CompiledChapter

/** Deps that record what they were asked to do and rebuild sections trivially. */
function spyDeps(): QueueSessionDeps & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    recompile: vi.fn(async (_chapter, sectionIds: readonly string[]): Promise<readonly Rebuilt[]> => {
      calls.push([...sectionIds])
      return sectionIds.map((id) => ({
        section: { ...section(id, []), gate: undefined },
        displayHtml: `repaired:${id}`,
      }))
    }),
    audit: vi.fn(async () => REAUDITED),
  }
}

describe('useQueueSession', () => {
  it('recompiles exactly the affected section on an accepted answer', async () => {
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')]), section('s2', [])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('s1::d1', { type: 'decorative' }))
    await waitFor(() => expect(deps.calls).toHaveLength(1))
    expect(deps.calls[0]).toEqual(['s1'])
  })

  it('hands the IDEA edits to the recompile beside the answers, so an answer cannot strip an edit', async () => {
    // The IDEA phase applies its edits from source on every recompile. If THIS
    // recompile did not carry them, answering an alt item in an edited section
    // would rebuild the section without its wording and hand those bytes to
    // Plan — the export would depend on which of two audits landed last.
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const ideaEdits = new Map([['s1::b::0::crazy', { kind: 'replace' as const, replacement: 'wild' }]])
    const { result } = renderHook(() => useQueueSession(compiled, deps, { ideaEdits }))

    act(() => result.current.answer('s1::d1', { type: 'decorative' }))
    await waitFor(() => expect(deps.calls).toHaveLength(1))
    const opts = (deps.recompile as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { answers: Map<string, unknown>; ideaEdits: unknown }
    expect(opts.ideaEdits).toBe(ideaEdits)
    expect(opts.answers.get('s1::d1')).toEqual({ type: 'decorative' })
  })

  it('recompiles EVERY section holding a copy of an image answered by hash', async () => {
    // The propagation D5.2 promises. The merged queue lists the image once; two
    // sections contain it, and both of their queues have to be rebuilt or the
    // second one keeps asking a question that has been answered.
    const deps = spyDeps()
    const hashed = (sectionId: string) => item('alt', 'i1', sectionId, 'abc')
    const compiled = chapterOf(
      [section('s1', [hashed('s1')]), section('s2', [hashed('s2')])],
      [hashed('s1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('abc', { type: 'alt', text: 'A real description.' }))
    await waitFor(() => expect(deps.calls).toHaveLength(1))
    expect(deps.calls[0]).toEqual(['s1', 's2'])
  })

  it('recompiles nothing when the answer is REFUSED', async () => {
    // "Refused" and "accepted but changed nothing" are easy to conflate in an
    // effect dependency array, and conflating them recompiles on every keystroke
    // that fails validation.
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('alt', 'a1', 's1')])],
      [item('alt', 'a1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('s1::a1', { type: 'alt', text: 'photo.jpg' }))
    await waitFor(() => expect(result.current.session.refusal).toBeDefined())
    expect(deps.calls).toHaveLength(0)
    expect(deps.recompile).not.toHaveBeenCalled()
  })

  it('recompiles nothing when an item is merely skipped', async () => {
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.skip('s1::d1'))
    await waitFor(() => expect(result.current.session.skipped.size).toBe(1))
    expect(deps.recompile).not.toHaveBeenCalled()
  })

  it('re-audits the recompiled section in the background and commits the verdict', async () => {
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('s1::d1', { type: 'decorative' }))
    // Waited on the COMMIT, not on `dirty` emptying — dirty is empty to begin
    // with, so waiting for that passes before anything has happened.
    await waitFor(() => expect(result.current.session.compiled.sections[0]!.gate).toBe(REAUDITED))
    expect(deps.audit).toHaveBeenCalledTimes(1)
    expect(result.current.session.dirty.size).toBe(0)
  })

  it('does not audit the same bytes twice', async () => {
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('s1::d1', { type: 'decorative' }))
    await waitFor(() => expect(result.current.session.compiled.sections[0]!.gate).toBe(REAUDITED))
    // The commit re-renders and the drain's own completion wakes the effect a
    // second time. Neither may start the same audit again.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(deps.audit).toHaveBeenCalledTimes(1)
  })

  it('recompiles when an answer is REVISITED, or the item never comes back', async () => {
    const deps = spyDeps()
    const compiled = chapterOf(
      [section('s1', [item('confirm-decorative', 'd1', 's1')])],
      [item('confirm-decorative', 'd1', 's1')],
    )
    const { result } = renderHook(() => useQueueSession(compiled, deps))

    act(() => result.current.answer('s1::d1', { type: 'decorative' }))
    await waitFor(() => expect(deps.calls).toHaveLength(1))
    act(() => result.current.revisit('s1::d1'))
    await waitFor(() => expect(deps.calls).toHaveLength(2))
  })
})
