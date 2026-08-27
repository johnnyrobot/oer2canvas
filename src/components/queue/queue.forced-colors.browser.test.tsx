import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueueView } from './QueueView'
import { newSession, type QueueSession } from './session'
import '../../App.css'
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

/**
 * The three geometry rules, with forced colors ON.
 *
 * `queue.css` adds three rules and, deliberately, not one colour: they use only
 * `currentColor` and the `Canvas`/`CanvasText` system colours, which is exactly
 * the set a forced-colors mode preserves. That is why the screen is EXPECTED to
 * survive Windows High Contrast — but until now it was an argument from which
 * properties were used, not a measurement. `geometry.browser.test.tsx` measures
 * the same rules under normal rendering and cannot speak to this.
 *
 * This file runs in its own vitest project (`browser-forced-colors`), because
 * the emulation cannot be switched on from inside the page and the provider is
 * configured per project rather than per test. It is therefore a second browser
 * launch, which is why it holds only what genuinely needs the mode rather than
 * a copy of the whole geometry suite.
 *
 * THE POINT IS THE REGRESSION, NOT THE PASS. These assertions are expected to
 * pass today. They are worth running because a future rule that reaches for a
 * real colour — a palette landing on this screen, say — would break them, and
 * nothing else in the suite would notice.
 */

afterEach(cleanup)

const gate = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

const item = (elementId: string): QueueItem => ({
  kind: 'confirm-decorative',
  elementId,
  sectionId: 's1',
  context: { reference: `Sentence for ${elementId}.` },
})

function session(): QueueSession {
  const queue = [item('d0'), item('d1')]
  const section: CompiledSection = {
    id: 's1',
    title: '1.4 Polynomials',
    html: '<p>compiled</p>',
    notes: [],
    queue,
    gate: gate(
      Array.from({ length: 30 }, (_, i) => `<p style="height:120px">line ${i}</p>`).join('') +
        '<p id="d0">the element</p>',
    ),
  }
  return newSession({
    chapter: { sections: [] },
    sections: [section],
    queue,
  } as unknown as CompiledChapter)
}

describe('with forced colors active', () => {
  /*
    FIRST, AND NOT OPTIONAL. Everything below is a claim about behaviour under a
    mode this file cannot switch on itself. If the project config ever stops
    applying `forcedColors: 'active'`, every other assertion here would quietly
    re-run under ordinary rendering and keep passing while measuring nothing —
    the precise failure this file exists to end. This is the assertion that
    makes the rest of them mean something.
  */
  it('is actually in forced-colors mode, so the rest of this file measures something', () => {
    expect(window.matchMedia('(forced-colors: active)').matches).toBe(true)
  })

  it('keeps the rule on the render edge visible as geometry', () => {
    render(<QueueView session={session()} />)
    const el = document.querySelector('.b2c-queue-render') as HTMLElement
    const style = getComputedStyle(el)
    // Still there: a forced-colors mode discards author colours, not author
    // geometry, so the boundary between our interface and publisher content
    // survives as a width even when every colour on the screen is replaced.
    expect(parseFloat(style.borderInlineStartWidth)).toBeGreaterThanOrEqual(3)
    expect(parseFloat(style.paddingInlineStart)).toBeGreaterThan(0)
  })

  /*
    WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, AND WHY — measured, not reasoned.

    This file cannot prove that the render edge matches its own text colour:
    no file running in this mode can, because forced
    colors REPLACES author colours with system ones, so `border-color` resolves
    to `CanvasText` whether the stylesheet said `currentColor` or a hard-coded
    hex. Verified by mutation rather than argued — swapping the rule to
    `3px solid #767676` leaves all four tests here GREEN, while the same mutation
    fails `geometry.browser.test.tsx` immediately (`expected 'rgb(118, 118, 118)'
    to be 'rgb(0, 0, 0)'`).

    So the colour half of the geometry-not-colour discipline is enforced under
    NORMAL rendering, where an author colour is still observable, and this file
    owns only what normal rendering cannot see: that the geometry carrying these
    signals survives when every colour is taken away. Adding the colour assertion
    here would pass forever and prove nothing — worse than not testing it, since
    it would read like coverage.
  */

  it('keeps the element highlight separable from the focus ring by geometry', () => {
    render(<QueueView session={session()} />)
    const target = document.querySelector('.b2c-queue-target') as HTMLElement
    const highlight = getComputedStyle(target)

    const button = document.querySelector('.b2c-queue-controls button') as HTMLElement
    button.focus()
    const ring = getComputedStyle(button)

    // The stake: with the author palette discarded these two are drawn in the
    // SAME system colour, so geometry is not merely the preferred separator
    // here — it is the only one left. One says "this is the thing you are
    // judging", the other "this is what your keystroke will hit", and a reader
    // in High Contrast who cannot tell them apart answers the wrong question.
    expect(parseFloat(highlight.outlineWidth)).toBeGreaterThan(parseFloat(ring.outlineWidth))
    expect(parseFloat(highlight.outlineOffset)).toBeGreaterThan(parseFloat(ring.outlineOffset))
  })

  it('holds every control above the 24px floor, since forced colors may resize text', () => {
    render(<QueueView session={session()} />)
    for (const control of document.querySelectorAll('.b2c-queue button, .b2c-queue summary')) {
      const box = control.getBoundingClientRect()
      expect(box.height, `${control.textContent} was ${box.height}px tall`).toBeGreaterThanOrEqual(24)
      expect(box.width).toBeGreaterThanOrEqual(24)
    }
  })
})
