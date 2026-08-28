import { useEffect, useRef, useState } from 'react'
import { SourceBrowser } from './components/SourceBrowser'
import { ChapterPicker } from './components/ChapterPicker'
import { ChapterView } from './components/ChapterView'
import { QueueView } from './components/queue/QueueView'
import { useQueueSession } from './components/queue/useQueueSession'
import { counts } from './components/queue/session'
import { createDefaultOpenStaxClient, flattenToc, fetchChapter } from './sources/openstax'
import type { BookToc, ChapterOutline } from './sources/openstax'
import { createLibreTextsClient, createPressbooksClient, type WebBookClient } from './sources/webbooks'
import type { BookRef, Chapter } from './sources/types'
import type { CompileProgress } from './engine'
import { draftAltText, SELECTED_VLM_MODEL, type VlmModel, type VlmProgress } from './engine/vlm'
import { createBrowserVlmRuntime } from './engine/vlm-runtime'
import {
  DOCUMENT,
  LIBRETEXTS,
  OPENSTAX,
  PRESSBOOKS,
  type PublisherProfile,
} from './engine/compile/context'
import { isPublishable } from './contracts/index'
import type { CompiledChapter, CompiledSection } from './contracts/index'
import { mergeQueues } from './engine/compile/index'
// Not decoration: `App.css` is what carries the WCAG 2.2 SC 2.5.8 target sizes
// that `App.a11y.browser.test.tsx` holds this UI to. See the file's own header.
import './App.css'
import { AppShell } from './shell/AppShell'
import { DestinationScreen, ResultScreen } from './shell/screens'
import { PlanScreen } from './shell/PlanScreen'
import { downloadCartridge } from './engine/export/download'
import { createDefaultCanvasClient } from './canvas/client'
import { createCredentialStore, migratePersistedTokens } from './canvas/credentials'
import { createIdbStore } from './canvas/idb'
import { useCanvasConnection } from './shell/useCanvasConnection'
import { runPush } from './shell/push-session'
import type { PushReport } from './shell/screens'
import type { Destination, PhaseId, ShellState } from './shell/phases'
import { mergeSelection, regroup, toggle } from './shell/selection'
import type { ImportResult } from './import/types'
import { toChapter } from './import/to-chapter'
import { isAbortError, messageOf } from './errors'

const openstaxClient = createDefaultOpenStaxClient()
const webClients: Partial<Record<'libretexts' | 'pressbooks', WebBookClient>> = {
  libretexts: createLibreTextsClient({ fetch: (...args) => globalThis.fetch(...args), relayUrl: '/relay' }),
  pressbooks: createPressbooksClient({ fetch: (...args) => globalThis.fetch(...args), relayUrl: '/relay' }),
}
const publisherProfiles = {
  openstax: OPENSTAX,
  libretexts: LIBRETEXTS,
  pressbooks: PRESSBOOKS,
  document: DOCUMENT,
} as const
const localVlmRuntime = createBrowserVlmRuntime()
const localVlmDrafting = {
  models: [SELECTED_VLM_MODEL] as const,
  draft: (
    model: VlmModel,
    image: string,
    onProgress: (progress: VlmProgress) => void,
    signal: AbortSignal,
  ) => draftAltText(localVlmRuntime, model, image, onProgress, signal),
}
/**
 * The one disk this app writes to, and the credential store over it.
 *
 * Module scope so a re-render never builds a second store — and so the
 * session-only half of `createCredentialStore` really is per session rather than
 * per mount, which is what makes "forgotten when you close this tab" true.
 */
const disk = createIdbStore()
const credentials = createCredentialStore(disk)
// Release 1.1 removes the old opt-in token persistence. Run the cleanup as soon
// as the app module loads; `createIdbStore().remove` reaches both the current
// and prototype database names. The credential store also removes the key on
// connect/forget, so this remains safe if a browser resumes mid-migration.
void migratePersistedTokens(disk).catch(() => {
  // IndexedDB failures are surfaced by the next credential operation; do not
  // log browser-local state or a token-bearing error.
})

const selfHostedCanvasOrigin =
  typeof __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__ === 'string'
    ? __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__
    : ''

