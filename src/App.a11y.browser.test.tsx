import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import axe from 'axe-core'
import App from './App'
import { ChapterPicker } from './components/ChapterPicker'
import { ChapterView } from './components/ChapterView'
import { TextContentImporter } from './components/TextContentImporter'
import { DocumentImporter } from './components/DocumentImporter'
import { WebArticleImporter } from './components/WebArticleImporter'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from './components/ImportPlanEditor'
import { QueueView } from './components/queue/QueueView'
import { newSession, reduce, type QueueSession } from './components/queue/session'
import { fetchChapter, flattenToc } from './sources/openstax'
import type { BookToc, ChapterOutline, OpenStaxClient } from './sources/openstax'
import { openStaxCatalog } from './sources/openstax-catalog'
import type { BookRef, Chapter } from './sources/types'
import type { AuditIssue, GateResult } from './engine/gate'
import { repairAllowlist } from './engine/allowlist'
import { compileSection } from './engine/compile/index'
import { fixtureContext, type FixtureName } from './engine/compile/fixture-context'
import { queueKeyOf } from './engine/compile/answers'
import { mergeQueues } from './engine/compile/index'
import { TABLE_REFUSAL } from './engine/compile/steps/tables'
import type { CompiledChapter, CompiledSection, QueueItem } from './contracts/index'
import { semanticDocxFixture } from './import/testing/docx-fixture'
// The screens under audit are styled by App.css — it is what carries the WCAG 2.2
// SC 2.5.8 target sizes. Imported explicitly rather than relying on `App` pulling
// it in, so that auditing a component in isolation still sees the real styling.
import './App.css'

/**
 * An accessibility tool with an inaccessible interface has no standing, so our
 * own UI is held to the same rule set we hold imported chapters to: the full
 * WCAG A/AA tag set, nothing removed, on EVERY screen.
 *
 * "Every screen" is the point. Auditing only the landing state left
 * `ChapterPicker` and `ChapterView` — the screens where results are actually
 * read — completely unaudited, and that is precisely where a duplicate-id defect
 * survived. Each test below renders one screen directly from fixture-derived
 * props: simpler than driving `App` through its states, no network, and one
 * assertion per screen.
 *
 * These are `.browser.test.tsx` on purpose — jsdom has no layout and no real
 * computed styles, so an axe assertion there would mean nothing.
 */

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function violationsIn(container: Element): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: WCAG_AA } })
  return results.violations.map((v) => `${v.id}: ${v.description}`)
}

/**
 * Ids that appear more than once in the rendered output.
 *
 * This is asserted DIRECTLY rather than left to axe. axe's `duplicate-id-aria`
 * rule reports a duplicated, aria-referenced id as `incomplete` — not a
 * violation — because a scoped run cannot prove document-wide uniqueness. A
 * violations-only assertion therefore cannot see it, which is exactly how N
 * panels sharing one `id="audit-heading"` went unnoticed. We do not weaken the
 * axe assertion to compensate (`incomplete` is legitimately non-empty, e.g. the
 * MathML `color-contrast` rows); we check the invariant ourselves.
 */
function duplicateIds(container: Element): string[] {
  const counts = new Map<string, number>()
  for (const el of container.querySelectorAll('[id]')) {
    const id = el.getAttribute('id')!
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].filter(([, n]) => n > 1).map(([id, n]) => `${id} (x${n})`)
}

/** The book the committed TOC fixture belongs to, taken from the real catalog. */
function fixtureBook(): BookRef {
  const book = openStaxCatalog().find((b) => b.id === '13ac107a-f15f-49d2-97e8-60ab2e3b519c')
  if (!book) throw new Error('Algebra and Trigonometry is missing from the bundled catalog')
  return book
}

/** Real `flattenToc` over the committed TOC — normalized plain-text titles and all. */
async function fixtureOutlines(): Promise<ChapterOutline[]> {
  const toc = await import('./sources/fixtures/openstax/book-toc.json')
  return flattenToc((toc as unknown as { default: BookToc }).default.tree)
}

