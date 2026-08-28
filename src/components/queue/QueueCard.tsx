/**
 * One queue item, in three kinds. STRINGS ONLY.
 *
 * No publisher html reaches this component, which is why it needs no allowlist
 * repair and no `dangerouslySetInnerHTML`. The element being asked about is
 * shown in situ — highlighted in the real section render below the card (D5.7)
 * — and the card carries the text around it: the referencing sentence, a real
 * caption, and where the answer will propagate.
 *
 * Every user-facing string here is quoted verbatim from the UX spec (§2, §4,
 * §5). They are not paraphrasable: the decorative question in particular is the
 * one piece of copy in this product that argues, and it argues for a measured
 * reason — see `DECORATIVE` below.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { QueueItem } from '../../contracts/index'
import type { QueueAnswer } from '../../engine/compile/answers'
import type { VlmModel, VlmProgress } from '../../engine/vlm'
import { CANVAS_ALT_TEXT_MAX_LENGTH } from '../../engine/alt-text'

const GROUP_HEADING: Record<QueueItem['kind'], string> = {
  'confirm-decorative': 'Images marked decorative',
  alt: 'Images needing descriptions',
  'table-headers': 'Tables missing headers',
}

/**
 * §5. The failure mode this copy exists to prevent: the instructor reads "the
 * publisher marked this decorative", presses the primary button 25 times, and
 * ships four silent equations.
 *
 * It asks whether the image CARRIES INFORMATION rather than whether it is
 * decorative, because the publisher already answered the second question and
 * asking a human to re-confirm the publisher's word primes agreement. The
 * examples are domain-true — the four real items in the 1.4 fixture are
 * equation fragments inside a worked example. And the doubt line routes
 * uncertainty to the safe branch with the cost stated, because the two errors
 * are not symmetric and nobody can know that unless told.
 */
const DECORATIVE = {
  question: 'Does this image carry information?',
  body:
    'The publisher marked this image as decoration, so screen readers currently skip it. ' +
    "That is right only if the image adds nothing the text doesn't already say. If it shows " +
    'an equation, a diagram, or a step in the worked example, it is not decoration.',
  doubt:
    'Not sure? Choose "Needs a description." A wrong "decoration" answer hides the image from ' +
    'screen readers for every student; an unneeded description costs one sentence.',
}

/** §4. Split at its own sentence boundary so the first half can be the heading. */
const ALT = {
  question: 'Describe this image for a student who cannot see it.',
  body:
    'One or two sentences: what it shows and what matters about it. ' +
    "Don't start with 'Image of' or 'Figure' — the screen reader already says that.",
  draftLabel: 'Suggested description — use it, edit it, or replace it:',
}

const TABLE = {
  question: 'Which cells are headers?',
  body:
    'A header labels the cells below it or beside it. If no cell labels another — the table ' +
    'only arranges things — it is a layout table.',
  /** No default is offered: a structural choice needs eyes on the rendered table. */
  options: [
    { label: 'First row', choice: 'row' },
    { label: 'First column', choice: 'column' },
    { label: 'First row and column', choice: 'both' },
    { label: "It's a layout table", choice: 'presentation' },
  ],
} as const

const NO_REFERENCE = {
  image: 'No sentence near this image was found — use the highlighted image below.',
  table: 'No text near this table was found — use the highlighted table below.',
}

