import { probeParser } from '../parsers/probe'
import { readPresentationIndex } from './index'
import { reconcilePresentation } from './reconcile'
import { odpFixture, pptxFixture, MC_REQUIRES_NAMESPACES } from '../testing/presentation-fixtures'

/**
 * The reconciler against REAL anydoc 0.2.4, in the real Worker, on real
 * packages — because every one of its rules is a claim about what anydoc emits,
 * and both defects this file pins passed a full suite of hand-written HTML.
 * Hand-written HTML can only ever restate what its author already believed.
 */
async function reconcileBytes(kind: 'odp' | 'pptx', bytes: Uint8Array) {
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes: bytes.buffer as ArrayBuffer,
    formatHint: kind,
  })
  const index = readPresentationIndex(kind, parsed.presentation!.parts)
  const result = reconcilePresentation({
    html: parsed.normalized!.html,
    index,
    sourceLabel: kind.toUpperCase(),
  })
  return { anydocHtml: parsed.normalized!.html, index, result }
}

async function reconcileFixture(pages: Parameters<typeof odpFixture>[0]) {
  return reconcileBytes('odp', await odpFixture(pages))
}

const sectionsOf = (html: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('section')]

test('speaker notes carrying an inline comment are excluded, not published', async () => {
  const { anydocHtml, index, result } = await reconcileFixture([
    {
      title: 'Photosynthesis',
      bulletList: ['Light reactions', 'Calvin cycle'],
      notesRuns: ['Mention the lab', { comment: 'INLINE PRIVATE' }, ' before class.'],
    },
  ])

  // anydoc renders the comment's text INSIDE the notes blockquote, once. The
  // index must reproduce that string exactly or the equality test cannot fire —
  // counting the comment twice (or not at all) published both the presenter's
  // private note and the private comment, under a finding that said they were
  // not imported.
  expect(anydocHtml).toContain('<blockquote><p>Mention the labINLINE PRIVATE before class.</p></blockquote>')
  expect(index.slides[0]!.notesText).toBe('Mention the labINLINE PRIVATE before class.')

  expect(result.html).not.toContain('Mention the lab')
  expect(result.html).not.toContain('INLINE PRIVATE')
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-speaker-notes'])
})

test("an agenda deck keeps every slide's own heading in its own section", async () => {
  // Slide 2 is the agenda's LAST bullet, deliberately: the run left spare by
  // matching the one `<ul>` block against a single bullet has to be the run the
  // NEXT block's heading matches, or the pre-fix rule breaks correctly here by
  // luck and this pins nothing.
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'Agenda', bulletList: ['Cell walls', 'Photosynthesis'] },
    { title: 'Photosynthesis', body: ['Light reactions happen in the thylakoid'] },
    { title: 'Cell walls', body: ['Rigid layer outside the membrane'] },
  ])

  // The granularity mismatch this rule exists for: one `<ul>` block against
  // one index run per bullet, with the bullets naming later slides.
  expect(anydocHtml).toContain('<ul><li><p>Cell walls</p></li><li><p>Photosynthesis</p></li></ul>')

  const sections = sectionsOf(result.html)
  expect(sections).toHaveLength(3)
  // Section 1 holds its heading and its bullets, and NOTHING else: the defect
  // this pins put slide 2's own `<h2>` here as a third child.
  expect([...sections[0]!.children].map((child) => child.localName)).toEqual(['h2', 'ul'])
  expect(sections[0]!.querySelector('ul')).toHaveTextContent('Cell walls')
  // Each later section carries the heading ANYDOC emitted — identified by the
  // id anydoc derived from the slide's own title, not a heading fabricated here
  // to replace one that went missing.
  expect(sections[1]!.querySelector('h2')!.id).toBe('Photosynthesis')
  expect(sections[1]!.querySelector('p')).toHaveTextContent('Light reactions happen in the thylakoid')
  expect(sections[2]!.querySelector('h2')!.id).toBe('Cell-walls')
  expect(result.findings).toEqual([])
})

test('an untitled slide is given its own titled anchor even beside an anydoc h1', async () => {
  const { anydocHtml, result } = await reconcileFixture([
    { headingText: 'A heading paragraph', body: ['Body text'] },
  ])

  // An ODP `text:h` becomes an `h1` of anydoc's own, which is NOT this slide's
  // title — the slide has none.
  expect(anydocHtml).toContain('<h1 id="A-heading-paragraph">A heading paragraph</h1>')

  const [section] = sectionsOf(result.html)
  expect(section!.firstElementChild).toHaveProperty('id', 'slide-1')
  expect(section!.firstElementChild).toHaveTextContent('Slide 1')
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-untitled-slide'])
})

test.each([
  ['odp', async () => odpFixture([{ title: 'Data', body: ['Body text'], table: true }])],
  ['pptx', async () => pptxFixture([{ title: 'Data', body: ['Body text'], table: true }])],
] as const)('a %s slide carrying a table imports it instead of refusing', async (kind, fixture) => {
  // Design fact 8: a table is not a loss, because anydoc emits it — so its text
  // has to be in BOTH accounts or the deck refuses. The PPTX index used to hold
  // only the title and body, and every deck with a table was unimportable.
  const { anydocHtml, result } = await reconcileBytes(kind, await fixture())

  expect(anydocHtml).toContain('<table>')
  expect(result.findings).toEqual([])
  expect(result.html).toContain('<table>')
  expect(result.html).toContain('<td><p>Calvin cycle</p></td>')
})

test.each([
  ['odp', async () => odpFixture([
    { title: 'One', body: ['Body one'] },
    { image: { alt: 'A cell' } },
    { title: 'Three', body: ['Body three'] },
  ])],
  ['pptx', async () => pptxFixture([
    { title: 'One', body: ['Body one'] },
    { image: { alt: 'A cell' } },
    { title: 'Three', body: ['Body three'] },
  ])],
] as const)('a %s image-only slide keeps its own picture', async (kind, fixture) => {
  // anydoc emits a picture as a block with NO text, so nothing about the block
  // itself says which slide it came from; the index's per-slide image count
  // does. Absorbing it into whichever slide was open put this image in slide 1
  // and shipped slide 2 empty, with no finding at all.
  const { anydocHtml, result } = await reconcileBytes(kind, await fixture())

  expect(anydocHtml).toContain('<img')
  const sections = sectionsOf(result.html)
  expect(sections).toHaveLength(3)
  expect(sections[0]!.querySelector('img')).toBeNull()
  expect(sections[1]!.querySelector('img')).not.toBeNull()
  expect(sections[2]!.querySelector('img')).toBeNull()
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-untitled-slide'])
})

