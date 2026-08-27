import { describe, it, expect } from 'vitest'
import { newSession, reduce, traversal } from './session'
import { compileSection } from '../../engine/compile/index'
import { fixTables } from '../../engine/compile/steps/tables'
import { ctx, section } from '../../engine/compile/test-support'
import type { CompiledChapter, CompiledSection, QueueItem, QueueKind } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

const item = (kind: QueueKind, elementId: string, sectionId = 's1'): QueueItem => ({
  kind,
  elementId,
  sectionId,
  context: {},
})

const chapterOf = (queue: QueueItem[]): CompiledChapter =>
  ({ chapter: { sections: [] }, sections: [], queue }) as unknown as CompiledChapter

describe('traversal', () => {
  it('groups by kind, document order within a kind', () => {
    const q = [
      item('table-headers', 't1'),
      item('alt', 'a1'),
      item('confirm-decorative', 'd1'),
      item('alt', 'a2'),
    ]
    expect(traversal(q, new Set())).toEqual(['s1::d1', 's1::a1', 's1::a2', 's1::t1'])
  })

  it('rotates skipped items to the end, keeping their relative order', () => {
    const q = [
      item('confirm-decorative', 'd1'),
      item('confirm-decorative', 'd2'),
      item('confirm-decorative', 'd3'),
    ]
    expect(traversal(q, new Set(['s1::d1']))).toEqual(['s1::d2', 's1::d3', 's1::d1'])
  })

  it('rotates a skipped item past LATER GROUPS, not just its own', () => {
    // Skipped items are the tail of one linear walk, which is what lets "keep
    // going" reach them without a separate mode (D5.10). To the end of their
    // group would strand them behind work the instructor has not started.
    const q = [item('confirm-decorative', 'd1'), item('table-headers', 't1')]
    expect(traversal(q, new Set(['s1::d1']))).toEqual(['s1::t1', 's1::d1'])
  })
})

describe('converting a decorative item to alt', () => {
  it('lands the conversion AHEAD of the cursor, never behind it', () => {
    // Triage before writing, so a converted item joins a group not yet reached.
    // Reverse the group order and this silently stops being true.
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    let s = newSession(chapterOf(q))
    expect(s.cursor).toBe('s1::d1')
    s = reduce(s, {
      type: 'answer',
      key: 's1::d1',
      answer: { type: 'alt', text: 'A real description here.' },
    })
    expect(s.cursor).toBe('s1::d2')
  })
})

describe('answer', () => {
  it('records the answer and advances FORWARD, not back to the start', () => {
    const q = ['d1', 'd2', 'd3'].map((e) => item('confirm-decorative', e))
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'jump', key: 's1::d2' })
    s = reduce(s, { type: 'answer', key: 's1::d2', answer: { type: 'decorative' } })
    expect(s.answers.get('s1::d2')).toEqual({ type: 'decorative' })
    expect(s.cursor).toBe('s1::d3')
  })

  it('keeps an accept-with-note, so the answered list can show it', () => {
    const q = [item('alt', 'a1')]
    const s = reduce(newSession(chapterOf(q)), {
      type: 'answer',
      key: 's1::a1',
      answer: { type: 'alt', text: 'Figure 2 A four-term polynomial.' },
    })
    expect(s.answers.size).toBe(1)
    expect(s.notes.get('s1::a1')).toContain('Saved, with a note')
  })

  it('unskips an item that is answered from the tail', () => {
    // A skipped item answered later is answered, not still-skipped: the header
    // line counts the two separately and would double-count it.
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'skip', key: 's1::d1' })
    s = reduce(s, { type: 'answer', key: 's1::d1', answer: { type: 'decorative' } })
    expect(s.skipped.has('s1::d1')).toBe(false)
    expect(s.answers.has('s1::d1')).toBe(true)
  })
})

describe('skip', () => {
  it('writes no answer and removes nothing', () => {
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    const s = reduce(newSession(chapterOf(q)), { type: 'skip', key: 's1::d1' })
    expect(s.answers.size).toBe(0)
    expect(s.skipped).toEqual(new Set(['s1::d1']))
    expect(s.cursor).toBe('s1::d2')
  })

  it('leaves the queue itself untouched, so isPublishable cannot see it', () => {
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    const s = reduce(newSession(chapterOf(q)), { type: 'skip', key: 's1::d1' })
    expect(s.compiled.queue).toHaveLength(2)
  })

  it('terminates when every item is skipped rather than trapping', () => {
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    let s = newSession(chapterOf(q))
    for (let i = 0; i < 6; i++) s = reduce(s, { type: 'skip', key: s.cursor! })
    expect(s.skipped.size).toBe(2)
    expect(s.cursor).toBeDefined()
  })
})

