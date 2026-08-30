import { probeParser } from '../parsers/probe'
import { readPresentationIndex } from './index'
import { reconcilePresentation } from './reconcile'
import { odpFixture, pptxFixture } from '../testing/presentation-fixtures'

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

test('a deck with a video imports it, poster frame and all', async () => {
  /*
   * PowerPoint writes a media `p:pic` with a poster frame, and anydoc emits
   * that poster as an ordinary picture block. Counting the shape as media alone
   * left the poster belonging to nobody, and one video anywhere in a lecture
   * deck refused the whole import.
   */
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', body: ['Body one'], video: true },
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

test('a counted picture anydoc never emitted refuses rather than taking the next slide\'s', async () => {
  // A `p:pic` whose `r:embed` names an undefined relationship: anydoc emits
  // nothing for it and raises no finding, so nothing but the index's own count
  // knows the picture is missing.
  const { anydocHtml, result } = await reconcileBytes('pptx', await pptxFixture([
    { title: 'One', brokenImage: true },
    { image: { alt: 'A cell' } },
    { title: 'Three', body: ['Body three'] },
  ]))

  expect(anydocHtml.match(/<img/g)).toHaveLength(1)
  const finding = result.findings.find((entry) => entry.code === 'presentation-unattributed-content')
  expect(finding?.severity).toBe('blocker')
  expect(finding?.message).toContain('missing content the deck says')
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
] as const)('%s spends its budget and does not refuse', async (_name, fixture) => {
  // Refusing on an unspent budget is only safe if every ordinary picture shape
  // actually spends one.
  const { result } = await reconcileBytes('pptx', await fixture())

  expect(result.findings.map((finding) => finding.code))
    .not.toContain('presentation-unattributed-content')
  expect(result.html).toContain('<img')
})
