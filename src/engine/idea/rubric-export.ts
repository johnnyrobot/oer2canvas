/**
 * Rubric 1 as a file the instructor can keep or submit.
 *
 * Markdown for reading, JSON for machines; both carry the same content in the
 * same order Appendix A does — header, one row per rubric row with notes
 * under each category, the Category Count block, Summary, Suggestions — so a
 * future OERI submission form has something it can consume. Area titles are
 * Rubric 1's own, not the §7 headings, for the same reason.
 *
 * Edition is not exported: the app does not know it. The header line reads
 * "Textbook/Publisher" and the instructor adds an edition by hand if OERI
 * wants one.
 *
 * Spec §2.5's appendix: the edits applied and the images added, from the
 * same Applied list the screen shows (`appliedEdits`), so the file says what
 * the cartridge will carry. A stale edit — one whose text is no longer at
 * its element — is listed and marked, not dropped: it was a decision.
 *
 * DOWNLOAD ONLY. Nothing here is ever packaged into the cartridge: the rubric
 * is about the material, not for the students who will read it.
 */
import { FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK } from './framework'
import type { AppliedEdit } from './applied'
import { parseIdeaEditKey } from './edits'
import { RATING_LABEL, ratingCounts, type ChecklistAnswer, type IdeaHeader, type IdeaReview, type Rating } from './review'

export { RATING_LABEL }

export interface Rubric1Context {
  bookTitle: string
  chapterTitle: string
  publisher?: string
  sourceUrl?: string
  exportedAt: Date
  /** The chapter's Applied list; absent (slice 1 callers) exports no appendix. */
  applied?: readonly AppliedEdit[]
}

const NOT_RATED = 'Not rated'

/** One applied text edit, as the appendix lists it. */
export interface AppliedEditJson {
  category: string
  section: string
  original: string
  /** The replacement, or for a keep the parenthetical added (empty if none). */
  replacement: string
  kind: 'replace' | 'keep'
  /** No longer at its element in the current bytes. */
  stale: boolean
}

/** One image added, as the appendix lists it. */
export interface AddedImageJson {
  section: string
  alt: string
  caption: string
  /** Title · Author · Source · License, as the page credits it. */
  credit: string
  license: string
  sourcePageUrl: string
  stale: boolean
}

function appendixOf(applied: readonly AppliedEdit[]): { edits: AppliedEditJson[]; images: AddedImageJson[] } {
  const edits: AppliedEditJson[] = []
  const images: AddedImageJson[] = []
  for (const a of applied) {
    if (a.edit.kind === 'image') {
      images.push({
        section: a.sectionTitle, alt: a.edit.alt, caption: a.edit.caption, credit: a.edit.attribution.text,
        license: a.edit.attribution.licenseName, sourcePageUrl: a.edit.attribution.sourcePageUrl, stale: a.stale,
      })
      continue
    }
    edits.push({
      category: a.category, section: a.sectionTitle, original: parseIdeaEditKey(a.key).original,
      replacement: a.edit.kind === 'replace' ? a.edit.replacement : (a.edit.context ?? ''),
      kind: a.edit.kind, stale: a.stale,
    })
  }
  return { edits, images }
}

export interface Rubric1Json {
  format: 'oer2canvas-idea-rubric1'
  version: 1
  framework: { title: string; url: string; license: string }
  textbook: { title: string; publisher?: string; url?: string }
  chapter: string
  assessor: { name: string; title: string; college: string }
  benchmark: { bipocPercent: number }
  exportedAt: string
  areas: {
    id: string
    title: string
    rows: { id: string; rating: Rating | null; label: string }[]
    notes: string
    checklist: { id: string; answer: ChecklistAnswer }[]
  }[]
  counts: Readonly<Record<Rating | 'notRated', number>>
  summary: string
  suggestions: string
  /** Present when the caller supplied the Applied list (spec §2.5). */
  applied?: { edits: AppliedEditJson[]; images: AddedImageJson[] }
}

export function rubric1Json(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): Rubric1Json {
  return {
    format: 'oer2canvas-idea-rubric1',
    version: 1,
    framework: {
      title: FRAMEWORK_ATTRIBUTION.title,
      url: FRAMEWORK_ATTRIBUTION.url,
      license: FRAMEWORK_ATTRIBUTION.license.name,
    },
    textbook: {
      title: ctx.bookTitle,
      ...(ctx.publisher ? { publisher: ctx.publisher } : {}),
      ...(ctx.sourceUrl ? { url: ctx.sourceUrl } : {}),
    },
    chapter: ctx.chapterTitle,
    assessor: { ...header.assessor },
    benchmark: { ...header.benchmark },
    exportedAt: ctx.exportedAt.toISOString(),
    areas: IDEA_FRAMEWORK.map((c) => {
      const r = review.categories[c.id]
      return {
        id: c.id,
        title: c.rubricTitle,
        rows: c.rows.map((row) => {
          const rating = r.ratings.get(row.id) ?? null
          return { id: row.id, rating, label: rating ? RATING_LABEL[rating] : NOT_RATED }
        }),
        notes: r.notes,
        checklist: c.elements
          .filter((e) => r.checklist.has(e.id))
          .map((e) => ({ id: e.id, answer: r.checklist.get(e.id)! })),
      }
    }),
    counts: ratingCounts(review),
    summary: review.summary,
    suggestions: review.suggestions,
    ...(ctx.applied ? { applied: appendixOf(ctx.applied) } : {}),
  }
}

