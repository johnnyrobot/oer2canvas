import { newHeader, reduceHeader } from './review'
import { planFilename, planJson, planMarkdown, planTableLines } from './plan-export'
import type { PlanDraft } from './llm/parse'

const draft: PlanDraft = {
  plan: [
    { priority: 2, where: '4.2 Nutrients', issue: 'one | outdated term', revision: 'replace', rationale: 'r2', licence: 'in-page' },
    { priority: 1, where: '4.1 Intro', issue: 'no Indigenous perspective', revision: 'add a paragraph', rationale: 'r1', licence: 'course-level supplement' },
  ],
  studentText: [{ where: '4.1 Intro', purpose: 'framing', text: 'Before reading, note that…' }],
}
const header = reduceHeader(newHeader(), { type: 'assessor', assessor: { name: 'A. Lee', title: 'Instructor', college: 'Foothill' } })
const ctx = { bookTitle: 'Human Biology', chapterTitle: '4: Nutrition', header, exportedAt: new Date('2026-09-13T10:00:00Z'), provenance: { provider: 'Gemini', draftedAt: new Date('2026-09-13T09:00:00Z') } }

test('the table is sorted by priority and escapes pipes', () => {
  const lines = planTableLines(draft.plan)
  expect(lines[0]).toBe('| Priority | Where | Issue | Revision | Rationale | Licence |')
  expect(lines[2]).toContain('| 1 | 4.1 Intro |')
  expect(lines[3]).toContain('one \\| outdated term')
})

test('Markdown carries the header, the plan, the student drafts, both attributions, and the provenance sentence', () => {
  const md = planMarkdown(draft, ctx)
  expect(md).toContain('# IDEA Framework — Revision plan')
  expect(md).toContain('**Chapter:** 4: Nutrition')
  expect(md).toContain('**Assessor:** A. Lee, Instructor, Foothill')
  expect(md).toContain('## Student-facing drafts')
  expect(md).toContain('Before reading, note that…')
  expect(md).toContain('Gen-AI Crosswalk Instructions')
  expect(md).toContain('The revision plan was drafted by Gemini on 2026-09-13 and has not been verified')
  expect(md).toContain('entered by the assessor named above')
  expect(md).not.toContain('Region')
})

test('JSON is stable and the filename is slugged and dated', () => {
  const j = planJson(draft, ctx)
  expect(j.format).toBe('oer2canvas-idea-revision-plan')
  expect(j.plan.map((p) => p.priority)).toEqual([1, 2])
  expect(j.drafted).toEqual({ provider: 'Gemini', at: '2026-09-13T09:00:00.000Z' })
  expect(planFilename('4: Nutrition', ctx.exportedAt, 'md')).toBe('idea-revision-plan-4-nutrition-2026-09-13.md')
})
