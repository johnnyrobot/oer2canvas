import { isPresentationPackageKind, wantedPresentationPart } from './parts'

test('a pptx index wants the presentation, its slides, their rels, and their notes', () => {
  const wanted = (path: string) => wantedPresentationPart('pptx', path)

  expect(wanted('ppt/presentation.xml')).toBe(true)
  expect(wanted('ppt/_rels/presentation.xml.rels')).toBe(true)
  expect(wanted('ppt/slides/slide12.xml')).toBe(true)
  expect(wanted('ppt/slides/_rels/slide12.xml.rels')).toBe(true)
  expect(wanted('ppt/notesSlides/notesSlide12.xml')).toBe(true)
})

test('a pptx index wants no media, theme, master, or macro part', () => {
  const wanted = (path: string) => wantedPresentationPart('pptx', path)

  // Media is what makes a deck large; inflating it to count slides would be
  // the whole cost of the parse for none of the benefit.
  expect(wanted('ppt/media/image1.png')).toBe(false)
  expect(wanted('ppt/theme/theme1.xml')).toBe(false)
  expect(wanted('ppt/slideMasters/slideMaster1.xml')).toBe(false)
  // A macro-enabled deck (.pptm/.ppsm) carries this. We never read it and
  // never execute it; this pins that it is not even inflated.
  expect(wanted('ppt/vbaProject.bin')).toBe(false)
  // A slide LAYOUT is the part a reader would need to resolve a placeholder
  // whose type is inherited rather than written on the slide. Design fact 9
  // measured 226 real slides and found no title that needed it, so a deck's
  // layouts are left in the archive rather than inflated per slide. Adding
  // them is the one change the layout-chain branch would have required.
  expect(wanted('ppt/slideLayouts/slideLayout1.xml')).toBe(false)
  expect(wanted('ppt/slideLayouts/_rels/slideLayout1.xml.rels')).toBe(false)
})

test('an odp index wants only content.xml', () => {
  expect(wantedPresentationPart('odp', 'content.xml')).toBe(true)
  expect(wantedPresentationPart('odp', 'styles.xml')).toBe(false)
  expect(wantedPresentationPart('odp', 'Pictures/image1.png')).toBe(false)
})

test('exactly the two deck formats are presentation packages', () => {
  /*
   * Two modules key off this and they have to agree exactly: the anydoc Worker
   * collects a deck's package parts for these formats, and
   * `parsers/anydoc-html.ts` tags its pictures with the `data-origin-part`
   * join key for these formats. A format in one set and not the other either
   * refuses every deck carrying a picture (an index with no keys to join) or
   * leaks a package path into an exported page (keys with no index to read
   * them).
   *
   * `ppt` is the legacy BINARY format and is deliberately false: it is not a
   * ZIP package, so there is no index to read and nothing to join against.
   */
  expect(isPresentationPackageKind('pptx')).toBe(true)
  expect(isPresentationPackageKind('odp')).toBe(true)
  for (const format of ['ppt', 'docx', 'odt', 'rtf', 'epub', 'pdf', 'xlsx', 'ods', 'csv', 'doc', 'document']) {
    expect(isPresentationPackageKind(format)).toBe(false)
  }
})