/** A cell must not carry a bare pipe or a newline, or the table falls apart. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

export function rubric1Markdown(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): string {
  const j = rubric1Json(review, header, ctx)
  const lines: string[] = []
  lines.push('# IDEA Framework — Rubric 1')
  lines.push('')
  lines.push(`**Textbook/Publisher:** ${cell(ctx.bookTitle)}${ctx.publisher ? ` (${cell(ctx.publisher)})` : ''}`)
  if (ctx.sourceUrl) lines.push(`**Source:** ${ctx.sourceUrl}`)
  lines.push(`**Chapter:** ${cell(ctx.chapterTitle)}`)
  const a = header.assessor
  const who = [a.name, a.title, a.college].map((s) => s.trim()).filter(Boolean).join(', ')
  lines.push(`**Assessor:** ${who || '—'}`)
  lines.push(`**BIPOC benchmark used:** ${header.benchmark.bipocPercent}%`)
  lines.push(`**Exported:** ${j.exportedAt}`)
  lines.push('')
  lines.push('| Area | Row | Rating | Notes |')
  lines.push('| --- | --- | --- | --- |')
  for (const area of j.areas) {
    area.rows.forEach((row, i) => {
      const areaCell = i === 0 ? `${area.id} ${cell(area.title)}` : ''
      const notes = i === 0 ? cell(area.notes) : ''
      lines.push(`| ${areaCell} | ${row.id} | ${row.label} | ${notes} |`)
    })
  }
  lines.push('')
  lines.push('## Category count')
  lines.push('')
  lines.push(`- ${RATING_LABEL.exclusive}: ${j.counts.exclusive}`)
  lines.push(`- ${RATING_LABEL.emerging}: ${j.counts.emerging}`)
  lines.push(`- ${RATING_LABEL.inclusive}: ${j.counts.inclusive}`)
  lines.push(`- ${RATING_LABEL.na}: ${j.counts.na}`)
  lines.push(`- ${NOT_RATED}: ${j.counts.notRated}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(j.summary.trim() || '—')
  lines.push('')
  lines.push('## Suggestions')
  lines.push('')
  lines.push(j.suggestions.trim() || '—')
  lines.push('')
  lines.push('## Elements for consideration')
  lines.push('')
  for (const area of j.areas) {
    if (area.checklist.length === 0) continue
    lines.push(`- ${area.id} ${cell(area.title)}: ${area.checklist.map((c) => `${c.id}: ${c.answer}`).join('; ')}`)
  }
  if (j.applied) {
    lines.push('')
    lines.push('## Appendix: edits applied')
    lines.push('')
    if (j.applied.edits.length === 0) lines.push('None.')
    else {
      lines.push('| Area | Section | Original | Replacement | Note |')
      lines.push('| --- | --- | --- | --- | --- |')
      for (const e of j.applied.edits) {
        const note = [e.kind === 'keep' ? 'kept as written' : '', e.stale ? 'no longer matches; not applied' : ''].filter(Boolean).join('; ')
        lines.push(`| ${e.category} | ${cell(e.section)} | ${cell(e.original)} | ${cell(e.replacement)} | ${note} |`)
      }
    }
    lines.push('')
    lines.push('## Appendix: images added')
    lines.push('')
    if (j.applied.images.length === 0) lines.push('None.')
    else {
      lines.push('| Section | Alt text | Credit | Note |')
      lines.push('| --- | --- | --- | --- |')
      for (const i of j.applied.images) {
        lines.push(`| ${cell(i.section)} | ${cell(i.alt)} | ${cell(i.credit)} (${i.sourcePageUrl}) | ${i.stale ? 'no longer in the chapter' : ''} |`)
      }
    }
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(
    `Rubric and category text from "${FRAMEWORK_ATTRIBUTION.title}" by ${FRAMEWORK_ATTRIBUTION.author}, ` +
      `${FRAMEWORK_ATTRIBUTION.url}, licensed ${FRAMEWORK_ATTRIBUTION.license.name} (${FRAMEWORK_ATTRIBUTION.license.url}). ` +
      'Ratings, notes, checklist answers, summary, and suggestions were entered by the assessor named above; none were produced by software.',
  )
  lines.push('')
  return lines.join('\n')
}

export function rubric1Filename(chapterTitle: string, now: Date, ext: 'md' | 'json'): string {
  const slug = chapterTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const date = now.toISOString().slice(0, 10)
  return `idea-rubric1-${slug || 'chapter'}-${date}.${ext}`
}
