import { appliedEdits } from './applied'
import { ideaEditKey, newEdits, reduceEdits } from './edits'

const sections = [
  { id: 's1', title: 'Nutrients', html: '<p id="a">He has asthma and is a chairman.</p>' },
  { id: 's2', title: 'Digestion', html: '<p id="b">hit the books (study hard)</p>' },
]

test('an applied replace is present when its replacement is at the element; its category is the finding’s', () => {
  const k = ideaEditKey('s1', 'a', 0, 'suffers from')
  const e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  expect(appliedEdits(sections, e)).toEqual([
    { key: k, edit: { kind: 'replace', replacement: 'has' }, stale: false, sectionTitle: 'Nutrients', category: '7.6' },
  ])
})

test('a gendered noun edit is filed under 7.3; an idiom gloss under 7.6', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'chairman'), replacement: 'chair' })
  e = reduceEdits(e, { type: 'replace', key: ideaEditKey('s2', 'b', 0, 'hit the books'), replacement: 'hit the books (study hard)' })
  expect(appliedEdits(sections, e).map((a) => a.category)).toEqual(['7.3', '7.6'])
})

test('a keep with context is present while the original is still at the element', () => {
  const k = ideaEditKey('s1', 'a', 0, 'chairman')
  const e = reduceEdits(newEdits(), { type: 'keep', key: k, context: 'as titled' })
  expect(appliedEdits(sections, e)[0]!.stale).toBe(false)
})

test('an edit whose text is gone is stale and falls back to 7.6', () => {
  const k = ideaEditKey('s1', 'a', 0, 'gone')
  const e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'x' })
  expect(appliedEdits(sections, e)[0]).toMatchObject({ stale: true, category: '7.6', sectionTitle: 'Nutrients' })
})
