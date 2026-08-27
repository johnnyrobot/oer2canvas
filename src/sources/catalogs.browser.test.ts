test('serves all three release catalogs through the application origin', async () => {
  const [libreResponse, pressResponse] = await Promise.all([
    fetch('/catalogs/libretexts.json'),
    fetch('/catalogs/pressbooks/milnepublishing.geneseo.edu.json'),
  ])
  expect(libreResponse.ok).toBe(true)
  expect(pressResponse.ok).toBe(true)
  const libre = await libreResponse.json() as { books: { source: string }[] }
  const press = await pressResponse.json() as { books: { source: string }[] }
  expect(libre.books).toHaveLength(1000)
  expect(libre.books.every((book) => book.source === 'libretexts')).toBe(true)
  expect(press.books.length).toBeGreaterThan(80)
  expect(press.books.every((book) => book.source === 'pressbooks')).toBe(true)
})
