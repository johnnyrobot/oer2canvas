import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App, { ChapterHandoff, QueueScreen, progressLabel } from './App'
import type { CompiledChapter, CompiledSection, QueueItem } from './contracts/index'
import type { GateResult } from './engine/gate'
import releaseFixture from './sources/fixtures/openstax/release.json'
import bookToc from './sources/fixtures/openstax/book-toc.json'

/**
 * `pickBook` and `pickChapter` are `async` handlers with no caller to catch
 * them. Before they had a `try/catch/finally`, ANY rejection — a 404, a 500, a
 * dropped connection — left the status region reading "Loading …" or "Auditing…"
 * for the rest of the session, with the failure visible only in the console as
 * an unhandled rejection. The user's whole experience of the failure was an app
 * that appeared to still be working.
 *
 * These drive the real handlers through `globalThis.fetch`, which is where the
 * app's only network call goes. That works because the shipped client resolves
 * the global lazily per call (see `createDefaultOpenStaxClient`), so a stub
 * installed after `App` was imported is still the one it reaches.
 */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/** The first button in the catalog, and the book the committed fixtures describe. */
const FIRST_BOOK = 'Algebra and Trigonometry'

/**
 * Render the app and walk it to the chapter browser the way a user does.
 *
 * The workflow now opens on Destination — "where does this go?" is asked BEFORE
 * anything is picked, which is the whole point of the redesign — so a test that
 * wants the book list has to answer it first. The cartridge is the honest choice
 * here: it is a complete decision that needs no credentials, so these tests stay
 * offline exactly as they were.
 */
/**
 * Select one chapter and start preparing it.
 *
 * Picking is a two-step now — tick the chapter, then commit the selection — and
 * that is the point of §2.3's multi-select: the set is visible and changeable
 * before anything runs. Tests walk the same two steps a user does.
 */
async function prepareChapter(name: RegExp) {
  const row = (await screen.findByRole('checkbox', { name }, { timeout: 10_000 })) as HTMLInputElement
  // Ensure-selected rather than click-blindly: a cancelled run deliberately
  // KEEPS the selection — losing your picks because a fetch failed would be its
  // own bug — so a second attempt finds the box already ticked, and clicking it
  // again would clear the set and take the commit button away with it.
  if (!row.checked) fireEvent.click(row)
  fireEvent.click(screen.getByRole('button', { name: /^Prepare 1 chapter$/ }))
  return row
}

function renderAtChapters() {
  const result = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  return result
}


afterEach(() => vi.unstubAllGlobals())

// The `h1` is the CURRENT SCREEN, not the product: one `h1` per screen is what
// lets focus land somewhere meaningful on every navigation. The product name
// lives in the shell's brand block, which is not a heading — it is a landmark
// label, and promoting it would leave every screen unnamed.
test('names the current screen in the h1, and the product in the shell', () => {
  render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Destination')
  expect(screen.getByText('oer2canvas')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Content')
})

test('the default public app has no Canvas address, token, course, or push entry point', () => {
  render(<App />)
  expect(screen.queryByRole('button', { name: /A Canvas course/ })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Canvas address')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /A cartridge file/ })).toBeInTheDocument()
})

test('can leave a loaded book and choose a different one without refreshing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input))
      if (url.includes('/rex/release.json')) return json(releaseFixture)
      if (/\/contents\/[^:]+\.json$/.test(url)) return json(bookToc)
      throw new Error(`unexpected request: ${url}`)
    }),
  )

  renderAtChapters()
  fireEvent.click(screen.getByRole('button', { name: FIRST_BOOK }))
  await screen.findByRole('checkbox', { name: /Chapter 1 Prerequisites/ })

  fireEvent.click(screen.getByRole('button', { name: /choose a different book/i }))

  expect(screen.getByRole('heading', { name: 'Choose content' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: FIRST_BOOK })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /Chapter 1 Prerequisites/ })).not.toBeInTheDocument()
})

test('a failed book load is announced, not left spinning', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
  renderAtChapters()
  fireEvent.click(screen.getByRole('button', { name: FIRST_BOOK }))

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(`Could not load ${FIRST_BOOK}`),
  )
  // The thrown message reaches the user; it is the only clue they get.
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
  // The status region is cleared — no permanent "Loading …".
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  // And the failure leaves the user somewhere they can act, not on an empty
  // chapter list for a book that never loaded.
  expect(screen.getByRole('button', { name: FIRST_BOOK })).toBeInTheDocument()
})

