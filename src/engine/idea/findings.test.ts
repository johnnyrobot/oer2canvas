import { findingsByCategory, findingsFor } from './findings'
import { ideaEditKey, newEdits, reduceEdits } from './edits'

const section = { id: 's1', html: '<p id="a">He suffers from asthma and is a chairman.</p><p id="b">hit the books</p>' }

test('findingsFor runs every finder and groups by category', () => {
  const all = findingsFor(section, newEdits())
  // The 7.1 image inventory always yields its summary row, even with no images.
  expect(all.map((f) => f.category).sort()).toEqual(['7.1', '7.3', '7.6', '7.6'])
  const by = findingsByCategory(all)
  expect(by.get('7.6')).toHaveLength(2)
  expect(by.get('7.3')).toHaveLength(1)
  expect(by.get('7.1')).toHaveLength(1)
})

test('a finding whose key is in edits or dismissed is suppressed', () => {
  let edits = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'suffers from'), replacement: 'has' })
  edits = reduceEdits(edits, { type: 'dismiss', key: ideaEditKey('s1', 'b', 0, 'hit the books') })
  const left = findingsFor(section, edits).filter((f) => f.kind === 'edit')
  expect(left).toHaveLength(1)
  expect(left[0]!.category).toBe('7.3')
})
