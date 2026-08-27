import { describe, it, expect } from 'vitest'
import { compileSection } from '../index'
import { restructureFigures } from './figures'
import { ctx, section } from '../test-support'

// The real shape, straight out of page-section.json: the caption is a
// following SIBLING of the figure, and its whole content is a label.
const REAL = `
<figure id="Figure_01_04_001" class="small">
<span data-type="media" id="fs-id1" data-alt="A house">
<img src="https://openstax.org/r/abc" alt="A house" width="360" height="285"/>
</span>
</figure><div class="os-caption-container">
  <span class="os-title-label">Figure </span><span class="os-number">1</span>
</div>`

describe('restructureFigures', () => {
  it('replaces figure with the allowlist-safe b2c-figure div', () => {
    const out = compileSection(section(REAL), ctx, [restructureFigures])
    expect(out.html).not.toContain('<figure')
    expect(out.html).toContain('class="b2c-figure"')
  })

  it('pulls in the SIBLING caption and associates it with the image', () => {
    const out = compileSection(section(REAL), ctx, [restructureFigures])
    expect(out.html).toContain('class="b2c-caption"')
    expect(out.html).toMatch(/aria-describedby="b2c-cap-Figure_01_04_001"/)
    expect(out.html).toMatch(/id="b2c-cap-Figure_01_04_001"[^>]*>Figure 1</)
    expect(out.html).not.toContain('os-caption-container')
  })

  it('unwraps the publisher media wrapper', () => {
    const out = compileSection(section(REAL), ctx, [restructureFigures])
    expect(out.html).not.toContain('data-type="media"')
    expect(out.html).toContain('<img')
  })

  it('notes a label-only caption so it is visible rather than silently thin', () => {
    const out = compileSection(section(REAL), ctx, [restructureFigures])
    expect(out.notes.some((n) => n.step === 'figures' && /label-only/i.test(n.message))).toBe(true)
  })

  it('does not note label-only when the caption is a real description', () => {
    const rich = REAL.replace(
      '<span class="os-number">1</span>',
      '<span class="os-number">1</span> A house drawn as a square with a triangular roof.',
    )
    const out = compileSection(section(rich), ctx, [restructureFigures])
    expect(out.notes.some((n) => /label-only/i.test(n.message))).toBe(false)
  })

  it('handles a figure with no caption at all', () => {
    const out = compileSection(section('<figure><img src="https://x/a" alt="a"></figure>'), ctx, [restructureFigures])
    expect(out.html).toContain('class="b2c-figure"')
    expect(out.html).not.toContain('b2c-caption')
    expect(out.html).not.toContain('aria-describedby')
  })

  it('is idempotent — a second pass adds no second caption', () => {
    const once = compileSection(section(REAL), ctx, [restructureFigures])
    const twice = compileSection({ ...section(once.html) }, ctx, [restructureFigures])
    expect(twice.html).toBe(once.html)
  })
})
