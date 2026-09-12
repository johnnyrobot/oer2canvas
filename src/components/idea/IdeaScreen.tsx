/**
 * The IDEA phase: one chapter at a time, eight category panels, the chapter's
 * own repaired HTML beside them, a header that carries what Rubric 1's header
 * carries (assessor, benchmark), the rubric's chapter-level Summary and
 * Suggestions, the export, and the forget control.
 *
 * THE CHAPTER IS ON THIS SCREEN. An instructor rating "Appropriate
 * Terminology" has to be reading the terminology; sending them back to Review
 * to look is how a review gets done from memory. `IdeaChapterRender` renders
 * exactly the bytes Review approved, no verdicts, and outlines the element a
 * focused finding is about.
 *
 * Findings are computed here, from the gated html, on every render of a new
 * chapter or edits map; they are never stored. The edits map is the record.
 *
 * One panel open at a time by default. Eight open panels of checklist radios
 * is a wall; one open panel with the other seven headers visible is a table of
 * contents. The instructor can always open the next one.
 *
 * Export is two plain buttons, not a menu: a `role="menu"` owes arrow-key and
 * Escape handling it would not get here, and two buttons need neither.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import type { CompiledChapter } from '../../contracts/index'
import { checkSection, findingsByCategory } from '../../engine/idea/findings'
import { newEdits, type IdeaEdits, type IdeaEditsEvent } from '../../engine/idea/edits'
import { appliedEdits } from '../../engine/idea/applied'
import { IdeaChapterRender } from './IdeaChapterRender'
import {
  FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK, RUBRIC_SUGGESTIONS_HINT, RUBRIC_SUMMARY_HINT, type CategoryId,
} from '../../engine/idea/framework'
import {
  newReview, type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent,
} from '../../engine/idea/review'
import { CategoryPanel } from './CategoryPanel'
import { IDEA_COPY } from './copy'
import { reviewKeyOf } from './useIdeaReviews'

const TARGET = 'min-h-9 min-w-9'
const FIELD =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const AREA =
  'rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const CARD =
  'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
const BUTTON =
  `${TARGET} inline-flex items-center gap-2 rounded-md border px-3 text-sm`
const PRIMARY = `${BUTTON} border-brand-700 bg-brand-700 text-white`
const QUIET = `${BUTTON} border-neutral-300 text-neutral-800 hover:bg-stone-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`

/** One shared empty, so a chapter with no edits keeps a stable identity across renders. */
const NO_EDITS = newEdits()

