import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import { buildCartridge } from './cartridge'
import { pageTargets } from './page-identity'

const section = (id: string, title: string, over: Partial<CompiledSection> = {}): CompiledSection => ({
  id, title, html: `<p>body of ${id}</p>`, notes: [], queue: [], ...over,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

const CHAPTERS = [
  chapter('Chapter 1', [section('a', 'Introduction'), section('b', '1.4 Polynomials')]),
  // "Introduction" again, deliberately: the disambiguation is the interesting case.
  chapter('Chapter 1', [section('c', 'Introduction')]),
]

/**
 * The property that makes the two destinations one product rather than two.
 *
 * Canvas derives a page's url from the cartridge FILENAME on import:
 * `wiki_content/chapter-1-1-4-polynomials.html` arrives as the page
 * `chapter-1-1-4-polynomials`, not as a slug of its title. So if the push
 * invented its own slug, an instructor who imported a cartridge and later pushed
 * the same chapters would get two parallel sets of pages, and every promise this
 * product makes about updating in place would be false for exactly the person
 * who used both paths.
 */
test('a push addresses exactly the pages a cartridge import would create', () => {
  const fromCartridge = buildCartridge(CHAPTERS)
    .filter((e) => e.name.startsWith('wiki_content/'))
    .map((e) => e.name.replace(/^wiki_content\//, '').replace(/\.html$/, ''))
  expect(pageTargets(CHAPTERS).map((p) => p.slug)).toEqual(fromCartridge)
})

/*
  A section title that does not say which chapter it belongs to gets told.
  "Introduction", "Key Terms" and "Summary" repeat verbatim in every chapter of
  an OpenStax book, and Canvas derives a page url from the title — so without
  this, two chapters' generic sections collide in the course.
*/
test('a section whose title does not name its chapter is qualified with it', () => {
  const [first] = pageTargets([chapter('Chapter 1 Prerequisites', [section('a', 'Introduction')])])
  expect(first!.title).toBe('Chapter 1 Introduction')
})

test('a section that already names its chapter is left alone', () => {
  const [numbered] = pageTargets([chapter('Chapter 1 Prerequisites', [section('b', '1.4 Polynomials')])])
  expect(numbered!.title).toBe('1.4 Polynomials')
})

/*
  The slug is deliberately NOT changed by any of this. Cartridge filenames — and
  therefore the Canvas urls of every page already imported from one — must stay
  exactly where they are, or the product's "running it again updates the same
  pages" promise breaks for everyone who used that route.
*/
test('qualifying a title leaves the slug where it was', () => {
  expect(pageTargets(CHAPTERS).map((p) => p.slug))
    .toEqual(['chapter-1-introduction', 'chapter-1-1-4-polynomials', 'chapter-1-introduction-2'])
})
