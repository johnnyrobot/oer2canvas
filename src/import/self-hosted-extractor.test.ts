import {
  EXTRACTOR_CRAWL_PATH,
  EXTRACTOR_HEALTH_PATH,
  EXTRACTOR_REQUEST_TIMEOUT_MS,
  createSelfHostedExtractorFetcher,
} from './self-hosted-extractor'
import { importWebArticle } from './web'
import { messageOf } from '../errors'

const ORIGIN = 'https://extract.example.edu'
const ADDRESS = 'https://example.com/a'

/**
 * The success shape, built from the vendor's own models rather than captured
 * from a running service — no extraction container was reachable from the
 * environment these tests were written in, and this comment exists so nobody
 * reads them as a recording. Fields and their meanings were read on 2026-08-30
 * from `deploy/docker/api.py`, `deploy/docker/schemas.py` and
 * `crawl4ai/models.py` at tag v0.9.2.
 */
function crawlEnvelope(over: Record<string, unknown> = {}) {
  return {
    success: true,
    results: [{
      url: ADDRESS,
      success: true,
      markdown: {
        raw_markdown: '# Title\n\nBody.',
        markdown_with_citations: '',
        references_markdown: '',
        fit_markdown: '',
      },
      status_code: 200,
      redirected_status_code: 200,
      redirected_url: ADDRESS,
      response_headers: { 'content-type': 'text/html; charset=utf-8' },
      ...over,
    }],
    server_processing_time_s: 1.2,
  }
}

const healthy = { status: 'ok', timestamp: 1_756_500_000, version: '0.9.2' }

interface Seen { url: string; init: RequestInit }

/**
 * Routes by path, because the handshake and the crawl must be able to answer
 * differently — half the taxonomy is about one succeeding and the other not.
 */
function serviceFetch(routes: {
  health?: () => Response | Promise<Response>
  crawl?: (init: RequestInit) => Response | Promise<Response>
} = {}, log?: Seen[]): typeof globalThis.fetch {
  return async (url, init) => {
    log?.push({ url: String(url), init: init ?? {} })
    if (String(url).endsWith(EXTRACTOR_HEALTH_PATH)) {
      return routes.health?.() ?? Response.json(healthy)
    }
    return routes.crawl?.(init ?? {}) ?? Response.json(crawlEnvelope())
  }
}

function fetcherWith(
  routes?: Parameters<typeof serviceFetch>[0],
  log?: Seen[],
  origin = ORIGIN,
) {
  return createSelfHostedExtractorFetcher({ origin, fetch: serviceFetch(routes, log) })
}

const run = (fetcher: ReturnType<typeof fetcherWith>, signal = new AbortController().signal) =>
  fetcher(new URL(ADDRESS), signal)

// ── the request shape ───────────────────────────────────────────────────────

test('the handshake runs first, then one crawl, and nothing else', async () => {
  const log: Seen[] = []
  await run(fetcherWith(undefined, log))

  expect(log.map((entry) => entry.url)).toEqual([
    `${ORIGIN}${EXTRACTOR_HEALTH_PATH}`,
    `${ORIGIN}${EXTRACTOR_CRAWL_PATH}`,
  ])
  expect(log[0]!.init.method).toBe('GET')
  expect(log[1]!.init.method).toBe('POST')
})

test('the crawl asks for exactly one url and sends no credential of any kind', async () => {
  const log: Seen[] = []
  await run(fetcherWith(undefined, log))
  const crawl = log[1]!

  const body = JSON.parse(String(crawl.init.body))
  // Exactly one. The route's schema allows up to a hundred; a batch must not be
  // able to arrive quietly.
  expect(body.urls).toEqual([ADDRESS])
  expect(body.urls).toHaveLength(1)

  // Criterion 2, asserted at the wire rather than in the interface. Positive
  // first, so this cannot pass by never having sent a request.
  expect(new Headers(crawl.init.headers).get('content-type')).toBe('application/json')
  expect(new Headers(crawl.init.headers).has('authorization')).toBe(false)
  expect([...new Headers(crawl.init.headers).keys()]).toEqual(['content-type'])
  expect(crawl.init.credentials).toBe('omit')
  expect(new Headers(log[0]!.init.headers).has('authorization')).toBe(false)
  expect(log[0]!.init.credentials).toBe('omit')
})