/**
 * "Auditing 3 of 12: 1.3 Radicals…" — what the status line says mid-run.
 *
 * `undefined` means "leave the line alone", and the `compile` phase gets it.
 * That is a measurement, not an oversight: compiling one section costs 0-15 ms
 * even for the 523 KB one, so React coalesces the compile state away before it
 * can ever be committed — a `Compiling …` line was verified never to reach the
 * DOM across a whole chapter, with a MutationObserver recording every change.
 * Rendering the audit phase alone also spares the line a flicker per section.
 * The engine still REPORTS the compile phase; it is genuinely where the run is,
 * and a slower publisher profile could make it worth showing.
 */
export function progressLabel(p: CompileProgress): string | undefined {
  if (p.phase === 'compile') return undefined
  if (p.phase === 'done') return ''
  return `Auditing ${p.done + 1} of ${p.total}: ${p.title}…`
}

/**
 * §3.4 and §3.8. The two things this app is allowed to say when the work is
 * done, quoted exactly.
 *
 * "Checks passed" and not "fixed", and there is a test asserting the word
 * "fixed" appears nowhere on the screen. The difference is the product: a check
 * that passed is a claim with the evidence directly below it — the gate panels
 * are on the same page — while "fixed" is a claim about a defect that may never
 * have existed and about a repair nobody can inspect.
 */
const READY = {
  answered: (n: number) =>
    `${n} answered. All sections passed their checks. This chapter is ready to publish.`,
  nothing: 'Nothing to review. All sections passed their checks. The chapter is ready to publish.',
  clearing: 'Queue clear. All checks passed. The chapter is ready to publish.',
  waiting: (section: number, total: number) =>
    `Nothing to review so far — checking section ${section} of ${total}.`,
}

/**
 * The chapter view, with at most one added line above it.
 *
 * The line is withheld unless `isPublishable` says so, and that is the whole
 * discipline: a chapter with a blocker gets no sentence at all rather than a
 * softened one, because the gate panels below already say what is wrong and a
 * hedge above them would just be the interface talking over its own evidence.
 */
export function ChapterHandoff({ compiled, answered }: { compiled: CompiledChapter; answered: number }) {
  const ready = isPublishable(compiled)
  return (
    <>
      {ready && <p>{answered > 0 ? READY.answered(answered) : READY.nothing}</p>}
      <ChapterView compiled={compiled} />
    </>
  )
}

/**
 * The queue, and the handoff out of it.
 *
 * Exported for its tests, as `progressLabel` above already is. A full run
 * cannot be driven in jsdom — axe needs `Element.checkVisibility`, which jsdom
 * does not implement — so the screens this file routes between are tested
 * directly from fixture-derived props, the same shape `App.a11y.browser.test`
 * settled on for the same reason.
 *
 * The session lives here rather than in `App` because `App` keeps owning
 * `compiled` — what an answer changes is what compile EMITS, and the emitting is
 * this screen's business. The switch to the chapter view is here too, for the
 * same reason: only the session knows whether anything is still awaiting a
 * re-audit, and handing off while a verdict is in flight would show a gate
 * panel that does not describe the bytes beside it.
 */
