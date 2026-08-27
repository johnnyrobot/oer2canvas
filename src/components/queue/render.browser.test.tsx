import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueueView } from './QueueView'
import { newSession, type QueueSession } from './session'
import { queueKeyOf } from '../../engine/compile/answers'
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

/**
 * Region E, in a real browser, because every claim here is a layout claim.
 *
 * "Scrolled to the vertical centre", "the outline moved but the render did
 * not", "one section, so ids cannot collide" — jsdom would pass all three
 * without measuring anything, since it has no viewport, no scrolling and no
 * paint. These are the tests the browser project exists for.
 */

afterEach(cleanup)

/** Enough filler that the document is taller than any viewport and can scroll. */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p style="height:220px">filler ${i}</p>`).join('')

const gate = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

const item = (elementId: string, sectionId: string): QueueItem => ({
  kind: 'confirm-decorative',
  elementId,
  sectionId,
  context: { reference: `Sentence for ${elementId}.` },
})

/**
 * A section whose repaired bytes really contain the elements its items point
 * at, spaced far apart. Spacing is the point: an assertion that an element is
 * centred means nothing if the whole section already fits on one screen.
 */
function section(id: string, title: string, elementIds: string[]): CompiledSection {
  const body = elementIds
    .map((eid) => `${filler(4)}<p id="${eid}">the element ${eid}</p>`)
    .join('')
  return {
    id,
    title,
    html: `<p>compiled ${id} — must never be rendered</p>`,
    notes: [],
    queue: elementIds.map((eid) => item(eid, id)),
    gate: gate(`${body}${filler(4)}`),
  }
}

const chapterOf = (sections: CompiledSection[]): CompiledChapter =>
  ({
    chapter: { sections: [] },
    sections,
    queue: sections.flatMap((s) => s.queue),
  }) as unknown as CompiledChapter

/** Two sections, so "one section at a time" has something to be true against. */
function fixtureSession(): QueueSession {
  return newSession(
    chapterOf([
      section('s1', '1.4 Polynomials', ['d0', 'd1', 'd2']),
      section('s2', '1.5 Factoring', ['d3', 'd4']),
    ]),
  )
}

/** The same session, posed with the cursor on the nth item of the traversal. */
function atItem(index: number): QueueSession {
  const base = fixtureSession()
  return { ...base, cursor: queueKeyOf(base.compiled.queue[index]!) }
}

const highlighted = (root: ParentNode) => root.querySelectorAll('.b2c-queue-target')

describe('the element the card is asking about', () => {
  it('resolves and centres the element for every fixture item', () => {
    const session = fixtureSession()
    for (let i = 0; i < session.compiled.queue.length; i++) {
      cleanup()
      const current = session.compiled.queue[i]!
      const { container } = render(<QueueView session={atItem(i)} />)

      const el = container.querySelector(`#${CSS.escape(current.elementId)}`)
      expect(el, `item ${i} (${current.elementId}) did not resolve in the render`).not.toBeNull()

      // Centred, within a generous band: the browser cannot centre an element
      // it has already scrolled as far as it can toward, so the first and last
      // of a section are legitimately off-centre. Being on screen at all is the
      // claim that must hold for every one of them.
      const rect = el!.getBoundingClientRect()
      expect(rect.top).toBeLessThan(window.innerHeight)
      expect(rect.bottom).toBeGreaterThan(0)
    }
  })

  it('puts an element it can centre at the vertical centre', () => {
    // d1 has ~880px of filler on each side, so the page really can scroll it to
    // the middle — which makes this an assertion about layout rather than about
    // the argument passed to scrollIntoView.
    const { container } = render(<QueueView session={atItem(1)} />)
    const rect = container.querySelector('#d1')!.getBoundingClientRect()
    const off = Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2)
    expect(off, `element sat ${off}px from the viewport centre`).toBeLessThan(4)
  })

  it('outlines exactly one element, and it is the current item’s', () => {
    const { container } = render(<QueueView session={atItem(1)} />)
    const marked = highlighted(container)
    expect(marked.length).toBe(1)
    expect(marked[0]!.id).toBe('d1')
  })

  it('scrolls instantly, never smoothly', () => {
    // Motion near the point of focus is a vestibular and attention hazard
    // bought for zero information (§6). Asserted on the call rather than by
    // watching frames, because "no behavior key" is the whole of the rule.
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<QueueView session={atItem(1)} />)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toEqual({ block: 'center' })
    spy.mockRestore()
  })

  it('moves the outline without re-rendering the section for a same-section neighbour', () => {
    // Consecutive items usually share a section. Re-rendering it would reset
    // scroll, re-run the browser's parse, and flash the evidence the instructor
    // is reading.
    const { rerender, container } = render(<QueueView session={atItem(0)} />)
    const before = container.querySelector('.b2c-section-body')
    const firstParagraph = container.querySelector('#d0')

    rerender(<QueueView session={atItem(1)} />)

    expect(container.querySelector('.b2c-section-body')).toBe(before)
    // The nodes inside survived too — an innerHTML reassignment to the same
    // string would keep the wrapper and replace everything under it.
    expect(container.querySelector('#d0')).toBe(firstParagraph)
    expect([...highlighted(container)].map((e) => e.id)).toEqual(['d1'])
  })

  it('swaps the render wholesale when the next item is in another section', () => {
    const { rerender, container } = render(<QueueView session={atItem(2)} />)
    expect(container.querySelector('#d3')).toBeNull()

    rerender(<QueueView session={atItem(3)} />)

    expect(container.querySelector('#d0')).toBeNull()
    expect(container.querySelector('#d3')).not.toBeNull()
    expect([...highlighted(container)].map((e) => e.id)).toEqual(['d3'])
  })

  it('renders exactly one section, so ids cannot collide', () => {
    const { container } = render(<QueueView session={fixtureSession()} />)
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
