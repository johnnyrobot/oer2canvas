/**
 * The Applied list's rows: every edit in the map, judged against the CURRENT
 * bytes of its section.
 *
 * `stale` is computed here rather than carried in the map: the map records a
 * decision, not whether it landed. After a replace the original is GONE by
 * design, so a stale replace is one where neither the original nor the
 * replacement is at that element; a keep is stale once the original is gone.
 *
 * `category` is what files the row under one panel. An edit's key does not
 * carry it — the key names text, not a rule — so the finders are run once more
 * WITHOUT suppression and the key is looked up among what they would have
 * said. An edit no finder recognises any more (its text is gone, or the rule
 * changed) is filed under 7.6, the terminology category, which is where most
 * edits come from and where a stale row is least surprising.
 */
import type { CategoryId } from './framework'
import { findingsFor } from './findings'
import { findOccurrence } from './text'
import { newEdits, parseIdeaEditKey, type IdeaEdit, type IdeaEdits } from './edits'

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
  if (edits.edits.size === 0) return []
  const categoryOf = new Map<string, CategoryId>()
  for (const s of sections) for (const f of findingsFor(s, newEdits())) categoryOf.set(f.key, f.category)

  return [...edits.edits.entries()].map(([key, edit]) => {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(key)
    const section = sections.find((s) => s.id === sectionId)
    const doc = new DOMParser().parseFromString(`<body>${section?.html ?? ''}</body>`, 'text/html')
    const el = doc.getElementById(elementId)
    const present = el !== null && (
      (edit.kind === 'replace' && (el.textContent ?? '').includes(edit.replacement)) ||
      (edit.kind === 'keep' && findOccurrence(el, original, occurrence) !== undefined)
    )
    return {
      key, edit, stale: !present, sectionTitle: section?.title ?? '', category: categoryOf.get(key) ?? FALLBACK,
    }
  })
}
