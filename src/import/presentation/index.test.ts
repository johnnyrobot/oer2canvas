import { readZipParts } from '../zip-read'
import { pptxFixture } from '../testing/presentation-fixtures'
import { wantedPresentationPart } from './parts'
import { readPresentationIndex } from './index'

async function indexOf(bytes: Uint8Array) {
  const parts = await readZipParts(bytes, (path) => wantedPresentationPart('pptx', path))
  return readPresentationIndex('pptx', Object.fromEntries(parts))
}

test('slides are numbered in presentation order, not part-name order', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'] },
    { title: 'Where it happens', body: ['Stroma'] },
  ]))

  expect(index.slides.map((slide) => slide.number)).toEqual([1, 2])
  expect(index.slides.map((slide) => slide.title)).toEqual(['Photosynthesis', 'Where it happens'])
})

test('a slide with no title placeholder reports no title (design fact 3)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'First slide' },
    { body: ['Body of an untitled slide'] },
    { title: 'Third slide' },
  ]))

  expect(index.slides[1]!.title).toBeUndefined()
  expect(index.slides[1]!.textRuns).toEqual(['Body of an untitled slide'])
})

test('a title authored last in spTree is reported out of order (design fact 4)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Title last in XML', body: ['Body first in XML'], titleLast: true },
  ]))

  expect(index.slides[0]!.titleOutOfOrder).toBe(true)
  // Runs stay in the deck's OWN order. The index reports the disagreement; it
  // never silently re-sorts, because re-sorting invents an order nobody claimed.
  expect(index.slides[0]!.textRuns).toEqual(['Body first in XML', 'Title last in XML'])
})

test('speaker notes are found and kept apart from slide text (design fact 5)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Mention the thylakoid membrane.' },
    { title: 'No notes here', body: ['Stroma'] },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
  expect(index.slides[0]!.textRuns).not.toContain('Mention the thylakoid membrane.')
  expect(index.slides[1]!.notesText).toBeUndefined()
})

test('diagrams, charts, and media are counted per slide (design fact 6)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Process overview', diagram: true, chart: true, video: true },
  ]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 1, media: 1 })
})

test('a table is not counted as unrepresentable, because anydoc emits it', async () => {
  const index = await indexOf(await pptxFixture([{ title: 'Where it happens', table: true }]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 0, media: 0 })
})

test('a title split across runs mid-word is joined with no separator (fix-review Important 1)', async () => {
  // PowerPoint splits a run mid-word at a spell-check mark, a formatting
  // change, or a language boundary — the two runs are still one word.
  const index = await indexOf(await pptxFixture([
    { titleRuns: ['Photosynthesi', 's'] },
  ]))

  expect(index.slides[0]!.title).toBe('Photosynthesis')
})

test('a two-paragraph body produces two separate text-run entries (fix-review Important 1)', async () => {
  // Each bullet is its own `a:p`; joining every run in the SHAPE into one
  // string (rather than one string per PARAGRAPH) would collapse two bullets
  // into one entry, which anydoc's own per-paragraph blocks never do.
  const index = await indexOf(await pptxFixture([
    { title: 'Carbon fixation', body: ['First bullet', 'Second bullet'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Carbon fixation', 'First bullet', 'Second bullet'])
})

test('shapes nested in a group are visited: diagram and video counted, grouped text placed in order (fix-review Important 2)', async () => {
  const index = await indexOf(await pptxFixture([
    {
      title: 'Cellular respiration',
      body: ['Overview'],
      group: { text: 'Grouped caption', diagram: true, video: true },
    },
  ]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 0, media: 1 })
  expect(index.slides[0]!.textRuns).toEqual(['Cellular respiration', 'Overview', 'Grouped caption'])
})

test('a diagram inside mc:AlternateContent is counted exactly once, from mc:Choice not mc:Fallback (fix-review Important 3)', async () => {
  // The fixture's `mc:Fallback` branch holds a CHART rather than a second
  // diagram, so a reader that (wrongly) walked both branches would be caught
  // by a phantom chart count rather than an indistinguishable doubled count.
  const index = await indexOf(await pptxFixture([
    { title: 'Newer PowerPoint construct', diagramInAlternateContent: true },
  ]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 0, media: 0 })
})
