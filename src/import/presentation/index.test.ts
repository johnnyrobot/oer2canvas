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

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 1, media: 1, pictures: 0 })
})

test('a table is not counted as unrepresentable, because anydoc emits it', async () => {
  const index = await indexOf(await pptxFixture([{ title: 'Where it happens', table: true }]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 0, media: 0, pictures: 0 })
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

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 0, media: 1, pictures: 0 })
  expect(index.slides[0]!.textRuns).toEqual(['Cellular respiration', 'Overview', 'Grouped caption'])
})

test('content inside mc:AlternateContent is counted exactly once, from the branch anydoc renders', async () => {
  // ONE branch, never both: the fixture's `mc:Fallback` holds a CHART where its
  // `mc:Choice` holds a diagram, so a reader that walked both would be caught by
  // a phantom count rather than by an indistinguishable doubled one. The branch
  // read is the FALLBACK — see the test below for the measurement that settles
  // which one anydoc renders.
  const index = await indexOf(await pptxFixture([
    { title: 'Newer PowerPoint construct', diagramInAlternateContent: true },
  ]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 1, media: 0, pictures: 0 })
})

test('mc:AlternateContent is read from the Fallback branch, because that is what anydoc renders', async () => {
  /*
   * MEASURED with real anydoc 0.2.4:
   * `<mc:Choice>CHOICE TEXT</mc:Choice><mc:Fallback>FALLBACK TEXT</mc:Fallback>`
   * comes out as `<p>FALLBACK TEXT</p>`. Preferring the Choice — which is what
   * the OOXML spec's intent suggests, and what an earlier version did — made
   * the index disagree with the page for text (a self-refusal) and go SILENT
   * for pictures: PowerPoint writes an ink annotation as a `p14:contentPart`
   * Choice with an ordinary `p:pic` Fallback, so the index saw no picture while
   * anydoc emitted one.
   */
  const index = await indexOf(await pptxFixture([
    { title: 'One', alternateContentText: { choice: 'CHOICE TEXT', fallback: 'FALLBACK TEXT' } },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['One', 'FALLBACK TEXT'])
})

test.each([
  // MEASURED with real anydoc 0.2.4 across nine `Requires` values on an
  // otherwise identical package (and pinned against anydoc itself in
  // `reconcile.browser.test.ts`): the Choice is rendered only for `a14` —
  // PowerPoint's 2010 drawing extensions — and when `Requires` is absent.
  ['p14', 'FALLBACK TEXT'],
  ['p15', 'FALLBACK TEXT'],
  ['a14', 'CHOICE TEXT'],
  ['a16', 'FALLBACK TEXT'],
  ['cx', 'FALLBACK TEXT'],
  ['wps', 'FALLBACK TEXT'],
  ['v', 'FALLBACK TEXT'],
  ['unknown', 'FALLBACK TEXT'],
  [false, 'CHOICE TEXT'],
] as const)('mc:Choice Requires=%s is read from the branch anydoc renders', async (requires, expected) => {
  const index = await indexOf(await pptxFixture([
    { title: 'One', alternateContentText: { choice: 'CHOICE TEXT', fallback: 'FALLBACK TEXT', requires } },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['One', expected])
})

test("an OLE object's preview picture is recorded, though it sits below the shape tree", async () => {
  /*
   * A pasted Excel worksheet is `p:graphicFrame` → `p:oleObj` → a preview
   * `p:pic`, two levels below where the shape walk looks for a picture.
   * MEASURED: anydoc emits `<p><span>[Embedded image: Worksheet]</span></p>`
   * for that preview, so a slide that cannot claim it has a block belonging to
   * nobody — and combined with a broken embed on an earlier slide, that turned
   * into content published under the wrong slide's heading with no blocker.
   *
   * ALSO MEASURED, and not what I expected: the origin anydoc reports for that
   * picture is the OLE OBJECT's part, not the preview blip's `ppt/media/
   * image2.emf`. Reading the blip made the deck refuse on an ordinary pasted
   * worksheet.
   */
  const index = await indexOf(await pptxFixture([
    { title: 'One', body: ['Body one'], oleObject: true },
  ]))

  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/embeddings/worksheet1.xlsx'])
})

test("an ink annotation's fallback picture is recorded, so the page's own image is not orphaned", async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'One', inkInAlternateContent: true },
  ]))

  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
})

