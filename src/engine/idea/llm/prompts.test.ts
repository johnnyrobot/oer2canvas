import {
  categoryPrompt, rubricPrompt, sectionText, bookPrompt, DRAFTABLE, filesUnder, type SectionInput,
} from './prompts'
import { categoryById } from '../framework'
import { newReview, reduceReview } from '../review'

const input: SectionInput = {
  sectionId: 's1', sectionTitle: '4.2 Nutrients', chapterTitle: '4: Nutrition', bookTitle: 'Biology',
  text: 'Indian spices are used as an example of phytochemicals.',
  images: [{ sectionId: 's1', elementId: 'i1', src: 'a.png', alt: 'A nurse', caption: 'Figure 1', mentionsPeople: true, presentational: false }],
  metadata: [{ sectionId: 's1', kind: 'heading', text: 'Key terms' }],
}

test('every category prompt inlines that category’s restorative requirement and elements, and the separation rule', () => {
  for (const c of ['7.1', '7.2', '7.4', '7.5', '7.7', '7.8'] as const) {
    const m = categoryPrompt(c, input)
    const all = m.map((x) => x.content).join('\n')
    expect(all).toContain(categoryById(c).restorative.slice(0, 60))
    expect(all).toContain(categoryById(c).elements[0]!.text.slice(0, 40))
    expect(all).toMatch(/separate what you see explicitly in the text from what you infer/i)
    expect(all).toContain('4: Nutrition')
    expect(all).toContain('Biology')
    expect(all).toMatch(/respond with json/i)
  }
})

test('7.1 sends the image inventory, not the section text; 7.7 sends the metadata inventory', () => {
  const p71 = categoryPrompt('7.1', input).map((x) => x.content).join('\n')
  expect(p71).toContain('A nurse')
  expect(p71).not.toContain('Indian spices')
  const p77 = categoryPrompt('7.7', input).map((x) => x.content).join('\n')
  expect(p77).toContain('Key terms')
})

test('7.5 asks for the five columns OERI names', () => {
  const p = categoryPrompt('7.5', input).map((x) => x.content).join('\n')
  for (const col of ['scenario', 'population', 'cultural knowledge assumed', 'stereotype risk', 'suggested revision']) expect(p.toLowerCase()).toContain(col)
})

test('the rubric prompt asks for area / rows / notes over every category, naming 7.1’s three rows', () => {
  const p = rubricPrompt('4: Nutrition', [input]).map((x) => x.content).join('\n')
  expect(p).toMatch(/"area"/)
  expect(p).toMatch(/"rows"/)
  expect(p).toMatch(/"notes"/)
  expect(p).toContain('7.8')
  expect(p).toMatch(/Not Applicable|Exclusive|Emerging Inclusive|Inclusive/)
  // Rubric 1's rows are quoted so the model rates what the assessor rates.
  expect(p).toContain('7.1.a')
  expect(p).toContain('7.1.c')
  expect(p).toContain(categoryById('7.1').rows[1]!.emerging)
})

test('sectionText flattens blocks and drops markup', () => {
  expect(sectionText('<p id="b2c-blk-0">One <em>two</em>.</p><ul><li id="x">Three</li></ul>')).toBe('One two.\n\nThree')
})

test('the system prompt names both documents and their licence', () => {
  const sys = categoryPrompt('7.2', input)[0]!.content
  expect(sys).toContain('Gen-AI Crosswalk Instructions')
  expect(sys.match(/CC BY 4\.0/g)).toHaveLength(2)
})

test('7.6 asks for outdated or pathologizing terms, names the resources, and asks for historical contextualisation', () => {
  const p = categoryPrompt('7.6', input).map((x) => x.content).join('\n')
  expect(p).toMatch(/race, indigeneity, gender, sexuality, disability, and mental health/)
  expect(p).toMatch(/outdated, pathologizing/)
  expect(p).toMatch(/historical contextualization/)
  expect(p).toContain(categoryById('7.6').resources[0]!.url)
  expect(p).toContain('Indian spices')
  expect(p).toMatch(/respond with json/i)
})

