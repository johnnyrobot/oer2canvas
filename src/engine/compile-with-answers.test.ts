import { describe, it, expect } from 'vitest'
import { compileAndAuditChapter, recompileSections } from './index'
import { chapterFixture } from './compile/fixture-context'
import type { GateDeps } from './gate'

// The first of the four equation images in the 1.4 fixture, by content hash —
// the key an answer to it is stored under. Taken from the committed queue
// golden rather than restated, in spirit: if the fixture is refreshed and this
// hash moves, the tests below fail loudly instead of quietly answering nothing.
const FIRST_HASH = 'f30414a10cb5f0a0369b27a897885a5341b96a42'

// `chapterFixture` is [preface, 1.4]; the preface has no queue at all.
const QUEUED = 1

const fakeDeps = (): GateDeps => ({
  validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
  audit: async () => ({ issues: [] }),
})

describe('recompileSections', () => {
  it('applies the answer and drops that item from the queue', () => {
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const before = recompileSections(chapter, [chapter.sections[QUEUED]!.id], {})
    const light = recompileSections(chapter, [chapter.sections[QUEUED]!.id], { answers })
    expect(before[0]!.queue).toHaveLength(4)
    expect(light[0]!.queue).toHaveLength(3)
  })

  it('leaves the gate ABSENT rather than stale', () => {
    // "Absent until the section has been audited" is the contract's own wording
    // for CompiledSection.gate, and the session reads it that way: a section
    // awaiting re-audit renders its repair-only bytes and says so, instead of
    // showing a verdict about bytes that have changed.
    const chapter = chapterFixture()
    const light = recompileSections(chapter, [chapter.sections[QUEUED]!.id], {})
    expect(light[0]!.gate).toBeUndefined()
  })

  it('leaves sections it was not asked about alone', () => {
    const chapter = chapterFixture()
    const light = recompileSections(chapter, [chapter.sections[0]!.id], {})
    expect(light).toHaveLength(1)
    expect(light[0]!.id).toBe(chapter.sections[0]!.id)
  })

  it('produces the same html a full compile would', () => {
    // Layer 2 is a CHEAPER path, not a different one. If the two could diverge,
    // the bytes the human approves would not be the bytes the re-audit judges.
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const light = recompileSections(chapter, [chapter.sections[QUEUED]!.id], { answers })
    const full = recompileSections(
      chapter,
      chapter.sections.map((s) => s.id),
      { answers },
    )
    expect(light[0]!.html).toBe(full[QUEUED]!.html)
  })
})

describe('compileAndAuditChapter with answers', () => {
  it('passes answers through to the steps', async () => {
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const out = await compileAndAuditChapter(chapter, { answers, deps: fakeDeps() })
    expect(out.queue).toHaveLength(3)
  })

  it('still compiles the chapter unchanged when given none', async () => {
    const chapter = chapterFixture()
    const out = await compileAndAuditChapter(chapter, { deps: fakeDeps() })
    expect(out.queue).toHaveLength(4)
  })
})
