import { fetchImageBytes } from './fetch-image'
import type { ImageHit } from './search'

const hit: ImageHit = { provider: 'commons', id: 'x', title: 't', thumbUrl: 'th', fullUrl: 'https://upload.wikimedia.org/x.png', width: 1, height: 1, license: { kind: 'cc0', name: 'CC0' }, sourcePageUrl: 's' }

test('returns the bytes of the full image', async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  expect([...(await fetchImageBytes(hit, fetch))]).toEqual([1, 2, 3])
  expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(hit.fullUrl)
})

test('an opaque or failed fetch rejects with a message that names the host and the way out', async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  await expect(fetchImageBytes(hit, fetch)).rejects.toThrow(/upload\.wikimedia\.org[^.]*does not let this browser fetch it[\s\S]*Document import/)
})

test('a non-OK answer names the host and the status', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 404 }))
  await expect(fetchImageBytes(hit, fetch)).rejects.toThrow(/upload\.wikimedia\.org answered HTTP 404/)
})