test('a failed chapter fetch is announced, not left on "Fetching …"', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      // Decoded: the client relays the release manifest as
      // `/relay?url=<percent-encoded target>`, so the literal path is not present.
      const url = decodeURIComponent(String(input))
      if (url.includes('/rex/release.json')) return json(releaseFixture)
      // The TOC url has no `:pageId` segment; a page url does. Serve the book,
      // then fail every page request.
      if (/\/contents\/[^:]+\.json$/.test(url)) return json(bookToc)
      // A failed origin is not necessarily a fast origin. Keep the rejection
      // beyond Testing Library's one-second default so this test also proves
      // that a delayed failure is eventually announced.
      await new Promise((resolve) => setTimeout(resolve, 1_100))
      return new Response('gone', { status: 500 })
    }),
  )
  renderAtChapters()
  fireEvent.click(screen.getByRole('button', { name: FIRST_BOOK }))

  // The real `flattenToc` over the real fixture: 13 chapters, the first of them
  // 12 sections. Reaching this screen at all proves the happy path still works.
  const chapter1 = await screen.findByRole('checkbox', { name: /Chapter 1 Prerequisites/ })
  expect(screen.getByText(/\(12 sections\)/)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toBeEmptyDOMElement()

  await prepareChapter(/Chapter 1 Prerequisites/)
  await waitFor(
    () => expect(screen.getByRole('alert')).toHaveTextContent('Could not prepare Chapter 1 Prerequisites'),
    { timeout: 10_000 },
  )
  expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  // A rejection must not strand the user. Under the old screen tree that meant
  // clearing `chapter`, because the picker was selected by absence; under the
  // shell it means the phase has to come back too, so this asserts BOTH — the
  // heading says where we are, and the picker is really there to act on.
  //
  // Re-queried rather than reusing the node captured above: bouncing back to
  // Content remounts the picker, so the old element is legitimately detached
  // and asserting on it would be testing React's reconciliation, not the app's.
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Content')
  expect(screen.getByRole('checkbox', { name: /Chapter 1 Prerequisites/ })).toBeInTheDocument()
})

/**
 * Cancellation.
 *
 * A chapter is a dozen sequential fetches followed by a dozen compile-and-audit
 * passes, and until this landed the user had no way out of either: no progress
 * beyond a single line, and no control at all. These drive the real handler, so
 * they pin the wiring — `AbortController` created, signal threaded, `AbortError`
 * distinguished from failure — and not just the presence of a button.
 *
 * They cancel during the FETCH phase deliberately. The compile phase needs the
 * iframe runner, which needs a browser that executes injected scripts; jsdom
 * does not, so a compile-phase cancel test belongs in the browser project and
 * would be testing the engine's signal handling, which
 * `compile-and-audit.test.ts` already pins directly.
 */
describe('cancelling a chapter', () => {
  /** Serves the release manifest and TOC, then hands each page request out one at a time. */
  function stubChapterFetch(): { releaseNextPage: () => void } {
    let release: (() => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = decodeURIComponent(String(input))
        if (url.includes('/rex/release.json')) return json(releaseFixture)
        if (/\/contents\/[^:]+\.json$/.test(url)) return json(bookToc)
        // A page. Hold it until the test lets it go, so the run is parked in
        // the fetch loop with the cancel button on screen.
        await new Promise<void>((resolve) => { release = resolve })
        return json({ id: 'p', title: 'Page', content: '<p>body</p>' })
      }),
    )
    return { releaseNextPage: () => release?.() }
  }

  async function startChapter() {
    const { releaseNextPage } = stubChapterFetch()
    renderAtChapters()
    fireEvent.click(screen.getByRole('button', { name: FIRST_BOOK }))
    await prepareChapter(/Chapter 1 Prerequisites/)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Fetching/))
    return { releaseNextPage }
  }

  it('offers a cancel while a chapter is being prepared, and not before', async () => {
    stubChapterFetch()
    renderAtChapters()
    fireEvent.click(screen.getByRole('button', { name: FIRST_BOOK }))
    await screen.findByRole('checkbox', { name: /Chapter 1 Prerequisites/ })
    // Nothing is running, so nothing to cancel — a permanently mounted cancel
    // button would be a control that does nothing most of the time.
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()

    await prepareChapter(/Chapter 1 Prerequisites/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument(),
    )
  })

  it('returns to the chapter picker with nothing announced', async () => {
    const { releaseNextPage } = await startChapter()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    releaseNextPage()

    // The picker is back and the user can choose again.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Chapter 1 Prerequisites/ })).toBeInTheDocument(),
    )
    // A cancel is not a failure. Announcing "Could not prepare …" for something
    // the user themselves stopped is the one outcome this must never produce,
    // and it is exactly what a naive catch-all `catch` would do.
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })

  it('does not strand the user on a stale cancel button after finishing', async () => {
    const { releaseNextPage } = await startChapter()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    releaseNextPage()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument(),
    )
    // And a second chapter can be started after a cancel — the controller is
    // per-run, so a cancelled one must not poison the next attempt.
    await prepareChapter(/Chapter 1 Prerequisites/)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument(),
    )
  })
})

