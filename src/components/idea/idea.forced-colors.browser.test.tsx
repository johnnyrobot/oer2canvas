import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
import { newHeader } from '../../engine/idea/review'
import type { CompiledChapter } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
// Both, in the app's own order: the theme carries Tailwind (the utilities that
// size the radio labels), App.css the floor beneath it.
import '../../styles/theme.css'
import '../../App.css'

/**
 * With forced colours ON, a checked rating must still be distinguishable from
 * an unchecked one by something other than a background tint — the browser
 * strips backgrounds in that mode. The native radio's checked state survives;
 * this asserts the mode is really on and that the radio, not a styled span,
 * is what carries the state.
 */
afterEach(cleanup)

const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: '4: Nutrition', sections: [],
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] }, xrefs: new Map(),
}
const compiled: CompiledChapter = { chapter, sections: [], queue: [] }
const props = {
  reviews: new Map(), header: newHeader(), onEvent: () => {}, onHeaderEvent: () => {}, onForget: () => {}, onExport: () => 'x.md',
  edits: new Map(), pending: new Set<string>(), onEditEvent: () => {},
  llm: { settings: undefined, onSave: () => {}, onForget: () => {}, runs: new Map(), rubricDrafts: new Map(), runCategory: () => {}, runRubric: () => {}, cancel: () => {}, bookDrafts: new Map(), planDrafts: new Map(), runBook: () => {}, runPlan: () => {}, exportBook: () => 'x.md', exportPlan: () => 'x.md' },
  image: { add: async () => true, busy: false, error: '' },
}

test('forced colours is active for this project', () => {
  expect(window.matchMedia('(forced-colors: active)').matches).toBe(true)
})

test('a rating is a native radio whose checked state does not depend on colour', () => {
  render(<IdeaScreen chapters={[compiled]} {...props} />)
  const rubric = screen.getByRole('group', { name: 'Rubric 1' })
  const radio = within(rubric).getAllByRole('radio')[0]!
  expect(radio).toBeInstanceOf(HTMLInputElement)
  expect((radio as HTMLInputElement).type).toBe('radio')
  const label = radio.closest('label')!
  const style = getComputedStyle(label)
  // A border is what survives forced colours; a background does not.
  expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
})

test('a book-level draft is set apart by a dashed border, not a colour', () => {
  const bookDrafts = new Map([['B', { draft: { summary: 's', areas: [], revisions: [] }, provider: 'Gemini', at: 1 }]])
  const llm = { ...props.llm, settings: { provider: 'gemini' as const, key: 'k', model: 'm' }, bookDrafts }
  render(<IdeaScreen chapters={[compiled, { ...compiled, chapter: { ...chapter, title: '5' } }]} {...props} llm={llm} />)
  const card = screen.getByRole('region', { name: 'Across the chapters' })
  const draft = card.querySelector('.b2c-idea-draft')!
  expect(getComputedStyle(draft).borderTopStyle).toBe('dashed')
})
