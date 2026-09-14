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
  const f = draftsToFindings('7.2', 's1', html, parsed)
  expect(f.map((x) => x.kind)).toEqual(['edit', 'observation', 'observation'])
  const e = f[0]!
  expect(e.kind === 'edit' && e.elementId).toBe('b2c-blk-0')
  expect(e.kind === 'edit' && e.key).toBe('s1::b2c-blk-0::0::chairman')
  expect(f.every((x) => x.origin === 'draft' && x.rule?.source === 'llm')).toBe(true)
})

// Spec §3.1 leaves pronoun rewrites to the author. A 7.3 draft is read, never
// offered as Replace, however verbatim its "original" is.
test('a 7.3 item with a verbatim original still comes back as an observation', () => {
  const html = '<p id="b2c-blk-0">Each student must bring his book.</p>'
  const f = draftsToFindings('7.3', 's1', html, { items: [{ evidence: 'his book', inference: 'binary', suggestion: 'their book', original: 'his book', replacement: 'their book' }] })
  expect(f.map((x) => x.kind)).toEqual(['observation'])
  expect(f[0]!.kind === 'observation' && f[0]!.columns.suggestion).toBe('their book')
  // 7.6 keeps the verbatim rule.
  const g = draftsToFindings('7.6', 's1', '<p id="b2c-blk-0">The crazy idea.</p>', { items: [{ evidence: 'crazy', inference: 'i', suggestion: 's', original: 'crazy', replacement: 'wild' }] })
  expect(g.map((x) => x.kind)).toEqual(['edit'])
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

// Gemini echoes the prompt's row line back with the rubric title in tow.
// Measured 2026-09-12; before this the whole rubric draft was null.
test('a row id followed by a title is still that row', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [
    { area: '7.1 Illustrations and Photos', rows: [
      { row: '7.1.a (Illustrations and Photos of People)', rating: 'Exclusive' },
      { row: 'b (Illustrations and Photos of People)', rating: 'Not Applicable' },
      { row: 'Row c', rating: 'Inclusive' },
      { row: '7.1.ab', rating: 'Inclusive' },
    ], notes: 'n' },
  ] }))
  expect(r.areas[0]!.rows).toEqual([{ id: '7.1.a', rating: 'exclusive' }, { id: '7.1.b', rating: 'na' }, { id: '7.1.c', rating: null }])
})

// A single "rating" for a three-row area is not spread across the rows: the
// model did not rate them, and a draft that looks like it did is a draft that
// gets copied by eye.
test('a bare rating on a multi-row area leaves its rows null', () => {
  const r = parseRubricResponse(JSON.stringify({ areas: [{ area: '7.1', rating: 'Inclusive', notes: 'n' }] }))
  expect(r.areas[0]!.rows.map((x) => x.rating)).toEqual([null, null, null])
  expect(r.areas[0]!.notes).toBe('n')
})

test('7.7.1 drafts are observations filed under 7.7 with their own keys', () => {
  const f = draftsToFindings('7.7.1', 's1', '<p id="a">x</p>', { summary: 's', items: [{ evidence: 'e', inference: 'i', suggestion: 'add “redlining”', original: 'x', replacement: 'y' }] })
  expect(f.every((x) => x.category === '7.7' && x.kind === 'observation')).toBe(true)
  expect(f.map((x) => x.key)).toEqual(['s1::llm::7.7.1::summary', 's1::llm::7.7.1::0'])
})
