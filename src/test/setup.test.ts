import { describe, it, expect } from 'vitest'

describe('test suite network guard', () => {
  it('throws when anything calls the ambient fetch', () => {
    expect(() => globalThis.fetch('https://openstax.org/rex/release.json')).toThrow(
      /network access is disabled in tests/i,
    )
  })

  it('names the URL it blocked, so the failure points at the caller', () => {
    expect(() => globalThis.fetch('https://example.com/x')).toThrow(/https:\/\/example\.com\/x/)
  })
})
