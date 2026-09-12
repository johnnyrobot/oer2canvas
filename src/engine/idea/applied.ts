/**
 * The Applied list's rows: every edit in the map, judged against the CURRENT
 * bytes of its section.
 *
 * `stale` is computed here rather than carried in the map: the map records a
 * decision, not whether it landed. After a replace the original is GONE by
 * design, so a stale replace is one where neither the original nor the
 * replacement is at that element; a keep is stale once the original is gone.
 *
 * `category` is what files the row under one panel. An edit made since
 * slice 4 carries the category of the finding it answered (a 7.2 draft
 * accepted files under 7.2). An older edit carries none, and its key names
 * text, not a rule — so for those the category is read off the ORIGINAL text
 * against the term list (a gendered noun files under 7.3, everything else the
 * rules know under 7.6). Text no rule recognises files under 7.6, the
 * terminology category, where most edits come from.
 *
 * An image edit (slice 5) is present while its figure is in the bytes, and
 * files under 7.1, the only category that adds images.
 */
import type { CategoryId } from './framework'
import { termCategoryOf } from './terms'
import { findOccurrence } from './text'
import { ideaFigureId, parseIdeaEditKey, type IdeaEdit, type IdeaEdits } from './edits'

export interface AppliedEdit {
  key: string
  edit: IdeaEdit
  stale: boolean
  sectionTitle: string
  category: CategoryId
}

const FALLBACK: CategoryId = '7.6'

export function appliedEdits(
  sections: readonly { id: string; title: string; html: string }[],
  edits: IdeaEdits,
): AppliedEdit[] {
  return [...edits.edits.entries()].map(([key, edit]) => {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(key)
    const section = sections.find((s) => s.id === sectionId)
    const doc = new DOMParser().parseFromString(`<body>${section?.html ?? ''}</body>`, 'text/html')
    if (edit.kind === 'image') {
      return { key, edit, stale: doc.getElementById(ideaFigureId(edit)) === null, sectionTitle: section?.title ?? '', category: '7.1' }
    }
    const el = doc.getElementById(elementId)
    const present = el !== null && (
      (edit.kind === 'replace' && (el.textContent ?? '').includes(edit.replacement)) ||
      (edit.kind === 'keep' && findOccurrence(el, original, occurrence) !== undefined)
    )
    return {
      key, edit, stale: !present, sectionTitle: section?.title ?? '', category: edit.category ?? termCategoryOf(original) ?? FALLBACK,
    }
  })
}
