/**
 * 7.6 Appropriate Terminology and 7.3 Gender-Inclusive Language, by list.
 *
 * Phrase matching at word boundaries, case-insensitive, inside ONE text node
 * (`matchPhrases` in `text.ts`). The occurrence index is computed against the
 * text AS WRITTEN (case preserved) so that `applyIdeaEdits`, which is
 * case-sensitive, finds the same place.
 *
 * A rule with `edit: false` yields an observation: the pronoun rewrites the
 * Framework assigns to the author.
 */
import type { CategoryId } from './framework'
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { isQuotation, matchPhrases, phrasePattern } from './text'
import data from './data/idea-terms.json'

interface TermRule {
  id: string
  category: string
  inconsiderate: string[]
  considerate: string[]
  note: string
  source: string
  edit: boolean
}

const COMPILED: { rule: TermRule; phrase: string; replacement: string; re: RegExp }[] = (data.rules as TermRule[]).flatMap(
  (rule) =>
    rule.inconsiderate.map((phrase, i) => ({
      rule,
      phrase,
      replacement: rule.considerate[i] ?? rule.considerate[0]!,
      re: phrasePattern(phrase),
    })),
)

const categoryOf = (rule: TermRule): CategoryId => (rule.category === 'gender' ? '7.3' : '7.6')

/**
 * The category a phrase would be reported under, from the phrase alone. An
 * applied edit's key carries the original text but not the rule, and once
 * the replacement is in the bytes no finder will produce that key again —
 * so the Applied list asks the list directly.
 */
export function termCategoryOf(phrase: string): CategoryId | undefined {
  const needle = phrase.trim().toLowerCase()
  const hit = COMPILED.find((c) => c.phrase === needle)
  return hit ? categoryOf(hit.rule) : undefined
}

export const findTerms: Finder = (sectionId, html) =>
  matchPhrases(html, COMPILED).map<IdeaFinding>(({ pattern: c, elementId, element, original, occurrence }) => {
    const key = ideaEditKey(sectionId, elementId, occurrence, original)
    const rule = { id: c.rule.id, source: 'terms' as const, note: c.rule.note, sourceUrl: c.rule.source }
    const category = categoryOf(c.rule)
    if (c.rule.edit) {
      return {
        kind: 'edit', key, category, sectionId, elementId, original, occurrence,
        replacement: c.replacement, inQuotation: isQuotation(element), rule, origin: 'rule',
      }
    }
    // `edit: false` (the pronoun rules): the considerate form is shown as a
    // column to read, not as `suggestion`, which the row would offer with a
    // one-click Use — and spec §3.1 leaves a pronoun rewrite to the author.
    return {
      kind: 'observation', key, category, sectionId, elementId,
      columns: { text: original, alternative: c.replacement, context: (element.textContent ?? '').slice(0, 160) },
      rule, origin: 'rule',
    }
  })
