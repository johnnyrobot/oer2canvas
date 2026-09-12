import terms from './data/idea-terms.json'
import idioms from './data/idea-idioms.json'

test('every term rule is complete, unique, lower-case, and cites a source', () => {
  const ids = new Set<string>()
  for (const r of terms.rules) {
    expect(ids.has(r.id), r.id).toBe(false)
    ids.add(r.id)
    expect(r.inconsiderate.length, r.id).toBeGreaterThan(0)
    expect(r.considerate.length, r.id).toBeGreaterThan(0)
    for (const p of r.inconsiderate) expect(p, r.id).toBe(p.toLowerCase().trim())
    expect(r.note.length, r.id).toBeGreaterThan(10)
    expect(r.source, r.id).toMatch(/^https?:\/\//)
    expect(['ablist', 'race', 'lgbtq', 'condescending', 'suicide', 'gender']).toContain(r.category)
    expect(typeof r.edit).toBe('boolean')
  }
  expect(terms.rules.length).toBeGreaterThanOrEqual(60)
})

test('no inconsiderate phrase is a common software or academic term', () => {
  const banned = ['disabled', 'master', 'slave', 'whitelist', 'blacklist', 'dummy', 'blind study', 'double-blind']
  for (const r of terms.rules) for (const p of r.inconsiderate) expect(banned, r.id).not.toContain(p)
})

test('idioms are unique, lower-case, and glossed', () => {
  const seen = new Set<string>()
  for (const i of idioms.idioms) {
    expect(seen.has(i.phrase), i.phrase).toBe(false)
    seen.add(i.phrase)
    expect(i.phrase).toBe(i.phrase.toLowerCase().trim())
    expect(i.gloss.length, i.phrase).toBeGreaterThan(3)
  }
  expect(idioms.idioms.length).toBeGreaterThanOrEqual(40)
})
