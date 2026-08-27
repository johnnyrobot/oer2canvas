import { describe, it, expect, vi } from 'vitest'
import { compileAndAuditChapter } from './index'
import type { Chapter } from '../sources/types'
import type { GateDeps } from './gate'

function chapterOf(n: number): Chapter {
  return {
    source: 'openstax',
    bookId: 'b',
    title: 'Chapter',
    xrefs: new Map(),
    attribution: { bookTitle: 'Algebra', publisher: 'OpenStax', url: 'https://x', authors: [] },
    sections: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      title: `Section ${i}`,
      order: i,
      html: `<p>Section ${i} body</p>`,
      contentBaseUrl: `https://x/s${i}.json`,
      canonicalUrl: `https://x/pages/s${i}`,
    })),
  }
}

function fakeDeps(): GateDeps {
  return {
    validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
    audit: async () => ({ issues: [] }),
  }
}

describe('compileAndAuditChapter', () => {
  it('reports both phases per section rather than once for the chapter', async () => {
    const onProgress = vi.fn()
    const chapter = chapterOf(3)
    await compileAndAuditChapter(chapter, { onProgress, deps: fakeDeps() })
    // Two calls per section plus a final `done`, so the status line neither
    // sticks on the last title nor sits empty through the compile pass. The
    // full call sequence is asserted, not just the count or the first call — a
    // once-per-chapter call, an off-by-one index, a wrong section's title or a
    // missing compile phase would all show up here, which a bare
    // `toHaveBeenCalledTimes` would miss.
    expect(onProgress.mock.calls.flat()).toEqual([
      { phase: 'compile', done: 0, total: 3, title: 'Section 0' },
      { phase: 'audit', done: 0, total: 3, title: 'Section 0' },
      { phase: 'compile', done: 1, total: 3, title: 'Section 1' },
      { phase: 'audit', done: 1, total: 3, title: 'Section 1' },
      { phase: 'compile', done: 2, total: 3, title: 'Section 2' },
      { phase: 'audit', done: 2, total: 3, title: 'Section 2' },
      { phase: 'done', done: 3, total: 3, title: '' },
    ])
  })

  it('hands each section over as it is gated, before the chapter is done', async () => {
    // The seam §3.6 rests on: the queue opens on the first section that HAS
    // items rather than on the chapter, and `onProgress` cannot carry that —
    // it reports where the run is, not what it produced. Each section must
    // arrive already gated, or the queue would render a section with no verdict
    // and no bytes it is allowed to show.
    const seen: string[] = []
    const chapter = chapterOf(3)
    const result = await compileAndAuditChapter(chapter, {
      onSection: (section, index) => {
        seen.push(`${index}:${section.title}:${section.gate ? 'gated' : 'no gate'}`)
      },
      onProgress: (p) => {
        if (p.phase === 'done') seen.push('done')
      },
      deps: fakeDeps(),
    })
    expect(seen).toEqual([
      '0:Section 0:gated',
      '1:Section 1:gated',
      '2:Section 2:gated',
      'done',
    ])
    // And the same sections, not copies of them — what the caller accumulated
    // is what the finished chapter is made of.
    expect(result.sections.length).toBe(3)
  })

  it('compiles each section inside the loop, not all of them before the first report', async () => {
    // Running every section synchronously ahead of the audit loop creates dead
    // air before any status line appears. Interleaving prevents that, so it is pinned directly:
    // section 1 must not be compiled until section 0 has been audited.
    const order: string[] = []
    const chapter = chapterOf(2)
    await compileAndAuditChapter(chapter, {
      onProgress: (p) => order.push(`${p.phase}:${p.done}`),
      deps: {
        validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
        audit: async () => {
          order.push('audited')
          return { issues: [] }
        },
      },
      steps: [(_doc, ctx) => order.push(`compiled:${ctx.sectionTitle}`)],
    })
    expect(order).toEqual([
      'compile:0',
      'compiled:Section 0',
      'audit:0',
      'audited',
      'compile:1',
      'compiled:Section 1',
      'audit:1',
      'audited',
      'done:2',
    ])
  })

  it('leaves a failed section without a gate rather than auditing empty html', async () => {
    const chapter = chapterOf(1)
    const validateAllowlist = vi.fn(async (html: string) => ({ html, removedSemantic: [] }))
    const audit = vi.fn(async () => ({ issues: [] }))
    const result = await compileAndAuditChapter(chapter, {
      deps: { validateAllowlist, audit },
      steps: [() => { throw new Error('boom') }],
    })
    expect(result.sections[0]!.error).toBe('boom')
    expect(result.sections[0]!.gate).toBeUndefined()
    // Not just "no gate" on the result — the gate deps were never even reached,
    // so an empty-html audit cannot quietly manufacture a clean verdict.
    expect(validateAllowlist).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('carries the merged queue onto the chapter', async () => {
    const result = await compileAndAuditChapter(chapterOf(1), {
      deps: fakeDeps(),
      steps: [(doc, ctx, sink) => sink.queue({ kind: 'table-headers', elementId: 'e', context: {} })],
    })
    expect(result.queue).toEqual([
      { kind: 'table-headers', elementId: 'e', context: {}, sectionId: 's0' },
    ])
  })

  describe('cancellation', () => {
    it('does no work at all when the signal is already aborted', async () => {
      const deps = { validateAllowlist: vi.fn(), audit: vi.fn() }
      const steps = [vi.fn()]
      await expect(
        compileAndAuditChapter(chapterOf(3), {
          deps: deps as unknown as GateDeps,
          steps,
          signal: AbortSignal.abort(),
        }),
      ).rejects.toThrow(/abort/i)
      // Rejecting is not enough on its own: a signal checked only INSIDE the
      // loop body would still have compiled and audited section 0 first.
      expect(steps[0]).not.toHaveBeenCalled()
      expect(deps.validateAllowlist).not.toHaveBeenCalled()
      expect(deps.audit).not.toHaveBeenCalled()
    })

    it('stops within the current section rather than at the end of the chapter', async () => {
      const controller = new AbortController()
      const compiled: string[] = []
      let audits = 0
      const promise = compileAndAuditChapter(chapterOf(5), {
        signal: controller.signal,
        deps: {
          validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
          audit: async () => {
            // Abort while the FIRST section is being audited. A run that only
            // checked the signal between sections would still audit section 1;
            // one that never checked would audit all five.
            if (++audits === 1) controller.abort()
            return { issues: [] }
          },
        },
        steps: [(_doc, ctx) => compiled.push(ctx.sectionTitle)],
      })
      await expect(promise).rejects.toThrow(/abort/i)
      expect(compiled).toEqual(['Section 0'])
      expect(audits).toBe(1)
    })

    it('rejects with an AbortError, so a caller can tell cancel from failure', async () => {
      // The distinction is load-bearing in `App`: a cancel must return the user
      // to the picker silently, while a real failure must be announced. Both
      // arrive at the same `catch`, so the error has to carry the difference.
      const error = await compileAndAuditChapter(chapterOf(1), {
        deps: fakeDeps(),
        signal: AbortSignal.abort(),
      }).catch((e: unknown) => e)
      expect((error as Error).name).toBe('AbortError')
    })
  })
})