/**
 * A real `Chapter`, assembled by the real `fetchChapter` — so the audit sees the
 * genuine `Attribution` (D9) and the genuine normalized section titles. The
 * injected client serves the two committed page fixtures and nothing else: this
 * test never touches the network.
 */
async function fixtureChapter(outline: ChapterOutline): Promise<Chapter> {
  const preface = await import('./sources/fixtures/openstax/page.json')
  const section = await import('./sources/fixtures/openstax/page-section.json')
  const pages = [preface, section].map(
    (m) => (m as unknown as { default: { content: string; title: string } }).default,
  )
  const client: OpenStaxClient = {
    async resolveRelease() {
      throw new Error('fixtureChapter must not resolve a release')
    },
    async fetchToc() {
      throw new Error('fixtureChapter must not fetch a TOC')
    },
    async fetchPage(_bookUuid, pageId) {
      const i = outline.sections.findIndex((s) => s.id === pageId)
      const page = pages[(i < 0 ? 0 : i) % pages.length]!
      return { id: pageId, title: page.title, content: page.content }
    },
    async pageUrl(_bookUuid, pageId) {
      return `https://openstax.org/contents/${pageId}.json`
    },
  }
  return fetchChapter(client, fixtureBook(), outline)
}

const issue = (id: string, severity: AuditIssue['severity'], message: string): AuditIssue => ({
  id,
  severity,
  message,
})

/**
 * Gate results shaped like the ones the milestone actually measured: the
 * `allowlist-removed-semantic:figure` blocker (message text copied from
 * `enforceGate`) and the `color-contrast` needs-review row. The warning row has
 * no counterpart in the measured output — section 1.4 produced zero warnings —
 * and is included here for one reason: `AuditPanel` renders warnings in their own
 * branch, and an unrendered branch is an unaudited branch.
 */
function measuredResult(): GateResult {
  const blockers = [issue('allowlist-removed-semantic:figure', 'blocker', 'Removed semantic <figure>')]
  return {
    html: '<p>repaired</p>',
    conformance: {
      passedChecks: false,
      blockers,
      warnings: [
        issue(
          'image-contrast',
          'warning',
          'Text over a background image may not reach the 4.5:1 minimum (worst-case estimate).',
        ),
      ],
      needsHumanReview: [
        issue(
          'color-contrast',
          'alert',
          'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
        ),
      ],
    },
    badgeWithheld: true,
  }
}

/** The Preface's measured shape: nothing to report. */
function cleanResult(): GateResult {
  return {
    html: '<p>repaired</p>',
    conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
    badgeWithheld: false,
  }
}

/**
 * A section body that is REAL OUTPUT, not a stand-in.
 *
 * A duplicated section title once survived this file because screen 3's bodies
 * were the string `'<p>repaired</p>'`. A fixture with no
 * headings in it cannot fail a heading assertion, and three earlier defects
 * were traced to the same choice. So this compiles a committed page fixture
 * with the real pipeline and repairs it with the real allowlist: the bytes
 * `ChapterView` renders in production, heading tree and all.
 *
 * Image urls are rewritten to the committed local resources for the reason
 * `App.browser.test.ts` gives at length — `src/test/setup.ts` guards the global
 * `fetch` and nothing else, so an `<img>` pointed at openstax.org is a real
 * network request that the guard cannot see. The rewrite is asserted rather
 * than trusted, because an identity-function regression would be invisible
 * here: axe reads the `alt` attribute, not the pixels.
 */
