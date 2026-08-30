import { reconcilePresentation, formatSlideList } from './reconcile'
import type { ReconcileResult } from './reconcile'
import type { PresentationIndex } from './index'

const index = (slides: PresentationIndex['slides']): PresentationIndex => ({ kind: 'pptx', slides })

const slide = (
  number: number,
  overrides: Partial<PresentationIndex['slides'][number]> = {},
): PresentationIndex['slides'][number] => ({
  number,
  textRuns: [],
  titleOutOfOrder: false,
  unrepresentable: { diagrams: 0, charts: 0, media: 0 },
  ...overrides,
})

const codes = (result: ReconcileResult) => result.findings.map((finding) => finding.code)

const only = (result: ReconcileResult, code: string) => {
  const matching = result.findings.filter((finding) => finding.code === code)
  expect(matching).toHaveLength(1)
  return matching[0]!
}

test('each slide becomes one section carrying its number', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><p>Light reactions</p><h2>Where it happens</h2><p>Stroma</p>',
    index: index([
      slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis', 'Light reactions'] }),
      slide(2, { title: 'Where it happens', textRuns: ['Where it happens', 'Stroma'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toBe(
    '<section data-slide="1" data-plan-label="Slide 1: Photosynthesis">' +
    '<h2 id="slide-1">Photosynthesis</h2><p>Light reactions</p></section>' +
    '<section data-slide="2" data-plan-label="Slide 2: Where it happens">' +
    '<h2 id="slide-2">Where it happens</h2><p>Stroma</p></section>',
  )
  expect(result.findings).toEqual([])
})

test('an untitled slide gets a generated, editable title and a warning naming it', () => {
  const result = reconcilePresentation({
    html: '<h2>First slide</h2><p>Body of an untitled slide</p><h2>Third slide</h2>',
    index: index([
      slide(1, { title: 'First slide', textRuns: ['First slide'] }),
      slide(2, { textRuns: ['Body of an untitled slide'] }),
      slide(3, { title: 'Third slide', textRuns: ['Third slide'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<section data-slide="2" data-plan-label="Slide 2"><h2 id="slide-2">Slide 2</h2>')
  const finding = only(result, 'presentation-untitled-slide')
  expect(finding.severity).toBe('warning')
  // Exactly one slide is affected, so the finding can point at it.
  expect(finding.sourcePage).toBe(2)
  expect(finding.message).toContain('Slide 2 has no title')
})

test('several untitled slides produce ONE warning naming them all, with no sourcePage', () => {
  // 96 of 226 measured slides carry no title placeholder (task 4), so one
  // finding per slide would bury the reader in near-identical warnings.
  const result = reconcilePresentation({
    html: '<p>Alpha body</p><p>Beta body</p><p>Gamma body</p><h2>Delta</h2>',
    index: index([
      slide(1, { textRuns: ['Alpha body'] }),
      slide(2, { textRuns: ['Beta body'] }),
      slide(3, { textRuns: ['Gamma body'] }),
      slide(4, { title: 'Delta', textRuns: ['Delta'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-untitled-slide')
  expect(finding.message).toContain('Slides 1, 2, and 3 have no title')
  expect(finding.sourcePage).toBeUndefined()
})

test('speaker notes are removed from the page and named in a warning', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><p>Light reactions</p><blockquote><p>Mention the thylakoid membrane.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'Light reactions'],
      notesText: 'Mention the thylakoid membrane.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).not.toContain('thylakoid')
  const finding = only(result, 'presentation-speaker-notes')
  expect(finding.severity).toBe('warning')
  expect(finding.sourcePage).toBe(1)
  // The notes blockquote is not in `textRuns` — recognising it must CONSUME it,
  // not fall through to the unattributed-content refusal.
  expect(codes(result)).not.toContain('presentation-unattributed-content')
})

test('speaker notes containing a soft line break are still recognised and removed', () => {
  // anydoc renders `a:br`/`text:line-break` as an inline `<br>`, and
  // `textContent` concatenates straight across it ("membrane,then the stroma"),
  // while the index renders the same break as ONE SPACE. Comparing a raw
  // `textContent` read against `notesText` therefore fails on any note with a
  // soft break, and publishes the presenter's private words.
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>Mention the thylakoid membrane,<br>then the stroma.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis'],
      notesText: 'Mention the thylakoid membrane, then the stroma.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).not.toContain('thylakoid')
  expect(codes(result)).toContain('presentation-speaker-notes')
  expect(codes(result)).not.toContain('presentation-unattributed-content')
})

test('a real quotation is NOT mistaken for speaker notes', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>Energy cannot be created.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'Energy cannot be created.'],
      notesText: 'Mention the thylakoid membrane.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('Energy cannot be created.')
  expect(codes(result)).not.toContain('presentation-unattributed-content')
})

test('notes on several slides produce ONE warning naming every slide', () => {
  const result = reconcilePresentation({
    html:
      '<h2>One</h2><blockquote><p>Note for one.</p></blockquote>' +
      '<h2>Two</h2>' +
      '<h2>Three</h2><blockquote><p>Note for three.</p></blockquote>',
    index: index([
      slide(1, { title: 'One', textRuns: ['One'], notesText: 'Note for one.' }),
      slide(2, { title: 'Two', textRuns: ['Two'] }),
      slide(3, { title: 'Three', textRuns: ['Three'], notesText: 'Note for three.' }),
    ]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-speaker-notes')
  expect(finding.message).toContain('Slides 1 and 3 have speaker notes')
  expect(finding.sourcePage).toBeUndefined()
  expect(result.html).not.toContain('Note for')
})

test('a diagram, chart, or media is named on its own slide', () => {
  const result = reconcilePresentation({
    html: '<h2>Process overview</h2>',
    index: index([slide(1, {
      title: 'Process overview',
      textRuns: ['Process overview'],
      unrepresentable: { diagrams: 1, charts: 1, media: 2 },
    })]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-unrepresentable')
  expect(finding.severity).toBe('warning')
  expect(finding.sourcePage).toBe(1)
  expect(finding.message).toMatch(/1 diagram, 1 chart, 2 media/)
})

test('unrepresentable content on several slides is summed into ONE warning', () => {
  const result = reconcilePresentation({
    html: '<h2>One</h2><h2>Two</h2><h2>Three</h2>',
    index: index([
      slide(1, { title: 'One', textRuns: ['One'], unrepresentable: { diagrams: 1, charts: 0, media: 0 } }),
      slide(2, { title: 'Two', textRuns: ['Two'] }),
      slide(3, { title: 'Three', textRuns: ['Three'], unrepresentable: { diagrams: 2, charts: 1, media: 0 } }),
    ]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-unrepresentable')
  expect(finding.message).toContain('Slides 1 and 3 contain 3 diagrams, 1 chart')
  expect(finding.sourcePage).toBeUndefined()
})

test('a title out of reading order warns and does not reorder the content', () => {
  const result = reconcilePresentation({
    html: '<p>Body first in XML</p><h2>Title last in XML</h2>',
    index: index([slide(1, {
      title: 'Title last in XML',
      textRuns: ['Body first in XML', 'Title last in XML'],
      titleOutOfOrder: true,
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<p>Body first in XML</p><h2 id="slide-1">Title last in XML</h2>')
  const finding = only(result, 'presentation-reading-order')
  expect(finding.severity).toBe('warning')
  expect(finding.sourcePage).toBe(1)
})

test('titles out of reading order on several slides produce ONE warning', () => {
  const result = reconcilePresentation({
    html: '<p>Body one</p><h2>One</h2><p>Body two</p><h2>Two</h2>',
    index: index([
      slide(1, { title: 'One', textRuns: ['Body one', 'One'], titleOutOfOrder: true }),
      slide(2, { title: 'Two', textRuns: ['Body two', 'Two'], titleOutOfOrder: true }),
    ]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-reading-order')
  expect(finding.message).toContain('On slides 1 and 2')
  expect(finding.sourcePage).toBeUndefined()
})

test('two headings on one slide do not repeat the slide id', () => {
  // A duplicate `id` is invalid HTML and breaks in-page navigation, so only the
  // first heading of a section is given the slide's id.
  const result = reconcilePresentation({
    html: '<h2>Title</h2><h2>Subheading</h2>',
    index: index([slide(1, { title: 'Title', textRuns: ['Title', 'Subheading'] })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toBe(
    '<section data-slide="1" data-plan-label="Slide 1: Title">' +
    '<h2 id="slide-1">Title</h2><h2>Subheading</h2></section>',
  )
})

test('a heading anydoc already gave an id keeps that id', () => {
  // An id the document chose beats one invented here, and rewriting it would
  // break any internal link that already points at it.
  const result = reconcilePresentation({
    html: '<h2 id="photosynthesis">Photosynthesis</h2>',
    index: index([slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis'] })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<h2 id="photosynthesis">Photosynthesis</h2>')
  expect(result.html).not.toContain('slide-1')
})

test("an agenda slide whose bullets name later slides does not eat those slides' headings", () => {
  // MEASURED with real anydoc 0.2.4 on a three-page .odp: a bulleted body is
  // ONE `<ul>` block while the index keeps one run per bullet. A rule that
  // matched a block against any single remaining run left the other bullets
  // spare, and the agenda's spare "Cell walls" run then swallowed slide 2's own
  // heading — silently, with no finding at all.
  const result = reconcilePresentation({
    html:
      '<h2 id="Agenda">Agenda</h2><ul><li><p>Cell walls</p></li><li><p>Photosynthesis</p></li></ul>' +
      '<h2 id="Cell-walls">Cell walls</h2><p>Rigid layer outside the membrane</p>' +
      '<h2 id="Photosynthesis">Photosynthesis</h2><p>Light reactions happen in the thylakoid</p>',
    index: index([
      slide(1, { title: 'Agenda', textRuns: ['Agenda', 'Cell walls', 'Photosynthesis'] }),
      slide(2, { title: 'Cell walls', textRuns: ['Cell walls', 'Rigid layer outside the membrane'] }),
      slide(3, { title: 'Photosynthesis', textRuns: ['Photosynthesis', 'Light reactions happen in the thylakoid'] }),
    ]),
    sourceLabel: 'ODP',
  })

  expect(result.html).toBe(
    '<section data-slide="1" data-plan-label="Slide 1: Agenda">' +
    '<h2 id="Agenda">Agenda</h2><ul><li><p>Cell walls</p></li><li><p>Photosynthesis</p></li></ul></section>' +
    '<section data-slide="2" data-plan-label="Slide 2: Cell walls">' +
    '<h2 id="Cell-walls">Cell walls</h2><p>Rigid layer outside the membrane</p></section>' +
    '<section data-slide="3" data-plan-label="Slide 3: Photosynthesis">' +
    '<h2 id="Photosynthesis">Photosynthesis</h2><p>Light reactions happen in the thylakoid</p></section>',
  )
  expect(result.findings).toEqual([])
})

test('a slide whose text anydoc never produced refuses instead of importing an empty section', () => {
  // Total content loss must not be indistinguishable from a clean import.
  const result = reconcilePresentation({
    html: '',
    index: index([
      slide(1, { title: 'One', textRuns: ['One', 'Body one'] }),
      slide(2, { title: 'Two', textRuns: ['Two', 'Body two'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-unattributed-content')
  expect(finding.severity).toBe('blocker')
  expect(finding.message).toContain('slides 1 and 2 are missing text the deck says they carry')
})

test('a partly-produced slide refuses rather than publishing what survived', () => {
  const result = reconcilePresentation({
    html: '<h2>One</h2>',
    index: index([slide(1, { title: 'One', textRuns: ['One', 'Body that never arrived'] })]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-unattributed-content')
  expect(finding.severity).toBe('blocker')
  expect(finding.message).toContain('slide 1 is missing text the deck says it carries')
})

test("an untitled slide gets its own h2 even when anydoc emitted an h1 of its own", () => {
  // MEASURED: an ODP `text:h` body heading becomes `<h1 id="...">`. Treating any
  // heading as the slide's title suppressed the generated `<h2 id="slide-1">`,
  // leaving the section with no anchor while the finding claimed it was titled.
  const result = reconcilePresentation({
    html: '<p>Body text</p><h1 id="A-heading-paragraph">A heading paragraph</h1>',
    index: index([slide(1, { textRuns: ['Body text', 'A heading paragraph'] })]),
    sourceLabel: 'ODP',
  })

  expect(result.html).toBe(
    '<section data-slide="1" data-plan-label="Slide 1">' +
    '<h2 id="slide-1">Slide 1</h2><p>Body text</p><h1 id="A-heading-paragraph">A heading paragraph</h1></section>',
  )
  expect(only(result, 'presentation-untitled-slide').message).toContain('"Slide 1"')
})

test('a quotation that CONTAINS the whole of the notes still survives', () => {
  // Pins the safety property from one side: mutating the notes comparison to
  // `block.text.includes(notesText)` deletes this quotation.
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>Mention the membrane. It matters.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'Mention the membrane. It matters.'],
      notesText: 'Mention the membrane.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<blockquote><p>Mention the membrane. It matters.</p></blockquote>')
  expect(codes(result)).not.toContain('presentation-unattributed-content')
})

test('a quotation CONTAINED IN the notes still survives', () => {
  // And from the other side: mutating the comparison to
  // `notesText.includes(block.text)` deletes this one.
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>mention the membrane</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'mention the membrane'],
      notesText: 'Remember to mention the membrane before class.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<blockquote><p>mention the membrane</p></blockquote>')
  expect(codes(result)).not.toContain('presentation-unattributed-content')
})

test('the refusal describes the mismatch without reproducing the content', () => {
  // When the orphaned block is a failed notes match it IS the private note, and
  // a finding may be logged, exported, or shared.
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>Do not repeat me anywhere.</p></blockquote>',
    index: index([slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis'] })]),
    sourceLabel: 'PPTX',
  })

  const finding = only(result, 'presentation-unattributed-content')
  expect(finding.message).not.toContain('Do not repeat me')
  expect(finding.message).toContain('1 block of content belongs to no slide')
})

test('content that cannot be attributed to a slide blocks the import', () => {
  const result = reconcilePresentation({
    // A paragraph the index knows nothing about: the two accounts disagree, and
    // guessing where it belongs is exactly the silent error this blocks on.
    html: '<h2>Photosynthesis</h2><p>Text no slide claims</p>',
    index: index([slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis'] })]),
    sourceLabel: 'PPTX',
  })

  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unattributed-content',
    severity: 'blocker',
  }))
})

test('a deck with no slides at all blocks rather than producing an empty page', () => {
  const result = reconcilePresentation({ html: '', index: index([]), sourceLabel: 'PPTX' })

  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unattributed-content',
    severity: 'blocker',
  }))
})

describe('formatSlideList', () => {
  // Tested directly because every aggregated finding's message is built from
  // it, and a joining bug would be invisible until a user read the warning.
  test('one number stands alone', () => {
    expect(formatSlideList([3])).toBe('3')
  })

  test('two numbers are joined with "and", no comma', () => {
    expect(formatSlideList([3, 7])).toBe('3 and 7')
  })

  test('three or more numbers use commas and a serial "and"', () => {
    expect(formatSlideList([3, 7, 12])).toBe('3, 7, and 12')
    expect(formatSlideList([1, 2, 3, 4])).toBe('1, 2, 3, and 4')
  })
})
