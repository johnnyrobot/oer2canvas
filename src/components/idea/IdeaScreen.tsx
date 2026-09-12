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
 *
 * Slice 5: the image search opens under 7.1 and the placement dialog under
 * it. The screen builds the placement options from the section the finding
 * came from (or the first section, from the Find button) and hands the
 * choice to App's `onAddImage`; the fetch, the asset, and the edit are
 * App's, because the chapter's asset list is.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { auditedHtml, type CompiledChapter, type CompiledSection } from '../../contracts/index'
import { checkSection, findingsByCategory, type FindingTarget } from '../../engine/idea/findings'
import { newEdits, type IdeaEdits, type IdeaEditsEvent, type ImagePlacement } from '../../engine/idea/edits'
import type { ImageHit, ImageSearch as ImageSearchPort } from '../../engine/idea/images/search'
import { blockElements } from '../../engine/idea/text'
import { appliedEdits } from '../../engine/idea/applied'
import { IdeaChapterRender } from './IdeaChapterRender'
import {
  FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK, RUBRIC_SUGGESTIONS_HINT, RUBRIC_SUMMARY_HINT, type CategoryId,
} from '../../engine/idea/framework'
import {
  newReview, type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent,
} from '../../engine/idea/review'
import { imageInventory } from '../../engine/idea/images'
import { metadataInventory } from '../../engine/idea/metadata'
import { providerById } from '../../engine/idea/llm/providers'
import type { LlmSettings } from '../../engine/idea/llm/settings'
import { DRAFTABLE, sectionText, type DraftableCategory, type SectionInput } from '../../engine/idea/llm/prompts'
import type { RubricDraft } from '../../engine/idea/llm/parse'
import type { IdeaFinding } from '../../engine/idea/findings'
import { CategoryPanel } from './CategoryPanel'
import { RunFailure } from './AskModel'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { ImageSearch } from './ImageSearch'
import { PlaceImageDialog, type PlacementOption } from './PlaceImageDialog'
import type { AddImageRequest } from './useAddImage'
import { rubricRunKey, runKey, type RunState } from './useModelRuns'
import { IDEA_COPY } from './copy'
import { categoryById } from '../../engine/idea/framework'
import { reviewKeyOf } from './useIdeaReviews'
import { FIELD, TARGET } from './styles'

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
const NO_SECTIONS: readonly CompiledSection[] = []
const IDLE: RunState = { status: 'idle' }

/**
 * Slice 4: the model settings and runs, owned by App (`useLlmSettings`,
 * `useModelRuns`) and handed down whole. The screen never calls the model on
 * its own; every run starts in a click handler below.
 */
export interface IdeaLlmProps {
  settings: LlmSettings | undefined
  onSave: (s: LlmSettings) => void
  onForget: () => void
  runs: ReadonlyMap<string, RunState>
  rubricDrafts: ReadonlyMap<string, RubricDraft>
  runCategory: (chapterKey: string, category: DraftableCategory, input: SectionInput, html: string) => void
  runRubric: (chapterKey: string, chapterTitle: string, sections: SectionInput[]) => void
  cancel: (key: string) => void
}

/**
 * One category's state across the chapter's sections. Running if any section
 * is; failed if any failed and none is running; done once every section that
 * ran is done. The button and the status line describe the category, not
 * the first section.
 */
function categoryRunState(states: readonly RunState[]): RunState {
  const running = states.find((r): r is Extract<RunState, { status: 'running' }> => r.status === 'running')
  if (running) return running
  const failed = states.find((r): r is Extract<RunState, { status: 'failed' }> => r.status === 'failed')
  if (failed) return failed
  const done = states.filter((r): r is Extract<RunState, { status: 'done' }> => r.status === 'done')
  if (done.length > 0) return { status: 'done', findings: done.flatMap((d) => d.findings), at: Math.max(...done.map((d) => d.at)) }
  return IDLE
}

/**
 * Slice 5: adding an image, owned by App (`useAddImage`) because the bytes
 * land in the chapter's asset list, which App owns.
 */
export interface IdeaImageProps {
  /** Resolves true when the image was added; false when `error` says why not. */
  add: (request: AddImageRequest) => Promise<boolean>
  busy: boolean
  error: string
  /** Test seam; production uses the search hook's default providers. */
  providers?: readonly ImageSearchPort[]
}

