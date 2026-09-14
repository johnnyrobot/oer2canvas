/**
 * What the three IDEA downloads share: the Markdown cell rule, the filename
 * slug, and the provenance sentence every file that carries model output
 * ends with. One copy each, so the Rubric 1 file, the book file, and the
 * plan file say the same thing the same way.
 */
import { CROSSWALK_ATTRIBUTION } from './framework'

/** A cell must not carry a bare pipe or a newline, or the table falls apart. */
export const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

export interface DraftProvenance {
  /** The provider's label, e.g. "Gemini". */
  provider: string
  draftedAt: Date
}

export const ASSESSOR_SENTENCE =
  'Ratings, notes, checklist answers, summary, and suggestions were entered by the assessor named above.'

/** Spec §5.1. The Rubric 1 file adds this only when it carries a plan. */
export function provenanceSentence(what: 'pattern review' | 'revision plan', p: DraftProvenance): string {
  return `The ${what} was drafted by ${p.provider} on ${p.draftedAt.toISOString().slice(0, 10)} and has not been verified; ` +
    `it is a draft in the sense of OERI's Gen-AI Crosswalk Instructions (${CROSSWALK_ATTRIBUTION.url}).`
}
