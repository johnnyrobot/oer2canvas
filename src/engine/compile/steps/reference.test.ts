import { describe, it, expect } from 'vitest'
import { firstSentence } from './reference'

describe('firstSentence', () => {
  it('cuts a table-length paragraph down to its opening sentence', () => {
    // The real 1.4 Analysis paragraph, 291 characters.
    const paragraph =
      'We can use a table to keep track of our work, as shown in Table 1. Write one polynomial ' +
      'across the top and the other down the side. For each box in the table, multiply the term ' +
      'for that row by the term for that column. Then add all of the terms together, combine ' +
      'like terms, and simplify.'
    expect(firstSentence(paragraph)).toBe(
      'We can use a table to keep track of our work, as shown in Table 1.',
    )
  })

  it('does not split a section or figure number', () => {
    // "Table 1.4" is the hazard a naive split on "." produces.
    const text = 'The results appear in Table 1.4 and are discussed below. Read on.'
    expect(firstSentence(text)).toBe('The results appear in Table 1.4 and are discussed below.')
  })

  it('does not split on a decimal', () => {
    const text = 'The ratio is 3.14 for every circle. Everything else follows.'
    expect(firstSentence(text)).toBe('The ratio is 3.14 for every circle.')
  })

  it('does not split on a common abbreviation followed by a capital', () => {
    const text = 'Compare the shapes in the grid, e.g. Table 1 and the one beside it. Then stop.'
    expect(firstSentence(text)).toBe(
      'Compare the shapes in the grid, e.g. Table 1 and the one beside it.',
    )
  })

  it('returns the whole string when there is no sentence boundary', () => {
    expect(firstSentence('Multiply each row by each column')).toBe(
      'Multiply each row by each column',
    )
  })

  it('keeps going rather than returning an implausibly short opening', () => {
    // A boundary this early is far more often a split we got wrong than a real
    // sentence, and a card reading "See." helps nobody.
    expect(firstSentence('See. The table below sets out every product in the grid.')).toBe(
      'See. The table below sets out every product in the grid.',
    )
  })

  it('handles ? and ! as boundaries', () => {
    const text = 'Which cells in this grid are labels? Every other cell is a product.'
    expect(firstSentence(text)).toBe('Which cells in this grid are labels?')
  })
})