export function IdeaScreen({
  chapters, reviews, header, onEvent, onHeaderEvent, onForget, onExport, edits, onEditEvent, pending, llm, image,
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
  llm: IdeaLlmProps
  image: IdeaImageProps
}) {
  const ids = useId()
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<CategoryId>('7.1')
  const [status, setStatus] = useState('')
  const [confirmForget, setConfirmForget] = useState(false)
  /** The element a focused finding is about, outlined in the render. */
  const [focus, setFocus] = useState<FindingTarget | undefined>()
  // The benchmark field holds its own text so it can be emptied to retype;
  // only a finite number is dispatched, and blur restores the stored value.
  const [benchText, setBenchText] = useState(String(header.benchmark.bipocPercent))
  const forgetButton = useRef<HTMLButtonElement>(null)
  /** The image search under 7.1, seeded from the row or the button that opened it. */
  const [imageSearch, setImageSearch] = useState<{ query: string; sectionId: string } | undefined>()
  /** The hit whose placement is being decided. */
  const [placing, setPlacing] = useState<ImageHit | undefined>()

  useEffect(() => {
    setBenchText(String(header.benchmark.bipocPercent))
  }, [header.benchmark.bipocPercent])

  // A shorter selection after a re-prepare must not leave the index pointing
  // past the end.
  useEffect(() => {
    if (index >= chapters.length) setIndex(0)
  }, [chapters.length, index])

  // Undefined only when the selection is empty. Every hook below runs before
  // that case returns, so a chapter list that goes 0 → n while this screen is
  // mounted does not change the hook order (Rules of Hooks).
  const current: CompiledChapter | undefined = chapters[Math.min(index, chapters.length - 1)]
  const key = current ? reviewKeyOf(current.chapter) : ''
  const sections = current?.sections ?? NO_SECTIONS
  const review = reviews.get(key) ?? newReview()
  const dispatch = (event: IdeaReviewEvent) => onEvent(key, event)

  const chapterEdits = edits.get(key) ?? NO_EDITS
  // `auditedHtml`: the gated bytes, or the compiled bytes while a recompile's
  // gate is still absent. Block ids are minted at compile and `id` is a
  // global allowlist attribute, so a finding keyed before the gate returns
  // names the same element after it.
  const checked = useMemo(() => {
    const results = sections.map((s) => checkSection({ id: s.id, html: auditedHtml(s) }, chapterEdits))
    return { findings: results.flatMap((r) => r.findings), failures: results.flatMap((r) => r.failures) }
  }, [sections, chapterEdits])
  const byCategory = findingsByCategory(checked.findings)
  const sectionTitleOf = (id: string) => sections.find((s) => s.id === id)?.title ?? ''
  // Against the same html the render shows, so "stale" means what the reader sees.
  const applied = useMemo(
    () => appliedEdits(sections.map((s) => ({ id: s.id, title: s.title, html: auditedHtml(s) })), chapterEdits),
    [sections, chapterEdits],
  )

  /**
   * What a model run is given: block text, the image inventory, the metadata
   * inventory — from the same gated html the render shows. Built here, sent
   * only when a button below is pressed.
   */
  const inputs = useMemo<SectionInput[]>(
    () => sections.map((s) => {
      const html = auditedHtml(s)
      return {
        sectionId: s.id, sectionTitle: s.title, chapterTitle: current?.chapter.title ?? '',
        bookTitle: current?.chapter.attribution.bookTitle ?? '',
        text: sectionText(html), images: imageInventory(s.id, html), metadata: metadataInventory(s.id, html),
      }
    }),
    [sections, current],
  )

  if (!current) {
    return <p className="text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.empty}</p>
  }
  const provider = llm.settings ? providerById(llm.settings.provider) : undefined
  const firstRun = ![...llm.runs.values()].some((r) => r.status === 'done' || r.status === 'failed')
  const rubricRun = llm.runs.get(rubricRunKey(key)) ?? IDLE
  const rubricDraft = llm.rubricDrafts.get(key)
  const askModelFor = (category: DraftableCategory) => {
    const keys = current.sections.map((s) => runKey(key, s.id, category))
    const state = categoryRunState(keys.map((k) => llm.runs.get(k) ?? IDLE))
    const draftFindings: IdeaFinding[] = state.status === 'done'
      ? state.findings.filter((f) => !chapterEdits.edits.has(f.key) && !chapterEdits.dismissed.has(f.key))
      : []
    return {
      askModel: {
        provider, state, firstRun,
        // One request per section, each behind its own in-flight guard.
        onSend: () => current.sections.forEach((s, i) => llm.runCategory(key, category, inputs[i]!, auditedHtml(s))),
        onCancel: () => keys.forEach((k) => llm.cancel(k)),
      },
      draftFindings,
    }
  }
  const isDraftable = (id: CategoryId): id is DraftableCategory => (DRAFTABLE as readonly string[]).includes(id)

  /**
   * Spec §5.3: Applied / Undone announced through the live region. A dismissal
   * too — the row disappears, and a screen-reader user should hear why.
   */
  const ANNOUNCE: Record<IdeaEditsEvent['type'], string> = {
    replace: IDEA_COPY.applied.announceApplied,
    keep: IDEA_COPY.applied.announceApplied,
    image: IDEA_COPY.applied.announceApplied,
    undo: IDEA_COPY.applied.announceUndone,
    dismiss: IDEA_COPY.applied.announceDismissed,
  }
  const editEvent = (event: IdeaEditsEvent) => {
    onEditEvent(key, event)
    setStatus(ANNOUNCE[event.type])
  }

  /**
   * Where an image can go in the section the search was opened for: in place
   * of any image already there, or after any block. Labels are the row's
   * caption or alt and the block's first words — what the render shows.
   */
  const placementOptions = (sectionId: string): PlacementOption[] => {
    const section = current.sections.find((s) => s.id === sectionId) ?? current.sections[0]
    if (!section) return []
    const html = auditedHtml(section)
    const replace = imageInventory(section.id, html).map((row): PlacementOption => ({
      placement: { kind: 'replace', elementId: row.elementId },
      label: IDEA_COPY.placeImage.replace(row.caption || row.alt || row.src.split('/').pop() || row.elementId),
    }))
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const after = blockElements(doc.body).flatMap((el): PlacementOption[] => {
      const id = el.getAttribute('id')
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!id || !text) return []
      return [{ placement: { kind: 'insert-after', elementId: id }, label: IDEA_COPY.placeImage.after(text.length > 50 ? `${text.slice(0, 50)}…` : text) }]
    })
    return [...replace, ...after]
  }
  const openImageSearch = (query: string, sectionId?: string) => {
    setPlacing(undefined)
    setImageSearch({ query, sectionId: sectionId ?? current.sections[0]?.id ?? '' })
  }
  const placeImage = async (choice: { placement: ImagePlacement; alt: string; caption: string }) => {
    if (!placing || !imageSearch) return
    const added = await image.add({ chapterKey: key, sectionId: imageSearch.sectionId, hit: placing, ...choice })
    if (added) {
      setPlacing(undefined)
      setImageSearch(undefined)
      setStatus(IDEA_COPY.placeImage.announceAdded)
    }
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

            {/*
              The model key is a different secret from the review, with its
              own Forget key: the review forget above does not touch it, and
              the panel's copy says so.
            */}
            <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <LlmSettingsPanel settings={llm.settings} onSave={llm.onSave} onForget={llm.onForget} />
            </div>
            {provider && (
              <div className="flex flex-wrap items-center gap-2">
                {rubricRun.status === 'running' ? (
                  <>
                    <span role="status" className="text-sm">{IDEA_COPY.llm.sending(provider.label)}</span>
                    <button type="button" onClick={() => llm.cancel(rubricRunKey(key))} className={QUIET}>{IDEA_COPY.llm.cancel}</button>
                  </>
                ) : (
                  <button type="button" onClick={() => llm.runRubric(key, current.chapter.title, inputs)} className={QUIET}>
                    {IDEA_COPY.llm.rubricDraft.button(provider.label)}
                  </button>
                )}
                {rubricRun.status === 'failed' && <RunFailure state={rubricRun} />}
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
                {...(isDraftable(category.id) ? askModelFor(category.id) : {})}
                {...(rubricDraft?.areas.find((a) => a.id === category.id) ? { rubricDraft: rubricDraft.areas.find((a) => a.id === category.id)! } : {})}
                {...(category.id === '7.1'
                  ? { onFindImage: openImageSearch }
                  : {})}
              />
            ))}
          </div>

          {imageSearch && open === '7.1' && (
            <ImageSearch
              key={`${key}:${imageSearch.query}`}
              initialQuery={imageSearch.query}
              onChoose={setPlacing}
              onClose={() => { setImageSearch(undefined); setPlacing(undefined) }}
              sources={categoryById('7.1').resources}
              {...(image.providers ? { providers: image.providers } : {})}
            />
          )}
          {imageSearch && placing && open === '7.1' && (
            <PlaceImageDialog
              key={`${placing.provider}:${placing.id}`}
              hit={placing}
              options={placementOptions(imageSearch.sectionId)}
              onUse={(choice) => { void placeImage(choice) }}
              onCancel={() => setPlacing(undefined)}
              busy={image.busy}
              error={image.error}
            />
          )}

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