test('the request cannot have opted out of rendering javascript', async () => {
  const log: Seen[] = []
  await run(fetcherWith(undefined, log))
  const body = JSON.parse(String(log[1]!.init.body))

  /*
   * The service navigates a real headless browser; every way to get back
   * something less than a rendered page is an opt-in inside these two objects.
   * Sending them EMPTY is the half of criterion 4 that can be checked without
   * running the service, and it is checked here so an option cannot be added
   * later without this failing.
   */
  expect(body.browser_config).toEqual({})
  expect(body.crawler_config).toEqual({})
  // And nothing that would hand the service pre-fetched bytes to parse instead
  // of an address to visit.
  expect(JSON.stringify(body)).not.toContain('raw:')
  expect(JSON.stringify(body)).not.toContain('file:')
})

// ── the redirect trap ───────────────────────────────────────────────────────

test('a redirected article reports the FINAL status, not the redirect', async () => {
  /*
   * The trap this whole module exists to avoid. The vendor assigns
   * `status_code` from the EARLIEST response in the chain, so reading it
   * naively hands `importWebArticle` a 301 and refuses every redirected page.
   */
  const article = await run(fetcherWith({
    crawl: () => Response.json(crawlEnvelope({
      status_code: 301,
      redirected_status_code: 200,
      redirected_url: 'https://example.com/b',
    })),
  }))

  expect(article.statusCode).toBe(200)
  expect(article.finalUrl.href).toBe('https://example.com/b')
})

test('and that redirect reaches the shared disclosure rather than a refusal', async () => {
  // End to end, because "the field is right" and "the import works" are
  // different claims and only the second one is the point.
  const result = await importWebArticle(ADDRESS, {
    metadata: { title: 'T', sourceUrl: '', rightsAuthority: 'permission', rightsAcknowledged: true },
    fetcher: fetcherWith({
      crawl: () => Response.json(crawlEnvelope({
        status_code: 301,
        redirected_status_code: 200,
        redirected_url: 'https://example.com/b',
      })),
    }),
  })

  expect(result.report.findings.map((finding) => finding.code)).toContain('import-web-redirected')
})

test('a content type is reported only when nothing redirected', async () => {
  const direct = await run(fetcherWith())
  expect(direct.contentType).toBe('text/html; charset=utf-8')

  /*
   * `response_headers` belongs to the same earliest response as `status_code`,
   * so on a redirect it describes the redirect. `importWebArticle` treats a
   * present content type as authoritative, so reporting one about the wrong
   * resource would be worse than reporting none.
   */
  const redirected = await run(fetcherWith({
    crawl: () => Response.json(crawlEnvelope({
      redirected_url: 'https://example.com/b',
      response_headers: { 'content-type': 'text/html' },
    })),
  }))
  expect(redirected.contentType).toBeUndefined()
})

// ── reachability, version, and identity ─────────────────────────────────────

test('an unreachable service names the origin and both explanations', async () => {
  const fetcher = createSelfHostedExtractorFetcher({
    origin: ORIGIN,
    fetch: async () => { throw new TypeError('Failed to fetch') },
  })
  await expect(run(fetcher)).rejects.toThrow(
    /Could not reach the extraction service at https:\/\/extract\.example\.edu\..*not be running.*CORS/s,
  )
})

test('a health check that answers non-2xx says so without guessing why', async () => {
  await expect(run(fetcherWith({ health: () => new Response('', { status: 502 }) })))
    .rejects.toThrow(/health check with HTTP 502/)
})