test("one slide's text:h does not demote every slide title on the page", async () => {
  // `engine/allowlist.ts` shifts EVERY heading down a level when any content
  // `h1` is present, so one `text:h` on one slide would push every slide title
  // from `h2` to `h3` across the whole imported page.
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'Titled', headingText: 'A heading paragraph', body: ['Body text'] },
    { title: 'Second', body: ['Body two'] },
  ])

  expect(anydocHtml).toContain('<h1 id="A-heading-paragraph">')
  expect(result.html).not.toContain('<h1')
  expect(result.html).toContain('<h3 id="A-heading-paragraph">A heading paragraph</h3>')
  expect(sectionsOf(result.html).map((section) => section.querySelector('h2')!.textContent))
    .toEqual(['Titled', 'Second'])
  expect(result.findings).toEqual([])
})

test.each([
  ['video', { video: true }],
  ['audio', { audio: true }],
] as const)('a deck with %s imports it, poster frame and all', async (_kind, media) => {
  /*
   * PowerPoint writes a media `p:pic` with a poster frame — an inserted sound
   * clip shows a speaker icon exactly as a video shows a still — and anydoc
   * emits that poster as an ordinary picture block. Treating the shape as
   * media ALONE left the poster belonging to nobody, and one clip anywhere in
   * a lecture deck refused the whole import. The audio row is measured here
   * rather than reasoned from the video row: the index treats `a:audioFile`
   * and `a:videoFile` alike, and that claim was never checked against anydoc.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], ...media },
    { title: 'Two', body: ['Body two'] },
  ]))

  expect(anydocHtml).toContain('<img')
  const sections = sectionsOf(result.html)
  expect(sections[0]!.querySelector('img')).not.toBeNull()
  expect(sections[1]!.querySelector('img')).toBeNull()
  // The medium itself is still reported lost: the poster is not the video.
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-unrepresentable'])
  expect(result.findings[0]!.message).toContain('1 media')
})

test("a broken embed no longer costs the next slide its picture", async () => {
  /*
   * A `p:pic` whose `r:embed` names an undefined relationship. Under the count
   * budget this deck REFUSED: slide 1 counted a picture, spent that count on
   * the one picture anydoc did emit — slide 2's — and the refusal then named
   * slide 2 as the slide missing a picture, which was as much as a budget could
   * say. Under the join there is nothing to say: an undefined relationship
   * resolves to no part, so slide 1 references nothing, expects nothing, and
   * cannot take the block that carries slide 2's part. The picture lands on
   * slide 2, where it came from, and the deck imports.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', brokenImage: true },
    { image: { alt: 'A cell' } },
    { title: 'Three', body: ['Body three'] },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  const sections = sectionsOf(result.html)
  expect(sections[0]!.querySelector('img')).toBeNull()
  expect(sections[1]!.querySelector('img')).not.toBeNull()
  expect(sections[2]!.querySelector('img')).toBeNull()
  // The broken reference is REPORTED, not silent: anydoc emits no block and
  // raises no finding for it, and the index resolves it to no part, so without
  // this count the deck would import with nothing saying a picture had been
  // there. It is a loss to name, not a disagreement to block on.
  expect(result.findings.map((finding) => finding.code))
    .toEqual(['presentation-untitled-slide', 'presentation-unrepresentable'])
  expect(result.findings[1]!.message).toContain('Slide 1 contains 1 picture')
})

test.each([
  ['a titled slide with its own picture', async () => pptxFixture([
    { title: 'One', body: ['Body one'], image: { alt: 'A cell' } },
    { title: 'Two', body: ['Body two'] },
  ])],
  ['two pictures on one slide', async () => pptxFixture([
    { title: 'One', image: { alt: 'First' }, secondImage: { alt: 'Second' } },
  ])],
  ['consecutive image-only slides', async () => pptxFixture([
    { title: 'One', body: ['Body one'] },
    { image: { alt: 'A' } },
    { image: { alt: 'B' } },
  ])],
  ['a grouped picture', async () => pptxFixture([{ title: 'One', group: { image: true } }])],
  ['a linked picture', async () => pptxFixture([{ title: 'One', linkedImage: true }])],
] as const)('%s is attributed to its own slide and does not refuse', async (_name, fixture) => {
  // Refusing when a referenced part never arrives is only safe if every
  // ordinary picture shape really does arrive carrying that part.
  const { result } = await reconcileBytes('pptx', await fixture())

  expect(result.findings.map((finding) => finding.code))
    .not.toContain('presentation-unattributed-content')
  expect(result.html).toContain('<img')
})

test('a p:pic naming no image data at all is a picture in neither account', async () => {
  // A bare `<a:blip/>`: no `r:embed`, no `r:link`. MEASURED — anydoc emits no
  // block for it, and it resolves through the rels to no part, so the two
  // accounts agree that nothing is there. Under the count budget this was a
  // rule the index had to KNOW ("do not count a p:pic naming no blip"); now it
  // is a consequence of there being nothing to resolve.
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], blipWithoutReference: true },
    { title: 'Two', body: ['Body two'] },
  ]))

  expect(anydocHtml).not.toContain('<img')
  expect(anydocHtml).not.toContain('[Embedded image')
  expect(index.slides[0]!.pictureOrigins).toEqual([])
  expect(result.findings).toEqual([])
})

test("an ink annotation's picture stays on the slide that carries it", async () => {
  /*
   * PowerPoint writes an ink annotation as `mc:AlternateContent` with a
   * `p14:contentPart` Choice and an ordinary `p:pic` Fallback. MEASURED: anydoc
   * renders the FALLBACK, so a reader preferring the Choice saw no picture at
   * all — and slide 1's picture was published under slide 2's heading with no
   * finding whatsoever.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', inkInAlternateContent: true },
    { title: 'Two', body: ['Body two'] },
  ]))

  expect(anydocHtml).toContain('alt="Ink annotation"')
  const sections = sectionsOf(result.html)
  expect(sections[0]!.querySelector('img')).not.toBeNull()
  expect(sections[1]!.querySelector('img')).toBeNull()
  expect(result.findings).toEqual([])
})

test('a picture that could not be packaged is attributed, not refused', async () => {
  /*
   * An EMF — what PowerPoint writes for a pasted chart, a Visio drawing, or
   * legacy clip art — cannot be packaged, so THIS REPO'S normalizer renders an
   * `[Embedded image]` placeholder and raises its own `embedded-content`
   * blocker. Treating that placeholder's text as content made it unattributable
   * and refused the whole deck on top of a finding that already said what was
   * wrong.
   */
  const bytes = await pptxFixture([
    { title: 'One', body: ['Body one'], unpackageableImage: {} },
    { title: 'Two', body: ['Body two'] },
  ])
  const parsed = await probeParser({ parser: 'anydoc', bytes: bytes.buffer as ArrayBuffer, formatHint: 'pptx' })
  const index = readPresentationIndex('pptx', parsed.presentation!.parts)
  const result = reconcilePresentation({ html: parsed.normalized!.html, index, sourceLabel: 'PPTX' })

  expect(parsed.normalized!.html).toContain('<span data-origin-part="ppt/media/image2.emf">[Embedded image: A pasted chart]</span>')
  // The loss is already reported, by the parser, with the actionable message.
  expect(parsed.normalized!.findings.map((finding) => finding.code)).toContain('embedded-content')
  // So the reconciler adds no second refusal, and the placeholder sits in the
  // section of the slide the index counted that picture on.
  expect(result.findings).toEqual([])
  expect(sectionsOf(result.html)[0]!.textContent).toContain('[Embedded image')
  expect(sectionsOf(result.html)[1]!.textContent).not.toContain('[Embedded image')
})

