import { newHeader } from './review'
import { bookPatternsFilename, bookPatternsJson, bookPatternsMarkdown } from './book-export'
import type { BookDraft } from './llm/parse'

const draft: BookDraft = {
  summary: 'Strong on 7.1, weak on 7.4.',
  areas: [{ area: '7.1', rating: 'inclusive', notes: 'varied | photos' }, { area: '7.4', rating: null, notes: 'no draft' }],
  revisions: [{ where: 'Ch 5', revision: 'cite Indigenous scholars', rationale: '7.4 unmet' }],
}
const ctx = { bookTitle: 'Human Biology', chapterTitles: ['4: Nutrition', '5: Digestion'], header: newHeader(), exportedAt: new Date('2026-09-13T10:00:00Z'), provenance: { provider: 'OpenRouter', draftedAt: new Date('2026-09-13T09:30:00Z') } }

test('Markdown lists the chapters, the area table with rating labels, the revisions, and the provenance sentence', () => {
  const md = bookPatternsMarkdown(draft, ctx)
  expect(md).toContain('# IDEA Framework — Chapter-level patterns')
  expect(md).toContain('**Chapters reviewed:** 4: Nutrition; 5: Digestion')
  expect(md).toContain('| 7.1 Illustrations and Photos of People | Inclusive | varied \\| photos |')
  expect(md).toContain('| 7.4 Diverse Authors, Researchers, and Studies | no draft | no draft |')
  expect(md).toContain('| Ch 5 | cite Indigenous scholars | 7.4 unmet |')
  expect(md).toContain('The pattern review was drafted by OpenRouter on 2026-09-13 and has not been verified')
})

test('JSON and filename', () => {
  const j = bookPatternsJson(draft, ctx)
  expect(j.format).toBe('oer2canvas-idea-book-patterns')
  expect(j.areas[0]).toEqual({ id: '7.1', title: 'Illustrations and Photos of People', rating: 'inclusive', label: 'Inclusive', notes: 'varied | photos' })
  expect(bookPatternsFilename('Human Biology', ctx.exportedAt, 'json')).toBe('idea-book-patterns-human-biology-2026-09-13.json')
})
