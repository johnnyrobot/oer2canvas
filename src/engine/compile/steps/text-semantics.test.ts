import { describe, expect, it } from 'vitest'
import { compileSection } from '../index'
import { normalizeTextSemantics } from './text-semantics'
import { ctx, section } from '../test-support'

describe('normalizeTextSemantics', () => {
  it('uses semantic emphasis elements', () => {
    const out = compileSection(section('<p><b>Important</b> and <i>optional</i></p>'), ctx, [normalizeTextSemantics])
    expect(out.html).toContain('<strong>Important</strong>')
    expect(out.html).toContain('<em>optional</em>')
    expect(out.html).not.toMatch(/<\/?[bi](?:\s|>)/)
  })

  it('removes underline from non-links but preserves linked underlines', () => {
    const out = compileSection(
      section('<p><u>plain</u> <span style="text-decoration: underline">plain 2</span> <a href="https://example.org"><u>link</u></a></p>'),
      ctx,
      [normalizeTextSemantics],
    )
    expect(out.html).toContain('<span style="text-decoration: none;">plain</span>')
    expect(out.html).toContain('<span style="text-decoration: none;">plain 2</span>')
    expect(out.html).toContain('<a href="https://example.org"><u>link</u></a>')
  })
})