describe('revisit', () => {
  it('returns the item to the traversal at its natural position', () => {
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'answer', key: 's1::d1', answer: { type: 'decorative' } })
    expect(s.answers.size).toBe(1)
    s = reduce(s, { type: 'revisit', key: 's1::d1' })
    expect(s.answers.size).toBe(0)
    expect(traversal(q, s.skipped)[0]).toBe('s1::d1')
  })

  it('makes the revisited item current, so the click has a visible effect', () => {
    const q = [item('confirm-decorative', 'd1'), item('confirm-decorative', 'd2')]
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'answer', key: 's1::d1', answer: { type: 'decorative' } })
    s = reduce(s, { type: 'revisit', key: 's1::d1' })
    expect(s.cursor).toBe('s1::d1')
  })

  it('drops the note along with the answer', () => {
    const q = [item('alt', 'a1')]
    let s = newSession(chapterOf(q))
    s = reduce(s, {
      type: 'answer',
      key: 's1::a1',
      answer: { type: 'alt', text: 'Figure 2 A four-term polynomial.' },
    })
    s = reduce(s, { type: 'revisit', key: 's1::a1' })
    expect(s.notes.size).toBe(0)
  })
})

describe('a refused answer', () => {
  it('is not recorded, and the cursor does not move', () => {
    const q = [item('alt', 'a1'), item('alt', 'a2')]
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'answer', key: 's1::a1', answer: { type: 'alt', text: 'photo.jpg' } })
    expect(s.answers.size).toBe(0)
    expect(s.cursor).toBe('s1::a1')
    expect(s.refusal).toMatch(/^Not saved: that looks like a file name/)
  })

  it('clears the refusal on the next event, so it cannot outlive its card', () => {
    const q = [item('alt', 'a1'), item('alt', 'a2')]
    let s = newSession(chapterOf(q))
    s = reduce(s, { type: 'answer', key: 's1::a1', answer: { type: 'alt', text: 'photo.jpg' } })
    s = reduce(s, {
      type: 'answer',
      key: 's1::a1',
      answer: { type: 'alt', text: 'A polynomial with four terms.' },
    })
    expect(s.refusal).toBeUndefined()
    expect(s.answers.size).toBe(1)
  })
})