export function IdeaScreen({
  chapters, reviews, header, onEvent, onHeaderEvent, onForget, onExport, edits, onEditEvent, pending,
}: {
  chapters: readonly CompiledChapter[]
  reviews: ReadonlyMap<string, IdeaReview>
  header: IdeaHeader
  onEvent: (key: string, event: IdeaReviewEvent) => void
  onHeaderEvent: (event: IdeaHeaderEvent) => void
  onForget: () => void
  /** Produces the download and returns its filename, which the status line announces. */
  onExport: (key: string, format: 'md' | 'json') => string
  /** The IDEA edits per chapter key, beside the reviews. */
  edits: ReadonlyMap<string, IdeaEdits>
  onEditEvent: (key: string, event: IdeaEditsEvent) => void
  /** Section ids whose recompile is in flight; the render says so for them. */
  pending: ReadonlySet<string>
}) {
  const ids = useId()
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<CategoryId>('7.1')
  const [status, setStatus] = useState('')
  const [confirmForget, setConfirmForget] = useState(false)
  /** The element a focused finding is about, outlined in the render. */
  const [focus, setFocus] = useState<{ sectionId: string; elementId: string } | undefined>()
  // The benchmark field holds its own text so it can be emptied to retype;
  // only a finite number is dispatched, and blur restores the stored value.
  const [benchText, setBenchText] = useState(String(header.benchmark.bipocPercent))
  const forgetButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setBenchText(String(header.benchmark.bipocPercent))
  }, [header.benchmark.bipocPercent])

  // A shorter selection after a re-prepare must not leave the index pointing
  // past the end.
  useEffect(() => {
    if (index >= chapters.length) setIndex(0)
  }, [chapters.length, index])

  if (chapters.length === 0) {
    return <p className="text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.empty}</p>
  }

  // In range by construction: the list is non-empty here and the index is clamped.
  const current = chapters[Math.min(index, chapters.length - 1)]!
  const key = reviewKeyOf(current.chapter)
  const review = reviews.get(key) ?? newReview()
  const dispatch = (event: IdeaReviewEvent) => onEvent(key, event)

  const chapterEdits = edits.get(key) ?? NO_EDITS
  const checked = useMemo(() => {
    const results = current.sections.map((s) => checkSection({ id: s.id, html: s.gate?.html ?? s.html }, chapterEdits))
    return { findings: results.flatMap((r) => r.findings), failures: results.flatMap((r) => r.failures) }
  }, [current, chapterEdits])
  const byCategory = findingsByCategory(checked.findings)
  const sectionTitleOf = (id: string) => current.sections.find((s) => s.id === id)?.title ?? ''
  // Against the same html the render shows, so "stale" means what the reader sees.
  const applied = useMemo(
    () => appliedEdits(current.sections.map((s) => ({ id: s.id, title: s.title, html: s.gate?.html ?? s.html })), chapterEdits),
    [current, chapterEdits],
  )

  /**
   * Spec §5.3: Applied / Undone announced through the live region. A dismissal
   * too — the row disappears, and a screen-reader user should hear why.
   */
  const ANNOUNCE: Record<IdeaEditsEvent['type'], string> = {
    replace: IDEA_COPY.applied.announceApplied,
    keep: IDEA_COPY.applied.announceApplied,
    undo: IDEA_COPY.applied.announceUndone,
    dismiss: IDEA_COPY.applied.announceDismissed,
  }
  const editEvent = (event: IdeaEditsEvent) => {
    onEditEvent(key, event)
    setStatus(ANNOUNCE[event.type])
  }

  const exportAs = (format: 'md' | 'json') => {
    const name = onExport(key, format)
    setStatus(IDEA_COPY.export.done(name))
  }

  const onBenchmarkChange = (text: string) => {
    setBenchText(text)
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) onHeaderEvent({ type: 'benchmark', bipocPercent: n })
  }

  const forget = () => {
    onForget()
    setConfirmForget(false)
    setStatus(IDEA_COPY.forget.done)
    forgetButton.current?.focus()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.intro}</p>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <div className={CARD}>
            <div className="flex flex-wrap items-end gap-3">
              {chapters.length > 1 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold">{IDEA_COPY.chapterSwitcher}</span>
                  <select
                    className={`${FIELD} ${TARGET}`}
                    value={index}
                    onChange={(e) => setIndex(Number(e.target.value))}
                  >
                    {chapters.map((c, i) => (
                      <option key={reviewKeyOf(c.chapter)} value={i}>{c.chapter.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {chapters.length === 1 && (
                <p className="m-0 text-sm"><span className="font-semibold">{IDEA_COPY.chapterSwitcher}:</span> {current.chapter.title}</p>
              )}

              <div role="group" aria-label={IDEA_COPY.export.legend} className="ml-auto flex flex-wrap gap-2">
                <button type="button" onClick={() => exportAs('md')} className={PRIMARY}>
                  <Download className="size-4" aria-hidden="true" />
                  {IDEA_COPY.export.markdown}
                </button>
                <button type="button" onClick={() => exportAs('json')} className={PRIMARY}>
                  <Download className="size-4" aria-hidden="true" />
                  {IDEA_COPY.export.json}
                </button>
              </div>
            </div>

            <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold">{IDEA_COPY.assessor.legend}</legend>
              <p className="m-0 w-full text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.assessor.hint}</p>
              {(['name', 'title', 'college'] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span>{IDEA_COPY.assessor[field]}</span>
                  <input
                    type="text"
                    className={`${FIELD} ${TARGET}`}
                    value={header.assessor[field]}
                    onChange={(e) => onHeaderEvent({ type: 'assessor', assessor: { [field]: e.target.value } })}
                  />
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-bench`} className="text-sm font-semibold">{IDEA_COPY.benchmark.label}</label>
              <div className="flex items-center gap-2">
                <input
                  id={`${ids}-bench`}
                  type="number"
                  min={0}
                  max={100}
                  className={`${FIELD} ${TARGET} w-24`}
                  value={benchText}
                  onChange={(e) => onBenchmarkChange(e.target.value)}
                  onBlur={() => setBenchText(String(header.benchmark.bipocPercent))}
                />
                <span className="text-sm">%</span>
              </div>
              <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.benchmark.hint}</p>
            </div>

            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.storage}</p>
            {/*
              The button stays mounted while the confirmation shows, so focus
              has somewhere to return to after Forget or Keep, and so the
              disclosure reads as one: aria-expanded on the trigger, the
              question beneath it.
            */}
            <div>
              <button
                ref={forgetButton}
                type="button"
                aria-expanded={confirmForget}
                aria-controls={`${ids}-forget`}
                onClick={() => setConfirmForget((c) => !c)}
                className={QUIET}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {IDEA_COPY.forget.button}
              </button>
            </div>
            {confirmForget && (
              <div id={`${ids}-forget`} role="group" aria-label={IDEA_COPY.forget.button} className="flex flex-col gap-2">
                <p className="m-0 text-sm">{IDEA_COPY.forget.confirm}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={forget} className={QUIET}>{IDEA_COPY.forget.yes}</button>
                  <button type="button" onClick={() => { setConfirmForget(false); forgetButton.current?.focus() }} className={PRIMARY}>{IDEA_COPY.forget.no}</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {IDEA_FRAMEWORK.map((category) => (
              <CategoryPanel
                key={`${key}:${category.id}`}
                category={category}
                review={review.categories[category.id]}
                open={open === category.id}
                onToggle={() => setOpen((o) => (o === category.id ? o : category.id))}
                onEvent={dispatch}
                findings={byCategory.get(category.id) ?? []}
                failures={checked.failures
                  .filter((f) => f.category === category.id)
                  .map((f) => ({ sectionTitle: sectionTitleOf(f.sectionId), message: f.message }))}
                applied={applied.filter((a) => a.category === category.id)}
                sectionTitleOf={sectionTitleOf}
                onEditEvent={editEvent}
                onFocusFinding={setFocus}
              />
            ))}
          </div>

          <fieldset className={`${CARD} m-0`}>
            <legend className="text-sm font-semibold">{IDEA_COPY.chapterLevel.legend}</legend>
            <label htmlFor={`${ids}-summary`} className="text-sm font-semibold">{IDEA_COPY.chapterLevel.summary}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{RUBRIC_SUMMARY_HINT}</p>
            <textarea
              id={`${ids}-summary`}
              rows={3}
              className={AREA}
              value={review.summary}
              onChange={(e) => dispatch({ type: 'summary', text: e.target.value })}
            />
            <label htmlFor={`${ids}-suggestions`} className="text-sm font-semibold">{IDEA_COPY.chapterLevel.suggestions}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{RUBRIC_SUGGESTIONS_HINT}</p>
            <textarea
              id={`${ids}-suggestions`}
              rows={3}
              className={AREA}
              value={review.suggestions}
              onChange={(e) => dispatch({ type: 'suggestions', text: e.target.value })}
            />
          </fieldset>

          <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
            {IDEA_COPY.attribution(FRAMEWORK_ATTRIBUTION.title, FRAMEWORK_ATTRIBUTION.author, FRAMEWORK_ATTRIBUTION.license.name)}{' '}
            <a href={FRAMEWORK_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="underline">
              asccc-oeri.org<span className="sr-only"> ({IDEA_COPY.opensNewTab})</span>
            </a>
          </p>
        </div>

        {/*
          Sticky on wide screens so the text stays in view while the panels
          scroll; a plain block below the panels on narrow ones. The region has
          its own scroll so a long chapter does not push the panels off screen.
        */}
        <aside
          aria-label={IDEA_COPY.renderLabel}
          className={`${CARD} min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}
        >
          <IdeaChapterRender compiled={current} target={focus} pending={pending} />
        </aside>
      </div>

      {/* Mounted empty rather than conditionally, so the announcement lands in a region that already exists. */}
      <p role="status" aria-live="polite" className="m-0 text-sm">{status}</p>
    </div>
  )
}
