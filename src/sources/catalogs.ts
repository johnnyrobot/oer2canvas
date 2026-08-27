import rawNetworks from './pressbooks-networks.json'
import type { BookRef, SourceId } from './types'

export interface PressbooksNetwork {
  host: string
  name: string
  bookCount: number
  isDefault?: boolean
}

export const pressbooksNetworks = (rawNetworks as { networks: PressbooksNetwork[] }).networks

function isBookRef(value: unknown, source: SourceId): value is BookRef {
  if (!value || typeof value !== 'object') return false
  const book = value as Partial<BookRef>
  return book.source === source
    && typeof book.id === 'string'
    && typeof book.slug === 'string'
    && /^https:\/\//.test(book.slug)
    && typeof book.title === 'string'
    && book.title.trim().length > 0
    && Array.isArray(book.authors)
}

async function loadCatalog(
  url: string,
  source: 'libretexts' | 'pressbooks',
  fetcher: typeof globalThis.fetch,
): Promise<BookRef[]> {
  const response = await fetcher(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${source === 'libretexts' ? 'LibreTexts' : 'Pressbooks'} catalog returned HTTP ${response.status}`)
  const payload = await response.json() as unknown
  if (!payload || typeof payload !== 'object' || !('books' in payload) || !Array.isArray(payload.books)) {
    throw new Error('Catalog response did not contain a books array')
  }
  const books = payload.books.filter((book): book is BookRef => isBookRef(book, source))
  if (books.length === 0) throw new Error('Catalog did not contain any usable books')
  return books
}

export function loadLibreTextsCatalog(fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<BookRef[]> {
  return loadCatalog('/catalogs/libretexts.json', 'libretexts', fetcher)
}

export function loadPressbooksCatalog(
  host: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<BookRef[]> {
  if (!pressbooksNetworks.some((network) => network.host === host)) {
    return Promise.reject(new Error('Pressbooks network is not offered'))
  }
  return loadCatalog(`/catalogs/pressbooks/${encodeURIComponent(host)}.json`, 'pressbooks', fetcher)
}

export function searchSourceCatalog(books: readonly BookRef[], query: string): BookRef[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...books]
  return books.filter((book) =>
    [book.title, book.subject ?? '', book.license ?? '', ...book.authors]
      .some((value) => value.toLocaleLowerCase().includes(needle)),
  )
}
