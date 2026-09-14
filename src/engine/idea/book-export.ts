/**
 * The book-level pattern review as a file. Download only; never in a
 * chapter's Rubric 1 file and never in the cartridge. There is no human
 * rating at book level, so every rating here is the model's, labelled so.
 */
import { categoryById } from './framework'
import { RATING_LABEL, type IdeaHeader, type Rating } from './review'
import type { BookDraft } from './llm/parse'
import { cell, slug, type DraftProvenance } from './export-text'
import { assessorLine, attributionFooter } from './plan-export'

export interface BookExportContext {
  bookTitle: string
  chapterTitles: readonly string[]
  header: IdeaHeader
  exportedAt: Date
  provenance: DraftProvenance
}

export interface BookPatternsJson {
  format: 'oer2canvas-idea-book-patterns'
  version: 1
  textbook: { title: string }
  chapters: string[]
  assessor: { name: string; title: string; college: string }
  exportedAt: string
  drafted: { provider: string; at: string }
  summary: string
  areas: { id: string; title: string; rating: Rating | null; label: string; notes: string }[]
  revisions: BookDraft['revisions']
}

const NO_DRAFT = 'no draft'

export function bookPatternsJson(draft: BookDraft, ctx: BookExportContext): BookPatternsJson {
  return {
    format: 'oer2canvas-idea-book-patterns', version: 1,
    textbook: { title: ctx.bookTitle }, chapters: [...ctx.chapterTitles],
    assessor: { ...ctx.header.assessor }, exportedAt: ctx.exportedAt.toISOString(),
    drafted: { provider: ctx.provenance.provider, at: ctx.provenance.draftedAt.toISOString() },
    summary: draft.summary,
    areas: draft.areas.map((a) => ({ id: a.area, title: categoryById(a.area).rubricTitle, rating: a.rating, label: a.rating ? RATING_LABEL[a.rating] : NO_DRAFT, notes: a.notes })),
    revisions: draft.revisions,
  }
}

export function bookPatternsMarkdown(draft: BookDraft, ctx: BookExportContext): string {
  const j = bookPatternsJson(draft, ctx)
  const lines: string[] = [
    '# IDEA Framework — Chapter-level patterns', '',
    `**Textbook:** ${cell(ctx.bookTitle)}`, `**Chapters reviewed:** ${ctx.chapterTitles.map(cell).join('; ')}`,
    `**Assessor:** ${assessorLine(ctx.header)}`, `**Exported:** ${j.exportedAt}`, '',
    '## Summary', '', j.summary.trim() || '—', '',
    '## Areas (model draft, unverified)', '',
    '| Area | Rating | Notes |', '| --- | --- | --- |',
  ]
  for (const a of j.areas) lines.push(`| ${a.id} ${cell(a.title)} | ${a.label} | ${cell(a.notes) || NO_DRAFT} |`)
  lines.push('', '## Prioritized revisions or supplements', '')
  if (j.revisions.length === 0) lines.push('None.')
  else {
    lines.push('| Where | Revision or supplement | Rationale |', '| --- | --- | --- |')
    for (const r of j.revisions) lines.push(`| ${cell(r.where)} | ${cell(r.revision)} | ${cell(r.rationale)} |`)
  }
  lines.push('', ...attributionFooter('pattern review', ctx.provenance))
  return lines.join('\n')
}

export function bookPatternsFilename(bookTitle: string, now: Date, ext: 'md' | 'json'): string {
  return `idea-book-patterns-${slug(bookTitle) || 'book'}-${now.toISOString().slice(0, 10)}.${ext}`
}