export interface QueueCardProps {
  item: QueueItem
  /** Position in the WHOLE queue, never in the group (A2). */
  position: number
  total: number
  /**
   * Titles of the sections this item's hash appears in. One section, or none,
   * says nothing — the line exists to warn that an answer reaches further than
   * the card, and that warning is noise when it does not.
   */
  occurrences?: readonly string[]
  /** This item is resurfacing from the skipped tail. */
  skippedEarlier?: boolean
  /**
   * Why the last answer to this item was not taken. Shown inline, next to the
   * answer that caused it; the view's `role="alert"` region announces it, and
   * this must not be a live region too or it is announced twice.
   */
  refusal?: string
  onAnswer?: (answer: QueueAnswer) => void
  onSkip?: () => void
  /**
   * Display-only resolution of `$IMS-CC-FILEBASE$/oer2canvas/…` tokens to
   * `blob:` urls, from `usePackagedAssetUrls` (see `QueueView`, which is the
   * only caller and owns the single instance of that hook for a session).
   * `item.context.src` carries whatever the compiler put there, which for a
   * packaged raster is that token — not a fetchable url — so both places this
   * card hands `src` to something that fetches it (the "open the original
   * image" link, and the local-draft seam below) need it resolved first.
   * Optional, and identity-safe to omit: a caller with no packaged assets at
   * all (every existing test, and every catalog-source chapter) can leave
   * this out entirely, since an ordinary `src` (an http(s) url, as catalog
   * sources use) contains no packaged-reference token for a resolver to act
   * on in the first place.
   */
  resolve?: (value: string) => string
  /** Present only after S1 selects and wires an audited local runtime. */
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

export function QueueCard({
  item,
  position,
  total,
  occurrences,
  skippedEarlier,
  refusal,
  onAnswer,
  onSkip,
  resolve,
  drafting,
}: QueueCardProps) {
  // "Needs a description" morphs the card in place. The item's KIND is
  // unchanged — what changes is which answer the instructor is composing, and
  // that distinction is why this is local state and not an event (§3.2).
  const [describing, setDescribing] = useState(false)
  const [text, setText] = useState(item.proposed ?? '')
  const availableModels = drafting?.models.filter((model) => model.status !== 'incompatible') ?? []
  const [modelId, setModelId] = useState(availableModels[0]?.id ?? '')
  const [draftState, setDraftState] = useState<'idle' | VlmProgress['phase']>('idle')
  const [draftError, setDraftError] = useState('')
  const [generatedDraft, setGeneratedDraft] = useState(false)
  const draftRun = useRef<AbortController | undefined>(undefined)
  const ids = useId()
  const questionId = `${ids}-question`
  const bodyId = `${ids}-body`
  const inputId = `${ids}-input`

  // Caption/reference text is the higher-confidence path. The local model is
  // offered only when the compiler found no usable text alternative at all;
  // that keeps an instructor from replacing grounded publisher context with a
  // speculative caption.
  const canDraftLocally =
    item.kind === 'alt' &&
    item.context.src &&
    item.proposed === undefined &&
    !item.context.caption &&
    !item.context.reference &&
    drafting &&
    availableModels.length > 0

  const writing = item.kind === 'alt' || describing
  const isTable = item.kind === 'table-headers'
  const copy = isTable ? TABLE : writing ? ALT : DECORATIVE

  /*
    Focus lands on the thing the instructor is about to use, on every card.

    The card is keyed by the cursor in `QueueView`, so a new item REMOUNTS this
    component and this effect runs once per item — which is what makes the
    dominant loop one keystroke: card appears, focus is already on "Confirm
    decorative (D)", eyes drop to the outlined image below, press D (§6).

    `writing` is the only dependency, so a re-render for any other reason — a
    refusal arriving, the section finishing its re-audit — does NOT touch focus.
    That matters more than it looks: a card that re-focuses itself while
    somebody is typing eats their text, and the audit landing must never move
    focus at all (§3.5).
  */
  const primary = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => draftRun.current?.abort(), [])
  useEffect(() => {
    // `preventScroll`, because focusing a control scrolls it into view and this
    // control sits ABOVE the section render — without it the browser would undo
    // the centring `QueueView` just did and put the instructor back at the top
    // of the page, looking at the question instead of the evidence. The cluster
    // stays reachable by other means: it is pinned to the viewport at narrow
    // widths, and it is where Shift+Tab goes at any width.
    const options = { preventScroll: true }
    if (writing) input.current?.focus(options)
    else primary.current?.focus(options)
  }, [writing])

