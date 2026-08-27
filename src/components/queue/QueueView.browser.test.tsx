import { describe, it, expect, afterEach } from 'vitest'
import { act, useReducer, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { userEvent } from 'vitest/browser'
import { QueueView } from './QueueView'
import { newSession, reduce, type QueueSession } from './session'
import { queueKeyOf } from '../../engine/compile/answers'
import type { CompiledChapter, CompiledSection, QueueItem, QueueKind } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'

/**
 * Focus, announcement and the keyboard — pinned, not inspected.
 *
 * Written early in the slice on purpose. Focus movement on content change is
 * the likeliest a11y regression here: the card swaps under the user on every
 * answer and focus is moved deliberately, and retrofitting focus management is
 * how screens become unusable with a keyboard.
 *
 * The browser project, because `Tab` is the assertion. jsdom cannot move focus
 * with a key press — `userEvent.tab()` there walks a hand-computed list — so a
 * tab-order test in jsdom asserts the test's own idea of the tab order rather
 * than the browser's.
 */

/*
  Mounted with `createRoot` rather than Testing Library's `render`, and that is
  about honesty rather than taste. `render` wraps every commit in `act()`, and
  `userEvent` here drives the real browser — so every keystroke lands outside
  that scope and React says so, once per key. Turning act() off is exactly what
  a real-browser test wants; doing it by not opting in is simpler than fighting
  a wrapper that exists to simulate what this project already has.

  `act` still wraps the MOUNT, because React commits and then flushes passive
  effects on a later task and this screen's opening focus and first announcement
  are both produced by one of them — waiting on a frame instead was measurably
  racy. The act environment is switched back off the moment the mount is done,
  which is the window the real key presses fall in.
*/
let root: Root | undefined
let host: HTMLElement | undefined

async function mount(ui: ReactElement): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const flag = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  flag.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      root!.render(ui)
    })
  } finally {
    flag.IS_REACT_ACT_ENVIRONMENT = false
  }
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = undefined
  host = undefined
})

const gate = (html: string) =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult

const item = (kind: QueueKind, elementId: string): QueueItem => ({
  kind,
  elementId,
  sectionId: 's1',
  context: { reference: `Sentence for ${elementId}.` },
})

/** §3.1's chapter exactly: 12 decorative, 8 alt, 5 tables — 25 items in one section. */
function fixtureSession(): QueueSession {
  const queue = [
    ...Array.from({ length: 12 }, (_, i) => item('confirm-decorative', `d${i}`)),
    ...Array.from({ length: 8 }, (_, i) => item('alt', `a${i}`)),
    ...Array.from({ length: 5 }, (_, i) => item('table-headers', `t${i}`)),
  ]
  const section: CompiledSection = {
    id: 's1',
    title: '1.4 Polynomials',
    html: '<p>compiled</p>',
    notes: [],
    queue,
    gate: gate(queue.map((q) => `<p id="${q.elementId}">${q.elementId}</p>`).join('')),
  }
  return newSession({
    chapter: { sections: [] },
    sections: [section],
    queue,
  } as unknown as CompiledChapter)
}

/** The same queue, posed with the cursor on the first item of the writing group. */
function altSession(): QueueSession {
  const base = fixtureSession()
  const first = base.compiled.queue.find((i) => i.kind === 'alt')!
  return { ...base, cursor: queueKeyOf(first) }
}

/**
 * The reducer wired to the view, which is what the app does.
 *
 * Deliberately not `useQueueSession`: that hook also drives recompile and
 * re-audit, and this file is about what a key press does to the screen.
 */
function Harness({ initial }: { initial: QueueSession }) {
  const [session, dispatch] = useReducer(reduce, initial)
  return (
    <QueueView
      session={session}
      onAnswer={(key, answer) => dispatch({ type: 'answer', key, answer })}
      onSkip={(key) => dispatch({ type: 'skip', key })}
      onRevisit={(key) => dispatch({ type: 'revisit', key })}
      onJump={(key) => dispatch({ type: 'jump', key })}
    />
  )
}

const status = () => document.querySelector('[role="status"]')!.textContent
const active = () => document.activeElement
const label = () => active()?.textContent

