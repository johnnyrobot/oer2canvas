import { render, screen } from '@testing-library/react'
import { IdeaChapterRender } from './IdeaChapterRender'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import '../../App.css'

const gate = (html: string): GateResult =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: '4: Nutrition', sections: [], xrefs: new Map(),
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
}
const s1: CompiledSection = { id: 's1', title: 'S1', html: '<p>raw one</p>', notes: [], queue: [], gate: gate('<p id="b2c-blk-0">one</p><p id="b2c-blk-1">two</p>') }
const s2: CompiledSection = { id: 's2', title: 'S2', html: '<p>raw two</p>', notes: [], queue: [], gate: gate('<p id="b2c-blk-0">three</p>') }
const compiled: CompiledChapter = { chapter, sections: [s1, s2], queue: [] }
const none = new Set<string>()

test('the chapter heading and every gated section render; raw html never does', () => {
  const { container } = render(<IdeaChapterRender compiled={compiled} target={undefined} pending={none} />)
  expect(screen.getByRole('heading', { name: '4: Nutrition' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'S1' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'S2' })).toBeInTheDocument()
  expect(container.innerHTML).not.toContain('raw one')
})

// Block ids repeat across sections (`b2c-blk-0` is in both), so the target is
// found INSIDE its section's article, never by a document-wide id lookup.
test('the target element in the named section carries the outline class, and a new target moves it', () => {
  const { rerender } = render(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's2', elementId: 'b2c-blk-0' }} pending={none} />)
  const inS2 = screen.getByRole('article', { name: 'S2' }).querySelector('#b2c-blk-0')
  const inS1 = screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-0')
  expect(inS2).toHaveClass('b2c-idea-target')
  expect(inS1).not.toHaveClass('b2c-idea-target')
  rerender(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's1', elementId: 'b2c-blk-1' }} pending={none} />)
  expect(inS2).not.toHaveClass('b2c-idea-target')
  expect(screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-1')).toHaveClass('b2c-idea-target')
})

test('the outline is geometry only, never a colour', () => {
  render(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's1', elementId: 'b2c-blk-1' }} pending={none} />)
  const s = getComputedStyle(screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-1')!)
  expect(parseFloat(s.outlineWidth)).toBeGreaterThanOrEqual(3)
  expect(s.outlineColor).toBe(s.color)
})

test('a pending section shows the pending line in place of its body; the others still render', () => {
  const { container } = render(<IdeaChapterRender compiled={compiled} target={undefined} pending={new Set(['s1'])} />)
  expect(screen.getByText('Re-checking this section…')).toBeInTheDocument()
  expect(container.innerHTML).not.toContain('>one<')
  expect(container.innerHTML).toContain('>three<')
})
