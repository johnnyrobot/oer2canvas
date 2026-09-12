import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ChapterView } from './ChapterView'
import type { Chapter } from '../sources/types'
import type { CompiledChapter } from '../contracts/index'
import type { GateResult } from '../engine/gate'

const chapter: Chapter = {
  source: 'openstax',
  bookId: 'b',
  title: 'Prerequisites',
  xrefs: new Map(),
  attribution: { bookTitle: 'Algebra', publisher: 'OpenStax', url: 'https://x', authors: [] },
  sections: [
    {
      id: 's1',
      title: 'Polynomials',
      order: 0,
      html: '<p>raw</p>',
      contentBaseUrl: 'https://x/s1.json',
      canonicalUrl: 'https://x/pages/s1',
    },
  ],
}

const gate = (html: string): GateResult => ({
  html,
  conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
  badgeWithheld: false,
})

/**
 * Builds a `CompiledChapter` around the fixture `chapter` above. `queue`
 * defaults empty so the "needs review" paragraph is opt-in per test.
 *
 * The section's own `html` (compiled, but not yet gated) is deliberately a
 * THIRD distinct string from both the raw publisher html and the repaired
 * gate html — so a component that accidentally rendered `s.html` instead of
 * `s.gate.html` would be caught by the same assertions that catch the raw
 * html leaking.
 */
function compiledWith(gateResult: GateResult | undefined, queue: CompiledChapter['queue'] = []): CompiledChapter {
  return {
    chapter,
    queue,
    sections: [
      {
        id: 's1',
        title: 'Polynomials',
        html: '<p>compiled but unaudited</p>',
        notes: [],
        queue: [],
        gate: gateResult,
      },
    ],
  }
}

describe('ChapterView', () => {
  it('renders the repaired html, not the raw publisher html', () => {
    render(<ChapterView compiled={compiledWith(gate('<p>repaired body text</p>'))} />)
    expect(screen.getByText('repaired body text')).toBeInTheDocument()
    expect(screen.queryByText('raw')).not.toBeInTheDocument()
    expect(screen.queryByText('compiled but unaudited')).not.toBeInTheDocument()
  })

  it('shows nothing where a section has no gate yet, rather than raw html', () => {
    render(<ChapterView compiled={compiledWith(undefined)} />)
    expect(screen.queryByText('raw')).not.toBeInTheDocument()
    expect(screen.queryByText('compiled but unaudited')).not.toBeInTheDocument()
    // But not an empty <article> either. The body is what names a section on
    // this screen, so with no body there is nothing left to say the section is
    // there at all unless this line says it.
    expect(screen.getByText('This section has not been checked yet.')).toBeInTheDocument()
  })

  /**
   * Every section title must render once.
   *
   * `compileSection` re-levels each section so its shallowest heading is an
   * `h2` — the section title — because Canvas renders the page title as the
   * page's own `h1`. `ChapterView` then added its own `h3` above the body, so
   * the title appeared once in our chrome and again in the publishable bytes,
   * in every section of every chapter. Observed live in two books before it was
   * found in source.
   *
   * Asserted by COUNTING, not by `getByRole`, which throws on multiple matches
   * with a message about the query rather than about the defect. And asserted
   * here rather than left to the self-audit: axe's `heading-order` reports
   * nothing at all on the broken markup — a heading that repeats an earlier
   * one at a shallower level is legal, since that is how a subsection closes —
   * so no axe rule at any tag level could have caught this. Measured, not
   * assumed: see `App.a11y.browser.test.tsx` screen 3.
   */
  it('renders each section title once, letting the compiled body own it', () => {
    const body = '<h2>Polynomials</h2><h3>Learning Objectives</h3><p>repaired body text</p>'
    const { container } = render(<ChapterView compiled={compiledWith(gate(body))} />)

    const titles = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(
      (h) => h.textContent?.trim() === 'Polynomials',
    )
    expect(titles.map((h) => h.tagName)).toEqual(['H2'])

    // The chrome keeps the section reachable without a heading of its own: the
    // article carries the NORMALIZED title, which the body's heading may not.
    expect(screen.getByRole('article', { name: 'Polynomials' })).toBeInTheDocument()
  })

  it('shows the queue count only when the chapter has items needing review', () => {
    const { rerender } = render(<ChapterView compiled={compiledWith(gate('<p>x</p>'))} />)
    expect(screen.queryByText(/item\(s\) need review/)).not.toBeInTheDocument()

    rerender(
      <ChapterView
        compiled={compiledWith(gate('<p>x</p>'), [
          { kind: 'table-headers', sectionId: 's1', elementId: 'e', context: {} },
          { kind: 'alt', sectionId: 's1', elementId: 'f', context: {} },
        ])}
      />,
    )
    expect(screen.getByText('2 item(s) need review before this chapter can be published.')).toBeInTheDocument()
  })
})
