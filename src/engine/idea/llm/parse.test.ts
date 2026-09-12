import { draftsToFindings, parseCategoryResponse, parseRubricResponse } from './parse'

test('a JSON response parses to items; a fenced one too', () => {
  const json = JSON.stringify({ summary: 'ok', items: [{ evidence: 'e', inference: 'i', suggestion: 's' }] })
  expect(parseCategoryResponse(json).items).toHaveLength(1)
  expect(parseCategoryResponse('```json\n' + json + '\n```').items).toHaveLength(1)
  expect(parseCategoryResponse(json).summary).toBe('ok')
})

test('unparseable text becomes raw, never dropped', () => {
  const r = parseCategoryResponse('Here are my thoughts...')
  expect(r.items).toEqual([])
  expect(r.raw).toBe('Here are my thoughts...')
})

test('an item is promoted to an edit only when its original is verbatim in the section', () => {
  const html = '<p id="b2c-blk-0">The chairman spoke to the men.</p>'
  const parsed = { items: [
    { evidence: 'e', inference: 'i', suggestion: 's', original: 'chairman', replacement: 'chair' },
    { evidence: 'e', inference: 'i', suggestion: 's', original: 'the chairperson', replacement: 'the chair' },
    { evidence: 'e', inference: 'i', suggestion: 'no edit' },
  ] }
  const f = draftsToFindings('7.3', 's1', html, parsed)
  expect(f.map((x) => x.kind)).toEqual(['edit', 'observation', 'observation'])
  const e = f[0]!
  expect(e.kind === 'edit' && e.elementId).toBe('b2c-blk-0')
  expect(e.kind === 'edit' && e.key).toBe('s1::b2c-blk-0::0::chairman')
  expect(f.every((x) => x.origin === 'draft' && x.rule?.source === 'llm')).toBe(true)
})

test('a raw response becomes one observation carrying the text', () => {
  const f = draftsToFindings('7.8', 's1', '<p id="a">x</p>', parseCategoryResponse('plain prose'))
  expect(f).toHaveLength(1)
  expect(f[0]!.kind === 'observation' && f[0]!.columns.response).toBe('plain prose')
})

test('the rubric parser maps OERI labels to per-row ratings and tolerates unknown labels as null', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [
    { area: '7.1 Illustrations', rows: [{ row: '7.1.a', rating: 'Emerging Inclusive' }, { row: 'b', rating: 'Exclusive' }, { row: '7.1.z', rating: 'Inclusive' }], notes: 'a' },
    { area: '7.6', rating: 'N/A', notes: 'b' },
    { area: '7.8', rating: 'unsure', notes: 'c' },
  ] }))
  expect(r.areas).toEqual([
    // Row ids are accepted bare or qualified; a row the Framework lacks is ignored; a missing row is null.
    { id: '7.1', rows: [{ id: '7.1.a', rating: 'emerging' }, { id: '7.1.b', rating: 'exclusive' }, { id: '7.1.c', rating: null }], notes: 'a' },
    { id: '7.6', rows: [{ id: '7.6.a', rating: 'na' }], notes: 'b' },
    { id: '7.8', rows: [{ id: '7.8.a', rating: null }], notes: 'c' },
  ])
})

// A single "rating" for a three-row area is not spread across the rows: the
// model did not rate them, and a draft that looks like it did is a draft that
// gets copied by eye.
test('a bare rating on a multi-row area leaves its rows null', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }] }))
  expect(r.areas[0]!.rows.map((x) => x.rating)).toEqual([null, null, null])
  expect(r.areas[0]!.notes).toBe('n')
})
