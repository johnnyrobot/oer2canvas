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

/** The element a finding is about: outlined in the render while the finding's row has focus. */
export interface FindingTarget {
  sectionId: string
  elementId: string
}

export type Finder = (sectionId: string, html: string) => IdeaFinding[]

/**
 * A finder and the categories it reports under. The categories are declared,
 * not inferred from output, because a finder that THROWS produces no output
 * to infer from — and spec §7.1 wants the failure pinned to a category.
 */
export interface RuleFinder {
  categories: readonly CategoryId[]
  find: Finder
}

export const RULE_FINDERS: readonly RuleFinder[] = [
  { categories: ['7.3', '7.6'], find: findTerms },
  { categories: ['7.6'], find: findIdioms },
  { categories: ['7.1'], find: findImages },
  { categories: ['7.7'], find: findMetadata },
]

/** A rule check that threw: which category, on which section, and what it said. */
export interface CheckFailure {
  category: CategoryId
  sectionId: string
  message: string
}

/**
 * Every finder over one section, each on its own. Spec §7.1: a rule-check
 * exception is caught per category per section and everything else still
 * runs — one bad regex against one odd paragraph must not blank the phase.
 * Findings whose key the instructor has already decided on are dropped.
 */
export function checkSection(
  section: { id: string; html: string },
  edits: IdeaEdits,
  finders: readonly RuleFinder[] = RULE_FINDERS,
): { findings: IdeaFinding[]; failures: CheckFailure[] } {
  const findings: IdeaFinding[] = []
  const failures: CheckFailure[] = []
  for (const { categories, find } of finders) {
    try {
      for (const f of find(section.id, section.html)) {
        if (edits.edits.has(f.key) || edits.dismissed.has(f.key)) continue
        findings.push(f)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      for (const category of categories) failures.push({ category, sectionId: section.id, message })
    }
  }
  return { findings, failures }
}

/** The findings alone, for callers that have nowhere to show a failure. */
export function findingsFor(section: { id: string; html: string }, edits: IdeaEdits): IdeaFinding[] {
  return checkSection(section, edits).findings
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