export function QueueScreen({
  initial,
  incoming,
  compiling,
  /**
   * The selection's chapters, kept apart. The session works on ONE merged
   * chapter — that is what makes the queue span the selection and dedupe across
   * it — but handing off has to give each chapter its own title and attribution
   * back, so `regroup` splits the ANSWERED result along these.
  */
  chapters,
  drafting,
}: {
  initial: CompiledChapter
  incoming: readonly CompiledSection[]
  compiling?: { section: number; total: number }
  chapters?: readonly CompiledChapter[]
  drafting?: {
    models: readonly VlmModel[]
    draft: (
      model: VlmModel,
      image: string,
      onProgress: (progress: VlmProgress) => void,
      signal: AbortSignal,
    ) => Promise<string>
  }
}) {
  const { session, answer, skip, revisit, jump, arrived } = useQueueSession(initial)

  /*
    Sections from the FIRST compile, handed over as they land (§3.6).

    Only ones this screen has not seen: `incoming` is `App`'s accumulator and
    never changes after the run, while the session's own copy of a section is
    replaced every time an answer rebuilds it. Re-delivering the whole list
    would overwrite those rebuilds with the originals and put answered items
    back in the queue.
  */
  const delivered = useRef(new Set(initial.sections.map((s) => s.id)))
  const finished = useRef(false)
  useEffect(() => {
    const fresh = incoming.filter((s) => !delivered.current.has(s.id))
    const last = compiling === undefined && !finished.current
    if (fresh.length === 0 && !last) return
    for (const s of fresh) delivered.current.add(s.id)
    if (last) finished.current = true
    arrived(fresh, last)
  }, [incoming, compiling, arrived])

  const tally = counts(session)
  const clear =
    compiling === undefined && session.compiled.queue.length === 0 && session.dirty.size === 0

  if (clear) {
    // Regrouped from the SESSION's chapter, never from the originals: an answer
    // rebuilds the section it touched, so the pre-answer copy is stale and would
    // put every gate panel beside bytes it no longer describes.
    const groups = chapters?.length ? regroup(chapters, session.compiled) : [session.compiled]
    return (
      <>
        {/* §3.4's announcement, said once, on the screen it hands off to. */}
        <p role="status" aria-live="polite">
          {groups.every(isPublishable) ? READY.clearing : ''}
        </p>
        {groups.map((g, i) => (
          <ChapterHandoff key={g.chapter.title ?? i} compiled={g} answered={i === 0 ? tally.answered : 0} />
        ))}
      </>
    )
  }

  return (
    <QueueView
      session={session}
      compiling={compiling}
      onAnswer={answer}
      onSkip={skip}
      onRevisit={revisit}
      onJump={jump}
      {...(drafting ? { drafting } : {})}
    />
  )
}