describe('progressLabel', () => {
  it('renders the audit phase and clears on done', () => {
    expect(progressLabel({ phase: 'audit', done: 2, total: 12, title: '1.3 Radicals' })).toBe(
      'Auditing 3 of 12: 1.3 Radicals…',
    )
    // `done` is an index, so the line reads 3 of 12 while section index 2 runs.
    expect(progressLabel({ phase: 'done', done: 12, total: 12, title: '' })).toBe('')
  })

  it('deliberately says nothing for the compile phase', () => {
    // Measured, not assumed: compiling a section costs 0-15 ms, so React
    // coalesces the state away and a "Compiling …" line was verified never to
    // reach the DOM across a whole chapter. `undefined` means "leave the line
    // alone" — distinct from `''`, which CLEARS it and would blank the status
    // region between every pair of sections.
    expect(progressLabel({ phase: 'compile', done: 0, total: 12, title: 'x' })).toBeUndefined()
  })
})

/**
 * The handoff out of the queue, and the queue's own arrival (§3.4, §3.6, §3.8).
 *
 * Driven from fixture-derived props rather than through `App`, because a real
 * run cannot complete in jsdom: axe calls `Element.checkVisibility`, which jsdom
 * does not implement, so `compileAndAuditChapter` rejects part-way. That is the
 * same constraint `App.a11y.browser.test.tsx` already documents, and the same
 * answer — render the screen directly.
 */