test('an odp video is reported lost even when its poster frame imports', async () => {
  // The poster is the dangerous case: the reader sees a still and has no reason
  // to suspect a video was ever there.
  const { result } = await reconcileFixture([
    { title: 'One', body: ['Body one'], video: { poster: true } },
  ])

  expect(sectionsOf(result.html)[0]!.querySelector('img')).not.toBeNull()
  const finding = result.findings.find((entry) => entry.code === 'presentation-unrepresentable')
  expect(finding?.message).toContain('1 media')
})

test('an odp video with no poster is reported lost rather than vanishing', async () => {
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'One', body: ['Body one'], video: {} },
  ])

  expect(anydocHtml).not.toContain('<img')
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-unrepresentable'])
})

test('a level-two text:h does not ship as a sibling of the slide title', async () => {
  // MEASURED: `text:outline-level="2"` makes anydoc emit `<h2>`, which
  // `allowlist.ts` never shifts (it triggers on `h1` alone), so anything walking
  // `h2` elements — a table of contents, a screen-reader outline — would see a
  // phantom slide.
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'Titled', headingText: 'A level two heading', headingLevel: 2, body: ['Body text'] },
    { title: 'Second', body: ['Body two'] },
  ])

  expect(anydocHtml).toContain('<h2 id="A-level-two-heading">')
  expect(result.html).toContain('<h3 id="A-level-two-heading">A level two heading</h3>')
  expect([...new DOMParser().parseFromString(result.html, 'text/html').querySelectorAll('h2')]
    .map((heading) => heading.textContent)).toEqual(['Titled', 'Second'])
})

test.each([...Object.keys(MC_REQUIRES_NAMESPACES), false] as const)(
  'the index reads the same mc:AlternateContent branch anydoc renders, for Requires=%s',
  async (requires) => {
    /*
     * The invariant, stated against anydoc itself rather than against a table
     * of remembered results: whichever branch anydoc renders is the branch the
     * index read. anydoc renders the Choice for `a14` and for an absent
     * `Requires`, and the Fallback for everything else — so an anydoc upgrade
     * that changes ANY of these rows fails here instead of silently flipping
     * attribution for the decks that use it.
     */
    const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
      { title: 'One', alternateContentText: { choice: 'CHOICE TEXT', fallback: 'FALLBACK TEXT', requires } },
    ]))

    const rendered = anydocHtml.includes('CHOICE TEXT') ? 'CHOICE TEXT' : 'FALLBACK TEXT'
    expect(index.slides[0]!.textRuns).toEqual(['One', rendered])
    expect(result.findings).toEqual([])
  },
)

test("a pasted worksheet's preview stays on the slide that carries it", async () => {
  // `p:graphicFrame` → `p:oleObj` → a preview `p:pic`, which anydoc renders as
  // a picture block. Counting zero for it left that block unclaimable.
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], oleObject: true },
    { title: 'Two', body: ['Body two'] },
  ]))

  expect(anydocHtml).toContain('<span data-origin-part="ppt/embeddings/worksheet1.xlsx">[Embedded image: Worksheet]</span>')
  const sections = sectionsOf(result.html)
  expect(sections[0]!.textContent).toContain('[Embedded image: Worksheet]')
  expect(sections[1]!.textContent).not.toContain('[Embedded image')
  expect(result.findings).toEqual([])
})

test('the deck that used to refuse for a broken embed now attributes every picture', async () => {
  /*
   * The adversarial deck from fix round 5: slide 1 holds a picture anydoc emits
   * nothing for, slide 2 holds a worksheet whose preview it does emit. Under
   * the count budget slide 1's unspent count refused the whole import; the
   * report recorded that it "fails closed here for slide 1's unspent budget
   * rather than for the preview". Neither slide's account is ambiguous under
   * the join — slide 1 references no resolvable part, slide 2 references the
   * worksheet — so the preview stays where it belongs and nothing refuses.
   */
  const { result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', brokenImage: true },
    { title: 'Two', body: ['Body two'], oleObject: true },
  ]))

  // Only the broken reference on slide 1 is reported, and as a LOSS rather than
  // a refusal: both slides' pictures are attributed correctly.
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-unrepresentable'])
  expect(result.findings[0]!.message).toContain('Slide 1 contains 1 picture')
  const sections = sectionsOf(result.html)
  expect(sections[0]!.textContent).not.toContain('Body two')
  expect(sections[0]!.textContent).not.toContain('[Embedded image')
  expect(sections[1]!.textContent).toContain('[Embedded image: Worksheet]')
})

test('a placeholder whose alt text contains brackets does not refuse the deck', async () => {
  // A bracket in a figure description is ordinary, and the placeholder's alt
  // text is interpolated unescaped.
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], unpackageableImage: { alt: 'Figure [3] pasted' } },
  ]))

  expect(anydocHtml).toContain('<span data-origin-part="ppt/media/image2.emf">[Embedded image: Figure [3] pasted]</span>')
  expect(result.findings).toEqual([])
  expect(sectionsOf(result.html)[0]!.textContent).toContain('[Embedded image: Figure [3] pasted]')
})


