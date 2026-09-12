import { FRAMEWORK_ATTRIBUTION, IDEA_CATEGORY_IDS, IDEA_FRAMEWORK, categoryById } from './framework'

test('the Framework has the eight categories in document order', () => {
  expect(IDEA_FRAMEWORK.map((c) => c.id)).toEqual(['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8'])
  expect(IDEA_CATEGORY_IDS).toEqual(IDEA_FRAMEWORK.map((c) => c.id))
})

// Ids are what the review map and the export key on, so a duplicate would make
// two checklist answers or two ratings silently overwrite each other.
test('every element id and rubric row id is unique across the whole Framework', () => {
  const ids = IDEA_FRAMEWORK.flatMap((c) => [...c.elements.map((e) => e.id), ...c.rows.map((r) => r.id)])
  expect(new Set(ids).size).toBe(ids.length)
  for (const c of IDEA_FRAMEWORK) {
    for (const e of c.elements) expect(e.id.startsWith(`${c.id}.`), e.id).toBe(true)
    for (const r of c.rows) expect(r.id.startsWith(`${c.id}.`), r.id).toBe(true)
  }
})

// Rubric 1 gives Illustrations and Photos three rows and every other category one.
test('rubric rows match Appendix A', () => {
  expect(categoryById('7.1').rows).toHaveLength(3)
  for (const id of IDEA_CATEGORY_IDS.filter((c) => c !== '7.1')) {
    expect(categoryById(id).rows, id).toHaveLength(1)
  }
})

// The element counts are the document's. A dropped bullet is a silently
// narrower checklist, so the counts are pinned, not just "at least three".
test('the elements for consideration are all present', () => {
  const counts = Object.fromEntries(IDEA_FRAMEWORK.map((c) => [c.id, c.elements.length]))
  expect(counts).toEqual({ '7.1': 5, '7.2': 5, '7.3': 5, '7.4': 7, '7.5': 6, '7.6': 6, '7.7': 3, '7.8': 6 })
})

// Two places the source text is easy to abridge and was, in an earlier draft.
test('the text is quoted in full, not shortened', () => {
  expect(categoryById('7.6').restorative).toContain('“schizophrenics”')
  expect(categoryById('7.6').restorative).toContain('“primary” bedroom')
  expect(categoryById('7.6').elements[4]?.text).toContain('Language that is offensive to people with disabilities is ableist.')
  expect(categoryById('7.5').elements[5]?.text).toContain('The Red Badge of Courage')
  expect(categoryById('7.8').elements[5]?.text).toContain('“rural communities tend to support gun rights.”')
})

test('no category is empty of guidance', () => {
  for (const c of IDEA_FRAMEWORK) {
    expect(c.title, c.id).not.toBe('')
    expect(c.rubricTitle, c.id).not.toBe('')
    expect(c.restorative.length, c.id).toBeGreaterThan(80)
    for (const r of c.rows) {
      expect(r.exclusive, r.id).not.toBe('')
      expect(r.emerging, r.id).not.toBe('')
      expect(r.inclusive, r.id).not.toBe('')
    }
  }
})

test('the attribution names the CC BY 4.0 licence', () => {
  expect(FRAMEWORK_ATTRIBUTION.license.name).toBe('CC BY 4.0')
  expect(FRAMEWORK_ATTRIBUTION.license.url).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by\/4\.0/)
  expect(FRAMEWORK_ATTRIBUTION.url).toMatch(/^https:\/\/asccc-oeri\.org\//)
})
