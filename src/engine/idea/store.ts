/**
 * What an IDEA review looks like on disk, and the read that trusts none of it.
 *
 * The document is stored as an object graph — Maps included — because the
 * app's `KeyValueStore` is IndexedDB, whose structured clone keeps a Map a
 * Map. That is the reason `idb.ts` gives for not using localStorage, and it
 * holds here: no JSON round-trip, so no class of bug where a value stops
 * surviving one.
 *
 * `restore` does not cast. It rebuilds each review by replaying the stored
 * values through `reduceReview` and `reduceHeader`, so a saved document from
 * a release with a different Framework, or a hand-edited one, degrades to
 * "nothing recorded for that row" instead of a rating nobody clicked. This is
 * also what keeps "the rating is never machine-written" true across a
 * reload: what comes back is only what went in through a `rate` event.
 *
 * Edits (slice 2) live in the same document, restored the same way: each
 * stored entry is replayed through `reduceEdits`, so a malformed entry is
 * dropped and a well-formed one becomes exactly the edit the instructor
 * made. Dismissals are NOT stored — spec §2.3 makes them session-only — so
 * `restore` always returns an empty `dismissed` set.
 */
import { IDEA_CATEGORY_IDS } from './framework'
import { isIdeaEditKey, newEdits, reduceEdits, type IdeaEdits } from './edits'
import {
  newHeader, newReview, reduceHeader, reduceReview,
  type ChecklistAnswer, type IdeaHeader, type IdeaReview, type Rating,
} from './review'

export const IDEA_STORAGE_KEY = 'idea.reviews'

export interface PersistedIdea {
  version: 1
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
  edits: ReadonlyMap<string, IdeaEdits>
}

export function toPersisted(
  header: IdeaHeader,
  reviews: ReadonlyMap<string, IdeaReview>,
  edits: ReadonlyMap<string, IdeaEdits>,
): PersistedIdea {
  // Dismissals stripped on the way out, so the document never carries them.
  const stripped = new Map<string, IdeaEdits>()
  for (const [key, e] of edits) stripped.set(key, { edits: e.edits, dismissed: new Set() })
  return { version: 1, header, reviews, edits: stripped }
}

const RATINGS: readonly string[] = ['na', 'exclusive', 'emerging', 'inclusive']
const ANSWERS: readonly string[] = ['yes', 'no', 'unsure', 'skip']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isRating = (v: unknown): v is Rating => typeof v === 'string' && RATINGS.includes(v)
const isAnswer = (v: unknown): v is ChecklistAnswer => typeof v === 'string' && ANSWERS.includes(v)
const entries = (v: unknown): [unknown, unknown][] => (v instanceof Map ? [...v] : [])

function restoreEdits(value: unknown): ReadonlyMap<string, IdeaEdits> {
  const out = new Map<string, IdeaEdits>()
  for (const [key, raw] of entries(value)) {
    if (typeof key !== 'string' || !isRecord(raw)) continue
    let e = newEdits()
    for (const [editKey, edit] of entries(raw.edits)) {
      if (!isIdeaEditKey(editKey) || !isRecord(edit)) continue
      if (edit.kind === 'replace' && typeof edit.replacement === 'string') {
        e = reduceEdits(e, { type: 'replace', key: editKey, replacement: edit.replacement })
      } else if (edit.kind === 'keep' && (edit.context === undefined || typeof edit.context === 'string')) {
        e = reduceEdits(e, edit.context === undefined ? { type: 'keep', key: editKey } : { type: 'keep', key: editKey, context: edit.context })
      }
    }
    out.set(key, e)
  }
  return out
}

export function restore(value: unknown): {
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
  edits: ReadonlyMap<string, IdeaEdits>
} | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined

  let header = newHeader()
  if (isRecord(value.header)) {
    const a = isRecord(value.header.assessor) ? value.header.assessor : {}
    header = reduceHeader(header, {
      type: 'assessor',
      assessor: { name: str(a.name), title: str(a.title), college: str(a.college) },
    })
    const b = isRecord(value.header.benchmark) ? value.header.benchmark.bipocPercent : undefined
    if (typeof b === 'number') header = reduceHeader(header, { type: 'benchmark', bipocPercent: b })
  }

  const reviews = new Map<string, IdeaReview>()
  for (const [key, raw] of entries(value.reviews)) {
    if (typeof key !== 'string' || !isRecord(raw)) continue
    let review = newReview()
    review = reduceReview(review, { type: 'summary', text: str(raw.summary) })
    review = reduceReview(review, { type: 'suggestions', text: str(raw.suggestions) })
    const categories = isRecord(raw.categories) ? raw.categories : {}
    for (const categoryId of IDEA_CATEGORY_IDS) {
      const c = categories[categoryId]
      if (!isRecord(c)) continue
      review = reduceReview(review, { type: 'note', categoryId, notes: str(c.notes) })
      for (const [rowId, rating] of entries(c.ratings)) {
        if (typeof rowId === 'string' && isRating(rating)) review = reduceReview(review, { type: 'rate', categoryId, rowId, rating })
      }
      for (const [elementId, answer] of entries(c.checklist)) {
        if (typeof elementId === 'string' && isAnswer(answer)) review = reduceReview(review, { type: 'check', categoryId, elementId, answer })
      }
    }
    reviews.set(key, review)
  }
  // A document with no `edits` field (written by slice 1) passes `undefined`
  // to `entries`, which yields nothing.
  return { header, reviews, edits: restoreEdits(value.edits) }
}