test.each([
  ['odp', async () => odpFixture([
    { title: 'One', image: { alt: 'First' } },
    { title: 'Two', image: { alt: 'Second' } },
  ])],
  ['pptx', async () => pptxFixture([
    { title: 'One', image: { alt: 'First' } },
    { title: 'Two', image: { alt: 'Second' } },
  ])],
] as const)('two %s slides showing the SAME media part keep one picture each', async (kind, fixture) => {
  /*
   * The shape the join has to answer for and a plain set-membership rule gets
   * wrong: one media part, referenced by two slides — a logo, a course banner,
   * the same diagram reused. Both blocks carry the identical
   * `data-origin-part`, so identity alone cannot say which is whose, and a
   * slide allowed to take every block bearing a part it references would eat
   * both and leave slide 2 empty. Each slide takes ONE block for a part another
   * slide also references, which is what the deck's own order says.
   */
  const { anydocHtml, result } = await reconcileBytes(kind, await fixture())

  const origins = [...anydocHtml.matchAll(/data-origin-part="([^"]*)"/g)].map((match) => match[1])
  expect(origins).toHaveLength(2)
  expect(origins[0]).toBe(origins[1])

  const sections = sectionsOf(result.html)
  expect(sections[0]!.querySelector('img')!.alt).toBe('First')
  expect(sections[1]!.querySelector('img')!.alt).toBe('Second')
  expect(result.findings).toEqual([])
})

test('the same part twice on one slide and once on another refuses rather than guessing', async () => {
  /*
   * The residual ambiguity, pinned as a REFUSAL rather than left to a guess.
   * PowerPoint declares one relationship per media part however many shapes
   * show it, so "twice on slide 1" and "once on slide 1" are the same set —
   * and since slide 2 references the same part, nothing in either account says
   * whether the second block is slide 1's or slide 2's. Slide 1 takes one,
   * slide 2 takes the next, and the third belongs to nobody.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', image: { alt: 'First' }, secondImage: { alt: 'Second' } },
    { title: 'Two', image: { alt: 'Third' } },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(3)
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('1 block of content belongs to no slide')
})

test('a picture anydoc cannot identify refuses rather than joining the open slide', async () => {
  /*
   * A `p:pic` whose `r:embed` names a relationship the package DOES declare,
   * pointing at a media part the package does not contain. MEASURED with real
   * anydoc 0.2.4: it emits `<span data-origin-part="">[Embedded image: A
   * missing picture]</span>` — a picture with no identity at all, because
   * anydoc has no bytes and therefore no origin to report. No slide can
   * reference the empty string, so it joins to nothing and both halves of the
   * refusal fire: the block belongs to no slide, and slide 1 never received the
   * part its own shapes point at.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], missingMediaImage: true },
    { title: 'Two', body: ['Body two'] },
  ]))

  expect(anydocHtml).toContain('<span data-origin-part="">[Embedded image: A missing picture]</span>')
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('slide 1 is missing a picture the deck says it carries')
  expect(finding?.message).toContain('blocks of content belong to no slide')
})

test('no join key survives into the html this module publishes', async () => {
  // `data-origin-part` is how a picture says where it came from; it is not
  // content, and `data-*` passes the Canvas allowlist untouched, so a package
  // path would otherwise ride into the exported page. Every picture shape at
  // once: a packaged picture, a linked one, and an unpackageable placeholder.
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], image: { alt: 'A cell' } },
    { title: 'Two', linkedImage: true },
    { title: 'Three', unpackageableImage: {} },
  ]))

  expect(anydocHtml).toContain('data-origin-part')
  expect(result.html).not.toContain('data-origin-part')
  expect(result.html).toContain('<img')
  expect(result.html).toContain('[Embedded image')
  expect(result.findings.map((finding) => finding.code)).toEqual([])
})



test('an odp frame\'s alternative pictures do not steal another slide\'s picture', async () => {
  /*
   * THE SIXTH COUNTEREXAMPLE, and the one that shows what the join does and
   * does not guarantee. ODF 1.3 §10.4.2 makes a `draw:frame`'s children
   * ALTERNATIVE representations of one object; the index collected all of them.
   *
   * Page 1 shows one picture twice (`Pictures/image1.png`), page 2 has a single
   * frame whose alternatives are `Pictures/image2.gif` then that same
   * `Pictures/image1.png`. The over-collected reference made `image1.png` look
   * like two slides' part, the sole-referencer rule then capped page 1 — its
   * true and ONLY owner — at one block and handed page 2 a claim on the
   * surplus, and the balance still came out even because the part page 2
   * over-claimed is exactly the part it over-collected. Page 1's second picture
   * published inside `<section data-slide="2">` with NO findings at all.
   *
   * Taking only the first child restores the agreement: anydoc renders the
   * first alternative, and so does the index.
   */
  const { anydocHtml, index, result } = await reconcileFixture([
    { title: 'One', image: { alt: 'First' }, secondImage: { alt: 'Second' } },
    { title: 'Two', alternateImages: true },
  ])

  // anydoc renders the FIRST alternative and nothing else — three blocks, not four.
  expect(anydocHtml.match(/<img/g)).toHaveLength(3)

  // The misattribution itself is asserted FIRST, so a regression fails on the
  // published sections rather than on the index reading that produced them.
  const sections = sectionsOf(result.html)
  expect([...sections[0]!.querySelectorAll('img')].map((image) => image.alt)).toEqual(['First', 'Second'])
  expect([...sections[1]!.querySelectorAll('img')].map((image) => image.alt)).toEqual([''])
  expect(result.findings).toEqual([])
  expect(index.slides[1]!.pictureOrigins).toEqual(['Pictures/image2.gif'])
})

test('an odp frame carrying only alternatives imports instead of refusing', async () => {
  // The benign half of the same defect: on its own, a frame with two
  // alternative children made the index expect two pictures where anydoc emits
  // one, so any converter-produced deck using alternative representations was
  // unimportable — "slide 1 is missing a picture the deck says it carries".
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'One', alternateImages: true },
  ])

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  expect(result.findings).toEqual([])
  expect(sectionsOf(result.html)[0]!.querySelector('img')).not.toBeNull()
})

