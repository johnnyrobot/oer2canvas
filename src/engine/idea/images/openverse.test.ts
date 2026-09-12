import { createOpenverseSearch } from './openverse'

const result = (over: Record<string, unknown>) => ({
  id: 'abc', title: 'A bench', url: 'https://live.staticflickr.com/x.jpg', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', width: 800, height: 600,
  license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', creator: 'Sam', foreign_landing_url: 'https://flickr.com/p/1', ...over,
})
const envelope = (results: unknown[]) => new Response(JSON.stringify({ result_count: results.length, results }), { status: 200 })

test('maps results, keeps only allowed licences, and requests the licence filter', async () => {
  const fetch = vi.fn(async () => envelope([result({}), result({ id: 'nc', license: 'by-nc' }), result({ id: 'pdm', license: 'pdm', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/' }), result({ id: 'z', license: 'cc0', license_version: '1.0' })]))
  const hits = await createOpenverseSearch({ fetch }).search('bench', { licenses: ['cc0', 'by', 'by-sa', 'pd'] })
  expect(hits.map((h) => [h.id, h.license.kind, h.license.name])).toEqual([['abc', 'by', 'CC BY 2.0'], ['pdm', 'pd', 'Public Domain Mark 1.0'], ['z', 'cc0', 'CC0 1.0']])
  expect(hits[0]).toMatchObject({ provider: 'openverse', title: 'A bench', creator: 'Sam', sourcePageUrl: 'https://flickr.com/p/1', fullUrl: 'https://live.staticflickr.com/x.jpg' })
  const url = (fetch.mock.calls[0] as unknown as [string])[0]
  expect(url).toContain('api.openverse.org/v1/images/')
  expect(url).toContain('license=cc0%2Cby%2Cby-sa%2Cpdm')
})

test('a result without license_url or with an unknown licence is dropped', async () => {
  const fetch = vi.fn(async () => envelope([result({ license_url: undefined }), result({ id: 'q', license: 'sampling+' })]))
  expect(await createOpenverseSearch({ fetch }).search('x', { licenses: ['by'] })).toEqual([])
})

test('429 rejects with a rate-limit message', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 429 }))
  await expect(createOpenverseSearch({ fetch }).search('x', { licenses: ['by'] })).rejects.toThrow(/rate-limiting|Wait a moment/)
})

test('is not offered: the probe measured three timeouts from page script', () => {
  const port = createOpenverseSearch({ fetch: vi.fn() })
  expect(port.offered).toBe(false)
  expect(port.evidence).toBe('docs/evidence/idea-image-api-2026-09-12.md')
})