test('an odp draw:plugin carrying media is reported lost, with or without a poster frame', async () => {
  /*
   * MEASURED: Impress writes an inserted video as a `draw:plugin` with a media
   * mime type, and anydoc emits nothing for it. WITH a poster the deck imports
   * as an ordinary picture and nothing says a video was ever there — the worse
   * case, because the reader sees a still and has no reason to suspect
   * otherwise; WITHOUT one it vanishes entirely.
   */
  const withPoster = await odpIndexOf(await odpFixture([
    { title: 'One', body: ['Body one'], video: { poster: true } },
  ]))
  expect(withPoster.slides[0]!.unrepresentable.media).toBe(1)
  expect(withPoster.slides[0]!.pictureOrigins).toEqual(['Pictures/image1.png'])

  const withoutPoster = await odpIndexOf(await odpFixture([
    { title: 'One', body: ['Body one'], video: {} },
  ]))
  expect(withoutPoster.slides[0]!.unrepresentable.media).toBe(1)
  expect(withoutPoster.slides[0]!.pictureOrigins).toEqual([])
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

test('pretty-printed indentation between runs does not become content or a separator (fix-review round 3 Important 1)', async () => {
  // A formatter, repair tool, or indenting generator inserts a whitespace
  // text node BETWEEN sibling <a:r> elements inside <a:p>; PowerPoint's own
  // minified XML never has these, so the fixture must emit one deliberately
  // to catch a walker that (wrongly) treats every text node as content
  // rather than only the ones inside <a:t>.
  const index = await indexOf(await pptxFixture([
    { titleRuns: ['Photosynthesi', { indent: true }, 's'] },
  ]))

  expect(index.slides[0]!.title).toBe('Photosynthesis')
})

test('pretty-printed indentation between notes runs does not corrupt notesText (fix-review round 3 Important 1)', async () => {
  // `notesText` is compared by STRICT EQUALITY downstream; indentation
  // reaching it as a wrongly-inserted mid-word space breaks that comparison.
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', notesRuns: ['Mention the thylakoid membran', { indent: true }, 'e.'] },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
})

test('runs/spans nested past the paragraph depth cap are refused with a named error, not a raw RangeError (fix-review round 3 Important 2)', async () => {
  // `joinParagraphText`'s own recursion has no other cap; fix-review round 3
  // measured that 5,000 levels of nested `text:span` throw a raw, unnamed
  // `RangeError` that escapes this module.
  await expect(odpIndexOf(await odpFixture([
    { title: 'Adversarial nesting', nestedSpanDepth: 40 },
  ]))).rejects.toThrow(PresentationIndexError)
})

test('an odp draw:custom-shape with typed text is not invisible to textRuns (fix-review round 3 Important 3)', async () => {
  // Impress writes a shape drawn from the toolbar (rectangle, callout,
  // arrow, connector) as draw:custom-shape containing text:p DIRECTLY, not
  // wrapped in a draw:frame. anydoc emits a block for it; a query that only
  // looks at draw:frame does not know it exists, raising a false
  // unattributed-content blocker downstream.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title D', customShapeText: 'Text in a drawn rectangle' },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title D', 'Text in a drawn rectangle'])
})

test('an odp draw:custom-shape wrapped in a draw:g group is still found (fix-review round 3 Important 3)', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', groupedCustomShapeText: 'Grouped drawn text' },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title', 'Grouped drawn text'])
})

test('a draw:frame nested inside another draw:frame contributes its text exactly once (fix-review round 3 Important 3)', async () => {
  // Widening the shape-kind allowlist (rather than querying text:p directly)
  // would double-count a frame nested inside a frame: the OUTER frame's own
  // descendant query would find the SAME text:p the inner frame also finds.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', nestedFrameText: 'Text in a frame inside a frame' },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title', 'Text in a frame inside a frame'])
})

test('an odp text:tab becomes one space so notesText matches anydoc (fix-review round 3 Important 4)', async () => {
  // `notesText` is compared by STRICT EQUALITY downstream; anydoc renders a
  // tab as a space, so dropping text:tab entirely produces "TermDefinition"
  // instead of "Term Definition" and the comparison fails, publishing the
  // notes as body text.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', body: ['Body'], notesRuns: ['Term', { tab: true }, 'Definition'] },
  ]))

  expect(index.slides[0]!.notesText).toBe('Term Definition')
})

