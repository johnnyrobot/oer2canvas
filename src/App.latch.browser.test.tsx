import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import App from './App'
import page from './sources/fixtures/openstax/page.json'
import pageSection from './sources/fixtures/openstax/page-section.json'
import './App.css'

/**
 * THE OPEN-QUEUE LATCH, DRIVEN THROUGH `App`.
 *
 * `QueueScreen` and `ChapterHandoff` are both tested from fixture-derived props
 * and the engine's `onSection` seam has its own test, so the pieces were
 * covered. What was not was the latch that wires them together — the lines in
 * `App.tsx` deciding WHEN the queue opens and when it hands off — which the
 * existing tests touched only by continuing to reach `ChapterView`.
 *
 * It could not be tested in the unit project at all: a real
 * `compileAndAuditChapter` cannot complete in jsdom, because axe calls
 * `Element.checkVisibility` and jsdom does not implement it, so the promise
 * rejects part-way and `App` never reaches the state change. Hence the browser
 * project, and hence a synthetic two-section chapter — the committed 12-section
 * one is far too slow to audit for real inside a test.
 *
 * `globalThis.fetch` is stubbed rather than the client injected, because `App`
 * constructs its client at module scope (`createDefaultOpenStaxClient()`), which
 * is the shape production actually runs and therefore the shape worth driving.
 * NOTHING HERE TOUCHES THE NETWORK: all three hops are served from memory, and
 * the fixtures' `../resources/<sha>` image urls are rewritten onto this origin
 * before the content is handed over — otherwise they would absolutize against
 * `https://openstax.org` and the audit iframe would fetch every one of them.
 */

const BOOK_UUID = '13ac107a-f15f-49d2-97e8-60ab2e3b519c'
const BOOK_TITLE = 'Algebra and Trigonometry'
const ARCHIVE = '/apps/archive/synthetic'
const VERSION = '1'

type Fixture = { id: string; slug: string; content: string }
const WITH_ITEMS = pageSection as unknown as Fixture // 4 confirm-decorative items
const CLEAN = page as unknown as Fixture // 0 queue items

/**
 * Point every publisher image at this origin's committed copies.
 *
 * The fixtures carry `../resources/<sha>` with no extension, resolved against
 * the page url; left alone that is `https://openstax.org/...` and the audit
 * iframe really does load them. The committed files add `.jpg`.
 */
function localImages(content: string): string {
  return content.replace(
    /\.\.\/resources\/([0-9a-f]{40})/g,
    (_m, sha: string) =>
      new URL(`/src/sources/fixtures/openstax/resources/${sha}.jpg`, location.origin).href,
  )
}

/** One chapter, `sections.length` pages, each served the fixture it is given. */
function tocFor(sections: { id: string; title: string; fixture: Fixture }[]) {
  return {
    title: 'Synthetic Book',
    license: { name: 'Creative Commons Attribution License', url: 'https://example.org/by/4.0/' },
    language: 'en',
    tree: {
      id: `${BOOK_UUID}@${VERSION}`,
      title: 'Synthetic Book',
      contents: [
        {
          id: 'chapter-1@1',
          title: 'Chapter 1 Synthetic',
          toc_type: 'chapter',
          contents: sections.map((s) => ({
            id: `${s.id}@1`,
            title: s.title,
            toc_type: 'book-content',
            slug: s.id,
          })),
        },
      ],
    },
  }
}

let realFetch: typeof globalThis.fetch

function serve(sections: { id: string; title: string; fixture: Fixture }[]) {
  const toc = tocFor(sections)
  const byId = new Map(sections.map((s) => [s.id, s.fixture]))

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    // Hop 1 — the release manifest, the one call that goes through the relay.
    if (url.includes('/relay?url=') && decodeURIComponent(url).includes('/rex/release.json')) {
      return json({ archiveUrl: ARCHIVE, books: { [BOOK_UUID]: { defaultVersion: VERSION } } })
    }
    // Hop 3 — a page. Checked BEFORE the toc, because the toc url is a prefix of
    // it: `...@1.json` vs `...@1:<page>.json`.
    const pageMatch = url.match(/@[^:]+:([^.]+)\.json$/)
    if (pageMatch) {
      const id = pageMatch[1]!
      const fixture = byId.get(id)
      if (!fixture) throw new Error(`test stub: no fixture for page ${id}`)
      return json({ ...fixture, id, slug: id, content: localImages(fixture.content) })
    }
    // Hop 2 — the table of contents.
    if (url.includes(`/contents/${BOOK_UUID}@${VERSION}.json`)) return json(toc)
    // Anything else would be a real request, and this suite makes none.
    throw new Error(`test stub: unexpected request to ${url}`)
  }) as typeof globalThis.fetch
}

