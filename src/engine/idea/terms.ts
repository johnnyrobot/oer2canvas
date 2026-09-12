/**
 * 7.6 Appropriate Terminology and 7.3 Gender-Inclusive Language, by list.
 *
 * Phrase matching at word boundaries, case-insensitive, inside ONE text node
 * (see `text.ts`). The occurrence index is computed against the text AS
 * WRITTEN (case preserved) so that `applyIdeaEdits`, which is case-sensitive,
 * finds the same place.
 *
 * A rule with `edit: false` yields an observation: the pronoun rewrites the
 * Framework assigns to the author.
 */
import type { CategoryId } from './framework'
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { blockElements, countOccurrences, isQuotation, textNodesOf } from './text'
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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED: { rule: TermRule; phrase: string; replacement: string; re: RegExp }[] = (data.rules as TermRule[]).flatMap(
  (rule) =>
    rule.inconsiderate.map((phrase, i) => ({
      rule,
      phrase,
      replacement: rule.considerate[i] ?? rule.considerate[0]!,
      // `(?<![\w-])` and `(?![\w-])`: word boundaries that also refuse a hyphen
      // neighbour, so "crazy" does not fire inside "crazy-quilt" and "the blind"
      // does not fire inside "the blind-spot".
      re: new RegExp(`(?<![\\w-])${escape(phrase)}(?![\\w-])`, 'gi'),
    })),
)

const categoryOf = (rule: TermRule): CategoryId => (rule.category === 'gender' ? '7.3' : '7.6')

export const findTerms: Finder = (sectionId, html) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: IdeaFinding[] = []
  for (const el of blockElements(doc.body)) {
    const elementId = el.getAttribute('id')
    if (!elementId) continue
    const quoted = isQuotation(el)
    const fullText = el.textContent ?? ''
    for (const node of textNodesOf(el)) {
      for (const c of COMPILED) {
        c.re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = c.re.exec(node.data)) !== null) {
          const original = m[0]
          // Occurrence counted over the block's WHOLE text up to this node and
          // offset, so the index matches what `findOccurrence` will count.
          const before = textBefore(el, node, m.index)
          const occurrence = countOccurrences(before, original)
          const key = ideaEditKey(sectionId, elementId, occurrence, original)
          const rule = { id: c.rule.id, source: 'terms' as const, note: c.rule.note, sourceUrl: c.rule.source }
          if (c.rule.edit) {
            out.push({
              kind: 'edit', key, category: categoryOf(c.rule), sectionId, elementId, original, occurrence,
              replacement: c.replacement, inQuotation: quoted, rule, origin: 'rule',
            })
          } else {
            out.push({
              kind: 'observation', key, category: categoryOf(c.rule), sectionId, elementId,
              columns: { text: original, suggestion: c.replacement, context: fullText.slice(0, 160) },
              rule, origin: 'rule',
            })
          }
        }
      }
    }
  }
  return out
}

/**
 * The block's text strictly before `offset` in `node` — every earlier text
 * node plus this node's prefix.
 *
 * `findOccurrence` counts node by node and never spans two, while this
 * concatenates earlier nodes, so a phrase straddling two EARLIER nodes is
 * counted here and not there. The phrase itself would have to contain an
 * inline boundary, and the only effect is that the edit later fails to match
 * and is dropped with a note — the fail-safe branch, never a wrong replacement.
 */
export function textBefore(el: Element, node: Text, offset: number): string {
  let s = ''
  for (const t of textNodesOf(el)) {
    if (t === node) return s + t.data.slice(0, offset)
    s += t.data
  }
  return s
}
