import { readZipParts } from '../zip-read'
import { pptxFixture, odpFixture } from '../testing/presentation-fixtures'
import { wantedPresentationPart } from './parts'
import { readPresentationIndex, PresentationIndexError } from './index'

async function indexOf(bytes: Uint8Array) {
  const parts = await readZipParts(bytes, (path) => wantedPresentationPart('pptx', path))
  return readPresentationIndex('pptx', Object.fromEntries(parts))
}

async function odpIndexOf(bytes: Uint8Array) {
  const parts = await readZipParts(bytes, (path) => wantedPresentationPart('odp', path))
  return readPresentationIndex('odp', Object.fromEntries(parts))
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

test('a run split mid-word AND a soft line break in the same paragraph are both handled correctly (fix-review round-2 Important A)', async () => {
  // `a:br` (Shift+Enter) stays inside ONE paragraph and becomes a single
  // space; a run split mid-word joins with no separator at all. Neither
  // behaviour may regress the other.
  const index = await indexOf(await pptxFixture([
    { titleRuns: ['Photosynthesi', 's', { break: true }, 'occurs in chloroplasts'] },
  ]))

  expect(index.slides[0]!.title).toBe('Photosynthesis occurs in chloroplasts')
})

test('a mid-word run split inside the notes body still joins correctly (fix-review round-2 Important B)', async () => {
  // The notes path must use the SAME per-run joining rule as the slide path,
  // not a second rule a routine mid-word split defeats.
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', notesRuns: ['Mention the thylakoid membran', 'e.'] },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
})

test('a notes placeholder with no type attribute is still the body placeholder (fix-review round-2 Important C)', async () => {
  // ECMA-376's schema default for `CT_Placeholder/@type` IS `body`.
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', notes: 'Mention the thylakoid membrane.', notesOmitPlaceholderType: true },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
})

test('groups nested past the depth cap are refused with a named error, not a raw RangeError (fix-review round-2 Minor D)', async () => {
  await expect(indexOf(await pptxFixture([
    { title: 'Adversarial nesting', nestedGroupDepth: 40 },
  ]))).rejects.toThrow(PresentationIndexError)
})

test('an empty title placeholder no longer marks the slide title out of order (fix-review round-2 E)', async () => {
  // Round 1's restructure changed this deferred Minor by accident: an empty
  // title placeholder produces no paragraphs at all now, so it never claims a
  // `titleIndex` and can no longer be "out of order" — pinned here since it
  // was previously reported as untouched.
  const index = await indexOf(await pptxFixture([
    { title: '', body: ['Body first, then an empty title placeholder'], titleLast: true },
  ]))

  expect(index.slides[0]!.title).toBeUndefined()
  expect(index.slides[0]!.titleOutOfOrder).toBe(false)
})

test('a ctrTitle placeholder is a title, like the Title Slide layout PowerPoint gives slide 1 (design fact 9)', async () => {
  // 20 of the 130 titled slides fact 9 surveyed said `ctrTitle` rather than
  // `title` — a slide-1 title read as untitled would put a warning on the
  // very first slide of most decks.
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', titlePlaceholderType: 'ctrTitle', body: ['A survey course'] },
  ]))

  expect(index.slides[0]!.title).toBe('Photosynthesis')
  expect(index.slides[0]!.titleOutOfOrder).toBe(false)
})

test('a title placeholder identified only by idx is read as ordinary text, not a title (design fact 9)', async () => {
  // The layout-chain case, pinned as a DECISION rather than a bug: fact 9
  // found it zero times in 226 real slides, and anydoc emits a paragraph
  // rather than a heading for exactly this shape — so resolving it here
  // would leave the two accounts disagreeing about a slide anydoc gives no
  // heading for. The text is not lost either way; the slide is simply
  // untitled, which is the warning design fact 3 already covers.
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', titleIdentifiedOnlyByIdx: true, body: ['Light reactions'] },
  ]))

  expect(index.slides[0]!.title).toBeUndefined()
  expect(index.slides[0]!.textRuns).toEqual(['Photosynthesis', 'Light reactions'])
  expect(index.slides[0]!.titleOutOfOrder).toBe(false)
})

test('odp pages are numbered in document order with their titles', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', body: ['Light reactions'] },
    { title: 'Where it happens', body: ['Stroma'] },
  ]))

  expect(index.kind).toBe('odp')
  expect(index.slides.map((slide) => slide.title)).toEqual(['Photosynthesis', 'Where it happens'])
})

test('an odp page with no title frame reports no title', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'First page' },
    { body: ['Body of an untitled page'] },
  ]))

  expect(index.slides[1]!.title).toBeUndefined()
})

test('odp notes are found and kept out of the page text', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Mention the thylakoid membrane.' },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
  expect(index.slides[0]!.textRuns).not.toContain('Mention the thylakoid membrane.')
})

test('an odp title frame authored last is NOT out of order, because anydoc hoists it', async () => {
  /*
   * Design fact 4: measured 2026-08-29, ODP hoists a `presentation:class="title"`
   * frame to the top of its page while PPTX preserves `spTree` order. The index
   * reports what the CONSUMER will see, so ODP's title is in order even when it
   * is authored last — otherwise every such deck would carry a warning about a
   * disagreement that does not exist downstream.
   */
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title last in XML', body: ['Body first in XML'], titleLast: true },
  ]))

  expect(index.slides[0]!.titleOutOfOrder).toBe(false)
  expect(index.slides[0]!.textRuns).toEqual(['Title last in XML', 'Body first in XML'])
})

test('a two-paragraph odp body produces two separate text-run entries, not one merged run', async () => {
  // Each bullet is its own `text:p`; collapsing the whole FRAME's textContent
  // into one string (the defect the PPTX path already removed) would merge
  // two bullets into one entry, which anydoc's own per-paragraph blocks never
  // do — and the later reconciliation would raise a false "unattributed
  // content" blocker on the second bullet.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', body: ['Light reactions', 'Dark reactions'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Photosynthesis', 'Light reactions', 'Dark reactions'])
})

test('an odp text:span split mid-word is joined with no separator', async () => {
  // Impress splits a run mid-word at a spell-check mark or a formatting
  // change, exactly as PowerPoint does with `a:r` — the two spans are still
  // one word.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Overview', bodyRuns: ['Photosynthesi', 's'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Overview', 'Photosynthesis'])
})

test('an odp text:line-break becomes one space, matching a:br on the PPTX side', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Overview', bodyRuns: ['First half', { break: true }, 'second half'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Overview', 'First half second half'])
})

test('bullets authored inside a text:list produce one text-run entry each', async () => {
  // Impress stores a bulleted body placeholder as `text:list > text:list-item
  // > text:p`, not bare `text:p` siblings — the index must search the whole
  // frame subtree for `text:p`, not just its direct children.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', bulletList: ['Light reactions', 'Dark reactions'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Photosynthesis', 'Light reactions', 'Dark reactions'])
})

test('odp notes text survives a mid-word text:span split and stays out of page text', async () => {
  // `notesText` is compared by STRICT EQUALITY downstream to decide whether a
  // blockquote is the author's private speaker notes; a routine mid-word
  // split reaching it as two words with a wrongly-stitched space would break
  // that comparison and publish the notes as body text.
  const index = await odpIndexOf(await odpFixture([
    {
      title: 'Photosynthesis',
      bulletList: ['Light reactions', 'Dark reactions'],
      notesRuns: ['Mention the thylakoid membran', 'e.'],
    },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
  expect(index.slides[0]!.textRuns).toEqual(['Photosynthesis', 'Light reactions', 'Dark reactions'])
})