/**
 * Watch for the queue screen, and snapshot its header the INSTANT it exists.
 *
 * Recorded from a MutationObserver rather than read after the fact, because
 * "opened as soon as the first section with items compiled" is a claim about a
 * moment: by the time an `await` resolves the remaining sections may have
 * finished, and the line would read the same whether the queue opened early or
 * waited for the whole chapter. Snapshotting at first appearance is what tells
 * those two apart — and `everAppeared` is what lets §3.8 assert a screen was
 * never shown, which no after-the-fact query can do.
 */
function watchForTheQueue() {
  let header: string | null = null
  const record = () => {
    if (!document.querySelector('.b2c-queue')) return
    if (header === null) header = document.querySelector('.b2c-queue-header')?.textContent ?? ''
  }
  const observer = new MutationObserver(record)
  observer.observe(document.body, { childList: true, subtree: true })
  observers.push(observer)
  return {
    header: () => header,
    everAppeared: () => header !== null,
  }
}

let observers: MutationObserver[] = []

beforeEach(() => {
  realFetch = globalThis.fetch
  observers = []
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const o of observers) o.disconnect()
  cleanup()
})

/**
 * Book → chapter, the two clicks that start a run.
 *
 * `fireEvent` rather than a bare `.click()`: it wraps the dispatch in `act`, and
 * without that every state update this run makes is reported as an unwrapped
 * update. The suite is held to pristine output, and a screenful of act warnings
 * is how a real one gets missed.
 */
async function startTheChapter() {
  render(<App />)
  // The workflow opens on Destination now — answer it the way a user does
  // before reaching for the book list. Cartridge needs no credentials, so
  // this stays offline.
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  fireEvent.click(screen.getByRole('button', { name: BOOK_TITLE }))
  const chapter = await screen.findByRole('checkbox', { name: /Chapter 1 Synthetic/ }, { timeout: 10_000 })
  fireEvent.click(chapter)
  // Selection is a set now: ticking a chapter chooses it, committing runs it.
  fireEvent.click(screen.getByRole('button', { name: /^Prepare 1 chapter$/ }))
}

describe('the open-queue latch', () => {
  it('opens the queue on the first section with items, without waiting for the chapter', async () => {
    // Section one carries the four items; section two is clean. If the latch
    // waited for the chapter, the queue would still open — just later, and with
    // no compile clause in its header. That is the difference being measured.
    serve([
      { id: 'with-items', title: '1.1 With items', fixture: WITH_ITEMS },
      { id: 'clean', title: '1.2 Clean', fixture: CLEAN },
    ])
    const watch = watchForTheQueue()
    await startTheChapter()

    await waitFor(() => expect(watch.everAppeared()).toBe(true), { timeout: 25_000 })
    // §3.6: the header names the section still being compiled, which can only be
    // true if the queue is on screen while the run is still going.
    expect(watch.header()).toMatch(/compiling and checking section \d+ of 2/)
  }, 30_000)

  it('never renders the queue for a chapter with nothing to review, and hands off (§3.8)', async () => {
    /*
      TWO clean sections, and the second one is load-bearing.

      With a single section the run is already over by the time `partial` first
      exists, so `compiling` is `undefined`, so even a latch that opened on an
      EMPTY queue would render the handoff rather than the queue screen — and
      this test would pass against the bug it exists to catch. Measured: with
      the `queue.length === 0` guard deleted from the latch, the one-section
      version stayed green and the two-section version fails.
    */
    serve([
      { id: 'clean-a', title: '1.1 Clean', fixture: CLEAN },
      { id: 'clean-b', title: '1.2 Also clean', fixture: CLEAN },
    ])
    const watch = watchForTheQueue()

    await startTheChapter()

    // The handoff renders the chapter, so waiting for the section body is
    // waiting for the run to be over.
    await waitFor(() => expect(document.querySelector('.b2c-section-body')).toBeTruthy(), {
      timeout: 25_000,
    })
    expect(watch.everAppeared()).toBe(false)
  }, 30_000)

  it('says the §3.4 sentence, and never says "fixed"', async () => {
    serve([
      { id: 'clean-a', title: '1.1 Clean', fixture: CLEAN },
      { id: 'clean-b', title: '1.2 Also clean', fixture: CLEAN },
    ])
    await startTheChapter()
    await waitFor(() => expect(document.querySelector('.b2c-section-body')).toBeTruthy(), {
      timeout: 25_000,
    })

    // Quoted exactly, because the copy IS the product claim: a check that passed
    // is a claim with its evidence on the same page.
    expect(document.body.textContent).toContain(
      'Nothing to review. All sections passed their checks. The chapter is ready to publish.',
    )
    // The word this app is not allowed to say. "Fixed" is a claim about a defect
    // that may never have existed and about a repair nobody can inspect — the
    // overlay-vendor sentence this whole gate exists to avoid.
    expect(document.body.textContent).not.toMatch(/\bfixed\b/i)
  }, 30_000)
})
