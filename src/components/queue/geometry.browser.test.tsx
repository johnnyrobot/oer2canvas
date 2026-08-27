import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueueView } from './QueueView'
import { newSession, type QueueSession } from './session'
import '../../App.css'
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

/**
 * The three geometry rules, measured rather than eyeballed.
 *
 * They are the two verifications §8 and A7/A10 ask for — 44px under a thumb at
 * a phone width, and a render the pinned cluster never sits on — and both are
 * claims about computed layout, so the browser project is the only place they
 * can be checked at all. `App.css` is imported explicitly because it carries the
 * SC 2.5.8 floor these rules are raised above.
 */

afterEach(cleanup)

const gate = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

const item = (elementId: string, kind: QueueItem['kind'] = 'confirm-decorative'): QueueItem => ({
  kind,
  elementId,
  sectionId: 's1',
  context: { reference: `Sentence for ${elementId}.` },
})

function session(kind?: QueueItem['kind']): QueueSession {
  const queue = [item('d0', kind), item('d1', kind)]
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

const cluster = () => document.querySelector('.b2c-queue-card .b2c-queue-controls') as HTMLElement

describe('the geometry', () => {
  it('sets the render apart with a rule on its leading edge, in an inherited colour', () => {
    render(<QueueView session={session()} />)
    const render_ = document.querySelector('.b2c-queue-render') as HTMLElement
    const style = getComputedStyle(render_)
    expect(parseFloat(style.borderInlineStartWidth)).toBeGreaterThanOrEqual(3)
    // The same colour as its text: an inherited colour, not an invented one.
    expect(style.borderInlineStartColor).toBe(style.color)
    expect(parseFloat(style.paddingInlineStart)).toBeGreaterThan(0)
  })

  it('leaves the card and the jump list unbordered, so the boundary means something', () => {
    render(<QueueView session={session()} />)
    for (const selector of ['.b2c-queue-card', '.b2c-queue-jump']) {
      const style = getComputedStyle(document.querySelector(selector) as HTMLElement)
      expect(parseFloat(style.borderInlineStartWidth)).toBe(0)
      expect(parseFloat(style.borderBlockStartWidth)).toBe(0)
    }
  })

  it('keeps the element highlight heavier and further out than the focus ring', () => {
    render(<QueueView session={session()} />)
    const target = document.querySelector('.b2c-queue-target') as HTMLElement
    const highlight = getComputedStyle(target)

    const button = document.querySelector('.b2c-queue-controls button') as HTMLElement
    button.focus()
    const ring = getComputedStyle(button)

    // Geometry alone separates them, because with no palette both are the same
    // near-black: one says "this is the thing you are judging", the other "this
    // is what your keystroke will hit".
    expect(parseFloat(highlight.outlineWidth)).toBeGreaterThan(parseFloat(ring.outlineWidth))
    expect(parseFloat(highlight.outlineOffset)).toBeGreaterThan(parseFloat(ring.outlineOffset))
    expect(highlight.outlineColor).toBe(highlight.color)
  })

  it('holds every control above the 24px floor at any width', () => {
    render(<QueueView session={session()} />)
    for (const control of document.querySelectorAll('.b2c-queue button, .b2c-queue summary')) {
      const box = control.getBoundingClientRect()
      expect(box.height, `${control.textContent} was ${box.height}px tall`).toBeGreaterThanOrEqual(24)
      expect(box.width).toBeGreaterThanOrEqual(24)
    }
  })

  it('pins the cluster to the bottom edge at a phone width, at 44px, without occluding the render', () => {
    // The TABLE card, deliberately: five controls is the widest cluster this
    // screen builds and therefore the one that wraps to the most rows. Sizing
    // the page's bottom padding against anything smaller leaves the pinned
    // cluster sitting on the render exactly when the question is hardest.
    render(<QueueView session={session('table-headers')} />)
    const style = getComputedStyle(cluster())
    if (style.position !== 'fixed') return // wide viewport: the rule does not apply
    const box = cluster().getBoundingClientRect()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(Math.round(box.bottom)).toBe(window.innerHeight)
    const queue = document.querySelector('.b2c-queue') as HTMLElement
    expect(parseFloat(getComputedStyle(queue).paddingBlockEnd)).toBeGreaterThanOrEqual(box.height)
  })
})
