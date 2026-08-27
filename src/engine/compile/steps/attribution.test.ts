import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { appendAttribution } from './attribution'
import { ctx, section } from '../test-support'

const full = {
  ...ctx,
  attribution: {
    bookTitle: 'Algebra and Trigonometry',
    publisher: 'OpenStax',
    url: 'https://openstax.org/books/algebra-and-trigonometry',
    authors: ['Jay Abramson', 'Valeree Falduto'],
    license: {
      name: 'Creative Commons Attribution License',
      url: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
}

describe('appendAttribution', () => {
  it('appends a block naming the section, book, publisher and authors', () => {
    const out = compileSection(section('<p>x</p>'), full, [appendAttribution])
    expect(out.html).toContain('class="b2c-attribution"')
    expect(out.html).toContain('Polynomials')
    expect(out.html).toContain('Algebra and Trigonometry')
    expect(out.html).toContain('OpenStax')
    expect(out.html).toContain('Jay Abramson')
  })

  it('links the section by its own canonical url, not the book url', () => {
    const out = compileSection(section('<p>x</p>'), full, [appendAttribution])
    expect(out.html).toContain(`href="${full.canonicalUrl}"`)
  })

  it('gives the license link descriptive text, never a bare url', () => {
    // The block is audited like everything else, so it must itself meet WCAG.
    const out = compileSection(section('<p>x</p>'), full, [appendAttribution])
    expect(out.html).toContain('>Creative Commons Attribution License</a>')
    expect(out.html).not.toMatch(/>https?:\/\/[^<]*<\/a>/)
  })

  it('uses only allowlisted elements, so repair leaves it intact', () => {
    const out = compileSection(section('<p>x</p>'), full, [appendAttribution])
    const tags = [...out.html.matchAll(/<([a-z0-9]+)/g)].map((m) => m[1]!)
    expect(new Set(tags)).toEqual(new Set(['p', 'div', 'h2', 'a']))
  })

  it('degrades without a license, and SAYS it degraded', () => {
    const noLicense = { ...full, attribution: { ...full.attribution, license: undefined } }
    const out = compileSection(section('<p>x</p>'), noLicense, [appendAttribution])
    expect(out.html).toContain('class="b2c-attribution"')
    expect(out.html).toContain('Algebra and Trigonometry')
    expect(out.html).toMatch(/license .*could not be determined/i)
  })

  it('degrades without authors, and SAYS it degraded', () => {
    const noAuthors = { ...full, attribution: { ...full.attribution, authors: [] } }
    const out = compileSection(section('<p>x</p>'), noAuthors, [appendAttribution])
    expect(out.html).toContain('class="b2c-attribution"')
    expect(out.html).toMatch(/authors? .*could not be determined/i)
  })

  it('names the authors when present, with no degradation sentence', () => {
    const out = compileSection(section('<p>x</p>'), full, [appendAttribution])
    expect(out.html).toContain('By Jay Abramson, Valeree Falduto.')
    expect(out.html).not.toMatch(/authors? .*could not be determined/i)
  })

  it('is idempotent — a second pass appends no second block', () => {
    const once = compileSection(section('<p>x</p>'), full, [appendAttribution])
    const twice = compileSection(section(once.html), full, [appendAttribution])
    expect(twice.html).toBe(once.html)
  })
})