const GREEN = {
  html: '<p>repaired</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as GateResult

const compiledSection = (id: string, html: string): CompiledSection => ({
  id,
  title: 'Section',
  html,
  notes: [],
  queue: [],
})

/** A session whose one section has just been recompiled and is awaiting re-audit. */
function sessionWithDirtySection(id: string, html: string) {
  const base = {
    chapter: { sections: [] },
    sections: [{ ...compiledSection(id, '<p>before</p>'), gate: GREEN }],
    queue: [],
  } as unknown as CompiledChapter
  return reduce(newSession(base), {
    type: 'recompiled',
    sections: [{ section: compiledSection(id, html), displayHtml: `repaired:${html}` }],
  })
}

describe('recompiled', () => {
  it('drops the old gate rather than carrying it over', () => {
    // A verdict about bytes that no longer exist is the false assurance this
    // product exists to prevent. "Absent until the section has been audited" is
    // the contract's own wording for what to put there instead.
    const s = sessionWithDirtySection('sec-1', '<p>after</p>')
    expect(s.compiled.sections[0]!.gate).toBeUndefined()
    expect(s.dirty.has('sec-1')).toBe(true)
  })

  it('holds repaired bytes to render meanwhile', () => {
    const s = sessionWithDirtySection('sec-1', '<p>after</p>')
    expect(s.displayHtml.get('sec-1')).toBe('repaired:<p>after</p>')
  })
})

describe('re-audit commit rule', () => {
  it('commits an audit whose bytes still match', () => {
    let s = sessionWithDirtySection('sec-1', '<p>after</p>')
    s = reduce(s, { type: 'audited', sectionId: 'sec-1', forHtml: '<p>after</p>', gate: GREEN })
    expect(s.dirty.has('sec-1')).toBe(false)
    expect(s.compiled.sections[0]!.gate).toBe(GREEN)
  })

  it('DROPS an audit whose bytes changed while it was in flight', () => {
    // The instructor answered a second item in the same section while the first
    // answer's audit was running. Committing here would show a verdict about
    // bytes nobody is looking at — a green gate on a section that changed
    // underneath it.
    let s = sessionWithDirtySection('sec-1', '<p>after</p>')
    s = reduce(s, {
      type: 'recompiled',
      sections: [
        { section: compiledSection('sec-1', '<p>after again</p>'), displayHtml: 'repaired:again' },
      ],
    })
    s = reduce(s, { type: 'audited', sectionId: 'sec-1', forHtml: '<p>after</p>', gate: GREEN })
    expect(s.dirty.has('sec-1')).toBe(true)
    expect(s.compiled.sections[0]!.gate).toBeUndefined()
  })

  it('keeps the stand-in bytes when it drops a stale audit', () => {
    // The section is still dirty, so it still has nothing to render but these.
    let s = sessionWithDirtySection('sec-1', '<p>after</p>')
    s = reduce(s, {
      type: 'recompiled',
      sections: [
        { section: compiledSection('sec-1', '<p>after again</p>'), displayHtml: 'repaired:again' },
      ],
    })
    s = reduce(s, { type: 'audited', sectionId: 'sec-1', forHtml: '<p>after</p>', gate: GREEN })
    expect(s.displayHtml.get('sec-1')).toBe('repaired:again')
  })

  it('drops the stand-in bytes when it commits, leaving one source of truth', () => {
    let s = sessionWithDirtySection('sec-1', '<p>after</p>')
    s = reduce(s, { type: 'audited', sectionId: 'sec-1', forHtml: '<p>after</p>', gate: GREEN })
    expect(s.displayHtml.has('sec-1')).toBe(false)
  })

  it('ignores an audit for a section that is not in the chapter', () => {
    const s = sessionWithDirtySection('sec-1', '<p>after</p>')
    expect(
      reduce(s, { type: 'audited', sectionId: 'nope', forHtml: '<p>after</p>', gate: GREEN }),
    ).toEqual(s)
  })
})

describe('an answer the recompile REFUSED', () => {
  // The other half of `fixTables`' refusal. Compile keeps the item queued —
  // that is the correctness half, and it is what stops a headerless table
  // shipping gate-clean. On its own it leaves the instructor looking at the same
  // card with no reason to choose differently, so the reason travels back.
  const queued = (id: string): QueueItem => item('table-headers', id)
  const refusedRebuild = (id: string, reason: string) => ({
    section: {
      ...compiledSection('s1', '<p>after</p>'),
      queue: [queued(id)],
      notes: [{ step: 'tables', message: `Table headers could not be applied safely: ${reason}` }],
    },
    displayHtml: 'repaired',
  })

  const sessionAnswering = (id: string) => {
    const base = {
      chapter: { sections: [] },
      sections: [{ ...compiledSection('s1', '<p>before</p>'), queue: [queued(id)] }],
      queue: [queued(id)],
    } as unknown as CompiledChapter
    return reduce(newSession(base), {
      type: 'answer',
      key: `s1::${id}`,
      answer: { type: 'table-headers', choice: 'row' },
    })
  }

  it('drops the answer, because the answer is not what the html says', () => {
    // Keeping it would leave the item both answered and queued: filtered out of
    // the traversal by the answer, still counted by isPublishable. The
    // instructor could never reach it and the chapter could never publish.
    let s = sessionAnswering('T10')
    expect(s.answers.size).toBe(1)
    s = reduce(s, {
      type: 'recompiled',
      sections: [refusedRebuild('T10', 'the rows are not all the same width')],
    })
    expect(s.answers.size).toBe(0)
  })

  it("says why, in the instructor's terms and with a way forward", () => {
    let s = sessionAnswering('T10')
    s = reduce(s, {
      type: 'recompiled',
      sections: [refusedRebuild('T10', 'the rows are not all the same width')],
    })
    expect(s.refusal).toBe(
      'Not applied: the rows are not all the same width, so those cells cannot become headers ' +
        'without claiming a structure this table does not have. Choose another option, or mark ' +
        'it a layout table.',
    )
  })

  it('leaves the refused item current, not the next one', () => {
    let s = sessionAnswering('T10')
    s = reduce(s, {
      type: 'recompiled',
      sections: [refusedRebuild('T10', 'a cell spans more than one row')],
    })
    expect(s.cursor).toBe('s1::T10')
  })

  it('says something rather than nothing when the reason did not travel', () => {
    // Defensive. A refused answer with no note is a bug, but silently keeping an
    // answer that was not applied is the one outcome that must not happen.
    let s = sessionAnswering('T10')
    s = reduce(s, {
      type: 'recompiled',
      sections: [
        { section: { ...compiledSection('s1', '<p>x</p>'), queue: [queued('T10')] }, displayHtml: 'r' },
      ],
    })
    expect(s.answers.size).toBe(0)
    expect(s.refusal).toBe(
      'Not applied: that answer could not be applied to this item. Choose another option, or ' +
        'skip it for now.',
    )
  })

  it('does not cry refusal for an item in a section it did not rebuild', () => {
    // Only sections that were actually recompiled have had their chance. An
    // answered key still sitting in some OTHER section's queue means that
    // section has not been rebuilt yet, not that the answer was rejected.
    const base = {
      chapter: { sections: [] },
      sections: [
        { ...compiledSection('s1', '<p>a</p>'), queue: [queued('T1')] },
        { ...compiledSection('s2', '<p>b</p>'), queue: [item('table-headers', 'T2', 's2')] },
      ],
      queue: [queued('T1'), item('table-headers', 'T2', 's2')],
    } as unknown as CompiledChapter
    let s = reduce(newSession(base), {
      type: 'answer',
      key: 's1::T1',
      answer: { type: 'table-headers', choice: 'row' },
    })
    s = reduce(s, {
      type: 'recompiled',
      sections: [
        { section: { ...compiledSection('s2', '<p>b2</p>'), queue: [item('table-headers', 'T2', 's2')] }, displayHtml: 'r' },
      ],
    })
    expect(s.answers.size).toBe(1)
    expect(s.refusal).toBeUndefined()
  })
})

describe('the refusal channel, end to end through real compile', () => {
  it('turns a real ragged table into a message the instructor can act on', () => {
    // Everything above stubs the recompile. This one runs it: the real
    // `10-7-parametric-equations-graphs` shape, the real `fixTables` refusal,
    // the real note, and the message that comes out the far end. If the note's
    // wording and the session's prefix ever drift apart, this is what notices.
    const ragged = `
<p>The parametric values are tabulated below.</p>
<table id="T10"><tbody>
<tr><td>t</td><td>0</td><td>1</td><td>2</td></tr>
<tr><td>x</td><td>0</td></tr>
</tbody></table>`
    const first = compileSection(section(ragged), ctx, [fixTables])
    const compiled = {
      chapter: { sections: [] },
      sections: [first],
      queue: first.queue,
    } as unknown as CompiledChapter

    let s = newSession(compiled)
    expect(s.cursor).toBe('s1::T10')
    s = reduce(s, {
      type: 'answer',
      key: 's1::T10',
      answer: { type: 'table-headers', choice: 'row' },
    })
    expect(s.answers.size).toBe(1)

    const answers = new Map([['s1::T10', { type: 'table-headers', choice: 'row' } as const]])
    const again = compileSection(section(ragged), { ...ctx, answers }, [fixTables])
    s = reduce(s, { type: 'recompiled', sections: [{ section: again, displayHtml: again.html }] })

    expect(s.answers.size).toBe(0)
    expect(s.cursor).toBe('s1::T10')
    expect(s.refusal).toBe(
      'Not applied: the rows are not all the same width, so those cells cannot become headers ' +
        'without claiming a structure this table does not have. Choose another option, or mark ' +
        'it a layout table.',
    )
    // And the item is still queued, which is the half that keeps a headerless
    // table from shipping gate-clean.
    expect(s.compiled.queue.map((i) => i.elementId)).toEqual(['T10'])
  })

  it('lets the instructor out through the layout answer', () => {
    const ragged = `
<p>The parametric values are tabulated below.</p>
<table id="T10"><tbody>
<tr><td>t</td><td>0</td><td>1</td></tr>
<tr><td>x</td><td>0</td></tr>
</tbody></table>`
    const answers = new Map([
      ['s1::T10', { type: 'table-headers', choice: 'presentation' } as const],
    ])
    const out = compileSection(section(ragged), { ...ctx, answers }, [fixTables])
    expect(out.queue).toEqual([])
  })
})
