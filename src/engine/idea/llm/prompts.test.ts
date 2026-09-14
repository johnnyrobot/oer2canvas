import { categoryPrompt, rubricPrompt, sectionText, type SectionInput } from './prompts'
import { categoryById } from '../framework'

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