test.each([
  ['a space', 'image 1.png'],
  ['a reserved character', 'image#2.png'],
] as const)('a media part whose name contains %s still joins', async (_name, imagePartName) => {
  /*
   * An OPC relationship `Target` is a URI reference, so `image 1.png` is
   * written `../media/image%201.png` while the ZIP entry keeps the literal
   * name. The index resolved that target by string surgery — `ppt/` plus the
   * target with a leading `../` removed — which percent-decoded nothing:
   * MEASURED, it produced `ppt/media/image%201.png` while anydoc reported
   * `ppt/media/image 1.png`, and a media file with a space in its name refused
   * the whole deck. That resolution only located a notes part before pictures
   * were joined on it, so the exposure was new.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture(
    [{ title: 'One', body: ['Body one'], image: { alt: 'A cell' } }],
    { imagePartName },
  ))

  // The two accounts agree on the DECODED name, which is the ZIP entry's own.
  expect(anydocHtml).toContain(`data-origin-part="ppt/media/${imagePartName}"`)
  expect(index.slides[0]!.pictureOrigins).toEqual([`ppt/media/${imagePartName}`])
  expect(result.findings).toEqual([])
  expect(sectionsOf(result.html)[0]!.querySelector('img')).not.toBeNull()
})


test('sibling a:blip elements in one p:blipFill: the FIRST is the picture, not both', async () => {
  /*
   * PowerPoint never authors two `a:blip` siblings in one fill; a converter
   * can. MEASURED: anydoc renders ONE `<img>`, from the FIRST blip. An
   * earlier version of the index collected every `a:blip` at any depth inside
   * the chosen fill instead, which would have made this ONE shape's picture
   * look like a reference to two different parts.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', siblingBlipsInFill: true },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
  expect(result.findings).toEqual([])
})

test('a second a:blip nested in an extLst does not double the picture', async () => {
  /*
   * Schema-legal: `a:extLst` holds vendor extensions, engineered here to hold
   * a second, complete `a:blip` instead of an ordinary one. MEASURED: anydoc
   * renders ONE `<img>`, from the OUTER blip. Walking every `a:blip` at any
   * depth inside the chosen fill (an earlier version of the index) would find
   * this nested one too.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', blipInExtLst: true },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
  expect(result.findings).toEqual([])
})

test('inside a blipFill, anydoc renders the FIRST blip written, not the branch Requires would pick', async () => {
  /*
   * MEASURED with real anydoc 0.2.4: unlike `walkShapes` on the shape tree,
   * anydoc does not evaluate `mc:AlternateContent`'s `Requires` inside a
   * blipFill at all — it renders whichever blip is written FIRST in document
   * order. `Requires="p14"` would make `rendersChoiceBranch` prefer the
   * Fallback at the shape-tree level; here the Choice (always written first)
   * is what anydoc renders instead. An earlier version of this fix routed
   * `readBlipOrigins` through `rendersChoiceBranch` to "inherit" that
   * discipline, which read the FALLBACK's part here — the wrong one.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', blipFillChoiceFallback: { choice: 'image', fallback: 'image2' } },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  expect(index.slides[0]!.pictureOrigins).toEqual(['ppt/media/image1.png'])
  expect(result.findings).toEqual([])
})

test('the motivating misattribution deck: a plain picture beside an mc:AlternateContent fill keeps its own picture', async () => {
  /*
   * Slide 1 carries a plain picture on the SECOND real image plus a
   * `p:blipFill` wrapping `mc:AlternateContent` whose Choice names the FIRST
   * real image and whose Fallback names the second. Slide 2 carries a plain
   * picture on the first real image alone. An earlier version of this fix
   * routed the blipFill's blip through `rendersChoiceBranch`, which prefers
   * the Fallback for `Requires="p14"` — reading the SECOND image for slide
   * 1's AC pic where anydoc renders the FIRST. MEASURED: that silently
   * swapped which slide's heading each picture published under, with no
   * finding at all — this pins the deck that exposed it.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', image2: { alt: 'Plain B' }, blipFillChoiceFallback: { choice: 'image', fallback: 'image2' } },
    { title: 'Two', image: { alt: 'Plain A' } },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(3)
  const sections = sectionsOf(result.html)
  expect(sections).toHaveLength(2)
  expect([...sections[0]!.querySelectorAll('img')].map((image) => image.alt)).toContain('Plain B')
  expect([...sections[0]!.querySelectorAll('img')].map((image) => image.alt)).not.toContain('Plain A')
  expect([...sections[1]!.querySelectorAll('img')].map((image) => image.alt)).toEqual(['Plain A'])
  expect(result.findings).toEqual([])
})

test("a choice-only mc:AlternateContent does not steal an earlier slide's picture", async () => {
  /*
   * THE SEVENTH COUNTEREXAMPLE, and the same SHAPE as the sixth: the index
   * walked a branch anydoc renders nothing for.
   *
   * `mc:AlternateContent` carrying ONE `mc:Choice` with an unsupported
   * `Requires` and NO `mc:Fallback`. MEASURED: anydoc emits no block for it at
   * all. The index's last resort — "otherwise the first Choice, because an
   * AlternateContent with no Fallback is legal" — collected that Choice's
   * picture part, and because the part is the one slide 1 really owns, the
   * sole-referencer rule capped slide 1 at one block and handed slide 2 the
   * surplus: `[["ONE PIC"], ["TWO PIC"]]` with NO findings, when slide 1 owns
   * both. Collecting nothing is what anydoc does.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', image: { alt: 'ONE PIC' }, secondImage: { alt: 'TWO PIC' } },
    { title: 'Two', pictureInChoiceOnlyAlternateContent: true },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(2)
  const sections = sectionsOf(result.html)
  expect([...sections[0]!.querySelectorAll('img')].map((image) => image.alt)).toEqual(['ONE PIC', 'TWO PIC'])
  expect(sections[1]!.querySelectorAll('img')).toHaveLength(0)
  expect(result.findings).toEqual([])
  expect(index.slides[1]!.pictureOrigins).toEqual([])
})

test('a choice-only mc:AlternateContent contributes no TEXT either', async () => {
  // The same branch, carrying a paragraph instead of a picture: anydoc emits
  // the heading and nothing else, so an index that read the Choice would hold a
  // run no block carries and the deck would refuse.
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', alternateContentText: { choice: 'CHOICE TEXT', requires: 'p14' } },
  ]))

  expect(anydocHtml).toBe('<h2 id="One">One</h2>')
  expect(index.slides[0]!.textRuns).toEqual(['One'])
  expect(result.findings).toEqual([])
})

test.each([
  [
    'Requires names several namespaces, not all supported',
    { choice: 'CHOICE TEXT', fallback: 'FALLBACK TEXT', requires: ['a14', 'p14'] },
    'FALLBACK TEXT',
  ],
  [
    'Requires is present but empty',
    { choice: 'CHOICE TEXT', fallback: 'FALLBACK TEXT', requires: '' },
    'CHOICE TEXT',
  ],
  [
    'the renderable Choice is not the first one written',
    {
      choice: 'CHOICE TEXT',
      requires: 'p14',
      secondChoice: { text: 'SECOND CHOICE TEXT', requires: 'a14' },
      fallback: 'FALLBACK TEXT',
    },
    'SECOND CHOICE TEXT',
  ],
] as const)('the index reads the branch anydoc renders when %s', async (_name, alternateContentText, expected) => {
  // The controls on the branch rule, stated against anydoc itself rather than
  // against remembered values — the `Requires` rule is namespace-keyed and
  // conservative (every prefix must be supported), and the renderable Choice
  // wins wherever it sits among several.
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', alternateContentText },
  ]))

  expect(anydocHtml).toContain(expected)
  expect(index.slides[0]!.textRuns).toEqual(['One', expected])
  expect(result.findings).toEqual([])
})

test('an odp picture part whose name contains a space still joins', async () => {
  /*
   * The PPTX defect on the other format. An `xlink:href` is an IRI, so a part
   * named `image 1.png` is referenced as `Pictures/image%201.png`; taking the
   * href verbatim kept the encoded form while anydoc reported the decoded one,
   * and the deck refused with "slide 1 is missing a picture the deck says it
   * carries".
   */
  const { anydocHtml, index, result } = await reconcileBytes('odp', await odpFixture(
    [{ title: 'One', body: ['Body one'], image: { alt: 'A cell' } }],
    { imagePartName: 'image 1.png' },
  ))

  expect(anydocHtml).toContain('data-origin-part="Pictures/image 1.png"')
  expect(index.slides[0]!.pictureOrigins).toEqual(['Pictures/image 1.png'])
  expect(result.findings).toEqual([])
  expect(sectionsOf(result.html)[0]!.querySelector('img')).not.toBeNull()
})

