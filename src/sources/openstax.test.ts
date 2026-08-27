import { createOpenStaxClient } from './openstax'
import release from './fixtures/openstax/release.json'
import bookToc from './fixtures/openstax/book-toc.json'
import page from './fixtures/openstax/page.json'
import pageSection from './fixtures/openstax/page-section.json'

const UUID = '13ac107a-f15f-49d2-97e8-60ab2e3b519c'

// Derived from the fixture (not hardcoded) so these stay correct across a future
// re-capture against a new archive release. noUncheckedIndexedAccess means the lookup
// is possibly undefined; fail loudly rather than casting it away.
const releaseBook = release.books[UUID]
if (!releaseBook) throw new Error(`fixture release.json has no entry for ${UUID}`)
const EXPECTED_VERSION = releaseBook.defaultVersion

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fn = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return Object.assign(fn, { calls })
}

test('resolves the release manifest', async () => {
  const fetch = fakeFetch({ '/rex/release.json': release })
  const client = createOpenStaxClient({ fetch: fetch as typeof globalThis.fetch })
  const r = await client.resolveRelease()
  expect(r.archiveUrl).toMatch(/^\/apps\/archive\//)
  expect(r.versions[UUID]).toBeTruthy()
})

test('caches the release manifest across calls', async () => {
  const fetch = fakeFetch({ '/rex/release.json': release })
  const client = createOpenStaxClient({ fetch: fetch as typeof globalThis.fetch })
  await client.resolveRelease()
  await client.resolveRelease()
  expect(fetch.calls.filter((u) => u.includes('release.json'))).toHaveLength(1)
})

test('fetches a book toc at the default version', async () => {
  const fetch = fakeFetch({ '/rex/release.json': release, '/contents/': bookToc })
  const client = createOpenStaxClient({ fetch: fetch as typeof globalThis.fetch })
  const toc = await client.fetchToc(UUID)
  expect(toc.title).toBeTruthy()
  expect(toc.tree).toBeTruthy()
  // Pin the full composed URL, not just a substring — a swapped uuid/version or a
  // dropped archiveUrl prefix would still be handed the toc fixture by fakeFetch's
  // substring routing, so only an exact match on the whole string catches it.
  const tocCall = fetch.calls.find((u) => u.includes('/contents/'))!
  expect(tocCall).toBe(
    `https://openstax.org${release.archiveUrl}/contents/${UUID}@${EXPECTED_VERSION}.json`,
  )
})

test('fetches a page', async () => {
  const fetch = fakeFetch({ '/rex/release.json': release, ':': page })
  const client = createOpenStaxClient({ fetch: fetch as typeof globalThis.fetch })
  const p = await client.fetchPage(UUID, 'some-page-uuid')
  expect(typeof p.content).toBe('string')
  expect(p.content.length).toBeGreaterThan(0)
  // Pin the full composed URL. The ':' route key above matches any https:// URL by
  // substring, so without this the fixture would be handed back regardless of what
  // URL the client actually built — a swapped bookUuid/pageId or a missing @version
  // segment would still pass. Only an exact match on the whole string catches it.
  const pageCall = fetch.calls.find((u) => u.includes('/contents/'))!
  expect(pageCall).toBe(
    `https://openstax.org${release.archiveUrl}/contents/${UUID}@${EXPECTED_VERSION}:some-page-uuid.json`,
  )
})

test('throws a clear error for an unknown book', async () => {
  const fetch = fakeFetch({ '/rex/release.json': release })
  const client = createOpenStaxClient({ fetch: fetch as typeof globalThis.fetch })
  await expect(client.fetchToc('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/unknown OpenStax book/)
})

test('throws on a non-2xx upstream', async () => {
  const fetch = (async () => new Response('boom', { status: 500 })) as typeof globalThis.fetch
  const client = createOpenStaxClient({ fetch })
  await expect(client.resolveRelease()).rejects.toThrow(/HTTP 500/)
})

it('names the URL and status when a 2xx body is not JSON', async () => {
  const client = createOpenStaxClient({
    fetch: async () =>
      new Response('<!doctype html><h1>maintenance</h1>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    baseUrl: 'https://openstax.example',
  })
  await expect(client.resolveRelease()).rejects.toThrow(
    /https:\/\/openstax\.example\/rex\/release\.json.*200/s,
  )
})

// Fixture-integrity test, not a client behavior test. `page.json` (captured via the
// brief's Step 1 script) lands on the Preface because the capture walks contents[0]
// recursively to the first leaf, and front matter has no figures, math, or images.
// `page-section.json` is 1.4 Polynomials, captured deliberately so a real content
// section exists in the fixture set. Task 14's milestone audit depends on this fixture
// carrying real transform-relevant markup (figure/math/img) — if a future re-capture
// silently grabs front matter again, this test catches it instead of the milestone
// quietly measuring nothing.
test('page-section fixture is a real content section, not front matter', () => {
  expect(typeof pageSection.content).toBe('string')
  expect(pageSection.content.length).toBeGreaterThan(0)
  expect(pageSection.content).toContain('<figure')
  expect(pageSection.content).toContain('<math')
  expect(pageSection.content).toContain('<img')
})

describe('the relay hop for the release manifest', () => {
  // `/rex/release.json` sends no Access-Control-Allow-Origin header, so a browser
  // cannot fetch it — and it is the FIRST of the client's three hops, so its
  // failure blocks the other two even though both of those do send the header.
  // Measured 2026-08-21 and re-confirmed 2026-08-22.
  const seen: string[] = []
  const spyFetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    seen.push(url)
    if (url.includes('release.json')) {
      return new Response(JSON.stringify({ archiveUrl: '/apps/archive/x', books: { b: { defaultVersion: 'v1' } } }))
    }
    return new Response(JSON.stringify({ title: 't', tree: { id: 'b@v1', title: 't' } }))
  }) as typeof globalThis.fetch

  beforeEach(() => {
    seen.length = 0
  })

  // Fails if the release url stops being wrapped: `seen[0]` would be the bare
  // openstax.org url with no `/relay?url=` prefix.
  it('fetches the release manifest through the relay when one is configured', async () => {
    const client = createOpenStaxClient({ fetch: spyFetch, baseUrl: 'https://openstax.example', relayUrl: '/relay' })
    await client.resolveRelease()
    expect(seen[0]).toBe(
      '/relay?url=' + encodeURIComponent('https://openstax.example/rex/release.json'),
    )
  })

  // Fails if someone routes ALL OpenStax traffic through the relay: the archive
  // endpoints do send the header, and relaying them would spend a request and add
  // a hop for nothing.
  it('fetches archive content DIRECTLY, because those endpoints do send the header', async () => {
    const client = createOpenStaxClient({ fetch: spyFetch, baseUrl: 'https://openstax.example', relayUrl: '/relay' })
    await client.fetchToc('b')
    expect(seen[1]).toBe('https://openstax.example/apps/archive/x/contents/b@v1.json')
    expect(seen[1]).not.toContain('/relay')
  })

  // Fails if the relay stops being optional — every existing test injects a fetch
  // and expects bare urls, and the browser-mode receiver test pins the same shape.
  it('goes direct when no relay is configured', async () => {
    const client = createOpenStaxClient({ fetch: spyFetch, baseUrl: 'https://openstax.example' })
    await client.resolveRelease()
    expect(seen[0]).toBe('https://openstax.example/rex/release.json')
  })
})
