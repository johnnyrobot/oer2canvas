/**
 * What a check surfaced about a section. Ephemeral: recomputed whenever the
 * section's html changes, never persisted — the human's decision is what is
 * kept, in `IdeaEdits`.
 *
 * `origin` is set by the producer and rendered by the panel. A rule finding
 * says "a style guide says"; a draft finding (slice 4) says "a model suggested".
 * The distinction is visual by construction, not by convention.
 */
import type { CategoryId } from './framework'
import type { IdeaEdits } from './edits'
import { findTerms } from './terms'
import { findIdioms } from './idioms'
import { findImages } from './images'
import { findMetadata } from './metadata'

export type FindingOrigin = 'rule' | 'draft'

export interface RuleRef {
  id: string
  source: 'terms' | 'idiom' | 'inventory' | 'llm'
  note?: string
  sourceUrl?: string
}

export interface EditFinding {
  kind: 'edit'
  key: string
  category: CategoryId
  sectionId: string
  elementId: string
  original: string
  occurrence: number
  replacement: string
  inQuotation: boolean
  rule: RuleRef
  origin: FindingOrigin
}

export interface ObservationFinding {
  kind: 'observation'
  key: string
  category: CategoryId
  sectionId: string
  elementId?: string
  columns: Readonly<Record<string, string>>
  rule?: RuleRef
  origin: FindingOrigin
}

export type IdeaFinding = EditFinding | ObservationFinding

export type Finder = (sectionId: string, html: string) => IdeaFinding[]

export const RULE_FINDERS: readonly Finder[] = [findTerms, findIdioms, findImages, findMetadata]

export function findingsFor(section: { id: string; html: string }, edits: IdeaEdits): IdeaFinding[] {
  const out: IdeaFinding[] = []
  for (const find of RULE_FINDERS) {
    for (const f of find(section.id, section.html)) {
      if (edits.edits.has(f.key) || edits.dismissed.has(f.key)) continue
      out.push(f)
    }
  }
  return out
}

export function findingsByCategory(findings: readonly IdeaFinding[]): ReadonlyMap<CategoryId, IdeaFinding[]> {
  const by = new Map<CategoryId, IdeaFinding[]>()
  for (const f of findings) {
    const list = by.get(f.category) ?? []
    list.push(f)
    by.set(f.category, list)
  }
  return by
}
