import { RULE_FINDERS, checkSection, findingsByCategory, findingsFor } from './findings'
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

test('a finder that throws fails only its own categories; every other finder still runs', () => {
  const broken = { categories: ['7.6', '7.3'] as const, kind: 'rule' as const, find: () => { throw new Error('regex blew up') } }
  const { findings, failures } = checkSection(section, newEdits(), [...RULE_FINDERS.filter((f) => !f.categories.includes('7.3')), broken])
  // The idiom finder (7.6 only) still ran; the terms finder was replaced by the broken one.
  expect(findings.map((f) => f.category)).toContain('7.6')
  expect(failures).toEqual([
    { category: '7.6', sectionId: 's1', message: 'regex blew up' },
    { category: '7.3', sectionId: 's1', message: 'regex blew up' },
  ])
})

test('every rule finder names the categories it can fail for', () => {
  for (const f of RULE_FINDERS) expect(f.categories.length).toBeGreaterThan(0)
})
