/**
 * One Framework category: restorative requirement, checklist, Rubric 1 rows,
 * notes, resources. STRINGS ONLY — no publisher html reaches this component.
 *
 * The rubric radios carry Rubric 1's own wording as their accessible name,
 * because "Emerging Inclusive" alone tells an assessor nothing about what the
 * row is asking; the column text is the question.
 *
 * Slice 2 adds a "What a rule found" zone between the requirement and the
 * checklist; slice 3 puts an "Inventory" zone in the same place for the two
 * categories that list rather than suggest; slice 4 adds "Ask the model" after
 * it; slice 5 gives 7.1's inventory two ways into the image search and the
 * Applied list, since an added image is an edit. All are zones inside this
 * panel, which is why the panel and not the screen owns the category.
 */
import { useId } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, ImagePlus } from 'lucide-react'
import type { CategoryId, IdeaCategory, RubricRow } from '../../engine/idea/framework'
import { RUBRIC_NA_TEXT } from '../../engine/idea/framework'
import type { CategoryReview, IdeaReviewEvent, Rating } from '../../engine/idea/review'
import type { FindingTarget, IdeaFinding } from '../../engine/idea/findings'
import type { IdeaEditsEvent } from '../../engine/idea/edits'
import type { AppliedEdit } from '../../engine/idea/applied'
import type { LlmProvider } from '../../engine/idea/llm/providers'
import { DRAFTABLE, type DraftableCategory } from '../../engine/idea/llm/prompts'
import { FindingRow } from './FindingRow'
import { AppliedList } from './AppliedList'
import { AskModel } from './AskModel'
import type { RunState } from './useModelRuns'
import {
  CHECKLIST_COPY, CHECKLIST_ORDER, IDEA_COPY, RATING_COPY, RATING_ORDER,
} from './copy'

const TARGET = 'min-h-9 min-w-9'
const QUIET = `${TARGET} inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`
const PANEL =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
const CHOICE =
  'flex cursor-pointer items-start gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm ' +
  'has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ' +
  'dark:border-neutral-700 dark:has-[:checked]:bg-neutral-800'

/** The categories a rule finder exists for. Only these show a findings zone. */
const RULE_CATEGORIES = new Set<CategoryId>(['7.3', '7.6'])
/** The categories whose findings are an inventory to read, not suggestions to act on. */
const INVENTORY_CATEGORIES = new Set<CategoryId>(['7.1', '7.7'])

const isImageSummary = (f: IdeaFinding) => f.key.endsWith('::summary::7.1')
const isImageRow = (f: IdeaFinding) => f.rule?.id === 'inventory-image'

/** The header's trailing count: the 7.1 summary line, the 7.7 row count, or the rule categories' suggestion count. */
function countLine(id: CategoryId, found: readonly IdeaFinding[]): string | undefined {
  if (id === '7.1') {
    const summary = found.find(isImageSummary)
    if (summary?.kind !== 'observation') return undefined
    return IDEA_COPY.inventory.imagesSummary(Number(summary.columns.images), Number(summary.columns['mention people']))
  }
  if (id === '7.7') return IDEA_COPY.inventory.items(found.length)
  if (RULE_CATEGORIES.has(id)) return IDEA_COPY.findings.count(found.length)
  return undefined
}

