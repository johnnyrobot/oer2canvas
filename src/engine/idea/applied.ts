/**
 * The Applied list's rows: every edit in the map, judged against the CURRENT
 * bytes of its section.
 *
 * `stale` is computed here rather than carried in the map: the map records a
 * decision, not whether it landed. After a replace the original is GONE by
 * design, so a stale replace is one where neither the original nor the
 * replacement is at that element; a keep is stale once the original is gone.
 *
 * `category` is what files the row under one panel. An edit's key names text,
 * not a rule, and once a replacement is in the bytes no finder would produce
 * that key again — so the category is read off the ORIGINAL text against the
 * term list (a gendered noun files under 7.3, everything else the rules know
 * under 7.6). Text no rule recognises — an idiom gloss, or a phrase the list
 * has since dropped — files under 7.6, the terminology category, where most
 * edits come from. When slice 4 adds model drafts in other categories, the
 * edit itself should carry its category; the key cannot.
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
      key, edit, stale: !present, sectionTitle: section?.title ?? '', category: termCategoryOf(original) ?? FALLBACK,
    }
  })
}