export default function App() {
  const [outlines, setOutlines] = useState<ChapterOutline[]>([])
  const [book, setBook] = useState<BookRef | undefined>()
  // Held whole, not just its licence: `fetchChapter` also needs the TOC's tree
  // to build the intra-book xref map and each section's canonical url.
  const [toc, setToc] = useState<BookToc | undefined>()
  const [chapter, setChapter] = useState<Chapter | undefined>()
  /**
   * Sections as they come off the first compile, so the queue can open on the
   * first one that has items rather than on the chapter (§3.6). An instructor
   * with 25 items should spend compile time answering, not watching progress
   * text, and item keys are stable, so late arrivals cannot disturb answered
   * work.
   */
  const [audited, setAudited] = useState<readonly CompiledSection[]>([])
  const [compiling, setCompiling] = useState<{ section: number; total: number } | undefined>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  /**
   * The in-flight chapter run, so the Cancel button can reach it.
   *
   * A ref rather than state: nothing renders off the controller itself — the
   * button's presence is driven by `busy` — so holding it in state would buy an
   * extra render per run and change nothing on screen.
   */
  const run = useRef<AbortController | undefined>(undefined)

  /**
   * Which phase owns the main region. Navigation no longer unmounts the app: the
   * sidebar is always there, so this is a view selector rather than the routing
   * by absence the old screen tree did.
   */
  const [phase, setPhase] = useState<PhaseId>('destination')
  const [destination, setDestination] = useState<Destination | undefined>()
  /** Chapters chosen but not yet prepared. Order is the book's, not the click order. */
  const [selected, setSelected] = useState<readonly ChapterOutline[]>([])
  /** One `CompiledChapter` per prepared chapter, kept apart so each keeps its identity. */
  const [prepared, setPrepared] = useState<readonly CompiledChapter[]>([])
  /** Browser-imported content, retained so the shell has one source-neutral selection. */
  const [imported, setImported] = useState<ImportResult | undefined>()
  /** The filename that was produced, once something has actually been committed. */
  const [committed, setCommitted] = useState<string | undefined>()
  /** What a Canvas push did, once one has run. Absent for the cartridge path. */
  const [push, setPush] = useState<PushReport | undefined>()
  const activeWebClient = useRef<WebBookClient | undefined>(undefined)

  const canvas = useCanvasConnection({
    store: credentials,
    createClient: (baseUrl, token) =>
      createDefaultCanvasClient(baseUrl, token, (ms) => {
        /*
         * §7's rule: surface a wait only when it is long enough to be worth a
         * sentence. Narrating every sub-five-second hiccup reads as a broken app,
         * and the backoff continues automatically either way.
         */
        if (ms >= 5000) setBusy(`Canvas is rate-limiting. Waiting ${Math.round(ms / 1000)} s, then continuing automatically.`)
      }),
  })

  /**
   * §2.4's page list, as the Plan screen and the push both need it. `undefined`
   * when nobody looked, and that is NOT the same as `[]` — see `buildPlan`.
   */
  const existingPages = canvas.pages

  /**
   * The chapter as far as it has been compiled. `chapter` whole, because that is
   * what a recompile reads — an answer rebuilds a section from its SOURCE, and
   * the source of a section that has not been audited yet is there already.
   */
  const partial: CompiledChapter | undefined =
    chapter && audited.length > 0
      ? { chapter, sections: [...audited], queue: mergeQueues(audited) }
      : undefined

  /*
    A latch, not a condition. Once the queue has opened it owns the screen until
    its own work is done: the answers live in it, and re-deriving "should the
    queue be showing?" from a queue that shrinks as it is answered would close it
    on the last answer and throw the session away mid-re-audit.
  */
  const opened = useRef(false)
  const [queue, setQueue] = useState<CompiledChapter | undefined>()
  useEffect(() => {
    if (opened.current || !partial || partial.queue.length === 0) return
    opened.current = true
    setBusy('')
    setQueue(partial)
  }, [partial])

  /**
   * Clear every value derived from a prepared source. Source acquisition state
   * is intentionally separate, so changing a book can replace its TOC without
   * ever leaving an old document's audited bytes available to Plan or export.
   */
  function clearDerivedOutput() {
    opened.current = false
    setChapter(undefined)
    setAudited([])
    setCompiling(undefined)
    setPrepared([])
    setQueue(undefined)
    setCommitted(undefined)
    setPush(undefined)
  }

  /** Compile and audit every source through one UI/state lifecycle. */
  async function compileForReview(
    ch: Chapter,
    profile: PublisherProfile,
    controller: AbortController,
    statusSuffix = '',
  ): Promise<CompiledChapter> {
    setChapter(ch)
    setCompiling({ section: 1, total: ch.sections.length })
    const { compileAndAuditChapter } = await import('./engine')
    return compileAndAuditChapter(ch, {
      profile,
      signal: controller.signal,
      onProgress: (progress) => {
        setCompiling(
          progress.phase === 'done'
            ? undefined
            : { section: progress.done + 1, total: progress.total },
        )
        const label = progressLabel(progress)
        // Silent once the queue owns the screen: its header names the active
        // section, so a second polite live region would repeat it.
        if (label !== undefined) setBusy(opened.current ? '' : `${label}${statusSuffix}`)
      },
      onSection: (section) => setAudited((all) => [...all, section]),
    })
  }

  async function pickBook(b: BookRef) {
    run.current?.abort()
    run.current = undefined
    clearDerivedOutput()
    setImported(undefined)
    setSelected([])
    setBusy(`Loading ${b.title}…`)
    setError('')
    try {
      if (b.source === 'openstax') {
        const fetchedToc = await openstaxClient.fetchToc(b.id)
        setToc(fetchedToc)
        setOutlines(flattenToc(fetchedToc.tree))
        activeWebClient.current = undefined
      } else {
        const adapter = webClients[b.source]
        if (!adapter) throw new Error(`${b.source} source is not configured`)
        const fetchedOutlines = await adapter.fetchOutlines(b)
        setToc(undefined)
        setOutlines(fetchedOutlines)
        activeWebClient.current = adapter
      }
      // Set only on success, so a failed load leaves the user on the source
      // browser with an error rather than on an empty chapter list.
      setBook(b)
    } catch (e) {
      setError(`Could not load ${b.title}. ${messageOf(e)}`)
    } finally {
      // ALWAYS: without this, any rejection leaves the status region stuck
      // reading "Loading …" forever, which is indistinguishable from a slow
      // network and is the only thing the user would ever see go wrong.
      setBusy('')
    }
  }

  /**
   * Return to the source browser without a refresh. A book is the owner of its
   * outlines, selected chapters, and any prepared output, so keeping any of
   * those around after changing books would let a later click prepare stale
   * content with the new source adapter.
   */
  function changeBook() {
    run.current?.abort()
    run.current = undefined
    activeWebClient.current = undefined
    clearDerivedOutput()
    setBook(undefined)
    setToc(undefined)
    setOutlines([])
    setSelected([])
    setImported(undefined)
    setBusy('')
    setError('')
    setPhase('chapters')
  }

  /**
   * Prepare every selected chapter, in the book's order.
   *
   * SEQUENTIAL, not concurrent, and that is not laziness. `createIframeRunner`
   * allocates one hidden frame and rewrites its document per section, so two
   * chapters auditing at once would be two runs sharing one document — the
   * second `doc.open()` would pull the DOM out from under the first one's axe
   * pass. It is also politer to the publisher's archive, which is the same
   * reason `fetchChapter` walks its sections in order.
   *
   * Sections accumulate across ALL chapters into one list, because the queue is
   * one queue across the whole selection: an image reused in four chapters is
   * one question, and the dedupe can only see that if the items share a queue.
   */
  async function prepareSelection() {
    if (selected.length === 0) return
    setPhase('review')
    // Fresh per run. Reusing one controller would mean a single cancel disabled
    // the feature for the rest of the session, since an aborted signal never
    // un-aborts.
    const controller = new AbortController()
    run.current = controller
    setError('')
    // The latch is per RUN, not per chapter: one queue spans the selection, so
    // reopening it between chapters would throw away answers mid-way through.
    clearDerivedOutput()

    const done: CompiledChapter[] = []
    try {
      for (const [index, outline] of selected.entries()) {
        const of = selected.length > 1 ? ` (${index + 1} of ${selected.length})` : ''
        setBusy(`Fetching ${outline.title}…${of}`)
        const ch = book!.source === 'openstax'
          ? await fetchChapter(openstaxClient, book!, outline, toc, controller.signal)
          : await activeWebClient.current!.fetchChapter(book!, outline, controller.signal)
        const compiled = await compileForReview(
          ch,
          publisherProfiles[ch.source],
          controller,
          of,
        )
        done.push(compiled)
        // Published per chapter rather than at the end, so a selection that
        // fails on chapter 4 still has 1-3 to show rather than nothing.
        setPrepared([...done])
      }
    } catch (e) {
      // A cancel is not announced. The user knows what they did, and the only
      // thing they need is to be back somewhere they can act.
      if (!isAbortError(e)) setError(`Could not prepare ${selected[done.length]?.title ?? 'the selection'}. ${messageOf(e)}`)
      // Everything the run produced goes with it, the open queue included. A
      // half-prepared selection left on screen would invite answers to sections
      // the rest of it will never be checked against.
      clearDerivedOutput()
      /*
       * And back to the phase that has something to act on. Clearing `chapter`
       * used to undo the navigation for free, because the picker was selected by
       * absence — `book && !chapter`. The shell routes explicitly, so it has to
       * be told explicitly, or the user lands on Prepare reading "Nothing to
       * prepare yet", which is a dead end wearing an empty state.
       */
      setPhase('chapters')
    } finally {
      setBusy('')
      setCompiling(undefined)
      run.current = undefined
    }
  }

  /**
   * Prepare a confirmed browser import through the same Chapter-level engine
   * seam as publisher content. Parsing and metadata stay above this boundary;
   * the compiler receives only the normalized Chapter.
   */
  async function prepareImportedContent(result: ImportResult) {
    const ch = toChapter(result.work)
    run.current?.abort()
    clearDerivedOutput()
    const controller = new AbortController()
    run.current = controller
    setImported(result)
    setBook(undefined)
    setToc(undefined)
    setOutlines([])
    setSelected([])
    setPhase('review')
    setError('')
    setBusy(`Preparing ${ch.title}…`)

    try {
      const compiled = await compileForReview(ch, publisherProfiles.document, controller)
      setPrepared([compiled])
    } catch (caught) {
      if (!isAbortError(caught)) setError(`Could not prepare ${ch.title}. ${messageOf(caught)}`)
      setImported(undefined)
      clearDerivedOutput()
      setPhase('chapters')
    } finally {
      setBusy('')
      setCompiling(undefined)
      run.current = undefined
    }
  }

  function clearImportedContent() {
    run.current?.abort()
    run.current = undefined
    clearDerivedOutput()
    setImported(undefined)
    setBusy('')
    setError('')
    setPhase('chapters')
  }

  async function commitCartridge() {
    setError('')
    setBusy('Building the cartridge…')
    try {
      const name = await downloadCartridge(prepared, new Date())
      setCommitted(name)
      setPhase('result')
    } catch (e) {
      setError(`Could not build the cartridge. ${messageOf(e)}`)
    } finally {
      setBusy('')
    }
  }

  /**
   * Push the prepared chapters into the chosen course.
   *
   * Resume is the same function. `runPush` reads the journal itself, so
   * "continue where it stopped" is not a second code path that could disagree
   * with the first one about what already landed.
   */
  async function commitPush() {
    if (!selfHostedCanvasOrigin || destination?.kind !== 'canvas' || !canvas.client) return
    const controller = new AbortController()
    run.current = controller
    setError('')
    try {
      const report = await runPush({
        client: canvas.client,
        courseId: destination.courseId,
        courseName: destination.courseName,
        chapters: prepared,
        journal: disk,
        ...(existingPages ? { existingPages } : {}),
        signal: controller.signal,
        onProgress: (p) => setBusy(`Pushing ${p.done + 1} of ${p.total}: ${p.title}…`),
      })
      setPush({
        ...report,
        courseName: destination.courseName,
        courseId: destination.courseId,
        courseBaseUrl: canvas.baseUrl ?? '',
      })
      // Committed even when the run stopped part-way, because it DID commit: the
      // pages that landed are in the course, and the Result screen is where that
      // is reported. Treating a partial run as "nothing happened" is the one
      // account of it that is certainly false.
      setCommitted(destination.courseName)
      setPhase('result')
    } catch (e) {
      setError(`Could not push to ${destination.courseName}. ${messageOf(e)}`)
    } finally {
      setBusy('')
      run.current = undefined
    }
  }

  /**
   * What the sidebar and the chips read off. Derived, never stored: a progress
   * model that can disagree with the work is worse than none, because it is
   * believed.
   */
  const shell: ShellState = {
    destination,
    selectedCount: imported ? 1 : selected.length,
    preparedCount: compiling ? prepared.length : prepared.length,
    unansweredCount: partial?.queue.length ?? 0,
    committed: committed !== undefined,
  }

  return (
    <AppShell
      active={phase}
      onNavigate={setPhase}
      shell={shell}
      status={busy}
      error={error}
      /*
       * Cancel is offered only while work is in flight, and it is the shell that
       * places it beside the status line it cancels. `busy` clearing when the
       * queue opens is deliberate and unchanged: the instructor has started
       * answering, and a cancel then would throw away answers to stop the very
       * run that is feeding them their next question.
       */
      onCancel={busy ? () => run.current?.abort() : undefined}
      selection={{
        items: imported
          ? [{ id: imported.work.id, title: imported.work.title, sectionCount: imported.work.sections.length }]
          : selected.map((o) => ({ id: o.id, title: o.title, sectionCount: o.sections.length })),
        onRemove: (id) => {
          if (imported?.work.id === id) clearImportedContent()
          else setSelected((sel) => sel.filter((s) => s.id !== id))
        },
        onClear: () => {
          if (imported) clearImportedContent()
          else setSelected([])
        },
      }}
    >
      {phase === 'destination' && (
        <DestinationScreen
          destination={destination}
          {...(selfHostedCanvasOrigin ? {
            canvas: {
              status: canvas.status,
              ...(canvas.error ? { error: canvas.error } : {}),
              ...(canvas.user ? { user: canvas.user } : {}),
              ...(canvas.courses ? { courses: canvas.courses } : {}),
              ...(canvas.selectedCourseId !== undefined
                ? { selectedCourseId: canvas.selectedCourseId }
                : {}),
              ...(canvas.pages ? { pages: canvas.pages } : {}),
              pagesError: canvas.pagesError,
              fixedAddress: selfHostedCanvasOrigin,
              onConnect: (address: string, token: string) => {
                void canvas.connect(address, token)
              },
              // Nothing to abort mid-connect beyond leaving the state alone: the
              // request is one `GET /users/self`, and a half-cancelled connection
              // that still resolved would be worse than waiting it out.
              onCancel: () => {},
              onPickCourse: (id: number) => { void canvas.pickCourse(id) },
              onRetryPages: () => { void canvas.retryPages() },
              onForget: () => { void canvas.forget() },
            },
          } : {})}
          onChoose={(d) => {
            if (d.kind === 'canvas' && !selfHostedCanvasOrigin) return
            setDestination(d)
            /*
              Canvas keeps the user HERE. Choosing a course is the middle of the
              destination decision, not the end of it — §2.4's page list appears
              underneath, and jumping away would hide the one thing this screen is
              ordered first to show. The cartridge has nothing more to say, so it
              moves on.
            */
            if (d.kind === 'cartridge') setPhase('chapters')
          }}
        />
      )}

      {phase === 'chapters' && !book && (
        <SourceBrowser
          onPick={(book) => { void pickBook(book) }}
          onImportText={(result) => { void prepareImportedContent(result) }}
          onImportDocx={(result) => { void prepareImportedContent(result) }}
        />
      )}
      {phase === 'chapters' && book && (
        <ChapterPicker
          outlines={outlines}
          selected={selected}
          onToggle={(o) => setSelected((sel) => toggle(sel, o, outlines))}
          onPrepare={prepareSelection}
          onChangeBook={changeBook}
        />
      )}

      {phase === 'review' && queue && (
        <QueueScreen
          initial={queue}
          incoming={audited}
          compiling={compiling}
          chapters={prepared}
          drafting={localVlmDrafting}
        />
      )}
      {/*
        §3.8. Nothing was ever queued, so the queue screen never renders at all
        and the chapter view is reached directly. While sections are still
        arriving the waiting state names them rather than claiming a clean
        chapter it cannot yet see the end of.
      */}
      {phase === 'review' && !queue && partial && compiling && (
        <p>{READY.waiting(compiling.section, compiling.total)}</p>
      )}
      {phase === 'review' && !queue && !compiling && prepared.length > 0 && (
        <>
          {prepared.map((c, i) => <ChapterHandoff key={c.chapter.title ?? i} compiled={c} answered={0} />)}
        </>
      )}
      {phase === 'review' && !partial && !compiling && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Nothing to prepare yet. Pick chapters first.
        </p>
      )}

      {phase === 'plan' && (
        <PlanScreen
          destination={destination}
          chapters={prepared}
          unansweredCount={partial?.queue.length ?? 0}
          {...(imported ? {
            assetCount: imported.work.assets.length,
            importFindings: imported.report.findings,
          } : {})}
          {...(existingPages ? { existingPages } : {})}
          /*
           * Offered only for a destination that can actually be produced. The
           * cartridge always can; Canvas can once there is a verified client
           * behind the chosen course. A button that runs and then apologises is
           * worse than one that never claimed it could.
           */
          onCommit={
            destination?.kind === 'cartridge'
              ? commitCartridge
              : selfHostedCanvasOrigin && canvas.client
                ? commitPush
                : undefined
          }
        />
      )}
      {phase === 'result' && (
        <ResultScreen
          filename={destination?.kind === 'cartridge' ? committed : undefined}
          chapters={prepared}
          {...(push ? { push } : {})}
          {...(selfHostedCanvasOrigin ? { onResume: commitPush } : {})}
          onDownloadAgain={destination?.kind === 'cartridge' ? commitCartridge : undefined}
        />
      )}
    </AppShell>
  )
}
