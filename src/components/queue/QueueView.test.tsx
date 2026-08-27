import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueueView } from './QueueView'
import { newSession, type QueueSession } from './session'
import type { CompiledChapter, CompiledSection, QueueItem, QueueKind } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'
import type { QueueAnswer } from '../../engine/compile/answers'

const gate = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

const item = (kind: QueueKind, elementId: string, sectionId = 's1'): QueueItem => ({
  kind,
  elementId,
  sectionId,
  context: { reference: `Sentence for ${elementId}.` },
})

const section = (id: string, title: string, queue: QueueItem[]): CompiledSection => ({
  id,
  title,
  html: `<p>compiled ${id}</p>`,
  notes: [],
  queue,
  gate: gate(`<p>repaired ${id}</p>`),
})

const chapterOf = (sections: CompiledSection[]): CompiledChapter =>
  ({
    chapter: { sections: [] },
    sections,
    queue: sections.flatMap((s) => s.queue),
  }) as unknown as CompiledChapter

/** A session at first arrival, with `n` unanswered confirm-decorative items. */
function freshSession(n = 4): QueueSession {
  const items = Array.from({ length: n }, (_, i) => item('confirm-decorative', `d${i}`))
  return newSession(chapterOf([section('s1', '1.4 Polynomials', items)]))
}

/**
 * A session posed mid-flight. Built by hand rather than by replaying events,
 * because these are header-arithmetic tests and driving 22 answers through the
 * reducer to reach one string would test the reducer, which has its own file.
 */
function sessionWith(opts: {
  answered?: number
  remaining?: number
  skipped?: number
  notes?: Map<string, string>
  refusal?: string
  dirty?: string[]
  sections?: CompiledSection[]
}): QueueSession {
  const remaining = Array.from({ length: opts.remaining ?? 0 }, (_, i) =>
    item('confirm-decorative', `r${i}`),
  )
  const skipped = Array.from({ length: opts.skipped ?? 0 }, (_, i) =>
    item('confirm-decorative', `k${i}`),
  )
  const answers = new Map<string, QueueAnswer>(
    Array.from({ length: opts.answered ?? 0 }, (_, i) => [
      `s1::a${i}`,
      { type: 'decorative' } as const,
    ]),
  )
  const sections = opts.sections ?? [section('s1', '1.4 Polynomials', [...remaining, ...skipped])]
  return {
    compiled: chapterOf(sections),
    answers,
    notes: opts.notes ?? new Map(),
    skipped: new Set(skipped.map((s) => `s1::${s.elementId}`)),
    dirty: new Set(opts.dirty ?? []),
    displayHtml: new Map(),
    cursor: remaining[0] ? `s1::${remaining[0].elementId}` : skipped[0] && `s1::${skipped[0].elementId}`,
    ...(opts.refusal ? { refusal: opts.refusal } : {}),
  }
}

function sessionWithFailedSection(title: string, error: string): QueueSession {
  const ok = section('s2', '1.5 Factoring', [item('confirm-decorative', 'd0', 's2')])
  const bad: CompiledSection = {
    id: 's1',
    title,
    html: '',
    notes: [],
    queue: [],
    error,
  }
  return newSession(chapterOf([bad, ok]))
}

