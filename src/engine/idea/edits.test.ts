import { ideaEditKey, imageEditKey, newEdits, parseIdeaEditKey, reduceEdits, sectionsWithEdits } from './edits'

const k = ideaEditKey('s1', 'b2c-blk-3', 1, 'suffers from')

test('a key round-trips and tolerates :: inside the original', () => {
  const key = ideaEditKey('s1', 'b2c-blk-3', 1, 'a::b')
  expect(parseIdeaEditKey(key)).toEqual({ sectionId: 's1', elementId: 'b2c-blk-3', occurrence: 1, original: 'a::b' })
  expect(parseIdeaEditKey(k).original).toBe('suffers from')
})

test('replace, keep and dismiss each land in exactly one place', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  expect(e.edits.get(k)).toEqual({ kind: 'replace', replacement: 'has' })
  e = reduceEdits(e, { type: 'keep', key: k, context: 'a term used at the time' })
  expect(e.edits.get(k)).toEqual({ kind: 'keep', context: 'a term used at the time' })
  e = reduceEdits(e, { type: 'dismiss', key: k })
  expect(e.edits.has(k)).toBe(false)
  expect(e.dismissed.has(k)).toBe(true)
})

test('undo removes a key from both edits and dismissed', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  e = reduceEdits(e, { type: 'undo', key: k })
  expect(e.edits.size).toBe(0)
  e = reduceEdits(e, { type: 'dismiss', key: k })
  e = reduceEdits(e, { type: 'undo', key: k })
  expect(e.dismissed.size).toBe(0)
})

test('sectionsWithEdits lists each section once', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'x'), replacement: 'y' })
  e = reduceEdits(e, { type: 'keep', key: ideaEditKey('s1', 'b', 0, 'x') })
  e = reduceEdits(e, { type: 'replace', key: ideaEditKey('s2', 'c', 0, 'x'), replacement: 'y' })
  expect([...sectionsWithEdits(e)]).toEqual(['s1', 's2'])
})

test('the reducer does not mutate its input', () => {
  const before = newEdits()
  reduceEdits(before, { type: 'replace', key: k, replacement: 'has' })
  expect(before.edits.size).toBe(0)
})

test('an image edit is stored under its own key and undone like any other', () => {
  const edit = { kind: 'image' as const, placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-2' }, assetName: 'students-abc12345.jpg', width: 800, height: 600, alt: 'Two students at a lab bench', caption: 'Students in a chemistry lab.', attribution: { text: '“Lab” by A, Wikimedia Commons, CC BY 4.0', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Lab.jpg', licenseName: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', shareAlike: false } }
  const key = imageEditKey('s1', edit.assetName)
  expect(parseIdeaEditKey(key)).toEqual({ sectionId: 's1', elementId: 'image', occurrence: 0, original: edit.assetName })
  let e = reduceEdits(newEdits(), { type: 'image', key, edit })
  expect(e.edits.get(key)).toEqual(edit)
  expect([...sectionsWithEdits(e)]).toEqual(['s1'])
  e = reduceEdits(e, { type: 'undo', key })
  expect(e.edits.size).toBe(0)
})