test('a target the index cannot name refuses instead of vanishing', async () => {
  /*
   * THE REVIEWER'S DECK. A relationship the deck DECLARES whose target will not
   * resolve to a part — slide 1 names `../media/100%.png`, a literal unencoded
   * `%`, while slide 2 names the SAME ZIP entry through a properly encoded
   * `../media/100%25.png`.
   *
   * Dropping the unresolvable reference was the defect: slide 1 recorded no
   * reference at all, so slide 2 became the SOLE referencer of that part and
   * claimed BOTH blocks — sections `[[], ["ONE PIC", "TWO PIC"]]` — and the
   * only finding was a warning saying slide 1's picture "could not be
   * imported", which was false: it was imported, under slide 2's heading.
   *
   * Recording it as a reference to something UNKNOWN closes it. Nothing can
   * ever satisfy that origin, so the slide holding one ALWAYS reaches the
   * refusal rather than silently losing its pictures to a neighbour — and on a
   * blocker nothing is published at all.
   */
  const { result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', image: { alt: 'ONE PIC' }, imageTargetOverride: '../media/100%.png' },
    { title: 'Two', image: { alt: 'TWO PIC' } },
  ], { imagePartName: '100%.png' }))

  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('slide 1 is missing a picture the deck says it carries')
  // And NOT the warning that used to stand in its place and contradict it.
  expect(result.findings.map((entry) => entry.code)).not.toContain('presentation-unrepresentable')
})

test('a raw fragment separator in a target is refused, not silently truncated', async () => {
  /*
   * `../media/im#age.png` used to resolve to `ppt/media/im` — a silently WRONG
   * value, which is worse than an absent one because it still feeds the
   * sole-referencer test. An OPC part name is a path, not a URL with a
   * fragment. MEASURED: anydoc cannot name it either and reports an empty
   * origin, so "neither account can name it" is the honest agreement, and both
   * halves of the refusal fire.
   */
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture(
    [{ title: 'One', body: ['Body one'], image: { alt: 'A cell' }, imageTargetOverride: '../media/im#age.png' }],
    { imagePartName: 'im#age.png' },
  ))

  expect(anydocHtml).toContain('data-origin-part=""')
  expect(index.slides[0]!.pictureOrigins).not.toContain('ppt/media/im')
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('slide 1 is missing a picture the deck says it carries')
  expect(finding?.message).toContain('1 block of content belongs to no slide')
})


test.each([
  ['a hyperlinked picture (draw:a)', 'hyperlinkedImage'],
  ['a picture inside a table cell', 'imageInTableCell'],
  ["a frame inside another frame's text-box", 'imageInNestedFrame'],
  ['a picture hung off a draw:custom-shape', 'imageInCustomShape'],
  ['an unframed picture directly under draw:page', 'unframedImage'],
  ['a frame directly inside another frame', 'imageInFrameInFrame'],
  ['a frame inside a group inside another frame', 'imageInFrameInGroupInFrame'],
  ['a frame inside another frame, inside a group', 'imageInFrameInFrameInGroup'],
] as const)('the odp index records nothing for %s, because anydoc renders nothing', async (_name, placement) => {
  /*
   * ODF puts almost no constraint on where a `draw:image` may sit, and the
   * index's picture query was a FLAT any-depth query over the page; anydoc
   * reaches a picture by WALKING A SHAPE TREE. The two disagree at every
   * placement the walk does not visit, and these five are measured: anydoc
   * emits no block for any of them.
   *
   * On its own each was a spurious refusal. Combined with an earlier page that
   * really owns the part, it was a silent misattribution — see the test below.
   */
  const { anydocHtml, index, result } = await reconcileFixture([{ title: 'One', [placement]: true }])

  expect(anydocHtml).not.toContain('<img')
  expect(index.slides[0]!.pictureOrigins).toEqual([])
  expect(result.findings).toEqual([])
})

test.each([
  ['inside a draw:g group', { groupedImage: true }],
  ['inside two nested draw:g groups', { deeplyGroupedImage: true }],
  ['three groups deep', { groupDepth: 3 }],
  ['four groups deep', { groupDepth: 4 }],
  ['five groups deep', { groupDepth: 5 }],
] as const)('the odp index still records a picture %s, which anydoc does render', async (_name, placement) => {
  // The positive controls for the nesting rule. A rule that over-restricts —
  // "only a frame that is a direct child of the page", or one that quietly caps
  // group depth — passes every negative test above and silently stops importing
  // Impress's own Group command.
  const { anydocHtml, index, result } = await reconcileFixture([{ title: 'One', ...placement }])

  expect(anydocHtml).toContain('<img')
  expect(index.slides[0]!.pictureOrigins).toEqual(['Pictures/image1.png'])
  expect(sectionsOf(result.html)[0]!.querySelector('img')).not.toBeNull()
  expect(result.findings).toEqual([])
})