function realSection(name: FixtureName): { id: string; title: string; html: string } {
  const { section, ctx } = fixtureContext(name)
  const repaired = repairAllowlist(compileSection(section, ctx).html).html
  const localized = repaired.replace(
    /https:\/\/openstax\.org\/apps\/archive\/[^/]+\/resources\/([0-9a-f]{40})/g,
    (_full, sha: string) =>
      new URL(`/src/sources/fixtures/openstax/resources/${sha}.jpg`, location.origin).href,
  )
  expect(localized).not.toContain('https://openstax.org/apps/archive/')
  // The title comes from the SAME fixture as the body, which `fixtureChapter`
  // cannot do — it serves the two committed pages round-robin across nine
  // outline entries, so its section titles and its bodies describe different
  // pages. That mismatch is not cosmetic here: a fixture whose two titles never
  // agree cannot expose an accidentally duplicated title
  // even when one is on screen. Verified by reintroducing the bug.
  return { id: section.id, title: section.title, html: localized }
}

test('screen 1 — the book browser has no accessibility violations', async () => {
  const { container } = render(<App />)
  // The workflow opens on Destination now — answer it the way a user does
  // before reaching for the book list. Cartridge needs no credentials, so
  // this stays offline.
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/i }))
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})

/**
 * An import form and the page plan editor it hands off to, wired as `App`
 * wires them. Both screens are audited: the form before parsing, the editor
 * after, and the editor again with a split picker and a preview open.
 */
function ImportFlow({ form }: { form: (onImported: (result: import('./import/types').ImportResult) => void) => React.ReactNode }) {
  const [draft, setDraft] = useState<ImportDraft | undefined>()
  return draft
    ? <ImportPlanEditor draft={draft} onChange={setDraft} onConfirm={() => {}} onDiscard={() => setDraft(undefined)} />
    : form((result) => setDraft(createImportDraft(result)))
}

test('screen 1b — the text and markup form and its page plan have no accessibility violations', async () => {
  const { container } = render(<ImportFlow form={(onImported) => <TextContentImporter onImported={onImported} />} />)
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Accessible notes' } })
  fireEvent.change(screen.getByLabelText('Content to import'), {
    target: { value: '# Notes\n\n## Membranes\n\nA useful paragraph.\n\nAnother.\n\n## Nucleus\n\nStores DNA.' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Create page plan' }))
  await screen.findByRole('heading', { name: 'Page plan: Accessible notes' })
  expect(screen.getAllByLabelText(/^Title of page/)).toHaveLength(2)

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: 'Split: Membranes' }))
  expect(screen.getByLabelText('Start a new page at')).toBeVisible()
  fireEvent.click(screen.getByText('Preview Nucleus'))
  await screen.findByText('Stores DNA.')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include: Nucleus' }))
  fireEvent.change(screen.getByLabelText('Title of page 1'), { target: { value: 'Nucleus' } })
  expect(screen.getByRole('button', { name: 'Prepare 1 page' })).toBeEnabled()

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})

