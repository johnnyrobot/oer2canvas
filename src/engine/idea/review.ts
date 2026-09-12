/**
 * The IDEA review: what the HUMAN decided.
 *
 * Two pure reducers, for the same reason `session.ts` is one: every rule in
 * this screen is testable with nothing rendered. The hook in
 * `useIdeaReviews.ts` is plumbing over them.
 *
 * `IdeaReview` is one chapter's Rubric 1: eight categories, plus the rubric's
 * chapter-level Summary and Suggestions. `IdeaHeader` is the rubric's header —
 * assessor and BIPOC benchmark — and there is ONE per session, not one per
 * chapter: OERI's form repeats the header on every chapter's sheet, but the
 * person filling it in does not change between chapters, and asking for a
 * name five times for a five-chapter selection is how a form gets abandoned.
 * The export stamps the header into every chapter's file.
 *
 * THE RATING IS NEVER MACHINE-WRITTEN. The only way a `Rating` enters this
 * structure is a `rate` event, and the only things that dispatch one are a
 * radio the instructor clicked and `store.ts` replaying a rating the
 * instructor clicked earlier. Slice 4's model draft renders BESIDE the rating
 * column and has no path to it — the spec's one deliberate friction.
 *
 * Rows and elements are validated against the Framework: an event naming a
 * row that is not in its category is dropped. Not an error — a stale id from
 * a renumbered Framework should degrade to "nothing recorded", not crash the
 * screen — but never stored, because the export keys on these ids.
 */
import { IDEA_CATEGORY_IDS, IDEA_FRAMEWORK, categoryById, type CategoryId } from './framework'

export type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
export type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'

export interface Assessor {
  name: string
  title: string
  college: string
}

/** Rubric 1's header. Once per session; stamped into every chapter's export. */
export interface IdeaHeader {
  assessor: Assessor
  /** Framework §9.0: 77% by default (CCCCO Data Mart, Fall 2022), adjustable per college. */
  benchmark: { bipocPercent: number }
}

export interface CategoryReview {
  /** By Rubric 1 row id. A category is rated when every one of its rows is. */
  ratings: ReadonlyMap<string, Rating>
  notes: string
  /** By Framework element id. */
  checklist: ReadonlyMap<string, ChecklistAnswer>
}

/** One chapter's Rubric 1. */
export interface IdeaReview {
  categories: Readonly<Record<CategoryId, CategoryReview>>
  /** Rubric 1's "Summary" field. */
  summary: string
  /** Rubric 1's "Suggestions" field. */
  suggestions: string
}

export const DEFAULT_BIPOC_PERCENT = 77

export type IdeaReviewEvent =
  | { type: 'rate'; categoryId: CategoryId; rowId: string; rating: Rating }
  | { type: 'clear-rating'; categoryId: CategoryId; rowId: string }
  | { type: 'note'; categoryId: CategoryId; notes: string }
  | { type: 'check'; categoryId: CategoryId; elementId: string; answer: ChecklistAnswer }
  | { type: 'summary'; text: string }
  | { type: 'suggestions'; text: string }

export type IdeaHeaderEvent =
  | { type: 'benchmark'; bipocPercent: number }
  | { type: 'assessor'; assessor: Partial<Assessor> }

const emptyCategory = (): CategoryReview => ({ ratings: new Map(), notes: '', checklist: new Map() })

export function newReview(): IdeaReview {
  const categories = {} as Record<CategoryId, CategoryReview>
  for (const id of IDEA_CATEGORY_IDS) categories[id] = emptyCategory()
  return { categories, summary: '', suggestions: '' }
}

export function newHeader(): IdeaHeader {
  return {
    assessor: { name: '', title: '', college: '' },
    benchmark: { bipocPercent: DEFAULT_BIPOC_PERCENT },
  }
}

function withCategory(
  review: IdeaReview,
  id: CategoryId,
  update: (c: CategoryReview) => CategoryReview,
): IdeaReview {
  return { ...review, categories: { ...review.categories, [id]: update(review.categories[id]) } }
}

const hasRow = (id: CategoryId, rowId: string) => categoryById(id).rows.some((r) => r.id === rowId)
const hasElement = (id: CategoryId, elementId: string) =>
  categoryById(id).elements.some((e) => e.id === elementId)

export function reduceReview(review: IdeaReview, event: IdeaReviewEvent): IdeaReview {
  switch (event.type) {
    case 'rate': {
      if (!hasRow(event.categoryId, event.rowId)) return review
      return withCategory(review, event.categoryId, (c) => {
        const ratings = new Map(c.ratings)
        ratings.set(event.rowId, event.rating)
        return { ...c, ratings }
      })
    }
    case 'clear-rating':
      return withCategory(review, event.categoryId, (c) => {
        const ratings = new Map(c.ratings)
        ratings.delete(event.rowId)
        return { ...c, ratings }
      })
    case 'note':
      return withCategory(review, event.categoryId, (c) => ({ ...c, notes: event.notes }))
    case 'check': {
      if (!hasElement(event.categoryId, event.elementId)) return review
      return withCategory(review, event.categoryId, (c) => {
        const checklist = new Map(c.checklist)
        checklist.set(event.elementId, event.answer)
        return { ...c, checklist }
      })
    }
    case 'summary':
      return { ...review, summary: event.text }
    case 'suggestions':
      return { ...review, suggestions: event.text }
  }
}

export function reduceHeader(header: IdeaHeader, event: IdeaHeaderEvent): IdeaHeader {
  switch (event.type) {
    case 'benchmark': {
      const n = event.bipocPercent
      // A non-number leaves the benchmark where it was: the field's text may be
      // mid-edit, and snapping to a default under the instructor's cursor is
      // worse than waiting for a number.
      if (!Number.isFinite(n)) return header
      return { ...header, benchmark: { bipocPercent: Math.min(100, Math.max(0, Math.round(n))) } }
    }
    case 'assessor':
      return { ...header, assessor: { ...header.assessor, ...event.assessor } }
  }
}

export function isCategoryRated(review: IdeaReview, id: CategoryId): boolean {
  const c = review.categories[id]
  return categoryById(id).rows.every((r) => c.ratings.has(r.id))
}

/** Categories whose every rubric row carries a rating. What the sidebar counts. */
export function ratedCount(review: IdeaReview): number {
  return IDEA_CATEGORY_IDS.filter((id) => isCategoryRated(review, id)).length
}

/** Rubric 1's "Category Count" block, over every rubric row. */
export function ratingCounts(review: IdeaReview): Readonly<Record<Rating | 'notRated', number>> {
  const counts = { na: 0, exclusive: 0, emerging: 0, inclusive: 0, notRated: 0 }
  for (const c of IDEA_FRAMEWORK) {
    for (const row of c.rows) {
      const rating = review.categories[c.id].ratings.get(row.id)
      if (rating) counts[rating] += 1
      else counts.notRated += 1
    }
  }
  return counts
}
