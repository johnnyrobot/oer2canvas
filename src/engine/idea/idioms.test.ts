import { findIdioms } from './idioms'

test('an idiom is an observation with a gloss and an optional parenthetical edit', () => {
  const f = findIdioms('s1', '<p id="a">Time to hit the books before the exam.</p>')
  expect(f).toHaveLength(1)
  const o = f[0]!
  expect(o.kind).toBe('observation')
  if (o.kind !== 'observation') return
  expect(o.category).toBe('7.6')
  expect(o.columns).toEqual({ idiom: 'hit the books', gloss: 'study hard', suggestion: 'hit the books (study hard)' })
  expect(o.elementId).toBe('a')
  expect(o.rule?.source).toBe('idiom')
  expect(o.key).toBe('s1::a::0::hit the books')
})

test('matching is case-insensitive and whole-phrase', () => {
  expect(findIdioms('s1', '<p id="a">A Piece Of Cake, said the baker of cake.</p>')).toHaveLength(1)
})
