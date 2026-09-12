/**
 * 7.6 idioms and colloquialisms. Observations only: the Framework says to
 * CLARIFY, not remove, so the suggestion is a parenthetical gloss the
 * instructor may accept as a replace edit ("hit the books (study hard)").
 */
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { matchPhrases, phrasePattern } from './text'
import data from './data/idea-idioms.json'

const COMPILED = data.idioms.map((i) => ({ ...i, re: phrasePattern(i.phrase) }))

export const findIdioms: Finder = (sectionId, html) =>
  matchPhrases(html, COMPILED).map<IdeaFinding>(({ pattern: c, elementId, original, occurrence }) => ({
    kind: 'observation',
    key: ideaEditKey(sectionId, elementId, occurrence, original),
    category: '7.6',
    sectionId,
    elementId,
    columns: { idiom: c.phrase, gloss: c.gloss, suggestion: `${original} (${c.gloss})` },
    rule: { id: `idiom-${c.phrase.replace(/\s+/g, '-')}`, source: 'idiom' },
    origin: 'rule',
  }))