test('screen 1c — the document form and its page plan have no accessibility violations', async () => {
  const { container } = render(<ImportFlow form={(onImported) => <DocumentImporter onImported={onImported} />} />)
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  const file = new File([await semanticDocxFixture()], 'accessible.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  fireEvent.change(screen.getByLabelText('Document file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('radio', { name: 'I created or own this content' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Inspect document' }))
  await screen.findByRole('heading', { name: 'Page plan: accessible' })
  fireEvent.click(screen.getByText('Preview accessible'))
  await screen.findByText('Stores DNA')

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})

/**
 * Issue 12 added the Web page tab and no accessibility screen for it — this
 * closes that gap. Shaped exactly like screen 1c: the same `ImportFlow`
 * harness, the same two assertions, audited on the bare form and again after
 * driving through to the page plan, because the findings list and the plan
 * editor are part of the screen a user actually reads.
 *
 * `fetch` is injected so this test, like every other screen in this file,
 * never reaches the network. The envelope below satisfies
 * `import/firecrawl.ts`'s validation — `success: true`, a string
 * `data.markdown`, and a numeric `data.metadata.statusCode` — and its
 * `metadata.url`/`sourceURL` match the address typed into the form, which is
 * what `WebArticleImporter` records as the page's source.
 */
test('screen 1d — the web page form and its page plan have no accessibility violations', async () => {
  const okEnvelope = {
    success: true,
    data: {
      markdown: '# Photosynthesis\n\nPlants convert light.\n\n## Products\n\nSugars and oxygen.',
      metadata: {
        url: 'https://en.wikipedia.org/wiki/Photosynthesis',
        sourceURL: 'https://en.wikipedia.org/wiki/Photosynthesis',
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
      },
    },
  }
  const { container } = render(
    <ImportFlow form={(onImported) => (
      <WebArticleImporter
        onImported={onImported}
        fetch={async () => new Response(JSON.stringify(okEnvelope))}
      />
    )} />,
  )
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  fireEvent.change(screen.getByLabelText(/Web page address/i), {
    target: { value: 'https://en.wikipedia.org/wiki/Photosynthesis' },
  })
  fireEvent.change(screen.getByLabelText(/Firecrawl API key/i), { target: { value: 'fc-test' } })
  fireEvent.change(screen.getByLabelText(/Document title/i), { target: { value: 'Photosynthesis' } })
  fireEvent.click(screen.getByRole('radio', { name: 'I have permission to republish or adapt it' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))
  await screen.findByRole('heading', { name: 'Page plan: Photosynthesis' })

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})

test('screen 2 — the chapter picker has no accessibility violations', async () => {
  const outlines = await fixtureOutlines()
  expect(outlines.length).toBeGreaterThan(1)

  const { container } = render(<ChapterPicker outlines={outlines} selected={[]} onToggle={() => {}} onPrepare={() => {}} onChangeBook={() => {}} />)
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})

// This exercises axe against two complete textbook fixtures and can exceed the
// default 15-second limit on a shared CI runner.
test('screen 3 — the chapter view has no accessibility violations', async () => {
  const outlines = await fixtureOutlines()
  const chapter = await fixtureChapter(outlines[0]!)
  // At least two sections, so the per-section `AuditPanel` is rendered more than
  // once — the shape that produced duplicate ids before `AuditPanel` used
  // `useId()`, and the shape any future regression would need to be caught in.
  expect(chapter.sections.length).toBeGreaterThanOrEqual(2)

  // TWO sections, and the two DISTINCT committed fixtures. Not the outline's
  // full nine: `fixtureChapter` serves the same two page bodies round-robin, so
  // a third section would re-render bytes already on screen and every publisher
  // id in them would collide with itself — a fixture artefact that would read
  // as the very defect `duplicateIds` exists to catch. Two real bodies cost
  // about two seconds of axe; nine would cost ten and prove nothing more.
  const real = [realSection('page'), realSection('page-section')]

  // A queue item too, deliberately: the "needs review" paragraph is markup
  // this audit has never scanned before, and an unscanned branch is an
  // unaudited branch (the same reasoning `AuditPanel`'s header comment gives
  // for its warnings branch).
  const compiled: CompiledChapter = {
    chapter,
    queue: [{ kind: 'table-headers', sectionId: real[0]!.id, elementId: 'e', context: {} }],
    sections: real.map((r, i) => ({
      id: r.id,
      title: r.title,
      html: '<p>compiled but unaudited — must never be rendered</p>',
      notes: [],
      queue: [],
      gate: { ...(i % 2 === 0 ? measuredResult() : cleanResult()), html: r.html },
    })),
  }
  const { container } = render(<ChapterView compiled={compiled} />)

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  /*
    The section title must not render once in `ChapterView` and again in the
    compiled body, which opens with it as an `h2` because Canvas
    renders the page title as the page's own `h1`.

    Counted directly, because NO AXE RULE CATCHES THIS — measured, not assumed.
    `heading-order` reports nothing on the broken markup at any tag level: a
    heading that returns to a shallower level is legal, since that is how a
    subsection closes. The rule is still asserted just below, because it would
    catch the other direction — a skipped level — and this screen now has a real
    heading tree for it to have an opinion about.
  */
  const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
  const titleText = (h: Element) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()
  const bodyElements = [...container.querySelectorAll('.b2c-section-body')]
  expect(bodyElements).toHaveLength(2)
  for (const [i, body] of bodyElements.entries()) {
    const top = body.querySelector('h1, h2, h3, h4, h5, h6')
    expect(top, 'a real body opens with a heading').not.toBeNull()
    // The body's opening heading IS the section title, which is what makes a
    // duplicate detectable: the fixture's `title` and its body agree, so a
    // second heading with this text can only have come from our own chrome.
    const text = titleText(top!)
    expect(text.replace(/\s+/g, ' '), 'the fixture title and its body agree').toBe(real[i]!.title)
    const matches = headings.filter((h) => titleText(h) === text)
    expect(matches.map((h) => h.tagName), `section title "${text}"`).toEqual(['H2'])
  }
  // The tree is real, so the assertions above are about something.
  expect(headings.length).toBeGreaterThan(10)

  const order = await axe.run(container, { runOnly: { type: 'rule', values: ['heading-order'] } })
  expect(order.violations.map((v) => v.id)).toEqual([])
}, 30_000)

/**
 * Repaired bytes carrying the elements the queue points at.
 *
 * A stand-in, exactly as `measuredResult().html` is a stand-in for screen 3, and
 * for the same reason: region E shows bytes the CHAPTER's gate is the judge of,
 * and an unanswered `alt` item is by definition an `<img>` carrying no `alt`
 * attribute (`steps/alt.ts` queues it and writes nothing). Auditing real
 * publisher output here would fail this test for a defect the queue exists to
 * get answered, and pass only while the fixture happened to be clean.
 *
 * The ids ARE load-bearing, though, and that is why these are real elements and
 * not one `<p>repaired</p>`: the card mints ids with `useId()`, the section
 * render brings the publisher's, and "one section at a time" (D5.6) is the only
 * reason those two sets cannot collide. The duplicate-id check below has
 * nothing to say unless both are on screen.
 */
function repaired(elementIds: readonly string[]): string {
  return elementIds
    .map((id) =>
      id.startsWith('tbl')
        ? `<table id="${id}"><tbody><tr><td>Year</td><td>Cost</td></tr>` +
          '<tr><td>2019</td><td>320</td></tr></tbody></table>'
        : `<p id="${id}">A paragraph standing in for the element being asked about.</p>`,
    )
    .join('')
}

const queueGate = (html: string): GateResult => ({
  html,
  conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
  badgeWithheld: false,
})

const imageItem = (
  sectionId: string,
  elementId: string,
  kind: 'confirm-decorative' | 'alt',
  extra: Partial<QueueItem> = {},
): QueueItem => ({
  kind,
  sectionId,
  elementId,
  context: {
    reference: 'The graph in Figure 3 shows the cost of each plan over ten years.',
    src: 'https://openstax.org/apps/archive/fixture/graph.png',
  },
  ...extra,
})

const tableItem = (sectionId: string, elementId: string): QueueItem => ({
  kind: 'table-headers',
  sectionId,
  elementId,
  context: {
    reference: 'Table 2 lists the cost of each plan.',
    caption: 'Table 2 Cost of each plan, 2019 to 2029.',
  },
})

/**
 * A chapter posed the way the queue screen actually meets one.
 *
 * Two sections that compiled and one that did not — §3.7's failed-section
 * statement is markup no other screen renders, and an unrendered branch is an
 * unaudited branch. `img-shared` is deliberately in BOTH working sections under
 * one hash, so the propagation line D5.2 promises has something to say; the
 * merged queue is built by the real `mergeQueues` so that the counts the header
 * quotes survive the `recompiled` event below, which rebuilds it the same way.
 */
async function queueChapter(): Promise<CompiledChapter> {
  const outlines = await fixtureOutlines()
  const chapter = await fixtureChapter(outlines[0]!)
  expect(chapter.sections.length).toBeGreaterThanOrEqual(3)
  const one = chapter.sections[0]!
  const two = chapter.sections[1]!
  const broken = chapter.sections[2]!

  const firstIds = ['img-plain', 'img-answered', 'img-drafted', 'img-shared']
  const secondIds = ['img-shared', 'img-bare', 'tbl-costs']
  const sections: CompiledSection[] = [
    {
      id: one.id,
      title: one.title,
      html: '<p>compiled — never rendered by this screen</p>',
      notes: [],
      queue: [
        imageItem(one.id, 'img-plain', 'confirm-decorative', { hash: 'h-plain' }),
        imageItem(one.id, 'img-answered', 'alt', { hash: 'h-answered' }),
        imageItem(one.id, 'img-drafted', 'alt', {
          hash: 'h-drafted',
          proposed: 'A line graph comparing the cost of the two plans from 2019 to 2029.',
        }),
        imageItem(one.id, 'img-shared', 'confirm-decorative', { hash: 'h-shared' }),
      ],
      gate: queueGate(repaired(firstIds)),
    },
    {
      id: two.id,
      title: two.title,
      html: '<p>compiled — never rendered by this screen</p>',
      notes: [],
      queue: [
        imageItem(two.id, 'img-shared', 'confirm-decorative', { hash: 'h-shared' }),
        // No `proposed`: the alt card labels its input by the question itself in
        // this branch and by a real <label> in the other, and only one of those
        // two wirings can be on screen at a time.
        imageItem(two.id, 'img-bare', 'alt'),
        tableItem(two.id, 'tbl-costs'),
      ],
      gate: queueGate(repaired(secondIds)),
    },
    {
      id: broken.id,
      title: broken.title,
      html: '',
      notes: [],
      queue: [],
      error: 'The publisher returned no content for this section.',
    },
  ]
  return { chapter, sections, queue: mergeQueues(sections) }
}

/**
 * Mid-session, reached by the events that reach it — never by hand-assembling
 * the state. Two items answered, one skipped, and the sections they touched
 * marked dirty, which is what puts the header line into its re-checking shape.
 *
 * An empty first-arrival queue exercises none of this.
 */
async function midSession(): Promise<QueueSession> {
  const compiled = await queueChapter()
  const key = (elementId: string) =>
    queueKeyOf(compiled.queue.find((i) => i.elementId === elementId)!)

  let session = newSession(compiled)
  session = reduce(session, { type: 'answer', key: key('img-plain'), answer: { type: 'decorative' } })
  session = reduce(session, {
    type: 'answer',
    key: key('img-answered'),
    answer: { type: 'alt', text: 'A line graph comparing the cost of the two plans.' },
  })
  session = reduce(session, { type: 'skip', key: key('img-shared') })
  return session
}

/**
 * The same session after compile REFUSED a table answer (D5.14).
 *
 * Worth posing separately because it is the only state that puts text in the
 * `role="alert"` region and a refusal paragraph inside the card, and because it
 * is the only state that renders region E from `displayHtml` — the stand-in a
 * section shows while its re-audit is still running — rather than from a gate.
 */
function withRefusal(session: QueueSession, sectionId: string): QueueSession {
  const section = session.compiled.sections.find((s) => s.id === sectionId)!
  const rebuilt: CompiledSection = {
    ...section,
    gate: undefined,
    notes: [{ step: 'tables', message: `${TABLE_REFUSAL}its first row is ragged` }],
  }
  const key = queueKeyOf(section.queue.find((i) => i.kind === 'table-headers')!)
  const answered = reduce(session, {
    type: 'answer',
    key,
    answer: { type: 'table-headers', choice: 'row' },
  })
  return reduce(answered, {
    type: 'recompiled',
    // The stand-in has to carry the same elements the rebuilt section's items
    // point at, or the outline would have nothing to land on.
    sections: [{ section: rebuilt, displayHtml: repaired(rebuilt.queue.map((i) => i.elementId)) }],
  })
}

/**
 * What a pose must actually have put on screen before its audit means anything.
 *
 * The three card kinds differ in exactly the places a11y lives — a labelled
 * text input, an input labelled by the question instead, five buttons and a
 * refusal — so an audit that measured the wrong one, or measured a card that
 * failed to render at all, would pass while saying nothing. This is the shape
 * check that stops a green run from being a silent one.
 */
function poseShape(container: Element) {
  return {
    heading: container.querySelector('.b2c-queue-card h3')?.textContent,
    controls: container.querySelectorAll('.b2c-queue-controls button').length,
    labelledByOwnLabel: !!container.querySelector('.b2c-queue-card label'),
    refused: !!container.querySelector('.b2c-queue-refusal'),
    skippedEarlier: !!container.textContent?.includes('You skipped this earlier.'),
  }
}

/**
 * SCREEN 4 — the queue, mid-session.
 *
 * Two items answered, one skipped, the jump list and the answered list open, a
 * section rendered, and one section that failed to compile. An empty
 * first-arrival queue exercises none of the states that can break.
 *
 * One card is on screen at a time (D5.6) and the three kinds are three
 * different shapes, so the cursor is walked across all of them rather than
 * audited wherever it happened to land — otherwise three quarters of this
 * screen's controls would be as unaudited as `ChapterView` was. Both
 * `<details>` are opened first for the same reason: a collapsed region renders
 * nothing, and nothing is what axe would then have to say about it.
 */
test('screen 4 — the queue screen, mid-session, has no accessibility violations', async () => {
  const base = await midSession()
  const second = base.compiled.sections[1]!
  const at = (elementId: string): QueueSession =>
    reduce(base, {
      type: 'jump',
      key: queueKeyOf(base.compiled.queue.find((i) => i.elementId === elementId)!),
    })

  const poses: [string, QueueSession, ReturnType<typeof poseShape>][] = [
    [
      'an image marked decorative, resurfacing from the skipped tail',
      at('img-shared'),
      {
        heading: 'Images marked decorative',
        controls: 3,
        labelledByOwnLabel: false,
        refused: false,
        skippedEarlier: true,
      },
    ],
    [
      'an image needing a description, with a draft the label points at',
      at('img-drafted'),
      {
        heading: 'Images needing descriptions',
        controls: 3,
        labelledByOwnLabel: true,
        refused: false,
        skippedEarlier: false,
      },
    ],
    [
      'an image needing a description, with no draft and so no label',
      at('img-bare'),
      {
        heading: 'Images needing descriptions',
        controls: 3,
        labelledByOwnLabel: false,
        refused: false,
        skippedEarlier: false,
      },
    ],
    [
      'a table whose headers compile refused to set',
      withRefusal(base, second.id),
      {
        heading: 'Tables missing headers',
        controls: 5,
        labelledByOwnLabel: false,
        refused: true,
        skippedEarlier: false,
      },
    ],
  ]

  for (const [pose, session, shape] of poses) {
    const { container, unmount } = render(<QueueView session={session} />)
    for (const details of container.querySelectorAll('details')) details.open = true

    expect(poseShape(container), pose).toEqual(shape)
    // The regions that do not depend on the cursor, asserted once per pose
    // because each of them is markup no other screen in this file renders.
    expect(container.querySelectorAll('.b2c-queue-failed'), pose).toHaveLength(1)
    expect(container.querySelectorAll('.b2c-queue-jump li').length, pose).toBeGreaterThan(0)
    expect(container.querySelectorAll('.b2c-queue-answered li'), pose).toHaveLength(2)
    // Region E is on screen with the publisher's own ids in it, which is what
    // gives the duplicate-id check below something to be true against.
    expect(container.querySelectorAll('.b2c-queue-render [id]').length, pose).toBeGreaterThan(0)

    expect(await violationsIn(container), pose).toEqual([])
    expect(duplicateIds(container), pose).toEqual([])
    unmount()
  }
})
