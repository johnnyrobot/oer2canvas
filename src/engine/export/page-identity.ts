import type { CompiledChapter, CompiledSection } from '../../contracts/index'

/**
 * WHERE A SECTION LANDS, decided once for both destinations.
 *
 * This used to live inside `cartridge.ts` as a private helper, which was correct
 * while the cartridge was the only way out. It is not any more: E7 pushes the
 * same sections over REST, and Canvas derives a page's url from the cartridge
 * FILENAME on import. For example,
 * `wiki_content/chapter-1-1-4-polynomials.html` arrived as the page
 * `chapter-1-1-4-polynomials` rather than as a slug of its title "1.4
 * Polynomials".
 *
 * So the two paths agree on identity or the product's central promise breaks:
 * an instructor who imports a cartridge and later pushes the same chapters would
 * otherwise get two parallel sets of pages, and "running it again updates the
 * same pages" would be false for exactly the person who used both routes.
 * `page-identity.test.ts` holds them together by comparing one against the other
 * rather than against a restatement of the rule.
 */

/** A section that failed to compile emits nothing, so it can never become a page. */
export function publishable(s: CompiledSection): boolean {
  return !s.error && s.html.length > 0
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
}

export interface PageTarget {
  section: CompiledSection
  chapterTitle: string
  /** The page url in Canvas, and the cartridge filename without its extension. */
  slug: string
}

/**
 * One list per chapter, in book order, keeping chapter identity — the cartridge
 * needs the grouping for its modules, and the plan needs it so pages are shown
 * under the chapter they came from rather than flattened away.
 */
export function pageTargetsByChapter(chapters: readonly CompiledChapter[]): PageTarget[][] {
  const used = new Set<string>()
  return chapters.map((c) =>
    c.sections.filter(publishable).map((section) => {
      // "Introduction" appears in every chapter, so the title alone collides.
      // Disambiguated against what has already been emitted rather than by
      // index, so a slug stays stable when an unrelated chapter is removed.
      let name = `${slug(c.chapter.title)}-${slug(section.title)}`
      let n = 2
      while (used.has(name)) name = `${slug(c.chapter.title)}-${slug(section.title)}-${n++}`
      used.add(name)
      return { section, chapterTitle: c.chapter.title, slug: name }
    }),
  )
}

/** The same targets, flat, for callers that push one page at a time. */
export function pageTargets(chapters: readonly CompiledChapter[]): PageTarget[] {
  return pageTargetsByChapter(chapters).flat()
}