describe('focus', () => {
  it('lands on the primary control when the queue opens', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    expect(label()).toBe('Confirm decorative (D)')
  })

  it('lands on the next item’s primary control after an answer', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    await userEvent.click(document.querySelector('.b2c-queue-controls button')!)
    expect(label()).toBe('Confirm decorative (D)')
    expect(document.querySelector('.b2c-queue-position')!.textContent).toBe('Item 2 of 25')
  })

  it('moves into the text field when the card morphs to writing', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    const buttons = [...document.querySelectorAll('.b2c-queue-controls button')]
    await userEvent.click(buttons.find((b) => b.textContent === 'Needs a description')!)
    expect(active()!.tagName).toBe('INPUT')
  })
})

describe('announcement', () => {
  it('names the queue and its groups on entry', async () => {
    // Mounted EMPTY and filled one tick later: a live region that already has
    // content when it is inserted is not announced at all, which is the whole
    // reason the region is unconditional in the markup.
    await mount(<Harness initial={fixtureSession()} />)
    expect(status()).toBe(
      'Review queue. 25 items: 12 images marked decorative, 8 images needing descriptions, ' +
        '5 tables missing headers. Item 1 of 25.',
    )
  })

  it('announces the answer with its place-keeping', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    await userEvent.click(document.querySelector('.b2c-queue-controls button')!)
    expect(status()).toBe('Answered. Item 2 of 25 — image marked decorative. 24 remain.')
  })

  it('announces a skip, and says it comes back', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    const buttons = [...document.querySelectorAll('.b2c-queue-controls button')]
    await userEvent.click(buttons.find((b) => b.textContent === 'Skip (S)')!)
    expect(status()).toBe(
      'Skipped. It will come back at the end. 1 skipped. Item 1 of 25 — image marked decorative.',
    )
  })

  it('names the new group when an answer crosses into one', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    for (let i = 0; i < 12; i++) {
      await userEvent.click(document.querySelector('.b2c-queue-controls button')!)
    }
    expect(status()).toBe(
      'Answered. Item 13 of 25 — image needing a description. 13 remain. ' +
        'Group 2 of 3 — images needing descriptions. 8 items.',
    )
  })
})

describe('the keyboard', () => {
  it('answers with D and skips with S', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    await userEvent.keyboard('d')
    expect(status()).toBe('Answered. Item 2 of 25 — image marked decorative. 24 remain.')
    await userEvent.keyboard('s')
    expect(status()).toBe(
      'Skipped. It will come back at the end. 1 skipped. Item 2 of 25 — image marked decorative.',
    )
  })

  it('keeps D and S inert while focus is in the text field', async () => {
    // Typing "d" must type. This is the one accelerator trade-off the design
    // accepts, and a comment would not survive the next person adding a
    // shortcut.
    await mount(<Harness initial={altSession()} />)
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    await userEvent.click(input)
    await userEvent.keyboard('ds')
    expect(input.value).toBe('ds')
    expect(document.querySelector('.b2c-queue-position')!.textContent).toBe('Item 1 of 25')
  })

  it('never binds Enter globally', async () => {
    await mount(<Harness initial={fixtureSession()} />)
    await userEvent.click(document.querySelector('.b2c-queue-header')!)
    await userEvent.keyboard('{Enter}')
    expect(document.querySelector('.b2c-queue-position')!.textContent).toBe('Item 1 of 25')
    expect(status()).not.toContain('Answered')
  })

  it('leaves D alone on a table card, which has no such answer', async () => {
    const base = fixtureSession()
    const table = base.compiled.queue.find((i) => i.kind === 'table-headers')!
    await mount(<Harness initial={{ ...base, cursor: queueKeyOf(table) }} />)
    await userEvent.keyboard('d')
    expect(document.querySelector('.b2c-queue-position')!.textContent).toBe('Item 1 of 25')
  })

  it('reaches every control by Tab alone, in reading order', async () => {
    // Starts from the primary control, because that is where the queue put
    // focus. Reading order is DOM order is focus order — that is the invariant,
    // and the section render is deliberately last.
    await mount(<Harness initial={fixtureSession()} />)
    const order: (string | null | undefined)[] = [label()]
    for (let i = 0; i < 3; i++) {
      await userEvent.tab()
      order.push(label())
    }
    expect(order).toEqual([
      'Confirm decorative (D)',
      'Needs a description',
      'Skip (S)',
      'Jump to an item — 24 remaining',
    ])
  })
})
