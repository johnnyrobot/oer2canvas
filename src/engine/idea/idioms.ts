/**
 * 7.6 idioms and colloquialisms. Observations only: the Framework says to
 * CLARIFY, not remove, so the suggestion is a parenthetical gloss the
 * instructor may accept as a replace edit ("hit the books (study hard)").
 */
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { blockElements, countOccurrences, textNodesOf } from './text'
import { textBefore } from './terms'
import data from './data/idea-idioms.json'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED = data.idioms.map((i) => ({
  ...i,
  re: new RegExp(`(?<![\\w-])${escape(i.phrase)}(?![\\w-])`, 'gi'),
}))

export const findIdioms: Finder = (sectionId, html) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: IdeaFinding[] = []
  for (const el of blockElements(doc.body)) {
    const elementId = el.getAttribute('id')
    if (!elementId) continue
    for (const node of textNodesOf(el)) {
      for (const c of COMPILED) {
        c.re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = c.re.exec(node.data)) !== null) {
          const original = m[0]
          const occurrence = countOccurrences(textBefore(el, node, m.index), original)
          out.push({
            kind: 'observation',
            key: ideaEditKey(sectionId, elementId, occurrence, original),
            category: '7.6',
            sectionId,
            elementId,
            columns: { idiom: c.phrase, gloss: c.gloss, suggestion: `${original} (${c.gloss})` },
            rule: { id: `idiom-${c.phrase.replace(/\s+/g, '-')}`, source: 'idiom' },
            origin: 'rule',
          })
        }
      }
    }
  }
  return out
}
