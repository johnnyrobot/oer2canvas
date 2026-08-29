import {
  FIRECRAWL_ENDPOINT,
  FIRECRAWL_REQUEST_TIMEOUT_MS,
  createFirecrawlFetcher,
} from './firecrawl'
import { messageOf } from '../errors'

const SENTINEL = 'fc-SENTINEL-do-not-leak-0123456789'

/** The shape measured on a successful `/v2/scrape` call, 2026-08-29. */
const okEnvelope = {
  success: true,
  data: {
    markdown: '# Title\n\nBody.',
    metadata: {
      sourceURL: 'https://example.com/a',
      url: 'https://example.com/a',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
    },
  },
}

function respond(body: unknown, status = 200): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

test('the request names one endpoint, asks for markdown only, and refuses pdf transcoding', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async (url, init) => {
      seen = { url: String(url), init: init! }
      return new Response(JSON.stringify(okEnvelope), { status: 200 })
    },
  })
  await fetcher(new URL('https://example.com/a'), new AbortController().signal)

  expect(seen!.url).toBe('https://api.firecrawl.dev/v2/scrape')
  const body = JSON.parse(String(seen!.init.body))
  expect(body.formats).toEqual(['markdown'])
  // Measured 2026-08-29: the DEFAULT is `[{"type":"pdf"}]`, and with it a PDF
  // URL is silently text-extracted server-side. `[]` makes a PDF arrive as a
  // PDF so `importWebArticle` can refuse it.
  expect(body.parsers).toEqual([])
  expect(body.timeout).toBe(FIRECRAWL_REQUEST_TIMEOUT_MS)
  // The link set is never requested, so link-following code cannot be written
  // by accident: it would have nothing to follow.
  expect(JSON.stringify(body)).not.toContain('links')
  // The wildcard `access-control-allow-origin: *` measured on every status
  // makes this mandatory — a browser rejects a wildcard response for a
  // credentialed request — and no cookie of this app's belongs on a vendor call.
  expect(seen!.init.credentials).toBe('omit')
})

test('the key travels in the Authorization header and in nothing else', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async (url, init) => {
      seen = { url: String(url), init: init! }
      return new Response(JSON.stringify(okEnvelope))
    },
  })
  await fetcher(new URL('https://example.com/a'), new AbortController().signal)
  // Positive first, so this can never pass by never sending the key at all.
  expect(new Headers(seen!.init.headers).get('authorization')).toBe(`Bearer ${SENTINEL}`)
  expect(seen!.url).not.toContain(SENTINEL)
  expect(String(seen!.init.body)).not.toContain(SENTINEL)
})

test('a missing key is a refusal with an instruction, never a keyless attempt', async () => {
  /*
   * Firecrawl Keyless was VERIFIED to work (200, `creditsUsed: 1`, no
   * Authorization header, 2026-08-29) and is rejected — unresolved terms,
   * a shared quota outside this project's control, withdrawable without
   * notice. `called` is the assertion that matters: no request is made.
   */
  let called = 0
  const fetcher = createFirecrawlFetcher({
    key: () => undefined,
    fetch: async () => { called += 1; return new Response('{}') },
  })
  await expect(fetcher(new URL('https://example.com/a'), new AbortController().signal))
    .rejects.toThrow(/Firecrawl API key/)
  expect(called).toBe(0)
})

test.each([
  [401, /rejected this API key/],
  [403, /could not read this site/],
  [429, /rate-limiting/],
  [402, /HTTP 402/],
  [500, /HTTP 500/],
])('HTTP %i produces an app-authored message and never the vendor text', async (status, expected) => {
  const vendorText = 'We apologize … https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg'
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: respond({ success: false, error: vendorText }, status),
  })
  const caught = await fetcher(new URL('https://example.com/a'), new AbortController().signal)
    .catch((error: unknown) => error)
  expect(messageOf(caught)).toMatch(expected)
  expect(messageOf(caught)).not.toContain('typeform')
  expect(messageOf(caught)).not.toContain(SENTINEL)
})

test('a network TypeError names both possibilities and never offers the relay', async () => {
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: async () => { throw new TypeError('Failed to fetch') },
  })
  const caught = await fetcher(new URL('https://example.com/a'), new AbortController().signal)
    .catch((error: unknown) => error)
  // CORS refusal is INDISTINGUISHABLE from offline: the browser deliberately
  // hides the reason. So the message names both rather than guessing.
  expect(messageOf(caught)).toMatch(/offline/i)
  expect(messageOf(caught)).toMatch(/browser requests|policy/i)
  // The one thing it must never suggest. Routing this key through the app's
  // relay would put a user's vendor credential on this project's infrastructure
  // and turn the relay into the open proxy its header comment forbids.
  expect(messageOf(caught)).not.toMatch(/relay|proxy|server/i)
})

test('an unexpected envelope fails closed rather than being parsed defensively', async () => {
  for (const body of [
    { success: false },
    { success: true, data: {} },                                   // no markdown
    { success: true, data: { markdown: 'x', metadata: {} } },      // no statusCode
    { success: true, data: { markdown: 'x', metadata: { statusCode: 'ok' } } },
  ]) {
    await expect(createFirecrawlFetcher({ key: () => SENTINEL, fetch: respond(body) })(
      new URL('https://example.com/a'), new AbortController().signal,
    )).rejects.toThrow(/unexpected response/i)
  }
})

test('the envelope becomes a FetchedArticle: origin status, final url, cache state', async () => {
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: respond({
      success: true,
      data: {
        markdown: '# Title',
        metadata: {
          sourceURL: 'https://example.com/old',
          url: 'https://example.com/new',
          statusCode: 404,
          contentType: 'text/html; charset=utf-8',
          cacheState: 'hit',
          cachedAt: '2026-08-27T10:00:00Z',
        },
      },
    }),
  })
  const article = await fetcher(new URL('https://example.com/old'), new AbortController().signal)
  // 404 is carried UP, not refused here. The refusal is `importWebArticle`'s,
  // because it must be identical for every fetcher.
  expect(article.statusCode).toBe(404)
  expect(article.finalUrl.href).toBe('https://example.com/new')
  expect(article.cachedAt).toBe('2026-08-27T10:00:00Z')
  expect(article.parser).toBe('firecrawl')
})

test('the client deadline aborts with a message about the deadline, not about cancelling', async () => {
  vi.useFakeTimers()
  try {
    const fetcher = createFirecrawlFetcher({ key: () => SENTINEL, fetch: () => new Promise(() => {}) })
    const running = fetcher(new URL('https://example.com/a'), new AbortController().signal)
    const settled = expect(running).rejects.toThrow(/did not answer/)
    await vi.advanceTimersByTimeAsync(FIRECRAWL_REQUEST_TIMEOUT_MS)
    await settled
  } finally {
    vi.useRealTimers()
  }
})

test('a user cancellation is an AbortError, distinguishable from the deadline', async () => {
  const controller = new AbortController()
  const fetcher = createFirecrawlFetcher({
    key: () => SENTINEL,
    fetch: (_u, init) => new Promise((_r, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
    }),
  })
  const running = fetcher(new URL('https://example.com/a'), controller.signal)
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})

test('the endpoint constant is the only firecrawl path this module knows', () => {
  expect(FIRECRAWL_ENDPOINT).toBe('https://api.firecrawl.dev/v2/scrape')
})
