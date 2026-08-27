import { openStaxCatalog, searchCatalog } from './openstax-catalog'

test('the catalog is non-empty and well-formed', () => {
  const books = openStaxCatalog()
  expect(books.length).toBeGreaterThan(20)
  for (const b of books) {
    expect(b.source).toBe('openstax')
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(b.slug).toBeTruthy()
    expect(b.title).toBeTruthy()
  }
})

test('search matches title case-insensitively', () => {
  const hits = searchCatalog(openStaxCatalog(), 'algebra')
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.every((b) => /algebra/i.test(b.title) || /algebra/i.test(b.subject ?? ''))).toBe(true)
})

test('an empty query returns everything', () => {
  const all = openStaxCatalog()
  expect(searchCatalog(all, '   ')).toHaveLength(all.length)
})

it('carries license through, because D9 attribution reads it', () => {
  const books = openStaxCatalog()
  const withLicense = books.filter((b) => b.license)
  expect(withLicense.length).toBe(books.length)
  expect(books[0]!.license).toBe('Creative Commons Attribution License')
})

it('carries authors, because D9 requires them and the content API has none', () => {
  const books = openStaxCatalog()
  expect(books.every((b) => Array.isArray(b.authors))).toBe(true)
  const algebra = books.find((b) => b.slug === 'algebra-and-trigonometry')
  expect(algebra?.authors).toContain('Jay Abramson')
})

it('leaves authors an empty array rather than undefined when the CMS had none', () => {
  const books = openStaxCatalog()
  for (const b of books) expect(b.authors).toBeDefined()
})

it('resolves the Polish edition via title fallback, because its CMS slug differs from ours', () => {
  const books = openStaxCatalog()
  const psychologia = books.find((b) => b.slug === 'psychologia')
  expect(psychologia?.authors).toContain('Joanna Czarnota-Bojarska')
})
