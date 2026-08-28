/**
 * The queue screen: regions A–F, in DOM order.
 *
 * DOM ORDER IS READING ORDER IS FOCUS ORDER, and nothing below may be moved for
 * layout. The narrow variant pins the control cluster to the bottom of the
 * viewport by position, never by relocating it in the markup (§7, §8) — that is
 * what keeps those three orders from coming apart.
 *
 * Region A status header · B the two live regions · C the current card ·
 * D the jump list · E the section render · F the answered list.
 */
import './queue.css'
import { CanvasShellStyles } from '../CanvasShellStyles'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CompiledSection, QueueItem } from '../../contracts/index'
import type { QueueAnswer } from '../../engine/compile/answers'
import type { VlmModel, VlmProgress } from '../../engine/vlm'
import { queueKeyOf } from '../../engine/compile/answers'
import { usePackagedAssetUrls } from '../usePackagedAssetUrls'
import { QueueCard } from './QueueCard'
import { counts, traversal, KIND_WORD, type QueueSession } from './session'

const ANSWER_WORD: Record<QueueAnswer['type'], string> = {
  decorative: 'confirmed decorative',
  alt: 'described',
  'table-headers': 'headers set',
}

/**
 * The outline on the element being asked about. Geometry, never colour (§8),
 * and it must stay separable from the focus ring — one says "this is the thing
 * you are judging", the other "this is what your keystroke will hit".
 */
const HIGHLIGHT = 'b2c-queue-target'

const CHOICE_WORD: Record<string, string> = {
  row: 'first row',
  column: 'first column',
  both: 'first row and column',
  presentation: 'layout table',
}

export interface QueueViewProps {
  session: QueueSession
  /**
   * Compile has not finished. `section` is 1-based — the section being worked
   * on, not the count completed — because that is what the copy quotes.
   * `CompileProgress.done` is 0-based, so the caller adds one.
   */
  compiling?: { section: number; total: number }
  onAnswer?: (key: string, answer: QueueAnswer) => void
  onSkip?: (key: string) => void
  onRevisit?: (key: string) => void
  onJump?: (key: string) => void
  drafting?: {
    models: readonly VlmModel[]
    draft: (
      model: VlmModel,
      image: string,
      onProgress: (progress: VlmProgress) => void,
      signal: AbortSignal,
    ) => Promise<string>
  }
}

