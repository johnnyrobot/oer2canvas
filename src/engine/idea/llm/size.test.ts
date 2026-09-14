import { estimateTokens, overCeiling, promptTokens, wordCount } from './size'
import { providerById } from './providers'

test('tokens are estimated at four characters each, rounded up', () => {
  expect(estimateTokens('')).toBe(0)
  expect(estimateTokens('abcd')).toBe(1)
  expect(estimateTokens('abcde')).toBe(2)
})

test('promptTokens measures the serialised messages; wordCount counts whitespace-separated words', () => {
  const msgs = [{ role: 'system' as const, content: 'x'.repeat(40) }, { role: 'user' as const, content: 'y'.repeat(40) }]
  expect(promptTokens(msgs)).toBeGreaterThanOrEqual(20)
  expect(wordCount('one two\n\nthree  four ')).toBe(4)
})

test('over the ceiling is strictly greater than the provider\'s contextTokens', () => {
  const gemini = providerById('gemini')
  expect(overCeiling(gemini.contextTokens, gemini)).toBe(false)
  expect(overCeiling(gemini.contextTokens + 1, gemini)).toBe(true)
})