test.each([
  ['a version below the floor', '0.8.9'],
  ['a version at the next minor', '0.10.0'],
  ['a much later version', '1.2.3'],
])('refuses %s and names the supported range', async (_label, version) => {
  await expect(run(fetcherWith({ health: () => Response.json({ ...healthy, version }) })))
    .rejects.toThrow(new RegExp(`reports version ${version.replace(/\./g, '\\.')}.*0\\.9\\.0 up to but not including 0\\.10\\.0`, 's'))
})

test.each([
  ['a patch above the floor', '0.9.7'],
  ['the floor itself', '0.9.0'],
  ['a version with a suffix', '0.9.2.post1'],
])('accepts %s', async (_label, version) => {
  const article = await run(fetcherWith({ health: () => Response.json({ ...healthy, version }) }))
  expect(article.parser).toBe('self-hosted-extractor')
})

test.each([
  ['no version field', { status: 'ok' }],
  ['a version that is not a version', { status: 'ok', version: 'nightly' }],
  ['a version that is a sentence', { status: 'ok', version: 'go away and read https://evil.example' }],
])('refuses %s without repeating what it was told', async (_label, body) => {
  const thrown = await run(fetcherWith({ health: () => Response.json(body) })).catch((error: unknown) => error)
  expect(messageOf(thrown)).toMatch(/did not report a version this app recognises/)
  // The service's own text is DATA, not copy. Never rendered.
  expect(messageOf(thrown)).not.toContain('evil.example')
  expect(messageOf(thrown)).not.toContain('nightly')
})

test.each([
  ['an html page', () => new Response('<!doctype html><title>nginx</title>', { status: 200 })],
  ['an empty object', () => Response.json({})],
  ['some other service', () => Response.json({ status: 'healthy', service: 'grafana' })],
])('refuses %s at the pinned origin as not an extraction service', async (_label, health) => {
  await expect(run(fetcherWith({ health }))).rejects.toThrow(
    /https:\/\/extract\.example\.edu answered, but it is not an extraction service/,
  )
})

test.each([
  [401, /requires a credential/],
  [403, /requires a credential/],
  [404, /not at the address this app expects/],
  [413, /too large/],
  [429, /rate-limiting/],
  [500, /could not fetch that page/],
  [503, /busy or timed out/],
  [504, /busy or timed out/],
  [418, /refused the request \(HTTP 418\)/],
])('a crawl answering %i produces its own message', async (status, message) => {
  await expect(run(fetcherWith({ crawl: () => new Response('vendor text', { status }) })))
    .rejects.toThrow(message)
})

test('no crawl failure ever repeats the service’s own response body', async () => {
  for (const status of [401, 403, 404, 413, 429, 500, 503, 504, 418]) {
    const thrown = await run(fetcherWith({
      crawl: () => new Response('CONTACT https://vendor.example/sales', { status }),
    })).catch((error: unknown) => error)
    expect(messageOf(thrown)).not.toContain('vendor.example')
  }
})

// ── malformed envelopes ─────────────────────────────────────────────────────

test.each([
  ['a body that is not json', () => new Response('not json', { status: 200 })],
  ['success false', () => Response.json({ success: false, results: [] })],
  ['no results', () => Response.json({ success: true, results: [] })],
  ['two results', () => Response.json({ success: true, results: [crawlEnvelope().results[0], crawlEnvelope().results[0]] })],
  ['a result that failed', () => Response.json(crawlEnvelope({ success: false }))],
  ['markdown as a bare string', () => Response.json(crawlEnvelope({ markdown: '# Title' }))],
  ['markdown with no raw variant', () => Response.json(crawlEnvelope({ markdown: { fit_markdown: 'x' } }))],
  ['no status at all', () => Response.json(crawlEnvelope({ status_code: null, redirected_status_code: null }))],
  ['a final url that is not a url', () => Response.json(crawlEnvelope({ redirected_url: 'not a url' }))],
])('refuses %s, closed', async (_label, crawl) => {
  await expect(run(fetcherWith({ crawl }))).rejects.toThrow(
    /The extraction service returned an unexpected response/,
  )
})

