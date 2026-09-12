import { describe, it, expect } from 'vitest'
import { compileChapter, compileSection, sectionContext } from './index'
import { OPENSTAX } from './context'
import { chapterFixture, fixtureContext, type FixtureName } from './fixture-context'

describe('CompileContext', () => {
  it('carries the section id, so a step can key answers without being told twice', () => {
    const chapter = chapterFixture()
    const ctx = sectionContext(chapter, chapter.sections[0]!, OPENSTAX)
    expect(ctx.sectionId).toBe(chapter.sections[0]!.id)
  })

  it('leaves answers absent when the caller supplies none', () => {
    const chapter = chapterFixture()
    expect(sectionContext(chapter, chapter.sections[0]!, OPENSTAX).answers).toBeUndefined()
  })

  it('passes an answers map straight through to the steps', () => {
    const chapter = chapterFixture()
    const answers = new Map([['k', { type: 'decorative' } as const]])
    const ctx = sectionContext(chapter, chapter.sections[0]!, OPENSTAX, { answers })
    expect(ctx.answers).toBe(answers)
  })

  it('leaves ideaEdits absent when the caller supplies none, and passes a map through', () => {
    const chapter = chapterFixture()
    expect(sectionContext(chapter, chapter.sections[0]!, OPENSTAX).ideaEdits).toBeUndefined()
    const edits = new Map([['k', { kind: 'keep' } as const]])
    expect(sectionContext(chapter, chapter.sections[0]!, OPENSTAX, { ideaEdits: edits }).ideaEdits).toBe(edits)
  })

  it('compiles byte-identically when no answers are supplied', () => {
    // The load-bearing assertion of this task. Every later task assumes that
    // adding the answers channel changed nothing for a caller that does not use
    // it; this is where that is true rather than hoped.
    //
    // Anchored to the committed goldens INDIRECTLY, via the section path that
    // `golden.test.ts` already pins to them byte for byte. Reading the golden
    // files here instead would need `node:fs`, and `tsconfig.json` deliberately
    // withholds node types from everything in `src/` so that a `process` or
    // `Buffer` reference in a shipped file is a compile error — `golden.test.ts`
    // is the single listed exception and its include list is meant to be hard to
    // grow. Both fixtures, because the chapter path builds its own context and
    // this pins that it builds the same one.
    const chapter = chapterFixture()
    const out = compileChapter(chapter, OPENSTAX)
    const names: readonly FixtureName[] = ['page', 'page-section']
    names.forEach((name, i) => {
      const { section, ctx } = fixtureContext(name)
      expect(out.sections[i]!.html, name).toBe(compileSection(section, ctx).html)
    })
  })
})
