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
