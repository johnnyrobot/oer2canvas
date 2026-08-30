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
  /**
   * The page title as Canvas will show it, which is NOT always the section's own
   * title: a section whose title does not say which chapter it belongs to is
   * qualified with it. See `qualifiedTitle`.
   */
  title: string
}

/**
 * "Chapter 1" out of "Chapter 1 Prerequisites", "Ch 1" or "1 | Functions and
 * Graphs" — or the chapter title unchanged when it carries no number at all.
 *
 * The number is normalized to one spelling rather than echoed as the book wrote
 * it, so a course does not end up with "Ch 1 Key Terms" beside "Chapter 2 Key
 * Terms" because two chapters were labelled inconsistently upstream.
 *
 * Falling back to the whole title rather than to nothing is deliberate: a book
 * whose chapters are not numbered still needs its generic sections told apart,
 * and a long prefix is a smaller problem than a silent collision.
 */
function chapterLabel(chapterTitle: string): { label: string, number?: string } {
  const match = /^\s*(?:ch(?:apter)?\.?\s+)?(\d+)\b/i.exec(chapterTitle)
  return match ? { label: `Chapter ${match[1]}`, number: match[1] } : { label: chapterTitle.trim() }
}

/**
 * The title a page is created with.
 *
 * "Introduction", "Key Terms" and "Summary" repeat verbatim across every chapter
 * of an OpenStax book. Canvas derives a page's url from its TITLE, so two
 * chapters' generic sections land on one page unless the title distinguishes
 * them — measured against a live instance in `resolve.test.ts`.
 *
 * A section that already opens with its chapter's number ("1.4 Polynomials") is
 * left exactly as its author wrote it. The lookahead is what stops chapter 1
 * claiming "11.2 Sequences": `11` starts with `1`, but the character after is a
 * digit, so it is a different chapter's numbering rather than this one's.
 */
export function qualifiedTitle(chapterTitle: string, sectionTitle: string): string {
  const { label, number } = chapterLabel(chapterTitle)
  if (number && new RegExp(`^\\s*${number}(?![0-9])`).test(sectionTitle)) return sectionTitle
  return `${label} ${sectionTitle}`.trim()
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
      return {
        section,
        chapterTitle: c.chapter.title,
        slug: name,
        title: qualifiedTitle(c.chapter.title, section.title),
      }
    }),
  )
}

/** The same targets, flat, for callers that push one page at a time. */
export function pageTargets(chapters: readonly CompiledChapter[]): PageTarget[] {
  return pageTargetsByChapter(chapters).flat()
}