test.each([
  ['a table cell', 'imageInTableCell'],
  ['a draw:a hyperlink', 'hyperlinkedImage'],
  ["a frame nested in another frame's text-box", 'imageInNestedFrame'],
  ['a frame directly inside another frame', 'imageInFrameInFrame'],
  ['a frame inside a group inside another frame', 'imageInFrameInGroupInFrame'],
  ['a frame inside another frame, inside a group', 'imageInFrameInFrameInGroup'],
] as const)(
  "an odp picture anydoc does not walk, in %s, no longer steals an earlier page's picture",
  async (_name, placement) => {
    /*
     * THE EIGHTH COUNTEREXAMPLE, and the same SHAPE as the sixth and seventh:
     * the index collects a picture anydoc does not render. Page 1 shows one
     * picture twice; page 2 holds that SAME part somewhere anydoc's walk never
     * visits. The over-collected reference made the part look like two pages',
     * the sole-referencer rule capped page 1 — its true and only owner — at one
     * block, and page 1's second picture published under page 2's heading with
     * NO findings at all. All three placements produced byte-identical output.
     */
    const { anydocHtml, result } = await reconcileFixture([
      { title: 'One', image: { alt: 'ONE PIC' }, secondImage: { alt: 'TWO PIC' } },
      { title: 'Two', [placement]: true },
    ])

    expect(anydocHtml.match(/<img/g)).toHaveLength(2)
    const sections = sectionsOf(result.html)
    expect([...sections[0]!.querySelectorAll('img')].map((image) => image.alt)).toEqual(['ONE PIC', 'TWO PIC'])
    expect(sections[1]!.querySelectorAll('img')).toHaveLength(0)
    expect(result.findings).toEqual([])
  },
)

test('a reference resolving to the package root cannot claim an unidentifiable picture', async () => {
  /*
   * `resolvePackagePath` returned the EMPTY STRING for a reference resolving to
   * the package root (`xlink:href="."`), and `''` is exactly the origin
   * `anydoc-html.ts` writes for a picture it could NOT identify — so the slide
   * holding it became the sole referencer of every unidentifiable picture in
   * the deck. MEASURED: page 1 with `href="."` and page 2 carrying its bytes
   * inline as `office:binary-data` (no href at all, which anydoc renders with
   * an empty origin), and page 1 claimed BOTH placeholders while the only
   * finding was the untitled-slide warning.
   *
   * There were two "cannot name it" values, one deliberately unclaimable and
   * one silently claimable. Now there is one.
   */
  const { anydocHtml, index, result } = await reconcileFixture([
    { title: 'One', image: { alt: 'DOT' }, imageHrefOverride: '.' },
    { inlineBytesImage: true },
  ])

  // Both pictures reach anydoc with NO identity of their own.
  expect(anydocHtml.match(/data-origin-part=""/g)).toHaveLength(2)
  expect(index.slides[0]!.pictureOrigins).not.toContain('')
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(sectionsOf(result.html)[0]!.textContent).not.toContain('INLINE BYTES')
})

test('a raw query separator in a target is refused, not silently truncated', async () => {
  // The sibling of the `#` row: `?` starts a query, and `URL` would strip
  // `?age.png` from the name just as silently. A part name is a path.
  const { anydocHtml, index, result } = await reconcileBytes('pptx', await pptxFixture(
    [{ title: 'One', body: ['Body one'], image: { alt: 'A cell' }, imageTargetOverride: '../media/im?age.png' }],
    { imagePartName: 'im?age.png' },
  ))

  expect(anydocHtml).toContain('data-origin-part=""')
  expect(index.slides[0]!.pictureOrigins).not.toContain('ppt/media/im')
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('slide 1 is missing a picture the deck says it carries')
})


test('an odp frame nested inside another frame contributes no text either', async () => {
  /*
   * The TEXT half of the one nesting rule, and a shape that was measured
   * UNIMPORTABLE: anydoc emits `<h2>One</h2>` and nothing else for a frame
   * inside a frame, while the index collected the inner frame's paragraph — a
   * run no block carries, so the deck took a `presentation-unattributed-content`
   * blocker. Fail-closed rather than a misattribution, but a unit test asserted
   * that collection was correct.
   */
  const { anydocHtml, index, result } = await reconcileFixture([
    { title: 'One', nestedFrameText: 'NESTED TEXT' },
  ])

  expect(anydocHtml).toBe('<h2 id="One">One</h2>')
  expect(index.slides[0]!.textRuns).toEqual(['One'])
  expect(result.findings).toEqual([])
})

test.each([
  ["a drawn shape's own text", { customShapeText: 'SHAPE TEXT' }, 'SHAPE TEXT'],
  ["a grouped drawn shape's own text", { groupedCustomShapeText: 'GROUPED TEXT' }, 'GROUPED TEXT'],
] as const)('%s is still read, because anydoc still emits it', async (_name, page, expected) => {
  // The text rule is NOT the picture rule. Task 5 measured that Impress puts
  // typed text directly inside a toolbar shape with no enclosing frame, and
  // that anydoc emits a block for it; the nesting rule must not take that with
  // it. A shape's own content is read — a shape inside another shape is not
  // entered.
  const { anydocHtml, index, result } = await reconcileFixture([{ title: 'One', ...page }])

  expect(anydocHtml).toContain(expected)
  expect(index.slides[0]!.textRuns).toEqual(['One', expected])
  expect(result.findings).toEqual([])
})

test.each([
  ['written where the picture fill goes', {}],
  ['written under p:spPr where a shape fill goes', { inSpPr: true }],
] as const)(
  "a p:pic whose fill is drawingml, %s, is attributed rather than lost",
  async (_name, drawingmlBlipFill) => {
    /*
     * MEASURED: anydoc renders a `p:pic` whose fill is `a:blipFill` with a real
     * origin, in both placements. The index scoped to the presentationml
     * `p:blipFill` and recorded nothing — a loud blocker on its own, but beside
     * an untitled picture-only slide it left slide 1 the sole referencer, which
     * then claimed BOTH blocks and shipped slide 2 empty under nothing but an
     * untitled-slide warning.
     */
    const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
      { title: 'One', drawingmlBlipFill },
      { image: { alt: 'SLIDE TWO PIC' } },
    ]))

    expect(anydocHtml.match(/<img/g)).toHaveLength(2)
    const sections = sectionsOf(result.html)
    expect(sections[0]!.querySelector('img')!.alt).toBe('Drawingml fill')
    expect(sections[1]!.querySelector('img')!.alt).toBe('SLIDE TWO PIC')
    expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-untitled-slide'])
  },
)


