import { newHeader, newReview, reduceHeader, reduceReview } from './review'
import { RATING_LABEL, rubric1Filename, rubric1Json, rubric1Markdown, type Rubric1Context } from './rubric-export'

const ctx: Rubric1Context = {
  bookTitle: 'Human Biology',
  chapterTitle: '4: Nutrition',
  publisher: 'LibreTexts',
  sourceUrl: 'https://bio.libretexts.org/x',
  exportedAt: new Date('2026-09-11T17:30:00Z'),
}

function sample() {
  let h = newHeader()
  h = reduceHeader(h, { type: 'assessor', assessor: { name: 'A. Lee', title: 'Instructor', college: 'Foothill College' } })
  h = reduceHeader(h, { type: 'benchmark', bipocPercent: 62 })
  let r = newReview()
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.b', rating: 'exclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.c', rating: 'inclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'na' })
  r = reduceReview(r, { type: 'note', categoryId: '7.6', notes: 'No people are named | in this chapter.' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.5', answer: 'yes' })
  r = reduceReview(r, { type: 'summary', text: 'Images are the weak point.' })
  r = reduceReview(r, { type: 'suggestions', text: 'Swap the two stock photos in 4.2.' })
  return { review: r, header: h }
}

test('the Markdown carries the header, one row per rubric row, notes, counts, summary, suggestions, and the attribution', () => {
  const { review, header } = sample()
  const md = rubric1Markdown(review, header, ctx)
  expect(md).toContain('# IDEA Framework — Rubric 1')
  expect(md).toContain('**Textbook/Publisher:** Human Biology (LibreTexts)')
  expect(md).toContain('**Chapter:** 4: Nutrition')
  expect(md).toContain('**Assessor:** A. Lee, Instructor, Foothill College')
  expect(md).toContain('**BIPOC benchmark used:** 62%')
  // Rubric 1's own category titles, which differ from the §7 headings.
  expect(md).toContain('| 7.1 Illustrations and Photos of People |')
  expect(md).toContain('| 7.8 Incorporating Diverse Perspectives |')
  // Three rows for 7.1, each with its own rating; one for 7.6.
  expect(md).toContain('| 7.1.a | Emerging Inclusive |')
  expect(md).toContain('| 7.1.b | Exclusive |')
  expect(md).toContain('| 7.1.c | Inclusive |')
  expect(md).toContain('| 7.6.a | Not Applicable |')
  // Unrated rows are stated as such, never blank.
  expect(md).toContain('| 7.2.a | Not rated |')
  // A pipe in notes must not break the table.
  expect(md).toContain('No people are named \\| in this chapter.')
  expect(md).toContain('7.6.5: yes')
  // Rubric 1's footer blocks.
  expect(md).toContain('## Category count')
  expect(md).toContain('- Exclusive: 1')
  expect(md).toContain('- Emerging Inclusive: 1')
  expect(md).toContain('- Inclusive: 1')
  expect(md).toContain('- Not Applicable: 1')
  expect(md).toContain('- Not rated: 6')
  expect(md).toContain('## Summary\n\nImages are the weak point.')
  expect(md).toContain('## Suggestions\n\nSwap the two stock photos in 4.2.')
  expect(md).toContain('CC BY 4.0')
  expect(md).toContain('asccc-oeri.org')
})

test('the JSON mirrors the table and is stable in shape', () => {
  const { review, header } = sample()
  const j = rubric1Json(review, header, ctx)
  expect(j.format).toBe('oer2canvas-idea-rubric1')
  expect(j.version).toBe(1)
  expect(j.framework.license).toBe('CC BY 4.0')
  expect(j.textbook).toEqual({ title: 'Human Biology', publisher: 'LibreTexts', url: 'https://bio.libretexts.org/x' })
  expect(j.chapter).toBe('4: Nutrition')
  expect(j.assessor).toEqual({ name: 'A. Lee', title: 'Instructor', college: 'Foothill College' })
  expect(j.benchmark.bipocPercent).toBe(62)
  expect(j.exportedAt).toBe('2026-09-11T17:30:00.000Z')
  expect(j.areas).toHaveLength(8)
  const first = j.areas[0]!
  expect(first.id).toBe('7.1')
  expect(first.title).toBe('Illustrations and Photos of People')
  expect(first.rows.map((r) => r.rating)).toEqual(['emerging', 'exclusive', 'inclusive'])
  expect(first.rows[0]!.label).toBe(RATING_LABEL.emerging)
  const terms = j.areas.find((a) => a.id === '7.6')!
  expect(terms.notes).toBe('No people are named | in this chapter.')
  expect(terms.checklist).toEqual([{ id: '7.6.5', answer: 'yes' }])
  expect(j.areas.find((a) => a.id === '7.2')!.rows[0]!.rating).toBeNull()
  expect(j.counts).toEqual({ na: 1, exclusive: 1, emerging: 1, inclusive: 1, notRated: 6 })
  expect(j.summary).toBe('Images are the weak point.')
  expect(j.suggestions).toBe('Swap the two stock photos in 4.2.')
})

test('the filename is safe, dated, and carries the chapter', () => {
  const now = new Date('2026-09-11T17:30:00Z')
  expect(rubric1Filename('4: Nutrition / Vitamins', now, 'md')).toBe('idea-rubric1-4-nutrition-vitamins-2026-09-11.md')
  expect(rubric1Filename('', now, 'json')).toBe('idea-rubric1-chapter-2026-09-11.json')
})
