/**
 * The revision plan as a file. Download only, like Rubric 1. Both lists go
 * here; only the instructor-facing `plan` also goes into the chapter's
 * Rubric 1 file (spec §4.3), through `planTableLines`.
 */
import { CROSSWALK_ATTRIBUTION, FRAMEWORK_ATTRIBUTION } from './framework'
import type { IdeaHeader } from './review'
import type { PlanDraft } from './llm/parse'
import { ASSESSOR_SENTENCE, cell, provenanceSentence, slug, type DraftProvenance } from './export-text'

export interface PlanExportContext {
  bookTitle: string
  chapterTitle: string
  header: IdeaHeader
  exportedAt: Date
  provenance: DraftProvenance
}

export interface PlanJson {
  format: 'oer2canvas-idea-revision-plan'
  version: 1
  textbook: { title: string }
  chapter: string
  assessor: { name: string; title: string; college: string }
  exportedAt: string
  drafted: { provider: string; at: string }
  plan: PlanDraft['plan']
  studentText: PlanDraft['studentText']
}

const byPriority = (plan: PlanDraft['plan']) => [...plan].sort((a, b) => a.priority - b.priority)

export function planTableLines(plan: PlanDraft['plan']): string[] {
  const lines = ['| Priority | Where | Issue | Revision | Rationale | Licence |', '| --- | --- | --- | --- | --- | --- |']
  for (const p of byPriority(plan)) lines.push(`| ${p.priority} | ${cell(p.where)} | ${cell(p.issue)} | ${cell(p.revision)} | ${cell(p.rationale)} | ${cell(p.licence)} |`)
  return lines
}

export function planJson(draft: PlanDraft, ctx: PlanExportContext): PlanJson {
  return {
    format: 'oer2canvas-idea-revision-plan', version: 1,
    textbook: { title: ctx.bookTitle }, chapter: ctx.chapterTitle,
    assessor: { ...ctx.header.assessor }, exportedAt: ctx.exportedAt.toISOString(),
    drafted: { provider: ctx.provenance.provider, at: ctx.provenance.draftedAt.toISOString() },
    plan: byPriority(draft.plan), studentText: draft.studentText,
  }
}

export function assessorLine(header: IdeaHeader): string {
  const a = header.assessor
  return [a.name, a.title, a.college].map((s) => s.trim()).filter(Boolean).join(', ') || '—'
}

export function attributionFooter(what: 'pattern review' | 'revision plan', p: DraftProvenance): string[] {
  return [
    '---', '',
    `Rubric and category text from "${FRAMEWORK_ATTRIBUTION.title}" by ${FRAMEWORK_ATTRIBUTION.author}, ${FRAMEWORK_ATTRIBUTION.url}, licensed ${FRAMEWORK_ATTRIBUTION.license.name}. ` +
    `Method from "${CROSSWALK_ATTRIBUTION.title}" by ${CROSSWALK_ATTRIBUTION.author}, licensed ${CROSSWALK_ATTRIBUTION.license.name}. ` +
    `${ASSESSOR_SENTENCE} ${provenanceSentence(what, p)}`,
    '',
  ]
}

export function planMarkdown(draft: PlanDraft, ctx: PlanExportContext): string {
  const j = planJson(draft, ctx)
  const lines: string[] = [
    '# IDEA Framework — Revision plan', '',
    `**Textbook:** ${cell(ctx.bookTitle)}`, `**Chapter:** ${cell(ctx.chapterTitle)}`,
    `**Assessor:** ${assessorLine(ctx.header)}`, `**Exported:** ${j.exportedAt}`, '',
    '## Revision plan', '',
  ]
  if (j.plan.length === 0) lines.push('None.')
  else lines.push(...planTableLines(j.plan))
  lines.push('', '## Student-facing drafts', '')
  if (j.studentText.length === 0) lines.push('None.')
  for (const s of j.studentText) lines.push(`### ${cell(s.where)} — ${cell(s.purpose)}`, '', s.text.trim(), '')
  lines.push(...attributionFooter('revision plan', ctx.provenance))
  return lines.join('\n')
}

export function planFilename(chapterTitle: string, now: Date, ext: 'md' | 'json'): string {
  return `idea-revision-plan-${slug(chapterTitle) || 'chapter'}-${now.toISOString().slice(0, 10)}.${ext}`
}
