import { describe, it, expect } from 'vitest'
import { compileChapter, compileSection } from './index'
import { chapterFixture, fixtureContext, type FixtureName } from './fixture-context'
import { OPENSTAX } from './context'
import { queueKeyOf } from './answers'
import { validateAllowlist } from '../allowlist'
import { isPublishable } from '../../contracts/index'
import type { CompiledChapter } from '../../contracts/index'
import { newSession, reduce } from '../../components/queue/session'

describe.each<FixtureName>(['page', 'page-section'])('%s invariants', (name) => {
  const { section, ctx } = fixtureContext(name)
  const out = compileSection(section, ctx)

  it('leaves no h1, so allowlist repair does not demote the document twice', () => {
    // allowlist.ts shifts EVERY heading down one when it sees a content <h1>
    // (shiftHeadings, C15). An h1 surviving compile means the whole document
    // ships one level too deep.
    expect(out.html).not.toMatch(/<h1[\s>]/i)
  })

  it('is idempotent', async () => {
    // Slice 5 recompiles after the queue is cleared. A second pass must not
    // append a second attribution block or re-wrap a b2c-figure.
    const again = compileSection({ ...section, html: out.html }, ctx)
    expect(again.html).toBe(out.html)
  })

  it('gives every queue item an elementId that resolves', () => {
    // A QueueItem pointing at nothing is a question slice 5's UI cannot show.
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    for (const item of out.queue) {
      expect(doc.getElementById(item.elementId), `${item.kind} -> ${item.elementId}`).not.toBeNull()
    }
  })

  it('emits nothing the allowlist has to destroy', async () => {
    // The strongest end-to-end statement this slice can make. Section 1.4
    // reported `allowlist-removed-semantic:figure` before slice 4; that blocker
    // is what restructureFigures exists to remove.
    const repaired = await validateAllowlist(out.html)
    expect(repaired.removedSemantic).toEqual([])
  })
})

// The first of the four equation images in 1.4, by content hash — the key an
// answer to it is stored under.
const FIRST_HASH = 'f30414a10cb5f0a0369b27a897885a5341b96a42'
// `chapterFixture` is [preface, 1.4]; the preface has no queue at all.
const QUEUED = 1

describe('recompiling with answers', () => {
  it('answering every item empties the queue', () => {
    const chapter = chapterFixture()
    const first = compileChapter(chapter, OPENSTAX)
    expect(first.queue.length).toBeGreaterThan(0)
    const answers = new Map(
      first.queue.map((i) => [queueKeyOf(i), { type: 'decorative' } as const]),
    )
    expect(compileChapter(chapter, OPENSTAX, { answers }).queue).toEqual([])
  })

  it('does not double the attribution or re-wrap a figure', () => {
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const html = compileChapter(chapter, OPENSTAX, { answers }).sections[QUEUED]!.html
    const plain = compileChapter(chapter, OPENSTAX).sections[QUEUED]!.html
    expect(html.match(/b2c-attribution/g) ?? []).toHaveLength(1)
    expect(html.match(/class="b2c-figure"/g)?.length).toBe(
      plain.match(/class="b2c-figure"/g)?.length,
    )
  })

  it('every elementId still resolves after answers are applied', () => {
    // A queue item pointing at an element that no longer exists is a question
    // the UI cannot show. The invariant above pins this for a first compile;
    // this pins it for the compile a human's answer produced.
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const out = compileChapter(chapter, OPENSTAX, { answers })
    const section = out.sections[QUEUED]!
    const doc = new DOMParser().parseFromString(section.html, 'text/html')
    for (const item of section.queue) {
      expect(doc.getElementById(item.elementId), item.elementId).not.toBeNull()
    }
  })

  it('is still idempotent with answers applied', () => {
    // The answered html must be a fixed point too, or the background re-audit
    // judges bytes the next recompile would change.
    const chapter = chapterFixture()
    const answers = new Map([[FIRST_HASH, { type: 'decorative' } as const]])
    const out = compileChapter(chapter, OPENSTAX, { answers }).sections[QUEUED]!
    const { section, ctx } = fixtureContext('page-section')
    const again = compileSection({ ...section, html: out.html }, { ...ctx, answers })
    expect(again.html).toBe(out.html)
  })

  it('SKIP CANNOT REACH PUBLISHABLE: every item skipped leaves the queue untouched', () => {
    // The invariant the whole skip design rests on (D5.10). Skip writes no
    // answer and removes nothing, so isPublishable — which reads only the queue
    // — cannot see it. There must be no code path from skip to publishable, and
    // this is the test that says so.
    const chapter = chapterFixture()
    const compiled = compileChapter(chapter, OPENSTAX)
    // Every section given a PASSING gate, so the queue is the only thing left
    // that can withhold publishability. Without this the assertion below would
    // hold even if skipping did empty the queue, because an ungated section is
    // unpublishable anyway — and it would be testing nothing.
    const gate = { html: '', conformance: { blockers: [], issues: [] }, badgeWithheld: false }
    const asChapter = {
      chapter,
      sections: compiled.sections.map((x) => ({ ...x, gate })),
      queue: compiled.queue,
    } as unknown as CompiledChapter
    expect(isPublishable({ ...asChapter, queue: [] })).toBe(true)
    const session = compiled.queue.reduce(
      (s, itemToSkip) => reduce(s, { type: 'skip', key: queueKeyOf(itemToSkip) }),
      newSession(asChapter),
    )
    expect(session.skipped.size).toBe(compiled.queue.length)
    expect(session.compiled.queue).toHaveLength(compiled.queue.length)
    expect(isPublishable(session.compiled)).toBe(false)
  })
})