  return (
    <section className="b2c-queue-card" aria-labelledby={questionId}>
      <h3>{GROUP_HEADING[item.kind]}</h3>
      <p className="b2c-queue-position">
        Item {position} of {total}
      </p>
      {skippedEarlier && <p>You skipped this earlier.</p>}

      <h4 id={questionId}>{copy.question}</h4>
      <p id={bodyId}>{copy.body}</p>

      <Context item={item} occurrences={occurrences} resolve={resolve} />

      {/* Inline, above the controls, where the answer that caused it still is. */}
      {refusal && <p className="b2c-queue-refusal">{refusal}</p>}

      {isTable ? (
        <p className="b2c-queue-controls">
          {TABLE.options.map((option, index) => (
            <button
              key={option.choice}
              ref={index === 0 ? primary : undefined}
              type="button"
              onClick={() => onAnswer?.({ type: 'table-headers', choice: option.choice })}
            >
              {option.label}
            </button>
          ))}
          <SkipButton onSkip={onSkip} />
        </p>
      ) : writing ? (
        /*
          A form, so Enter in the single-line input submits NATIVELY (D5.9).
          That is the whole reason the field is an input rather than a textarea:
          alt text is one string, newlines collapse in the attribute anyway, and
          binding Enter ourselves is what forces a modal cheat sheet.
        */
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onAnswer?.({ type: 'alt', text })
          }}
        >
          {canDraftLocally && (
            <fieldset className="b2c-vlm-draft">
              <legend>Optional local draft</legend>
              <p>The model runs on this device. Its draft is not accepted until you choose to use it.</p>
              <label htmlFor={`${ids}-model`}>Local draft model</label>
              <select
                id={`${ids}-model`}
                value={modelId}
                disabled={draftState !== 'idle'}
                onChange={(event) => setModelId(event.target.value)}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} — about {model.downloadMiB.toLocaleString()} MiB
                  </option>
                ))}
              </select>
              <p className="b2c-queue-controls">
                <button
                  type="button"
                  disabled={draftState !== 'idle'}
                  onClick={() => {
                    const model = availableModels.find((candidate) => candidate.id === modelId)
                    if (!model || !item.context.src) return
                    const controller = new AbortController()
                    draftRun.current = controller
                    setDraftError('')
                    setDraftState('loading')
                    // `resolve` turns a packaged reference into the `blob:` url
                    // the runtime's `fetch`-based image loader can actually
                    // read; canDraftLocally is true precisely when there is no
                    // caption or reference to fall back on, which is the same
                    // condition under which `context.src` is most often a
                    // packaged token (DOCX import) rather than a fetchable
                    // publisher url — so leaving this unresolved failed local
                    // drafting for exactly the ordinary case it exists to serve.
                    const image = resolve ? resolve(item.context.src) : item.context.src
                    void drafting.draft(model, image, (progress) => {
                      setDraftState(progress.phase)
                    }, controller.signal).then((draft) => {
                      if (controller.signal.aborted) return
                      setText(draft)
                      setGeneratedDraft(true)
                      setDraftState('idle')
                      input.current?.focus()
                    }).catch((error: unknown) => {
                      if (controller.signal.aborted) return
                      setDraftError(error instanceof Error ? error.message : String(error))
                      setDraftState('idle')
                    }).finally(() => {
                      if (draftRun.current === controller) draftRun.current = undefined
                    })
                  }}
                >
                  Draft locally
                </button>
                {draftState !== 'idle' && (
                  <button
                    type="button"
                    onClick={() => {
                      draftRun.current?.abort()
                      draftRun.current = undefined
                      setDraftState('idle')
                    }}
                  >
                    Cancel draft
                  </button>
                )}
              </p>
              {draftState !== 'idle' && (
                <p role="status">{draftState === 'loading' ? 'Loading model on this device…' : 'Drafting on this device…'}</p>
              )}
              {draftError && <p role="alert">Could not create a local draft. {draftError} Write a description instead.</p>}
            </fieldset>
          )}
          {(item.proposed !== undefined || generatedDraft) && (
            <>
              {generatedDraft && <p><strong>Draft — not accepted</strong></p>}
              <label htmlFor={inputId}>{ALT.draftLabel}</label>
            </>
          )}
          <input
            ref={input}
            id={inputId}
            type="text"
            maxLength={CANVAS_ALT_TEXT_MAX_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-labelledby={item.proposed === undefined && !generatedDraft ? questionId : undefined}
            aria-describedby={bodyId}
          />
          <p className="b2c-queue-controls">
            <button type="submit">
              {item.proposed === undefined && !generatedDraft ? 'Save description' : 'Use this description'}
            </button>
            {/* type="button" throughout: a bare button inside a form submits it,
                and "Skip (S)" would then save the description it was pressed
                instead of. */}
            <button type="button" onClick={() => onAnswer?.({ type: 'decorative' })}>
              Decorative (D)
            </button>
            <SkipButton onSkip={onSkip} />
          </p>
        </form>
      ) : (
        <>
          <p className="b2c-queue-controls">
            <button
              ref={primary}
              type="button"
              onClick={() => onAnswer?.({ type: 'decorative' })}
            >
              Confirm decorative (D)
            </button>
            <button type="button" onClick={() => setDescribing(true)}>
              Needs a description
            </button>
            <SkipButton onSkip={onSkip} />
          </p>
          <p>{DECORATIVE.doubt}</p>
        </>
      )}
    </section>
  )
}

