import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { fixLinks } from './links'
import { ctx, section } from '../test-support'

const HREF =
  './13ac107a-f15f-49d2-97e8-60ab2e3b519c@ebc5beb:f92fd036-ead4-5380-895d-8f6f9fdbcef7.xhtml#fs-id1167339184249-solution'

const withXrefs = {
  ...ctx,
  xrefs: new Map([
    ['f92fd036-ead4-5380-895d-8f6f9fdbcef7', 'https://openstax.org/books/algebra-and-trigonometry/pages/chapter-1'],
  ]),
}

describe('fixLinks', () => {
  it('rewrites an intra-book link to its public url AND KEEPS THE FRAGMENT', () => {
    // The fragment is the entire payload: all 29 such links in the 1.4 fixture
    // point at the same answer-key page and differ only in their fragment.
    const out = compileSection(section(`<a href="${HREF}">Solution</a>`), withXrefs, [fixLinks])
    expect(out.html).toContain(
      'href="https://openstax.org/books/algebra-and-trigonometry/pages/chapter-1#fs-id1167339184249-solution"',
    )
  })

  it('tags the link so slice 7 can re-point it without re-deriving anything', () => {
    const out = compileSection(section(`<a href="${HREF}">Solution</a>`), withXrefs, [fixLinks])
    expect(out.html).toContain('data-b2c-xref="f92fd036-ead4-5380-895d-8f6f9fdbcef7"')
  })

  it('handles an href with no fragment', () => {
    const bare = HREF.replace(/#.*/, '')
    const out = compileSection(section(`<a href="${bare}">x</a>`), withXrefs, [fixLinks])
    expect(out.html).toContain('pages/chapter-1"')
  })

  it('falls back to the book url and notes it when the uuid is not in the TOC', () => {
    const out = compileSection(section(`<a href="${HREF}">x</a>`), ctx, [fixLinks])
    expect(out.html).toContain(`href="${ctx.attribution.url}"`)
    expect(out.notes.some((n) => n.step === 'links')).toBe(true)
  })

  it('leaves ordinary links alone', () => {
    const out = compileSection(section('<a href="https://example.com/a">x</a><a href="#f">y</a>'), withXrefs, [fixLinks])
    expect(out.html).toContain('href="https://example.com/a"')
    expect(out.html).toContain('href="#f"')
    expect(out.html).not.toContain('data-b2c-xref')
  })
})

describe('Canvas descriptive link labels', () => {
  it('replaces an exact generic label with the target URL subject', () => {
    const out = compileSection(
      section('<p>Read <a href="https://example.org/resources/cell-structure.html">here</a>.</p>'),
      ctx,
      [fixLinks],
    )
    expect(out.html).toContain('>Read more about cell structure</a>')
    expect(out.notes.some((note) => /generic link label/i.test(note.message))).toBe(true)
  })

  it('uses the target heading for generic same-page links', () => {
    const out = compileSection(
      section('<p><a href="#details">Read more</a></p><h3 id="details">Experimental details</h3>'),
      ctx,
      [fixLinks],
    )
    expect(out.html).toContain('>Go to Experimental details</a>')
  })

  it('leaves meaningful link labels unchanged', () => {
    const out = compileSection(section('<a href="https://example.org">OpenStax textbook</a>'), ctx, [fixLinks])
    expect(out.html).toContain('>OpenStax textbook</a>')
    expect(out.notes.some((note) => /generic link label/i.test(note.message))).toBe(false)
  })

  it('turns a raw URL used as the visible label into natural text', () => {
    const out = compileSection(
      section('<a href="https://example.org/resources/cell-structure.html">https://example.org/resources/cell-structure.html</a>'),
      ctx,
      [fixLinks],
    )
    expect(out.html).toContain('>Read more about cell structure</a>')
  })
})
