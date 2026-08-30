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
  expect(result.findings.map((finding) => finding.code)).toEqual(['presentation-untitled-slide'])
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

  expect(result.findings).toEqual([])
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