describe('the live regions', () => {
  it('mounts both, empty, before either has content', () => {
    // A region inserted when it GAINS content is announced unreliably — the
    // exact pattern App.tsx already documents. This assertion is what stops
    // someone tidying these into conditional rendering and quietly breaking
    // every announcement in the slice.
    //
    // Asserted against the FIRST render specifically, which is why this goes
    // through the server renderer: it runs no effects, so it is the only way to
    // see the markup as the browser first inserts it. `render()` below has
    // already flushed the effect that fills the status region, and that is the
    // whole mechanism — empty at insertion, filled one tick later, therefore
    // announced as a change rather than swallowed as an initial value.
    const first = renderToStaticMarkup(<QueueView session={freshSession()} />)
    expect(first).toContain('role="status"')
    expect(first).toContain('role="alert"')
    expect(first).toMatch(/role="status"[^>]*>\s*<\/p>/)

    render(<QueueView session={freshSession()} />)
    expect(document.querySelector('[role="status"]')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('says what the queue is once it has mounted', () => {
    render(<QueueView session={freshSession()} />)
    expect(document.querySelector('[role="status"]')!.textContent).toBe(
      'Review queue. 4 items: 4 images marked decorative. Item 1 of 4.',
    )
  })

  it('stays silent when there is nothing to say', () => {
    render(<QueueView session={sessionWith({ remaining: 2 })} />)
    expect(document.querySelector('[role="status"]')!.textContent).toBe('')
  })

  it('puts a refusal in the alert region, where it is announced once', () => {
    render(
      <QueueView
        session={sessionWith({ remaining: 2, refusal: 'Not saved: the description is empty.' })}
      />,
    )
    expect(document.querySelector('[role="alert"]')!.textContent).toBe(
      'Not saved: the description is empty.',
    )
  })
})

describe('the status header', () => {
  it('reads the first-arrival line exactly', () => {
    render(<QueueView session={freshSession(25)} />)
    expect(
      screen.getByText('0 answered · 25 remain — publishing stays locked until 0 remain'),
    ).toBeTruthy()
  })

  it('counts answered, remaining and skipped separately', () => {
    render(<QueueView session={sessionWith({ answered: 7, remaining: 2, skipped: 1 })} />)
    expect(
      screen.getByText('7 answered · 2 remain · 1 skipped — publishing stays locked until 0 remain'),
    ).toBeTruthy()
  })

  it('says what is left when only skipped items remain, and does not celebrate', () => {
    // The moment the non-skipped work ends is the moment of maximum risk of
    // abandonment. The screen's job here is to be unremarkable and immovable.
    render(<QueueView session={sessionWith({ answered: 22, remaining: 0, skipped: 3 })} />)
    expect(
      screen.getByText(
        '22 answered · 0 remain · 3 skipped — publishing stays locked until the 3 skipped are answered',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/almost|nearly|great|well done/i)).toBeNull()
  })

  it('qualifies the counts while compile is still running', () => {
    render(
      <QueueView
        session={sessionWith({ answered: 3, remaining: 6 })}
        compiling={{ section: 3, total: 4 }}
      />,
    )
    expect(
      screen.getByText(
        /6 remain so far — compiling and checking section 3 of 4\. New items may join the queue\./,
      ),
    ).toBeTruthy()
  })

  it('names the section being re-checked after an answer', () => {
    render(
      <QueueView session={sessionWith({ answered: 8, remaining: 1, dirty: ['s1'] })} />,
    )
    expect(screen.getByText('8 answered · 1 remain — re-checking section 1 of 1')).toBeTruthy()
  })

  it('says publishing unlocks when the check finishes, once nothing remains', () => {
    render(<QueueView session={sessionWith({ answered: 25, remaining: 0, dirty: ['s1'] })} />)
    expect(
      screen.getByText(
        '25 answered · 0 remain — re-checking section 1 of 1. Publishing unlocks when the check finishes.',
      ),
    ).toBeTruthy()
  })
})

describe('the answered list', () => {
  it('does not render at all until there is an answer', () => {
    // Absence is a clean signal; an empty collapsed box is furniture.
    render(<QueueView session={freshSession()} />)
    expect(screen.queryByText(/^Answered/)).toBeNull()
  })

  it('appears with the first answer, and offers Revisit', () => {
    const onRevisit = vi.fn()
    render(
      <QueueView session={sessionWith({ answered: 1, remaining: 2 })} onRevisit={onRevisit} />,
    )
    expect(screen.getByText('Answered — 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revisit' }))
    expect(onRevisit).toHaveBeenCalledWith('s1::a0')
  })

  it('carries the note recorded at accept time', () => {
    render(
      <QueueView
        session={sessionWith({
          answered: 1,
          remaining: 1,
          notes: new Map([['s1::a0', "Saved, with a note: this starts with 'Figure 2'."]]),
        })}
      />,
    )
    expect(screen.getByText(/note: this starts with 'Figure 2'\./)).toBeTruthy()
  })
})

describe('the jump list', () => {
  it('still renders when nothing else remains, and says so', () => {
    // The user just watched it shrink; a vanished control reads as a bug.
    render(<QueueView session={sessionWith({ remaining: 1 })} />)
    expect(screen.getByText('No other items remain.')).toBeTruthy()
  })

  it('counts what is left in its summary and jumps on click', () => {
    const onJump = vi.fn()
    render(<QueueView session={sessionWith({ remaining: 3 })} onJump={onJump} />)
    expect(screen.getByText('Jump to an item — 2 remaining')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Item 2 of 3/ }))
    expect(onJump).toHaveBeenCalledWith('s1::r1')
  })

  it('tags a skipped entry in words, not in colour', () => {
    render(<QueueView session={sessionWith({ remaining: 2, skipped: 1 })} />)
    expect(screen.getByRole('button', { name: /skipped/ })).toBeTruthy()
  })
})

describe('a section that failed to compile', () => {
  it('states the failure rather than leaving a hole', () => {
    // Scoped to the block, because §3.7 also puts this sentence in the entry
    // announcement — the screen says it visibly AND says it to a screen reader,
    // which is the point of having both.
    const { container } = render(<QueueView session={sessionWithFailedSection('1.4', 'boom')} />)
    const block = within(container.querySelector('.b2c-queue-failed') as HTMLElement)
    expect(block.getByText('Section 1.4 could not be processed.')).toBeTruthy()
    expect(
      block.getByText(/The chapter cannot be published while a section is missing\./),
    ).toBeTruthy()
    expect(block.getByText('boom')).toBeTruthy()
  })

  it('still shows the other sections’ items', () => {
    render(<QueueView session={sessionWithFailedSection('1.4', 'boom')} />)
    expect(screen.getByRole('heading', { name: 'Images marked decorative' })).toBeTruthy()
  })
})

describe('the section render', () => {
  it('renders the repaired bytes of the current item’s section only', () => {
    const { container } = render(<QueueView session={freshSession()} />)
    const body = container.querySelector('.b2c-section-body')
    expect(body!.innerHTML).toBe('<p>repaired s1</p>')
  })

  it('renders the session stand-in while a re-audit is pending', () => {
    // D5.5. A section awaiting re-audit has no gate at all, so there is no
    // gate.html to render; s.html is compiled but un-repaired and must never be
    // set as innerHTML.
    const pending: CompiledSection = {
      ...section('s1', '1.4 Polynomials', [item('confirm-decorative', 'd0')]),
      gate: undefined,
    }
    const base = newSession(chapterOf([pending]))
    const session: QueueSession = {
      ...base,
      dirty: new Set(['s1']),
      displayHtml: new Map([['s1', '<p>stand-in</p>']]),
    }
    const { container } = render(<QueueView session={session} />)
    expect(container.querySelector('.b2c-section-body')!.innerHTML).toBe('<p>stand-in</p>')
  })
})