test('an odp text:s encoded run of spaces does not merge adjacent words (fix-review round 3 Important 4)', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', bodyRuns: ['First', { spaces: 3 }, 'second'] },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title', 'First second'])
})

test('an odp text:a hyperlink mid-sentence does not drop its own text or truncate what follows (fix-review round 4 Critical)', async () => {
  // Measured against a real .odp: an ODF `isTextCarrier` ALLOWLIST (an
  // earlier version of this function used one, checking only `text:span`)
  // dropped a `text:a` hyperlink's own text — ODF has no isolating leaf
  // element the way OOXML has `a:t`, so a hyperlink's text is paragraph
  // content too. This must hold in BOTH body text and speaker notes, since
  // `notesText` is compared by strict equality downstream.
  const index = await odpIndexOf(await odpFixture([
    {
      title: 'Title',
      bodyRuns: ['Read chapter 3 ', { link: 'tonight' }],
      notesRuns: ['Mention the ', { link: 'lab' }, ' before class.'],
    },
  ]))

  expect(index.slides[0]!.textRuns).toContain('Read chapter 3 tonight')
  expect(index.slides[0]!.notesText).toBe('Mention the lab before class.')
})

test('an odp office:annotation (reviewer comment) does not leak into textRuns (fix-review round 4 Important)', async () => {
  // office:annotation is a DIRECT child of draw:page, the same level
  // presentation:notes sits at. anydoc emits no block for a comment; leaving
  // it unexcluded invents a content-loss disagreement whose payload is a
  // private reviewer remark.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', body: ['Body'], commentText: 'Private reviewer comment.' },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title', 'Body'])
})

test('an odp text:h heading is found, matching the heading block anydoc emits (fix-review round 4)', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', headingText: 'A heading paragraph' },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Title', 'A heading paragraph'])
})

test('a text:h heading inside speaker notes is not dropped from notesText (fix-review round 5 Important)', async () => {
  // Round 2 added text:h to the PAGE query but not the query odfParagraphs
  // (feeding notesText) uses. Measured: anydoc's own blockquote rendering of
  // these notes reads "Notes heading Notes body.", so notesText must match
  // that exactly or the strict-equality comparison fails and the notes get
  // published.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title', body: ['Body'], notesHeadingText: 'Notes heading', notes: 'Notes body.' },
  ]))

  expect(index.slides[0]!.notesText).toBe('Notes heading Notes body.')
  expect(index.slides[0]!.textRuns).toEqual(['Title', 'Body'])
})

