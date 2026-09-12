import { fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { IdeaScreen } from './IdeaScreen'
import { newHeader } from '../../engine/idea/review'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { ImageHit, ImageSearch } from '../../engine/idea/images/search'
// Both, in the app's own order: the theme carries Tailwind (the utilities that
// size the radio labels), App.css the floor beneath it.
import '../../styles/theme.css'
import '../../App.css'

/**
 * The IDEA screen is held to the rule set the rest of the app's own UI is
 * held to (`App.a11y.browser.test.tsx`): full WCAG A/AA tags, nothing
 * removed, in a real browser where axe has layout. Radios inside labels with
 * two spans of text is exactly the construction that reads fine in jsdom and
 * fails a real label-content check. The chapter render is included, with a
 * real section body, because publisher html beside app chrome is where
 * heading-order and landmark rules actually bite.
 */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const chapter: Chapter = {
  source: 'openstax',
  bookId: 'book-1',
  title: '4: Nutrition',
  sections: [],
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
  xrefs: new Map(),
}
const GATE = {
  html: '<h2>Nutrients</h2><p>The body needs six major nutrients.</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as CompiledSection['gate']
const compiled: CompiledChapter = {
  chapter,
  sections: [{ id: 's1', title: 'Nutrients', html: '<p>x</p>', notes: [], queue: [], gate: GATE }],
  queue: [],
}
const hit: ImageHit = {
  provider: 'commons', id: 'File:A.jpg', title: 'Students', thumbUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', fullUrl: 'https://f/a',
  width: 4, height: 3, license: { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'u' }, creator: 'Jane', sourcePageUrl: 'https://s/a',
}
const commons: ImageSearch = { id: 'commons', label: 'Wikimedia Commons', offered: true, evidence: 'e', search: async () => [hit] }

const props = {
  reviews: new Map(), header: newHeader(), onEvent: () => {}, onHeaderEvent: () => {}, onForget: () => {}, onExport: () => 'x.md',
  edits: new Map(), pending: new Set<string>(), onEditEvent: () => {},
  llm: { settings: undefined, onSave: () => {}, onForget: () => {}, runs: new Map(), rubricDrafts: new Map(), runCategory: () => {}, runRubric: () => {}, cancel: () => {} },
  image: { add: async () => true, busy: false, error: '' },
}

async function violationsIn(container: Element): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: WCAG_AA } })
  return results.violations.map((v) => `${v.id}: ${v.description}`)
}

function duplicateIds(container: Element): string[] {
  const seen = new Map<string, number>()
  for (const el of container.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

test('the IDEA screen has no WCAG A/AA violations and no duplicate ids, with a panel open, the chapter rendered, and the forget confirmation showing', async () => {
  const { container } = render(
    <IdeaScreen chapters={[compiled, { ...compiled, chapter: { ...chapter, title: '5: Digestion' } }]} {...props} />,
  )
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
})

test('the image search region and the placement dialog have no WCAG A/AA violations', async () => {
  const { container } = render(<IdeaScreen chapters={[compiled]} {...props} image={{ ...props.image, providers: [commons] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Find an openly licensed photo' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for' }), { target: { value: 'students' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  fireEvent.click(await screen.findByRole('button', { name: /Use this image/ }))
  expect(screen.getByRole('dialog', { name: 'Place this image' })).toBeInTheDocument()
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
})

// WCAG 2.2 SC 2.5.8. Inline links in running text (the resource list, the
// attribution) are exempt under the criterion's inline exception and are not
// measured; every other control is. Radios sit inside a label that is the
// real target, so the label is what is measured for them.
test('every non-inline control meets the 24x24 target floor', () => {
  const { container } = render(<IdeaScreen chapters={[compiled]} {...props} />)
  for (const el of container.querySelectorAll('button, input, select, textarea')) {
    const target = el instanceof HTMLInputElement && el.type === 'radio' ? el.closest('label')! : el
    const box = target.getBoundingClientRect()
    expect(Math.min(box.width, box.height), (el as HTMLElement).outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(24)
  }
})