function SkipButton({ onSkip }: { onSkip?: () => void }) {
  // Always last. Skip is the escape hatch, not an answer, and putting it in the
  // cluster ahead of an answer invites it as one.
  return (
    <button type="button" onClick={() => onSkip?.()}>
      Skip (S)
    </button>
  )
}

/**
 * What the card can say about the element without showing it.
 *
 * A table gets a reference and a real caption and nothing else: it carries no
 * `src` and no `hash`, so a source link and an occurrence line are not merely
 * unhelpful there, they would be claims about fields that do not exist (A4).
 */
function Context({
  item,
  occurrences,
  resolve,
}: {
  item: QueueItem
  occurrences?: readonly string[]
  /** See `QueueCardProps.resolve` — same resolver, same reason. */
  resolve?: (value: string) => string
}) {
  const isTable = item.kind === 'table-headers'
  const { reference, caption, src } = item.context
  return (
    <div className="b2c-queue-context">
      {reference ? (
        <p>
          From the text: <em>{reference}</em>
        </p>
      ) : (
        <p>{isTable ? NO_REFERENCE.table : NO_REFERENCE.image}</p>
      )}
      {/* Only tables print a caption, and only a real one — a label-only caption
          was already dropped in compile (A9). An absent caption says nothing at
          all: it is the common case on image items, and a noise line on nearly
          every card trains the eye to skip the card's text. */}
      {isTable && caption && (
        <p>
          Caption: <em>{caption}</em>
        </p>
      )}
      {!isTable && occurrences && occurrences.length > 1 && (
        <p>
          This image appears in {occurrences.length} sections: {occurrences.join(', ')} — your
          answer applies to all of them.
        </p>
      )}
      {!isTable && src && (
        <p>
          {/* `resolve` turns a packaged reference (`$IMS-CC-FILEBASE$/…`, the
              form a DOCX-sourced image's `src` actually is) into a `blob:`
              url the browser can navigate to. Left unresolved, this token is
              not a url the app origin serves at all, and the link 404s.
              A catalog-source `src` is already a real publisher url with no
              packaged-reference token in it, so `resolve` is a no-op there —
              this is safe to apply unconditionally when a resolver is given. */}
          <a href={resolve ? resolve(src) : src} target="_blank" rel="noreferrer noopener">
            Open the original image (new tab)
          </a>
        </p>
      )}
    </div>
  )
}
