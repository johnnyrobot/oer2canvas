import {
  loadLibreTextsCatalog,
  loadPressbooksCatalog,
  pressbooksNetworks,
  searchSourceCatalog,
} from './catalogs'

const libre = {
  source: 'libretexts', id: 'chem-1', slug: 'https://chem.libretexts.org/Bookshelves/One',
  title: 'Organic Chemistry', authors: ['Ada Author'], subject: 'Chemistry',
}
const press = {
  source: 'pressbooks', id: 'https://milnepublishing.geneseo.edu/logic/',
  slug: 'https://milnepublishing.geneseo.edu/logic/', title: 'Concise Logic',
  authors: ['Craig DeLancey'], license: 'CC BY-NC-SA',
}

test('loads the static LibreTexts snapshot and rejects malformed records', async () => {
  const fetcher = vi.fn(async () => Response.json({ books: [libre, { source: 'libretexts', title: 'broken' }] }))
  await expect(loadLibreTextsCatalog(fetcher)).resolves.toEqual([libre])
  expect(fetcher).toHaveBeenCalledWith('/catalogs/libretexts.json', expect.anything())
})

test('loads only an offered Pressbooks network snapshot', async () => {
  const network = pressbooksNetworks[0]!
  const fetcher = vi.fn(async () => Response.json({ books: [press] }))
  await expect(loadPressbooksCatalog(network.host, fetcher)).resolves.toEqual([press])
  expect((fetcher.mock.calls as unknown[][])[0]?.[0]).toBe(`/catalogs/pressbooks/${encodeURIComponent(network.host)}.json`)
  await expect(loadPressbooksCatalog('attacker.example', fetcher)).rejects.toThrow('not offered')
})

test('catalog search covers title, author, subject, and license locally', () => {
  const books = [libre, press] as never[]
  expect(searchSourceCatalog(books, 'chemistry')).toHaveLength(1)
  expect(searchSourceCatalog(books, 'delancey')).toHaveLength(1)
  expect(searchSourceCatalog(books, 'by-nc')).toHaveLength(1)
  expect(searchSourceCatalog(books, '')).toHaveLength(2)
})

test('catalog loader reports HTTP and empty-snapshot failures clearly', async () => {
  await expect(loadLibreTextsCatalog(async () => new Response('', { status: 503 }))).rejects.toThrow('HTTP 503')
  await expect(loadLibreTextsCatalog(async () => Response.json(null))).rejects.toThrow('books array')
  await expect(loadLibreTextsCatalog(async () => Response.json({ books: [] }))).rejects.toThrow('usable books')
})
