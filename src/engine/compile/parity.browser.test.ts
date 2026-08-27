import { describe, it, expect } from 'vitest'
import { compileSection } from './index'
import { fixtureContext, type FixtureName } from './fixture-context'

/**
 * The transforms run over a DOMParser document. In `unit` that parser is
 * jsdom's; in the shipped app it is the user's browser. Every golden and every
 * invariant in this directory was measured under jsdom, so a divergence would
 * mean the suite is describing a pipeline nobody runs.
 *
 * These numbers are asserted against the SAME expectations the jsdom suite
 * holds, deliberately duplicated as literals rather than imported, so a change
 * to the jsdom side cannot quietly move the browser side with it.
 */
describe.each<FixtureName>(['page', 'page-section'])('%s parses the same in Chromium', (name) => {
  const { section, ctx } = fixtureContext(name)
  const out = compileSection(section, ctx)

  it('compiles without error', () => {
    expect(out.error).toBeUndefined()
  })

  it('produces the element counts jsdom produced', () => {
    const doc = new DOMParser().parseFromString(out.html, 'text/html')
    const counts = {
      math: doc.querySelectorAll('math').length,
      mo: doc.querySelectorAll('mo').length,
      img: doc.querySelectorAll('img').length,
      figure: doc.querySelectorAll('figure').length,
      b2cFigure: doc.querySelectorAll('.b2c-figure').length,
      table: doc.querySelectorAll('table').length,
      td: doc.querySelectorAll('td').length,
      h1: doc.querySelectorAll('h1').length,
      xref: doc.querySelectorAll('[data-b2c-xref]').length,
      attribution: doc.querySelectorAll('.b2c-attribution').length,
    }
    expect(counts).toEqual(
      name === 'page-section'
        ? { math: 132, mo: 1446, img: 7, figure: 0, b2cFigure: 1, table: 1, td: 12, h1: 0, xref: 29, attribution: 1 }
        : { math: 0, mo: 0, img: 1, figure: 0, b2cFigure: 0, table: 0, td: 0, h1: 0, xref: 0, attribution: 1 },
    )
  })

  it('produces the same queue jsdom produced', () => {
    expect(out.queue.map((q) => q.kind).sort()).toEqual(
      name === 'page-section' ? ['confirm-decorative', 'confirm-decorative', 'confirm-decorative', 'confirm-decorative'] : [],
    )
  })
})
