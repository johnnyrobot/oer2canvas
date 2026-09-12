import { findTerms } from './terms'

const html = (body: string) => body

test('an ableist phrase becomes an edit finding with the rule, occurrence, and category 7.6', () => {
  const f = findTerms('s1', html('<p id="b2c-blk-0">He suffers from asthma.</p>'))
  expect(f).toHaveLength(1)
  const e = f[0]!
  expect(e.kind).toBe('edit')
  if (e.kind !== 'edit') return
  expect(e).toMatchObject({
    category: '7.6', sectionId: 's1', elementId: 'b2c-blk-0', original: 'suffers from', occurrence: 0,
    replacement: 'has', inQuotation: false, origin: 'rule',
  })
  expect(e.rule.id).toBe('ablist-suffers-from')
  expect(e.rule.sourceUrl).toMatch(/^https:\/\/ncdj\.org/)
  expect(e.key).toBe('s1::b2c-blk-0::0::suffers from')
})

test('matching is case-insensitive at word boundaries and reports the text as written', () => {
  const f = findTerms('s1', '<p id="a">Crazy ideas. Not a crazyquilt. crazy.</p>')
  // The occurrence index counts SUBSTRING matches of the text as written, the
  // same way `findOccurrence` will at apply time: the standalone "crazy" is
  // occurrence 1 because "crazyquilt" contains occurrence 0. Counting words
  // here and substrings there would replace the wrong one.
  expect(f.map((x) => x.kind === 'edit' && [x.original, x.occurrence])).toEqual([['Crazy', 0], ['crazy', 1]])
})

test('a gender noun is category 7.3', () => {
  const f = findTerms('s1', '<p id="a">The chairman spoke.</p>')
  expect(f[0]!.category).toBe('7.3')
})

test('a rule with edit:false is an observation, not an edit', () => {
  const f = findTerms('s1', '<p id="a">Each student should bring his or her book.</p>')
  expect(f).toHaveLength(1)
  expect(f[0]!.kind).toBe('observation')
  if (f[0]!.kind !== 'observation') return
  expect(f[0]!.columns.text).toBe('his or her')
  expect(f[0]!.elementId).toBe('a')
})

test('a hit inside a quotation is flagged inQuotation', () => {
  const f = findTerms('s1', '<blockquote><p id="a">the schizophrenics were</p></blockquote><p id="b">As Kraepelin (1911) wrote, the schizophrenics</p>')
  expect(f.length).toBeGreaterThan(0)
  expect(f.every((x) => x.kind === 'edit' && x.inQuotation)).toBe(true)
})

test('a match that spans an inline element is skipped', () => {
  const f = findTerms('s1', '<p id="a">falling on <em>deaf</em> ears</p>')
  expect(f).toEqual([])
})

test('blocks with no id are skipped rather than keyed on an empty string', () => {
  expect(findTerms('s1', '<p>crazy</p>')).toEqual([])
})
