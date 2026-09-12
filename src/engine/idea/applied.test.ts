import { appliedEdits } from './applied'
import { ideaEditKey, imageEditKey, newEdits, reduceEdits, type ImageEdit } from './edits'

const sections = [
  { id: 's1', title: 'Nutrients', html: '<p id="a">He has asthma and is a chairman.</p>' },
  { id: 's2', title: 'Digestion', html: '<p id="b">hit the books (study hard)</p>' },
]

test('an applied replace is present when its replacement is at the element; its category comes from the original', () => {
  const k = ideaEditKey('s1', 'a', 0, 'suffers from')
  const e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  expect(appliedEdits(sections, e)).toEqual([
    { key: k, edit: { kind: 'replace', replacement: 'has' }, stale: false, sectionTitle: 'Nutrients', category: '7.6' },
  ])
})

test('a gendered noun edit is filed under 7.3; an idiom gloss under 7.6', () => {
  // From the key's original alone (case-insensitively), never from the html:
  // after a replace the original is not in the bytes to be found.
  let e = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'Chairman'), replacement: 'chair' })
  e = reduceEdits(e, { type: 'replace', key: ideaEditKey('s2', 'b', 0, 'hit the books'), replacement: 'hit the books (study hard)' })
  expect(appliedEdits(sections, e).map((a) => a.category)).toEqual(['7.3', '7.6'])
})

test('an edit that carries its category files there, whatever the original text; one that does not falls back to the term list', () => {
  // A 7.2 draft accepted: the key's original is text no rule knows, and it
  // must not land under 7.6 just because that is where the rules file.
  let e = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'He has asthma'), replacement: 'A patient has asthma', category: '7.2' })
  e = reduceEdits(e, { type: 'keep', key: ideaEditKey('s1', 'a', 0, 'chairman'), context: 'the title in 1950', category: '7.3' })
  e = reduceEdits(e, { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'Chairman'), replacement: 'chair' })
  expect(appliedEdits(sections, e).map((a) => a.category)).toEqual(['7.2', '7.3', '7.3'])
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

test('an image edit is present while its figure is in the bytes, and files under 7.1', () => {
  const image: ImageEdit = {
    kind: 'image', placement: { kind: 'insert-after', elementId: 'a' }, assetName: 'lab-abc12345.jpg', width: 1, height: 1, alt: 'A lab.', caption: '',
    attribution: { text: '“Lab”, Wikimedia Commons, CC0', sourcePageUrl: 's', licenseName: 'CC0', shareAlike: false },
  }
  const e = reduceEdits(newEdits(), { type: 'image', key: imageEditKey('s1', image.assetName), edit: image })
  expect(appliedEdits(sections, e)[0]).toMatchObject({ stale: true, category: '7.1', sectionTitle: 'Nutrients' })
  const placed = [{ ...sections[0]!, html: '<p id="a">x</p><div class="b2c-figure" id="b2c-idea-img-lab-abc12345"><img src="y" alt="A lab."></div>' }]
  expect(appliedEdits(placed, e)[0]!.stale).toBe(false)
})
