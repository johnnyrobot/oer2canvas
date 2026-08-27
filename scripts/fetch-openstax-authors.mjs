/**
 * One-shot: backfill `authors` into src/sources/openstax-catalog.json.
 *
 * The OpenStax CONTENT api (release.json -> /contents/...) returns no author
 * metadata at all. The CMS api does, and returns every book in one request, so
 * this runs offline at catalog-generation time and the app pays zero runtime
 * hops for D9. Re-run when the bundled catalog is regenerated.
 *
 *   node scripts/fetch-openstax-authors.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'

const CATALOG = new URL('../src/sources/openstax-catalog.json', import.meta.url)
const CMS = 'https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=authors,title&limit=500'

const res = await fetch(CMS)
if (!res.ok) throw new Error(`CMS api returned HTTP ${res.status}`)
const cms = await res.json()

const authorNames = (item) => (item.authors ?? []).map((a) => a.value.name)
const normalizeTitle = (title) => title.trim().toLowerCase()

/** slug -> author names, in the order the CMS lists them (senior authors first). */
const bySlug = new Map(cms.items.map((item) => [item.meta.slug, authorNames(item)]))

/**
 * Fallback for the rare book whose catalog slug and CMS slug disagree (e.g. a
 * translated edition, like the Polish "Psychologia" living at CMS slug
 * `psychologia-polska`). Keyed on normalized title, and ONLY populated for
 * titles that are unique across the CMS response — two different books
 * sharing a title must never join silently. Ambiguous titles are simply
 * absent from this map, so a lookup miss there falls through to `authors: []`
 * like any other unmatched book.
 */
const titleCounts = new Map()
for (const item of cms.items) {
  const key = normalizeTitle(item.title)
  titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
}
const byTitle = new Map(
  cms.items
    .filter((item) => titleCounts.get(normalizeTitle(item.title)) === 1)
    .map((item) => [normalizeTitle(item.title), { cmsSlug: item.meta.slug, authors: authorNames(item) }]),
)

const catalog = JSON.parse(await readFile(CATALOG, 'utf8'))
let matched = 0
const fallbackMatches = []
for (const book of catalog.books) {
  let authors = bySlug.get(book.slug)
  if (!authors) {
    const hit = byTitle.get(normalizeTitle(book.title))
    if (hit) {
      authors = hit.authors
      fallbackMatches.push(`${book.slug} -> ${hit.cmsSlug}`)
    }
  }
  // Absent rather than empty is a lie by omission: D9 permits degradation but
  // not SILENT degradation, so an unmatched book gets an explicit empty list.
  book.authors = authors ?? []
  if (authors?.length) matched += 1
}

await writeFile(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`)
const fallbackNote = fallbackMatches.length
  ? ` (${fallbackMatches.length} via title fallback: ${fallbackMatches.join(', ')})`
  : ''
console.log(
  `matched ${matched}/${catalog.books.length} books from ${cms.items.length} CMS entries${fallbackNote}`,
)