test('7.3 asks about gendered language and pronouns, the rubric rows as text, and where rewrites would go', () => {
  const p = categoryPrompt('7.3', input).map((x) => x.content).join('\n')
  expect(p).toMatch(/gender nonconforming pronouns/)
  expect(p).toMatch(/binary or stereotypical/)
  expect(p).toMatch(/area, rating, and notes/)
  expect(p).toMatch(/where inclusive rewrites would best be incorporated/)
  expect(DRAFTABLE).toEqual(['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8'])
})

test('7.4 asks for alternative researchers with a primary link, and centres the region only when one is given', () => {
  const without = categoryPrompt('7.4', input).map((x) => x.content).join('\n')
  expect(without).toMatch(/alternative researchers and\/or studies/)
  expect(without).toMatch(/primary link/)
  expect(without).not.toMatch(/Region served/)
  const withRegion = categoryPrompt('7.4', { ...input, region: 'Central Valley' }).map((x) => x.content).join('\n')
  expect(withRegion).toContain('Region served: Central Valley')
  expect(withRegion).toMatch(/historically marginalized scholars and\/or communities within Central Valley/)
})

test('7.7.1 sends headings and key blocks plus the section’s opening and closing blocks, and files under 7.7', () => {
  const i: SectionInput = {
    ...input,
    text: 'First.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.',
    metadata: [
      { sectionId: 's1', kind: 'heading', text: 'Key terms' },
      { sectionId: 's1', kind: 'key-block', text: 'Summary: cells divide.' },
      { sectionId: 's1', kind: 'proper-noun', text: 'Darwin', detail: '3' },
    ],
  }
  const p = categoryPrompt('7.7.1', i).map((x) => x.content).join('\n')
  expect(p).toContain('Key terms')
  expect(p).toContain('Summary: cells divide.')
  expect(p).not.toContain('Darwin')
  expect(p).toContain('First.\n\nSecond.')
  expect(p).toContain('Fourth.\n\nFifth.')
  expect(p).not.toContain('Third.')
  expect(p).toMatch(/missing or lacking/)
  expect(filesUnder('7.7.1')).toBe('7.7')
  expect(filesUnder('7.2')).toBe('7.2')
})

test('the book prompt sends every chapter in order with ratings or "not rated", the model draft when there is one, and every section’s text', () => {
  let rated = newReview()
  rated = reduceReview(rated, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'emerging' })
  rated = reduceReview(rated, { type: 'note', categoryId: '7.6', notes: 'two outdated terms' })
  const chapters = [
    { chapterKey: 'a', chapterTitle: '4: Nutrition', review: rated, sections: [input] },
    { chapterKey: 'b', chapterTitle: '5: Digestion', review: newReview(), rubricDraft: { areas: [{ id: '7.1' as const, rows: [{ id: '7.1.a', rating: 'inclusive' as const }, { id: '7.1.b', rating: null }, { id: '7.1.c', rating: null }], notes: 'varied' }] }, sections: [{ ...input, sectionTitle: '5.1 Mouth', text: 'Saliva begins digestion.' }] },
  ]
  const p = bookPrompt('Human Biology', chapters, 'Central Valley').map((x) => x.content).join('\n')
  expect(p.indexOf('4: Nutrition')).toBeLessThan(p.indexOf('5: Digestion'))
  expect(p).toContain('7.6.a: Emerging Inclusive')
  expect(p).toContain('two outdated terms')
  expect(p).toContain('7.2.a: not rated')
  expect(p).toMatch(/model draft, unverified/)
  expect(p).toContain('7.1.a: Inclusive')
  expect(p).toContain('Indian spices')
  expect(p).toContain('Saliva begins digestion.')
  expect(p).toContain('Region served: Central Valley')
  expect(p).toMatch(/consistently strong/)
  expect(p).toMatch(/"revisions"/)
  // The lenses and rubric rows come first, as the rubric prompt sends them.
  expect(p.indexOf('FRAMEWORK CATEGORY 7.1')).toBeLessThan(p.indexOf('4: Nutrition'))
  expect(p).toContain('7.1.a (')
})
