import { probeParser } from '../parsers/probe'
import { readPresentationIndex } from './index'
import { reconcilePresentation } from './reconcile'
import { odpFixture } from '../testing/presentation-fixtures'

/**
 * The reconciler against REAL anydoc 0.2.4, in the real Worker, on real
 * packages — because every one of its rules is a claim about what anydoc emits,
 * and both defects this file pins passed a full suite of hand-written HTML.
 * Hand-written HTML can only ever restate what its author already believed.
 */
async function reconcileFixture(pages: Parameters<typeof odpFixture>[0]) {
  const bytes = await odpFixture(pages)
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes: bytes.buffer as ArrayBuffer,
    formatHint: 'odp',
  })
  const index = readPresentationIndex('odp', parsed.presentation!.parts)
  const result = reconcilePresentation({ html: parsed.normalized!.html, index, sourceLabel: 'ODP' })
  return { anydocHtml: parsed.normalized!.html, index, result }
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
  const { anydocHtml, result } = await reconcileFixture([
    { title: 'Agenda', bulletList: ['Cell walls', 'Photosynthesis'] },
    { title: 'Cell walls', body: ['Rigid layer outside the membrane'] },
    { title: 'Photosynthesis', body: ['Light reactions happen in the thylakoid'] },
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
  expect(sections[1]!.querySelector('h2')!.id).toBe('Cell-walls')
  expect(sections[1]!.querySelector('p')).toHaveTextContent('Rigid layer outside the membrane')
  expect(sections[2]!.querySelector('h2')!.id).toBe('Photosynthesis')
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
