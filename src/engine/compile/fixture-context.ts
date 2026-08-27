import page from '../../sources/fixtures/openstax/page.json'
import pageSection from '../../sources/fixtures/openstax/page-section.json'
import bookToc from '../../sources/fixtures/openstax/book-toc.json'
import release from '../../sources/fixtures/openstax/release.json'
import { buildXrefMap, canonicalSectionUrl } from '../../sources/openstax'
import { openStaxCatalog } from '../../sources/openstax-catalog'
import { OPENSTAX } from './context'
import type { CompileContext } from './context'
import type { Chapter, Section } from '../../sources/types'

const BOOK_UUID = '13ac107a-f15f-49d2-97e8-60ab2e3b519c'
const BOOK_SLUG = 'algebra-and-trigonometry'

/**
 * `fetchChapter` (`src/sources/openstax.ts`) takes `book.authors` from the
 * bundled catalog and passes the whole array through unjoined; the
 * attribution step joins it. Looking the book up here the same way — rather
 * than hardcoding a name — is what makes `title` really the only override
 * below, and keeps this byline from silently drifting from the one D9 requires.
 */
const BOOK_AUTHORS = openStaxCatalog().find((b) => b.slug === BOOK_SLUG)?.authors ?? []

/**
 * Both page fixtures carry their own `id` and `slug` — verified 2026-08-21:
 * `page.json` is `aa5bbb11-...` / `preface`, `page-section.json` is
 * `f7978ad8-...` / `1-4-polynomials`, and neither id carries an `@version`
 * suffix. Read them rather than restating them, so a refreshed fixture cannot
 * silently disagree with this file.
 *
 * `title` is the ONE thing overridden. The content api returns "Polynomials";
 * `fetchChapter` prefers the TOC's normalized title, which is "1.4 Polynomials",
 * and the goldens must record what production emits.
 */
const TITLES: Record<string, string> = {
  preface: 'Preface',
  '1-4-polynomials': '1.4 Polynomials',
}

const FIXTURES = { page, 'page-section': pageSection } as const

export type FixtureName = keyof typeof FIXTURES

export function fixtureContext(name: FixtureName): { section: Section; ctx: CompileContext } {
  const f = FIXTURES[name] as { id: string; slug: string; content: string }
  const version = (release as { books: Record<string, { defaultVersion: string }> }).books[BOOK_UUID]!.defaultVersion
  const archive = (release as { archiveUrl: string }).archiveUrl
  const contentBaseUrl = `https://openstax.org${archive}/contents/${BOOK_UUID}@${version}:${f.id}.json`
  const canonicalUrl = canonicalSectionUrl(BOOK_SLUG, f.slug)
  const title = TITLES[f.slug] ?? f.slug

  return {
    section: { id: f.id, title, order: 0, html: f.content, contentBaseUrl, canonicalUrl },
    ctx: {
      profile: OPENSTAX,
      contentBaseUrl,
      canonicalUrl,
      sectionTitle: title,
      sectionId: f.id,
      xrefs: buildXrefMap((bookToc as { tree: Parameters<typeof buildXrefMap>[0] }).tree, BOOK_SLUG),
      attribution: {
        bookTitle: 'Algebra and Trigonometry',
        publisher: 'OpenStax',
        url: `https://openstax.org/books/${BOOK_SLUG}`,
        authors: BOOK_AUTHORS,
        license: {
          name: 'Creative Commons Attribution License',
          url: 'http://creativecommons.org/licenses/by/4.0/',
        },
      },
    },
  }
}

/**
 * Both page fixtures as one `Chapter`, in book order.
 *
 * Built from `fixtureContext` rather than beside it, so a chapter-level compile
 * and a section-level one cannot disagree about xrefs or attribution — which is
 * the whole point of the byte-identity assertion in `context.test.ts`.
 */
export function chapterFixture(): Chapter {
  const names: readonly FixtureName[] = ['page', 'page-section']
  const built = names.map((n, order) => {
    const { section, ctx } = fixtureContext(n)
    return { section: { ...section, order }, ctx }
  })
  return {
    source: 'openstax',
    bookId: BOOK_UUID,
    title: 'Chapter 1',
    sections: built.map((b) => b.section),
    attribution: built[0]!.ctx.attribution,
    xrefs: built[0]!.ctx.xrefs,
  }
}