test.each([
  ['beside notes text of its own', { notes: 'PRIVATE NOTE.', notesNestedFrameText: 'NESTED PRIVATE' },
    'PRIVATE NOTE. NESTED PRIVATE'],
  ['as the only notes content', { notesNestedFrameText: 'NESTED ONLY' }, 'NESTED ONLY'],
] as const)(
  'a frame nested inside speaker notes keeps the notes recognised, %s',
  async (_name, page, expectedNotes) => {
    /*
     * THE ASYMMETRY, measured rather than assumed — and the expectation it
     * overturned was mine and the reviewer's alike.
     *
     * On a `draw:page` anydoc's walk stops the moment a shape contains another
     * shape, which is the rule three ODP counterexamples came from. Inside
     * `presentation:notes` it does NOT stop: a `draw:frame` nested in the notes
     * frame contributes its paragraph to the blockquote. So the notes query's
     * any-depth reach is what AGREES with anydoc, and `notesText` equals the
     * blockquote's own text — the only thing the strict-equality comparison can
     * rest on.
     *
     * Applying the slide body's rule here was measured doing the harm the
     * consistency argument was meant to prevent: `notesText` came out short,
     * the comparison failed, the blockquote was no longer recognised as speaker
     * notes, and the deck took a `presentation-unattributed-content` blocker.
     */
    const { anydocHtml, index, result } = await reconcileFixture([
      { title: 'One', body: ['Body one'], ...page },
    ])

    expect(anydocHtml).toContain('<blockquote>')
    expect(index.slides[0]!.notesText).toBe(expectedNotes)
    // Recognised, and therefore kept off the page: both halves of the note.
    expect(result.html).not.toContain('NESTED')
    expect(result.html).not.toContain('PRIVATE NOTE')
    expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-speaker-notes'])
  },
)

test.each([
  ['a chart', [{ kind: 'chart' }], '1 chart'],
  ['a diagram', [{ kind: 'diagram' }], '1 diagram'],
  ['a chart with a raster preview a converter wrote', [{ kind: 'chart', replacement: 'png' }], '1 chart'],
  ['a chart and a diagram side by side', [{ kind: 'chart' }, { kind: 'diagram' }], '1 diagram, 1 chart'],
] as const)(
  'an ODP embedded object is named on its own page: %s',
  async (_name, embeddedObjects, expectedCount) => {
    /*
     * THE MEASUREMENT THAT DECIDED ISSUE 14's ODP VERDICT, in the direction it
     * finally landed.
     *
     * ODF gives an embedded object's frame NO `draw:mime-type`: an inserted
     * chart is `draw:frame > draw:object` whose `xlink:href` names a DIRECTORY
     * (`./Object 1`). Nothing in `content.xml` says what that object is. So
     * until the manifest was fetched alongside it (`parts.ts`), `odpIndex`
     * reported `unrepresentable.diagrams` and `charts` as a hardcoded zero and
     * an Impress chart was lost with NO finding — design fact 6's silent loss,
     * on the most ordinary thing an OER science deck carries after images.
     *
     * The manifest says. MEASURED 2026-08-30 on a file LibreOffice Impress
     * wrote through its own `impress8` filter: `META-INF/manifest.xml` carries
     * `Object 1/` with media type `application/vnd.oasis.opendocument.chart`.
     * Joining the two parts is what closes the gap, and it is the whole fix.
     *
     * The third row exists because the second is not enough on its own: a
     * `draw:image` preview beside the object could have been what raised the
     * finding rather than the object itself. It does not — the count says
     * "1 chart", never "1 chart, 1 picture", and the picture packages
     * normally.
     */
    const { result } = await reconcileFixture([
      { title: 'Process overview', embeddedObjects },
    ])

    const finding = result.findings.find((entry) => entry.code === 'presentation-unrepresentable')
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('warning')
    expect(finding!.sourcePage).toBe(1)
    expect(finding!.message).toContain(expectedCount)
    // No blocker: the object is REPORTED lost, not treated as a disagreement
    // the page cannot be published under.
    expect(result.findings.filter((entry) => entry.severity === 'blocker')).toEqual([])
  },
)

test('an ODP embedded object on the SECOND page is named on the second page', async () => {
  // The manifest is one flat list for the whole package, so a lookup keyed
  // wrongly — by "the package has a chart somewhere" rather than by THIS
  // page's own object directory — would put the finding on page 1 and still
  // pass every single-page row above.
  const { result } = await reconcileFixture([
    { title: 'Intro', body: ['Body one'] },
    { title: 'Process overview', embeddedObjects: [{ kind: 'chart' }] },
  ])

  const finding = result.findings.find((entry) => entry.code === 'presentation-unrepresentable')
  expect(finding!.sourcePage).toBe(2)
  expect(finding!.message).toContain('Slide 2')
})

test('an ODP page with no embedded object reports no unrepresentable content', async () => {
  // The other direction of the same guard: reading the manifest must not make
  // an ordinary page start claiming a loss it does not have.
  const { result } = await reconcileFixture([
    { title: 'Process overview', body: ['Body one'], image: { alt: 'A chloroplast' } },
  ])

  expect(result.findings.map((finding) => finding.code)).toEqual([])
})

test('an ODP chart is still named when it carries the GDI metafile preview LibreOffice really writes', async () => {
  /*
   * THE FILE A USER ACTUALLY HAS. Measured on LibreOffice's own `impress8`
   * output: the `ObjectReplacements/` preview beside an embedded object is a
   * VCL GDI metafile, declared `application/x-openoffice-gdimetafile` — a
   * format this importer cannot package. So a real Impress chart produces TWO
   * findings, and both are correct:
   *
   * - `presentation-unrepresentable`, naming the chart on its own page, which
   *   is what issue 14's bar required and what the manifest join delivers;
   * - `embedded-content` at severity BLOCKER, naming an image that cannot be
   *   packaged — the SAME refusal a PowerPoint deck carrying a pasted chart
   *   gets through its EMF preview, and a limitation both formats already
   *   state.
   *
   * The blocker is not an ODP defect and it is not a reason the format failed
   * the bar: it is the shared unpackageable-image rule, symmetric across the
   * two formats, and it refuses rather than losing anything silently.
   */
  const { result } = await reconcileFixture([
    { title: 'Process overview', embeddedObjects: [{ kind: 'chart', replacement: 'gdi-metafile' }] },
  ])

  const unrepresentable = result.findings.find((entry) => entry.code === 'presentation-unrepresentable')
  expect(unrepresentable!.sourcePage).toBe(1)
  expect(unrepresentable!.message).toContain('1 chart')
})
