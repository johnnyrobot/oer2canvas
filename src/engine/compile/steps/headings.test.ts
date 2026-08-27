import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { relevelHeadings } from './headings'
import { ctx, section } from '../test-support'

const levels = (html: string): string[] =>
  [...html.matchAll(/<(h[1-6])\b/g)].map((m) => m[1]!)

describe('relevelHeadings', () => {
  it('demotes a document that starts at h1', () => {
    const out = compileSection(section('<h1>A</h1><h2>B</h2><h3>C</h3>'), ctx, [relevelHeadings])
    expect(levels(out.html)).toEqual(['h2', 'h3', 'h4'])
  })

  it('leaves a document that already starts at h2 untouched', () => {
    const html = '<h2>A</h2><h3>B</h3><h4>C</h4>'
    expect(levels(compileSection(section(html), ctx, [relevelHeadings]).html)).toEqual(['h2', 'h3', 'h4'])
  })

  it('PROMOTES a document that starts at h3, because h3 under the page title h1 is a skip', () => {
    const out = compileSection(section('<h3>A</h3><h4>B</h4>'), ctx, [relevelHeadings])
    expect(levels(out.html)).toEqual(['h2', 'h3'])
  })

  it('closes a skip', () => {
    const out = compileSection(section('<h2>A</h2><h4>B</h4>'), ctx, [relevelHeadings])
    expect(levels(out.html)).toEqual(['h2', 'h3'])
  })

  it('clamps at h6', () => {
    const out = compileSection(section('<h1>A</h1><h6>B</h6>'), ctx, [relevelHeadings])
    expect(levels(out.html)).toEqual(['h2', 'h3'])
  })

  it('never emits h7+ when a long ramp under a promoting shift would otherwise overflow', () => {
    // The de-skip clamp (target > previous + 1) does NOT catch this case: by the
    // seventh heading `previous` has legitimately climbed to 6, so `previous + 1`
    // is 7 — exactly the raw overflowed target — and the guard's `>` comparison
    // is false. Only the Math.min(6, ...) ceiling in headings.ts stops h7 from
    // shipping. This fixture is the one that isolates that line; "clamps at h6"
    // above does not, because with only two headings the de-skip clamp already
    // forces the result down to h3 whether or not the ceiling exists.
    const html = '<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6><h6>G</h6>'
    const out = compileSection(section(html), ctx, [relevelHeadings])
    expect(levels(out.html)).toEqual(['h2', 'h3', 'h4', 'h5', 'h6', 'h6', 'h6'])
  })

  it('NEVER leaves an h1 behind, or allowlist.ts demotes the document a second time', () => {
    const out = compileSection(section('<h1>A</h1><p>x</p><h1>B</h1>'), ctx, [relevelHeadings])
    expect(out.html).not.toMatch(/<h1\b/)
  })

  it('keeps attributes and children when it renames', () => {
    const out = compileSection(section('<h1 id="t" class="os-title">A <em>b</em></h1>'), ctx, [relevelHeadings])
    expect(out.html).toContain('<h2 id="t" class="os-title">')
    expect(out.html).toContain('<em>b</em>')
  })

  it('does nothing to a section with no headings', () => {
    expect(compileSection(section('<p>x</p>'), ctx, [relevelHeadings]).html.trim()).toBe('<p>x</p>')
  })
})