export function QueueView({
  session,
  compiling,
  onAnswer,
  onSkip,
  onRevisit,
  onJump,
  drafting,
}: QueueViewProps) {
  // Lifted here, once, rather than called separately inside `QueueCard` and
  // `SectionRender`: both need the same resolver (the card's "open the
  // original image" link and its local-draft seam; the render's mounted
  // html), and calling the hook twice for one session would mint two
  // independent object-url lifecycles over the same bytes for no benefit.
  // Display-only, per `usePackagedAssetUrls`'s own contract — nothing here
  // ever writes back into `session.compiled` or `section.gate.html`.
  const resolve = usePackagedAssetUrls(session.compiled.chapter.assets)
  const tally = counts(session)
  const byKey = new Map(session.compiled.queue.map((i) => [queueKeyOf(i), i]))
  const order = traversal(session.compiled.queue, session.skipped).filter(
    (k) => !session.answers.has(k),
  )
  const current = session.cursor ? byKey.get(session.cursor) : undefined
  const sectionOf = (id: string) => session.compiled.sections.find((s) => s.id === id)
  const failed = session.compiled.sections.filter((s) => s.error)

  /*
    Mounted empty, filled on the next tick, and that ordering is the whole
    reason the regions below are unconditional. A live region that already has
    content when it is INSERTED is not announced — so the entry line §3.1 owes
    the instructor ("Review queue. 25 items: …") would be silently lost if it
    were simply rendered. One state flip after mount is what makes the first
    announcement a change rather than an initial value.
  */
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])

  /*
    How much room the pinned control cluster needs, published to CSS.

    At narrow widths the cluster is `position: fixed` and therefore out of flow,
    so the page has to reserve its height or the cluster sits on top of the
    render — on the table card, which has five controls and wraps to three rows,
    that is most of a phone screen of evidence covered by the buttons that
    answer it. A constant would have to be guessed against the widest cluster at
    the narrowest width with the longest wrapped label, and a guess that is
    slightly wrong fails silently and only on somebody's phone. This measures.
  */
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = root.current
    const controls = el?.querySelector('.b2c-queue-card .b2c-queue-controls')
    if (!el || !controls) return
    const publish = (target: Element) => {
      el.style.setProperty('--b2c-cluster-height', `${target.getBoundingClientRect().height}px`)
    }
    // Once now, because a ResizeObserver does not report until the next frame
    // and the first of those frames is the one the instructor arrives on.
    publish(controls)
    // Absent in jsdom, where there is no layout to observe and the measurement
    // above is zeroes anyway — the CSS fallback covers both.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => publish(entry!.target))
    observer.observe(controls)
    return () => observer.disconnect()
    // The card remounts per item and the table card is a different shape, so
    // this has to re-attach when the cursor moves.
  }, [session.cursor])

  /*
    D and S, and NOTHING ELSE — Enter is never bound here (§3.2). Every action
    on this screen is reachable by Tab plus Enter or Space with no custom key at
    all; these two are a redundant speed layer, printed on the controls
    themselves, so there is nothing to memorise and nothing to discover. Binding
    Enter globally is what would force a modal cheat sheet and break the alt
    form's native submit (D5.9).

    Held on the root rather than on `document`, so a key press only ever counts
    while focus is somewhere on this screen.
  */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!current || !session.cursor) return
    // Typing "d" must type. The one accelerator trade-off the design accepts,
    // and the reason it is a guard and not a comment: the next person to add a
    // shortcut inherits it for free.
    if (isTextEntry(e.target)) return
    // A modified key is somebody's browser or OS shortcut, never ours.
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 's') {
      e.preventDefault()
      onSkip?.(session.cursor)
    } else if (key === 'd' && current.kind !== 'table-headers') {
      // A table has no decorative answer to give, so D means nothing there and
      // must do nothing rather than something adjacent.
      e.preventDefault()
      onAnswer?.(session.cursor, { type: 'decorative' })
    }
  }

  return (
    <section className="b2c-queue" ref={root} onKeyDown={onKeyDown}>
      {/* Region E is publisher content and must look like what was audited, not
          like this app. Without this the instructor answers "is the contrast on
          this element acceptable?" against the app's typeface and the user
          agent's link blue, while the gate measured Canvas's. See
          `CanvasShellStyles`. Carries no region letter: it renders nothing. */}
      <CanvasShellStyles />

      {/* --- Region A: the status header. One line of plain text. No bar, no
          icon, no colour coding — this line IS the progress indicator, and a
          second one would be two counters disagreeing about what done means. */}
      <p className="b2c-queue-header">{headerLine(session, tally, compiling)}</p>

      {/* --- Region B: both live regions, MOUNTED EMPTY AT FIRST RENDER.
          A region inserted when it gains content is announced unreliably, which
          is the pattern App.tsx already documents. Never make these
          conditional. */}
      <p role="status" aria-live="polite" className="b2c-sr-only">
        {live ? (session.announcement ?? '') : ''}
      </p>
      <p role="alert" className="b2c-sr-only">
        {session.refusal ?? ''}
      </p>

      {/* --- Region C: the current card. One exists at a time; on accept it
          vanishes rather than greying out (§6). */}
      {current && (
        <QueueCard
          key={session.cursor}
          item={current}
          position={tally.answered + 1}
          total={tally.total}
          occurrences={occurrencesOf(session, current)}
          resolve={resolve}
          skippedEarlier={session.skipped.has(session.cursor!)}
          refusal={session.refusal}
          onAnswer={(answer) => onAnswer?.(session.cursor!, answer)}
          onSkip={() => onSkip?.(session.cursor!)}
          {...(drafting ? { drafting } : {})}
        />
      )}

      {/* --- Region D: the jump list. It stays even when it is down to nothing
          to offer — the user just watched it shrink, and a control that
          vanishes reads as a bug (§3b). */}
      <details className="b2c-queue-jump">
        <summary>Jump to an item — {Math.max(order.length - 1, 0)} remaining</summary>
        {order.length <= 1 ? (
          <p>No other items remain.</p>
        ) : (
          <ul>
            {order.map((key, index) =>
              key === session.cursor ? null : (
                <li key={key}>
                  <button type="button" onClick={() => onJump?.(key)}>
                    Item {tally.answered + 1 + index} of {tally.total} — {KIND_WORD[byKey.get(key)!.kind]}
                    {session.skipped.has(key) ? ', skipped' : ''} ·{' '}
                    {snippet(byKey.get(key)!)} · {sectionOf(byKey.get(key)!.sectionId)?.title}
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </details>

      {/* --- A failed section is a statement, never a hole (§3.7). It sits
          between the card and the render because that is where the render it
          replaces would have been. */}
      {failed.map((s) => (
        <div key={s.id} className="b2c-queue-failed">
          <p>
            <strong>Section {s.title} could not be processed.</strong>
          </p>
          <p>
            <em>{s.error}</em>
          </p>
          <p>
            The chapter cannot be published while a section is missing. Items from other sections
            are still below.
          </p>
        </div>
      ))}

      {/* --- Region E: exactly one section, the current item's. */}
      {current && (
        <SectionRender
          session={session}
          section={sectionOf(current.sectionId)}
          elementId={current.elementId}
          resolve={resolve}
        />
      )}

      {/* --- Region F: the answered list. Absent until the first answer —
          absence is a clean signal, an empty collapsed box is furniture. After
          the render, not before: undo is a deliberate act and burying it
          slightly is the point, but it must exist, because a mis-hit D ships an
          unreadable image that no gate can catch. */}
      {tally.answered > 0 && (
        <details className="b2c-queue-answered">
          <summary>Answered — {tally.answered}</summary>
          <ul>
            {[...session.answers].map(([key, answer]) => (
              <li key={key}>
                {describeAnswer(answer)}
                {session.notes.get(key) ? ` · note: ${stripNotePrefix(session.notes.get(key)!)}` : ''}{' '}
                <button type="button" onClick={() => onRevisit?.(key)}>
                  Revisit
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

/**
 * Where a keystroke is text rather than a command.
 *
 * `isContentEditable` is in here alongside the form controls because publisher
 * html is rendered on this screen, and an editable region arriving in somebody
 * else's markup would otherwise swallow the letter D as an answer.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * The current item's section, as published bytes, with its element outlined.
 *
 * `gate.html` when the section has a verdict, the session's stand-in while a
 * re-audit is pending (D5.5). NEVER `section.html`, which is compiled but not
 * allowlist-repaired — the same rule, and the same reason, as `ChapterView`.
 */
function SectionRender({
  session,
  section,
  elementId,
  resolve,
}: {
  session: QueueSession
  section: CompiledSection | undefined
  elementId: string
  /**
   * Display-only resolution of `$IMS-CC-FILEBASE$/oer2canvas/…` tokens to
   * `blob:` urls — the same treatment `ChapterView` and `ImportPlanEditor`
   * already give their previews, and for the same reason: a browser can never
   * resolve the token itself, only Canvas can, at cartridge import time. The
   * instructor answering the alt-text prompt here is looking at exactly the
   * image the prompt is about; without this, every DOCX-sourced image (the
   * ordinary case, since DOCX carries no alt-text field and so lands its
   * images in this queue as kind `alt`) would render as a broken image while
   * asking the instructor to describe it. Taken as a prop, computed once by
   * `QueueView`, rather than called again here — see the call site's comment.
   */
  resolve: (html: string) => string
}) {
  const body = useRef<HTMLDivElement>(null)
  const html = section
    ? section.gate
      ? section.gate.html
      : session.displayHtml.get(section.id)
    : undefined

  /*
    Memoized on the html STRING, and that is load-bearing rather than tidy.
    React re-applies `dangerouslySetInnerHTML` whenever the prop object's
    identity changes, so a fresh `{ __html }` literal each render reassigns
    innerHTML even when the bytes are identical — which throws away the parsed
    subtree, resets scroll, and flashes the evidence somebody is reading. Two
    consecutive items in one section must move the outline and touch nothing
    else, and there is a test asserting the nodes survive. `resolve` is in the
    deps for correctness (it is what turns `html` into what actually gets
    mounted) but never destabilizes this memo in practice: it is a `useCallback`
    closed only over `usePackagedAssetUrls`'s own `urls` state, which changes
    only when this chapter's asset list actually changes, not on every render.
    `html` itself is NEVER mutated by this — `resolve` is applied only to the
    value handed to `dangerouslySetInnerHTML`, so `section.gate.html` remains
    exactly the bytes that passed the gate and that the exporter will ship.
  */
  const markup = useMemo(
    () => (html === undefined ? undefined : { __html: resolve(html) }),
    [html, resolve],
  )

  useLayoutEffect(() => {
    const root = body.current
    if (!root) return
    const target = root.querySelector(`#${CSS.escape(elementId)}`)
    // An id that resolves to nothing is not a crash and not a hole: the card
    // above already carries the question, the reference sentence and the
    // occurrence list as text, so the screen still says everything it knows.
    if (!target) return
    target.classList.add(HIGHLIGHT)
    // Instant, with no `behavior`. Motion near the point of focus is a
    // vestibular and attention hazard bought for zero information (§6).
    target.scrollIntoView({ block: 'center' })
    return () => target.classList.remove(HIGHLIGHT)
    // `html` is a dependency because a re-audit landing replaces these bytes
    // wholesale, taking the class with them — the outline has to be put back.
  }, [elementId, html])

  if (!section || markup === undefined) return null
  return (
    <article className="b2c-queue-render">
      <h3>{section.title}</h3>
      {/*
        Safe for the reason `ChapterView`'s own comment gives: these bytes are
        allowlist-REPAIRED. `validateAllowlist` keeps no `on*` handler attribute
        and drops `<script>` subtrees entirely, so the two things innerHTML
        would otherwise wire up are already gone.
      */}
      <div className="b2c-section-body" ref={body} dangerouslySetInnerHTML={markup} />
    </article>
  )
}

/**
 * Region A's one line, in the four shapes §3 gives it.
 *
 * Precedence is compile, then re-audit, then the skipped tail, then the plain
 * lock sentence. Compile wins because "6 remain" is not yet true while sections
 * are still arriving, and a count that is about to change must say so.
 */
function headerLine(
  session: QueueSession,
  tally: ReturnType<typeof counts>,
  compiling: QueueViewProps['compiling'],
): string {
  const skippedClause = tally.skipped > 0 ? ` · ${tally.skipped} skipped` : ''

  if (compiling) {
    return (
      `${tally.answered} answered · ${tally.remaining} remain so far${skippedClause} — ` +
      `compiling and checking section ${compiling.section} of ${compiling.total}. ` +
      'New items may join the queue.'
    )
  }

  const head = `${tally.answered} answered · ${tally.remaining} remain${skippedClause}`

  if (session.dirty.size > 0) {
    const first = session.compiled.sections.findIndex((s) => session.dirty.has(s.id))
    const where = `re-checking section ${first + 1} of ${session.compiled.sections.length}`
    return tally.remaining === 0 && tally.skipped === 0
      ? `${head} — ${where}. Publishing unlocks when the check finishes.`
      : `${head} — ${where}`
  }

  // No celebration when the non-skipped work ends. That moment is the maximum
  // risk of abandonment; the counts are the signal and the screen's job is to be
  // unremarkable and immovable.
  if (tally.remaining === 0 && tally.skipped > 0) {
    return `${head} — publishing stays locked until the ${tally.skipped} skipped are answered`
  }
  return `${head} — publishing stays locked until 0 remain`
}

/** Section titles this item's answer will reach. One or none says nothing. */
function occurrencesOf(session: QueueSession, item: QueueItem): string[] | undefined {
  if (!item.hash) return undefined
  const key = queueKeyOf(item)
  return session.compiled.sections
    .filter((s) => s.queue.some((i) => queueKeyOf(i) === key))
    .map((s) => s.title)
}

function snippet(item: QueueItem): string {
  return item.context.reference ?? item.context.caption ?? item.elementId
}

function describeAnswer(answer: QueueAnswer): string {
  if (answer.type === 'alt') return `${ANSWER_WORD.alt} — “${answer.text}”`
  if (answer.type === 'table-headers') {
    return `${ANSWER_WORD['table-headers']} — ${CHOICE_WORD[answer.choice]}`
  }
  return ANSWER_WORD.decorative
}

/** The answered list already says an answer was saved; the prefix repeats it. */
function stripNotePrefix(note: string): string {
  return note.replace(/^Saved, with a note:\s*/, '')
}