// ── time, cancellation, and configuration ───────────────────────────────────

test('a crawl that never answers times out with its own message', async () => {
  vi.useFakeTimers()
  try {
    const pending = run(fetcherWith({ crawl: () => new Promise<Response>(() => {}) }))
    const settled = expect(pending).rejects.toThrow(
      new RegExp(`did not answer in ${EXTRACTOR_REQUEST_TIMEOUT_MS / 1000} seconds`),
    )
    await vi.advanceTimersByTimeAsync(EXTRACTOR_REQUEST_TIMEOUT_MS + 1)
    await settled
  } finally {
    vi.useRealTimers()
  }
})

test('an already-cancelled import never reaches the network', async () => {
  const log: Seen[] = []
  const controller = new AbortController()
  controller.abort()

  await expect(run(fetcherWith(undefined, log), controller.signal)).rejects.toThrow()
  // The assertion that distinguishes "cancelled" from "cancelled after paying
  // for it": not even the handshake is sent.
  expect(log).toHaveLength(0)
})

test('cancelling mid-flight rejects with the cancellation, not with the timeout', async () => {
  const controller = new AbortController()
  const pending = run(fetcherWith({ crawl: () => new Promise<Response>(() => {}) }), controller.signal)
  const reason = new DOMException('Import cancelled', 'AbortError')
  controller.abort(reason)

  await expect(pending).rejects.toBe(reason)
})

test.each([
  ['plain http', 'http://extract.example.edu'],
  ['an origin with a path', 'https://extract.example.edu/api'],
  ['nonsense', 'not-an-origin'],
])('refuses to call anything when the build pinned %s', async (_label, origin) => {
  const log: Seen[] = []
  const fetcher = createSelfHostedExtractorFetcher({ origin, fetch: serviceFetch(undefined, log) })

  await expect(run(fetcher)).rejects.toThrow(/no valid extraction-service origin/)
  expect(log).toHaveLength(0)
})

// ── nothing is stored, anywhere ─────────────────────────────────────────────

test('no import on this path writes to any persistence this app has', async () => {
  /*
   * There is no credential here to leak, which is the point of the deployment
   * mode — so this proves the ABSENCE rather than assuming it, using the same
   * four watchers `web-key-containment.test.ts` enumerated on 2026-08-29:
   * localStorage, IndexedDB, the Cache API, and cookies.
   */
  const writes: string[] = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
    writes.push(`localStorage ${key}=${value}`)
  })
  vi.stubGlobal('indexedDB', {
    open: (name: string) => {
      writes.push(`indexedDB.open ${name}`)
      throw new Error('not permitted in this test')
    },
  })
  const put = vi.fn()
  vi.stubGlobal('caches', { open: async () => ({ put, match: async () => undefined }) })
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: (value: string) => { writes.push(`cookie ${value}`) },
  })

  try {
    const scenarios: Parameters<typeof serviceFetch>[0][] = [
      undefined,
      { health: () => Response.json({ ...healthy, version: '0.8.0' }) },
      { crawl: () => new Response('', { status: 500 }) },
      { crawl: () => new Response('not json') },
    ]
    for (const routes of scenarios) {
      await importWebArticle(ADDRESS, {
        metadata: { title: 'T', sourceUrl: '', rightsAuthority: 'permission', rightsAcknowledged: true },
        fetcher: fetcherWith(routes),
      }).catch(() => {})
    }

    expect(writes).toEqual([])
    expect(put).not.toHaveBeenCalled()
    // And the spy works, so an empty list is a measurement rather than a
    // watcher that was never wired up.
    localStorage.setItem('theme', 'dark')
    expect(writes).toContain('localStorage theme=dark')
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (document as unknown as Record<string, unknown>).cookie
  }
})