test('an office:annotation anchored INSIDE a notes paragraph is counted ONCE, as anydoc emits it', async () => {
  /*
   * The reconciler tells a private speaker note from a genuine pull quote by
   * comparing `notesText` against anydoc's blockquote with STRICT EQUALITY, so
   * `notesText` has to reproduce anydoc's string exactly — that is the only
   * definition under which an equality test can work at all.
   *
   * MEASURED with real anydoc 0.2.4 on this very fixture shape: the blockquote
   * reads "Mention the labINLINE PRIVATE before class." — the comment's text
   * included once, concatenated with no separator. `odfParagraphs` used to find
   * the annotation's own `text:p` a SECOND time as a standalone paragraph, so
   * `notesText` doubled it and the comparison failed, publishing the notes.
   * Counting it zero times instead (an earlier attempt at this fix) fails the
   * same comparison from the other side.
   */
  const index = await odpIndexOf(await odpFixture([
    {
      title: 'Photosynthesis',
      body: ['Light reactions'],
      notesRuns: ['Mention the lab', { comment: 'INLINE PRIVATE' }, ' before class.'],
    },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the labINLINE PRIVATE before class.')
})

test('an inline notes comment does not leak into the page text either', async () => {
  const index = await odpIndexOf(await odpFixture([
    {
      title: 'Photosynthesis',
      notesRuns: ['Mention the lab', { comment: 'INLINE PRIVATE' }, ' before class.'],
    },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Photosynthesis'])
})

test("a pptx table's cells enter textRuns in anydoc's row-major order", async () => {
  /*
   * Design fact 8: a table is NOT unrepresentable, because anydoc emits it as a
   * real data table — so its text is content, and content anydoc emits that the
   * index cannot account for is a disagreement the reconciler answers by
   * refusing. MEASURED with real anydoc 0.2.4 on this fixture: the emitted
   * table reads Stage, Location, Calvin cycle, Stroma, row by row, cell by
   * cell, which is document order.
   */
  const index = await indexOf(await pptxFixture([
    { title: 'Data', body: ['Body text'], table: true },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Data', 'Body text', 'Stage', 'Location', 'Calvin cycle', 'Stroma'])
})

test("an odp table's cells reach textRuns through the flat paragraph query", async () => {
  // The ODP side needs no table-specific branch: a `table:table-cell`'s
  // `text:p` is found wherever it sits, already in document order.
  const index = await odpIndexOf(await odpFixture([
    { title: 'Data', body: ['Body text'], table: true },
  ]))

  expect(index.slides[0]!.textRuns).toEqual(['Data', 'Body text', 'Stage', 'Location', 'Calvin cycle', 'Stroma'])
})

test('a pptx picture records the package part its bytes come from', async () => {
  /*
   * The reconciler cannot attribute a picture by its text, because anydoc emits
   * it as a block with none; the part path is the identity it joins on, and
   * MEASURED against real anydoc 0.2.4 it reports exactly this string as the
   * picture's `originPart`.
   *
   * TWO pictures, ONE entry. PowerPoint declares one relationship per media
   * part and reuses it for every shape that shows that picture, so a list built
   * from the rels could not tell "twice on this slide" from "once" however it
   * was written — which is why this is a set and why the reconciler resolves
   * multiplicity from the whole deck rather than from one slide (see
   * `claimPictures`).
   */
  const index = await indexOf(await pptxFixture([
    { title: 'Pictures', image: { alt: 'A cell' }, secondImage: { alt: 'Another cell' } },
  ]))

  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
  expect(index.slides[0]!.unrepresentable.media).toBe(0)
})

test("a video's poster frame is BOTH a lost medium and a picture anydoc emits", async () => {
  /*
   * PowerPoint writes a media `p:pic` with a poster frame — the still shown
   * before the video plays — as an ordinary embedded blip in the same shape,
   * and MEASURED with real anydoc 0.2.4 that poster comes out as
   * `<p><img …></p>`. Counting the shape as media ALONE left the poster block
   * unclaimable, and a deck with one video refused to import at all.
   */
  const index = await indexOf(await pptxFixture([
    { title: 'Lecture', body: ['Body text'], video: true },
  ]))

  expect(index.slides[0]!.unrepresentable.media).toBe(1)
  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
})

test('a linked picture is identified by its URL, and a picture with no blip reference by nothing', async () => {
  /*
   * MEASURED: a linked blip (`r:link`, no bytes in the package) still emits an
   * `<img src="https://…">` alongside an `external-image` warning, so its slide
   * must be able to claim it — and there is no package part to claim it BY, so
   * the relationship's external target is the identity instead. It is the same
   * string anydoc reports as the picture's source, which is what makes the join
   * work for a picture the package holds no bytes for.
   *
   * A `p:pic` naming no blip at all resolves to nothing, exactly as anydoc
   * emits nothing for it — the old `hasRenderablePicture` prediction, now a
   * consequence of resolution rather than a rule of its own.
   */
  const linked = await indexOf(await pptxFixture([{ title: 'One', linkedImage: true }]))
  expect(linked.slides[0]!.pictureOrigins).toEqual(['https://example.edu/cell.png'])

  const withoutBlip = await indexOf(await pptxFixture([{ title: 'One', blipWithoutReference: true }]))
  expect(withoutBlip.slides[0]!.pictureOrigins).toEqual([])
})

test('an mc:AlternateContent with no renderable branch contributes nothing', async () => {
  /*
   * One `mc:Choice` with an unsupported `Requires` and NO `mc:Fallback`.
   * MEASURED: anydoc emits no block for it at all, so the index's old last
   * resort — read the first Choice when nothing else is renderable — collected
   * content nothing carries. For a picture that was not merely a spurious
   * refusal: the over-collected part belonged to an earlier slide, which then
   * lost a picture to this one with no finding at all.
   */
  const text = await indexOf(await pptxFixture([
    { title: 'One', alternateContentText: { choice: 'CHOICE TEXT', requires: 'p14' } },
  ]))
  expect(text.slides[0]!.textRuns).toEqual(['One'])

  const picture = await indexOf(await pptxFixture([
    { title: 'One', pictureInChoiceOnlyAlternateContent: true },
  ]))
  expect(picture.slides[0]!.pictureOrigins).toEqual([])
  expect(picture.slides[0]!.unrepresentable.pictures).toBe(0)
})

test('a declared relationship whose target cannot be named is still a reference', async () => {
  /*
   * The difference between "this slide references something I cannot identify"
   * and "this slide references nothing" is the difference between a refusal and
   * a neighbouring slide quietly claiming exclusivity it does not have. A
   * literal unencoded `%` makes the target unresolvable; the slide records a
   * reference no block can ever satisfy, so it always reaches the refusal.
   *
   * It is NOT counted as an unrepresentable loss: a warning saying the picture
   * "could not be imported" would contradict a deck that was refused outright,
   * and the measured defect was exactly such a warning standing beside a
   * picture that HAD been imported, under the wrong heading.
   */
  const index = await indexOf(await pptxFixture(
    [{ title: 'One', image: { alt: 'A cell' }, imageTargetOverride: '../media/100%.png' }],
    { imagePartName: '100%.png' },
  ))

  expect(index.slides[0]!.pictureOrigins).toHaveLength(1)
  expect(index.slides[0]!.pictureOrigins[0]).not.toBe('ppt/media/100%.png')
  expect(index.slides[0]!.unrepresentable.pictures).toBe(0)
})

test('a target resolving to the package root is unresolvable, not the empty string', async () => {
  /*
   * `''` is not a spare value to hand back: it is exactly the origin
   * `parsers/anydoc-html.ts` writes for a picture it could NOT identify, so a
   * slide recording it became the sole referencer of every unidentifiable
   * picture in the deck and claimed them. Measured on ODP with
   * `xlink:href="."`. A reference resolving to the package root names no part,
   * so it is unresolvable like any other — ONE "cannot name it" value, and it
   * is unclaimable.
   */
  const index = await odpIndexOf(await odpFixture([
    { title: 'One', image: { alt: 'A cell' }, imageHrefOverride: '.' },
  ]))

  expect(index.slides[0]!.pictureOrigins).toHaveLength(1)
  expect(index.slides[0]!.pictureOrigins).not.toContain('')
})

test('a blip naming an undefined relationship is reported as a lost picture', async () => {
  /*
   * The one loss nothing else records. MEASURED: anydoc emits no block for such
   * a `p:pic` and raises no finding of its own, and the reference resolves to
   * no part here — so the two accounts AGREE, nothing refuses, and without this
   * count the deck imports with nothing anywhere saying a picture had been
   * there. Under the old budget it produced a blocker, with wording that sent
   * the author looking at the wrong slide; the loss itself is real and belongs
   * in `unrepresentable`, beside the diagram and the video.
   *
   * A blip naming NO relationship at all is not the same thing and is not
   * counted: it references no image data, so nothing was ever there to lose.
   */
  const dangling = await indexOf(await pptxFixture([{ title: 'One', brokenImage: true }]))
  expect(dangling.slides[0]!.pictureOrigins).toEqual([])
  expect(dangling.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 0, media: 0, pictures: 1 })

  const bare = await indexOf(await pptxFixture([{ title: 'One', blipWithoutReference: true }]))
  expect(bare.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 0, media: 0, pictures: 0 })
})

test('an odp picture inside speaker notes is not recorded as a picture on the slide', async () => {
  /*
   * anydoc publishes nothing from the notes — MEASURED: the notes picture
   * produces no block at all — so counting it would leave the reconciler
   * holding a budget no block can spend, which is now a refusal. The page below
   * carries a picture ONLY inside its notes, so the count can only be zero if
   * the exclusion actually runs.
   */
  const index = await odpIndexOf(await odpFixture([
    { title: 'Pictures', image: { alt: 'A cell' } },
    { title: 'Notes only', notes: 'A note.', notesImage: true },
  ]))

  expect(index.slides[0]!.pictureOrigins).toEqual(['Pictures/image1.png'])
  expect(index.slides[1]!.pictureOrigins).toEqual([])
})
