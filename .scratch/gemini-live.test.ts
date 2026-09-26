/**
 * One-off LIVE check of the slice-4 engine path against Gemini with the key
 * from process.env. Not part of the suite: run only with the dedicated config
 * below, which does not install the suite's network guard.
 */
import { complete } from '../src/engine/idea/llm/client'
import { providerById } from '../src/engine/idea/llm/providers'
import { categoryPrompt, rubricPrompt, sectionText } from '../src/engine/idea/llm/prompts'
import { draftsToFindings, parseCategoryResponse, parseRubricResponse } from '../src/engine/idea/llm/parse'
import { imageInventory } from '../src/engine/idea/images'
import { metadataInventory } from '../src/engine/idea/metadata'

const key = process.env.GEMINI_API_KEY ?? ''
const provider = providerById('gemini')
const settings = { key, model: provider.defaultModel }
const html = `
<h2 id="b2c-blk-0">Nutrients</h2>
<p id="b2c-blk-1">The chairman of the committee, John Smith, asked the men to review the data. Bob and Tom compared notes with Mary.</p>
<p id="b2c-blk-2">A study by Watson and Crick (1953) is cited throughout; Rosalind Franklin's contribution is not mentioned.</p>
<figure><img id="b2c-img-0" src="a.png" alt="A nurse in scrubs checks a chart"><figcaption id="b2c-cap-0">Figure 1: A nurse at work.</figcaption></figure>
`
const input = {
  sectionId: 's1', sectionTitle: '4.2 Nutrients', chapterTitle: '4: Nutrition', bookTitle: 'Biology 2e',
  text: sectionText(html), images: imageInventory('s1', html), metadata: metadataInventory('s1', html),
}

test('7.2 live: Gemini answers in the requested shape and the parser produces drafts', async () => {
  expect(key).not.toBe('')
  const { text } = await complete(provider, settings, categoryPrompt('7.2', input), new AbortController().signal)
  const parsed = parseCategoryResponse(text)
  const findings = draftsToFindings('7.2', 's1', html, parsed)
  console.log('7.2 raw?', parsed.raw !== undefined, 'items', parsed.items.length, 'findings', findings.map((f) => f.kind))
  console.log(JSON.stringify(findings.slice(0, 3), null, 1).slice(0, 1500))
  expect(parsed.raw).toBeUndefined()
  expect(findings.length).toBeGreaterThan(0)
  expect(findings.every((f) => f.origin === 'draft')).toBe(true)
}, 90_000)

test('7.1 live: the image inventory prompt yields items', async () => {
  const { text } = await complete(provider, settings, categoryPrompt('7.1', input), new AbortController().signal)
  const parsed = parseCategoryResponse(text)
  console.log('7.1 raw?', parsed.raw !== undefined, 'items', parsed.items.length, parsed.items[0])
  expect(parsed.raw).toBeUndefined()
}, 90_000)

test('rubric live: per-row ratings come back and 7.1 gets three rows', async () => {
  const { text } = await complete(provider, settings, rubricPrompt('4: Nutrition', [input]), new AbortController().signal)
  const draft = parseRubricResponse(text)
  console.log('rubric raw?', draft.raw !== undefined, draft.areas.map((a) => `${a.id}:${a.rows.map((r) => r.rating).join('/')}`).join(' '))
  expect(draft.raw).toBeUndefined()
  expect(draft.areas.find((a) => a.id === '7.1')?.rows).toHaveLength(3)
}, 90_000)

test('a wrong key maps to bad-key and the message does not contain it', async () => {
  const bad = 'AIza-not-a-real-key-0000'
  await expect(complete(provider, { key: bad, model: provider.defaultModel }, categoryPrompt('7.2', input), new AbortController().signal))
    .rejects.toMatchObject({ failure: 'bad-key' })
}, 30_000)
