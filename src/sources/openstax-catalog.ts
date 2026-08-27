import raw from './openstax-catalog.json'
import type { BookRef } from './types'

interface RawBook {
  uuid: string
  slug: string
  title: string
  subject?: string
  edition?: string
  coverUrl?: string
  license?: string
  language?: string
  authors: string[]
}

/** Bundled rather than fetched: small, rarely changes, and free as a static asset. */
export function openStaxCatalog(): BookRef[] {
  return (raw as { books: RawBook[] }).books.map((b) => ({
    source: 'openstax' as const,
    id: b.uuid,
    slug: b.slug,
    title: b.title,
    subject: b.subject,
    coverUrl: b.coverUrl,
    license: b.license,
    authors: b.authors ?? [],
  }))
}

export function searchCatalog(books: BookRef[], q: string): BookRef[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return books
  return books.filter(
    (b) =>
      b.title.toLowerCase().includes(needle) ||
      (b.subject ?? '').toLowerCase().includes(needle),
  )
}