export function CategoryPanel({
  category, review, open, onToggle, onEvent, findings, applied, sectionTitleOf, onEditEvent, onFocusFinding, failures,
  askModel, draftFindings, rubricDraft, onFindImage,
}: {
  category: IdeaCategory
  review: CategoryReview
  open: boolean
  onToggle: () => void
  onEvent: (event: IdeaReviewEvent) => void
  findings?: readonly IdeaFinding[]
  applied?: readonly AppliedEdit[]
  sectionTitleOf?: (sectionId: string) => string
  onEditEvent?: (event: IdeaEditsEvent) => void
  onFocusFinding?: (target: FindingTarget | undefined) => void
  /** Sections this category's rule check threw on (spec §7.1). */
  failures?: readonly { sectionTitle: string; message: string }[]
  /** Slice 4: the Ask-the-model zone, rendered only for the draftable categories. */
  askModel?: { provider: LlmProvider | undefined; state: RunState; onSend: () => void; onCancel: () => void; firstRun: boolean }
  /** What the model drafted for this category, already filtered by the edits map. */
  draftFindings?: readonly IdeaFinding[]
  /** The model's Rubric 1 draft for this category: per row, beside the human's rating, never copied into it. */
  rubricDraft?: { rows: readonly { id: string; rating: Rating | null }[]; notes: string }
  /** Slice 5, 7.1 only: open the image search, seeded with a query. */
  onFindImage?: (initialQuery: string) => void
}) {
  const bodyId = useId()
  const rated = category.rows.filter((r) => review.ratings.has(r.id)).length
  const hasRules = RULE_CATEGORIES.has(category.id)
  const isInventory = INVENTORY_CATEGORIES.has(category.id)
  const isDraftable = askModel !== undefined && (DRAFTABLE as readonly string[]).includes(category.id)
  const found = findings ?? []
  // 7.1 reads summary first, then the rows; the finder appends the summary last.
  const listed = category.id === '7.1'
    ? [...found.filter(isImageSummary), ...found.filter((f) => !isImageSummary(f))]
    : found
  const count = countLine(category.id, found)
  const findImage = category.id === '7.1' ? onFindImage : undefined
  const zone = isInventory
    ? {
        heading: IDEA_COPY.inventory.heading,
        none: IDEA_COPY.inventory.none,
        guidance: category.id === '7.1' ? IDEA_COPY.inventory.guidance71 : IDEA_COPY.inventory.guidance77,
      }
    : { heading: IDEA_COPY.findings.heading, none: IDEA_COPY.findings.none, guidance: undefined }
  return (
    <section className={PANEL} aria-labelledby={`${bodyId}-h`}>
      <h3 id={`${bodyId}-h`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className={`${TARGET} flex w-full items-center gap-2 px-4 py-3 text-left text-base font-semibold`}
        >
          {open
            ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1">{category.id} {category.title}</span>
          <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400">
            {IDEA_COPY.ratedSummary(rated, category.rows.length)}
          </span>
          {count && (
            <span className="ml-1 text-xs font-normal text-neutral-600 dark:text-neutral-400">
              {`· ${count}`}
            </span>
          )}
        </button>
      </h3>

      {open && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <div>
            <h4 className="mb-1 text-sm font-semibold">{IDEA_COPY.restorativeHeading}</h4>
            <p className="text-sm text-neutral-800 dark:text-neutral-200">{category.restorative}</p>
          </div>

          {(hasRules || isInventory) && (
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-sm font-semibold">{zone.heading}</legend>
              {zone.guidance && (
                <p className="mb-2 text-sm text-neutral-700 dark:text-neutral-300">{zone.guidance}</p>
              )}
              {(failures ?? []).map((f, i) => (
                <div key={i} className="mb-2 text-sm">
                  <p className="m-0">{IDEA_COPY.findings.failed(category.id, f.sectionTitle)}</p>
                  <details>
                    <summary className="cursor-pointer text-neutral-700 dark:text-neutral-300">{IDEA_COPY.findings.failedDetail}</summary>
                    <pre className="m-0 whitespace-pre-wrap text-xs">{f.message}</pre>
                  </details>
                </div>
              ))}
              {listed.length === 0
                ? <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{zone.none}</p>
                : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {listed.map((f) => (
                      <FindingRow
                        key={f.key}
                        finding={f}
                        sectionTitle={sectionTitleOf?.(f.sectionId) ?? ''}
                        onEvent={(e) => onEditEvent?.(e)}
                        onFocus={(t) => onFocusFinding?.(t)}
                        {...(findImage && isImageRow(f) && f.kind === 'observation'
                          ? { action: { label: IDEA_COPY.imageSearch.findAlternative, onClick: () => findImage(alternativeQuery(f.columns)) } }
                          : {})}
                      />
                    ))}
                  </ul>
                )}
              {findImage && (
                <div className="mt-3">
                  <button type="button" className={QUIET} onClick={() => findImage('')}>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {IDEA_COPY.imageSearch.find}
                  </button>
                </div>
              )}
              {(hasRules || category.id === '7.1') && (
                <div className="mt-3">
                  <AppliedList applied={applied ?? []} onUndo={(key) => onEditEvent?.({ type: 'undo', key })} />
                </div>
              )}
            </fieldset>
          )}

          {isDraftable && (
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-sm font-semibold">{IDEA_COPY.llm.heading}</legend>
              <AskModel {...askModel} />
              {(draftFindings ?? []).length > 0 && (
                <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0" aria-label={IDEA_COPY.llm.draftLabel}>
                  {(draftFindings ?? []).map((f) => (
                    <FindingRow
                      key={f.key}
                      finding={f}
                      sectionTitle={sectionTitleOf?.(f.sectionId) ?? ''}
                      onEvent={(e) => onEditEvent?.(e)}
                      onFocus={(t) => onFocusFinding?.(t)}
                    />
                  ))}
                </ul>
              )}
            </fieldset>
          )}

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">{IDEA_COPY.checklistHeading}</legend>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {category.elements.map((el) => (
                <li key={el.id}>
                  <div role="radiogroup" aria-labelledby={`${bodyId}-${el.id}`} className="flex flex-col gap-2">
                    <p id={`${bodyId}-${el.id}`} className="m-0 text-sm">{el.text}</p>
                    <div className="flex flex-wrap gap-2">
                      {CHECKLIST_ORDER.map((answer) => (
                        <label key={answer} className={`${CHOICE} ${TARGET}`}>
                          <input
                            type="radio"
                            name={`${bodyId}-${el.id}`}
                            checked={review.checklist.get(el.id) === answer}
                            onChange={() => onEvent({ type: 'check', categoryId: category.id, elementId: el.id, answer })}
                            className="mt-0.5"
                          />
                          <span>{CHECKLIST_COPY[answer]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">{IDEA_COPY.rubricHeading}</legend>
            <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.rubricArgument}</p>
            <div className="flex flex-col gap-4">
              {category.rows.map((row) => (
                <RubricRowChoice
                  key={row.id}
                  row={row}
                  rowsInCategory={category.rows.length}
                  value={review.ratings.get(row.id)}
                  onChoose={(rating) => onEvent({ type: 'rate', categoryId: category.id, rowId: row.id, rating })}
                  draft={rubricDraft ? (rubricDraft.rows.find((r) => r.id === row.id)?.rating ?? null) : undefined}
                />
              ))}
            </div>
            {/*
              The model's notes for this area. "Use this note" fills Notes;
              there is deliberately no handler here or in the row that
              dispatches `rate` — a draft rating is read, never clicked in.
            */}
            {rubricDraft && (
              <div className="b2c-idea-draft-notes mt-3 flex flex-col gap-1 rounded-md border border-dashed border-neutral-300 p-3 text-sm dark:border-neutral-700">
                <p className="m-0 font-semibold">{IDEA_COPY.llm.rubricDraft.column}</p>
                <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.llm.rubricDraft.cannotCopy}</p>
                <p className="m-0 whitespace-pre-wrap">{rubricDraft.notes}</p>
                {rubricDraft.notes && (
                  <div>
                    <button
                      type="button"
                      className={`${TARGET} rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700`}
                      onClick={() => onEvent({ type: 'note', categoryId: category.id, notes: rubricDraft.notes })}
                    >
                      {IDEA_COPY.llm.rubricDraft.useNote}
                    </button>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${bodyId}-notes`} className="text-sm font-semibold">{IDEA_COPY.notesLabel}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.notesHint}</p>
            <textarea
              id={`${bodyId}-notes`}
              value={review.notes}
              onChange={(e) => onEvent({ type: 'note', categoryId: category.id, notes: e.target.value })}
              rows={3}
              className="rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>

          {category.resources.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">{IDEA_COPY.resourcesHeading}</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {category.resources.map((r) => (
                  <li key={r.url}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-brand-700 underline dark:text-brand-300"
                    >
                      {r.label}
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span className="sr-only">({IDEA_COPY.opensNewTab})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The row's own words, when it has any: a placeholder description seeds nothing. */
function alternativeQuery(columns: Readonly<Record<string, string>>): string {
  const description = columns.description ?? ''
  return description.startsWith('(') ? '' : description
}

/**
 * One Rubric 1 row as a radio group. The accessible name of each radio is the
 * rating label followed by the row's column text, so a screen-reader user
 * hears the question with the answer.
 */
function RubricRowChoice({
  row, rowsInCategory, value, onChoose, draft,
}: {
  row: RubricRow
  rowsInCategory: number
  value: Rating | undefined
  onChoose: (rating: Rating) => void
  /** `undefined` = no draft run yet; `null` = the model gave nothing for this row. */
  draft?: Rating | null
}) {
  const id = useId()
  const text: Record<Rating, string> = {
    na: RUBRIC_NA_TEXT,
    exclusive: row.exclusive,
    emerging: row.emerging,
    inclusive: row.inclusive,
  }
  const label = rowsInCategory > 1 ? `Row ${row.id.slice(-1)}` : 'Rating'
  return (
    <div role="radiogroup" aria-labelledby={`${id}-l`} className="flex flex-col gap-2">
      <p id={`${id}-l`} className="m-0 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
        {label}
      </p>
      {draft !== undefined && (
        <p className="b2c-idea-draft m-0 self-start rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
          <span className="font-semibold">{IDEA_COPY.llm.rubricDraft.column}: </span>
          <span>{draft ? RATING_COPY[draft] : IDEA_COPY.llm.rubricDraft.noDraft}</span>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {RATING_ORDER.map((rating) => (
          <label key={rating} className={`${CHOICE} ${TARGET}`}>
            <input
              type="radio"
              name={id}
              checked={value === rating}
              onChange={() => onChoose(rating)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">{RATING_COPY[rating]}</span>
              <span className="block text-neutral-700 dark:text-neutral-300">{text[rating]}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