describe('the handoff', () => {
  const gate = (passed: boolean): GateResult => ({
    html: '<p>repaired</p>',
    conformance: {
      passedChecks: passed,
      blockers: passed ? [] : [{ id: 'x', severity: 'blocker', message: 'Removed semantic <figure>' }],
      warnings: [],
      needsHumanReview: [],
    },
    badgeWithheld: !passed,
  })

  const item = (elementId: string, sectionId: string): QueueItem => ({
    kind: 'confirm-decorative',
    elementId,
    sectionId,
    context: { reference: `Sentence for ${elementId}.` },
  })

  const section = (id: string, queue: QueueItem[], passed = true): CompiledSection => ({
    id,
    title: `1.${id}`,
    html: `<p>compiled ${id}</p>`,
    notes: [],
    queue,
    gate: gate(passed),
  })

  const chapterOf = (sections: CompiledSection[]): CompiledChapter =>
    ({
      chapter: {
        title: 'Chapter 1',
        attribution: { bookTitle: 'Algebra', publisher: 'OpenStax', url: 'https://example.test' },
        sections: [],
      },
      sections,
      queue: sections.flatMap((s) => s.queue),
    }) as unknown as CompiledChapter

  it('says nothing to review, and never says fixed, when the queue was empty from the start', () => {
    // §3.8. The queue screen never renders: `App` routes straight here.
    const { container } = render(<ChapterHandoff compiled={chapterOf([section('a', [])])} answered={0} />)
    expect(
      screen.getByText(
        'Nothing to review. All sections passed their checks. The chapter is ready to publish.',
      ),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/fixed/i)
  })

  it('counts what the instructor answered, and claims only checks passed', () => {
    // §3.4. "Checks passed" is a claim with evidence — the gate panels are
    // directly below it. "Fixed" would be a claim about a repair nobody can
    // inspect, and it appears nowhere.
    const { container } = render(<ChapterHandoff compiled={chapterOf([section('a', [])])} answered={25} />)
    expect(
      screen.getByText('25 answered. All sections passed their checks. This chapter is ready to publish.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/fixed/i)
  })

  it('withholds the claim entirely when a section still has a blocker', () => {
    // Not softened — withheld. The gate panel below already says what is wrong,
    // and a hedge above it would be the interface talking over its own evidence.
    const { container } = render(
      <ChapterHandoff compiled={chapterOf([section('a', [], false)])} answered={3} />,
    )
    expect(container.textContent).not.toMatch(/ready to publish/)
    expect(container.textContent).not.toMatch(/passed their checks/)
    // The chapter itself is still shown; withholding a sentence is not hiding a
    // screen.
    expect(screen.getByRole('heading', { name: 'Chapter 1' })).toBeInTheDocument()
  })
})

describe('the queue screen’s arrival and departure', () => {
  const gate = (): GateResult =>
    ({
      html: '<p>repaired</p>',
      conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
      badgeWithheld: false,
    }) as GateResult

  const item = (elementId: string, sectionId: string): QueueItem => ({
    kind: 'confirm-decorative',
    elementId,
    sectionId,
    context: { reference: `Sentence for ${elementId}.` },
  })

  const section = (id: string, queue: QueueItem[]): CompiledSection => ({
    id,
    title: `Section ${id}`,
    html: `<p>compiled ${id}</p>`,
    notes: [],
    queue,
    gate: gate(),
  })

  const chapterOf = (sections: CompiledSection[]): CompiledChapter =>
    ({
      chapter: {
        title: 'Chapter 1',
        attribution: { bookTitle: 'Algebra', publisher: 'OpenStax', url: 'https://example.test' },
        sections: [],
      },
      sections,
      queue: sections.flatMap((s) => s.queue),
    }) as unknown as CompiledChapter

  const s1 = section('s1', [item('d0', 's1'), item('d1', 's1')])
  const s2 = section('s2', [item('d2', 's2')])

  it('opens on the first section that has items, without waiting for the chapter', () => {
    // §3.6. Two of four sections are still compiling and the instructor is
    // already answering — the counts say "so far" rather than pretending to
    // know the total.
    render(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1]} compiling={{ section: 2, total: 4 }} />,
    )
    expect(screen.getByText(/0 answered · 2 remain so far/)).toBeInTheDocument()
    expect(screen.getByText(/New items may join the queue\./)).toBeInTheDocument()
    expect(screen.getByText('Item 1 of 2')).toBeInTheDocument()
  })

  it('takes late sections into the queue and leaves the cursor where it was', () => {
    const { rerender } = render(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1]} compiling={{ section: 2, total: 4 }} />,
    )
    expect(screen.getByText('Item 1 of 2')).toBeInTheDocument()

    rerender(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1, s2]} compiling={{ section: 3, total: 4 }} />,
    )
    // The total grew; the instructor's place did not move. Late items join the
    // end of their group, which is what makes opening early safe.
    expect(screen.getByText('Item 1 of 3')).toBeInTheDocument()
  })

  it('corrects the provisional total out loud when compile finishes', () => {
    const { rerender } = render(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1]} compiling={{ section: 2, total: 4 }} />,
    )
    rerender(<QueueScreen initial={chapterOf([s1])} incoming={[s1, s2]} compiling={undefined} />)
    expect(document.querySelector('[role="status"]')!.textContent).toBe(
      'All sections processed. 3 items in the queue.',
    )
    // And the qualifier is gone.
    expect(screen.getByText(/0 answered · 3 remain — publishing stays locked until 0 remain/))
      .toBeInTheDocument()
  })

  it('hands off to the chapter view once nothing is queued and nothing is re-checking', () => {
    const empty = section('s1', [])
    const { container } = render(
      <QueueScreen initial={chapterOf([empty])} incoming={[empty]} compiling={undefined} />,
    )
    expect(screen.queryByText(/publishing stays locked/)).not.toBeInTheDocument()
    expect(
      screen.getByText('Nothing to review. All sections passed their checks. The chapter is ready to publish.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/fixed/i)
  })

  it('reports the answered, regrouped chapters once the queue settles', () => {
    const empty = section('s1', [])
    const onSettled = vi.fn()
    render(
      <QueueScreen initial={chapterOf([empty])} incoming={[empty]} compiling={undefined} chapters={[chapterOf([empty])]} onSettled={onSettled} />,
    )
    // Reported on mount and again when the arrival effect finalises the
    // session — the same chapters both times, so the consumer reads the last.
    expect(onSettled).toHaveBeenCalled()
    const settled = onSettled.mock.calls.at(-1)![0] as CompiledChapter[]
    expect(settled).toHaveLength(1)
    expect(settled[0]!.sections.map((s) => s.id)).toEqual(['s1'])
  })

  it('reports the answers map as it changes', () => {
    const onAnswers = vi.fn()
    render(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1]} compiling={undefined} onAnswers={onAnswers} />,
    )
    // The first report is the empty map, on mount — a consumer that starts with
    // its own empty map and only listens for changes would otherwise never
    // learn that nothing has been answered yet.
    expect(onAnswers).toHaveBeenCalledWith(new Map())
    fireEvent.click(screen.getByRole('button', { name: /Confirm decorative/ }))
    const last = onAnswers.mock.calls.at(-1)![0] as ReadonlyMap<string, unknown>
    expect(last.size).toBe(1)
    expect([...last.values()][0]).toEqual({ type: 'decorative' })
  })
})

test('the sidebar carries an IDEA phase that is shut before chapters are prepared', () => {
  render(<App />)
  const idea = screen.getByRole('button', { name: /IDEA/ })
  expect(idea).toHaveAttribute('aria-disabled', 'true')
  expect(idea).toHaveTextContent('select chapters first')
})
