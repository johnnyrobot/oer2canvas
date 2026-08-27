import { describe, it, expect } from 'vitest'
import { ensureId } from './ids'

describe('ensureId', () => {
  it('returns an existing id unchanged and does not overwrite it', () => {
    const el = document.createElement('p')
    el.setAttribute('id', 'already-here')

    const id = ensureId(el, 'para', 3)

    expect(id).toBe('already-here')
    expect(el.getAttribute('id')).toBe('already-here')
  })

  it('mints an id from kind and index, and WRITES it into the document', () => {
    const el = document.createElement('figure')

    const id = ensureId(el, 'figure', 2)

    expect(id).toBe('b2c-figure-2')
    // The whole point: a version that computed the id without setting it would
    // pass a return-value-only assertion and silently break the feature.
    expect(el.getAttribute('id')).toBe(id)
  })

  it('is idempotent: a second call returns the same id without re-minting', () => {
    const el = document.createElement('table')

    const first = ensureId(el, 'table', 5)
    const second = ensureId(el, 'table', 5)

    expect(second).toBe(first)
    expect(el.getAttribute('id')).toBe(first)
  })
})
