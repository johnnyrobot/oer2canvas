import { importWebArticle } from './web'
import { createFirecrawlFetcher } from './firecrawl'
import { createFirecrawlKeyStore } from './firecrawl-key'
import { messageOf } from '../errors'
import type { ImportResult } from './types'

/**
 * Issue 12's second criterion, proved adversarially rather than in passing.
 *
 * The persistence paths this repository actually has, enumerated 2026-08-29 by
 * `grep -rn "localStorage|sessionStorage|indexedDB|document.cookie" src worker`
 * with tests excluded — three hits, plus one the grep cannot see:
 *
 *  1. IndexedDB — `src/canvas/idb.ts:23`, whose header calls it "the one place
 *     this app writes to disk". Holds the Canvas base URL and the push journal;
 *     since IDEA slice 4 (2026-09-12) also the IDEA review document and, by the
 *     user's explicit choice, the model API key under `idea.llm.settings` —
 *     a different secret from the Firecrawl key, with its own containment test
 *     in `src/engine/idea/llm/key-containment.test.ts`. The Firecrawl key is
 *     never written there, which is what this file asserts.
 *  2. `localStorage` — one key, the theme, `src/shell/useTheme.ts:51`.
 *  3. Cookies — none. `document.cookie` appears nowhere outside tests.
 *  4. The service worker Cache API — invisible to that grep because workbox
 *     writes it. `vite.config.ts` declares three `runtimeCaching` rules; two
 *     require `sameOrigin` and the third `request.mode === 'navigate'`, and
 *     workbox does not cache a POST at all, so a cross-origin POST to
 *     api.firecrawl.dev matches none of them. Asserted ANYWAY — "provably not
 *     reached" and "asserted not reached" are different claims, and this is the
 *     one path a future runtime-caching rule could quietly start matching.
 *  5. Logs — already closed: `grep -rn "console\." src worker` excluding tests
 *     returns nothing (re-verified 2026-08-29), and `wrangler.jsonc` sets
 *     `observability.enabled: false`. Nothing on this path reaches a Worker.
 */
const SENTINEL = 'fc-SENTINEL-do-not-leak-0123456789'

const metadata = {
  title: 'Photosynthesis',
  sourceUrl: '',
  rightsAuthority: 'permission' as const,
  rightsAcknowledged: true,
}

const okEnvelope = {
  success: true,
  data: {
    markdown: '# Photosynthesis\n\nPlants convert light.',
    metadata: {
      url: 'https://example.com/a',
      sourceURL: 'https://example.com/a',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
    },
  },
}

/** Measured 2026-08-29: a 404 delivered inside a successful extraction. */
const notFoundInside200 = {
  success: true,
  data: {
    markdown: '# Not Found\n\nThe page you requested does not exist.',
    metadata: {
      url: 'https://example.com/a',
      sourceURL: 'https://example.com/a',
      statusCode: 404,
      error: 'Not Found',
    },
  },
}

type Scenario =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'network-error' }

const everyFailureRow: Scenario[] = [
  { kind: 'json', status: 200, body: okEnvelope },
  { kind: 'json', status: 401, body: { success: false, error: 'Unauthorized' } },
  { kind: 'json', status: 403, body: { success: false, error: 'We apologize … typeform.com/to/Ej6oydlg' } },
  { kind: 'json', status: 429, body: { success: false, error: 'Rate limit exceeded' } },
  { kind: 'json', status: 402, body: { success: false } },
  { kind: 'json', status: 500, body: { success: false } },
  { kind: 'network-error' },
  { kind: 'json', status: 200, body: notFoundInside200 },
  { kind: 'json', status: 200, body: { success: true, data: { markdown: 'x' } } },
]

const recordedRequestUrls: string[] = []

function fakeFetchFor(scenario: Scenario): typeof globalThis.fetch {
  return async (url, init) => {
    recordedRequestUrls.push(String(url))
    // The body is recorded too: a key smuggled into the payload rather than the
    // header would otherwise pass a url-only check.
    recordedRequestUrls.push(String(init?.body ?? ''))
    if (scenario.kind === 'network-error') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(scenario.body), { status: scenario.status })
  }
}

/** Every write path this app has, watched at once. */
function watchStorage() {
  const writes: string[] = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
    writes.push(`localStorage ${key}=${value}`)
  })
  // jsdom implements neither `indexedDB` nor `caches`, so these are stubbed
  // rather than spied. A test that only ever asserted on `undefined` would
  // silently stop watching the moment one of them appeared.
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
  return { writes, put }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as unknown as Record<string, unknown>).cookie
  recordedRequestUrls.length = 0
})

test('no import, successful or failed, writes the key anywhere', async () => {
  const { writes, put } = watchStorage()
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)

  for (const scenario of everyFailureRow) {
    await importWebArticle('https://example.com/a', {
      metadata,
      fetcher: createFirecrawlFetcher({ key: () => key.peek(), fetch: fakeFetchFor(scenario) }),
    }).catch(() => {})
  }

  expect(writes.filter((write) => write.includes(SENTINEL))).toEqual([])
  expect(put).not.toHaveBeenCalled()
  // And the theme write still happens somewhere in this app, so the spy works.
  localStorage.setItem('theme', 'dark')
  expect(writes).toContain('localStorage theme=dark')
})

test('the key appears in no thrown message, no finding, and no request url', async () => {
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)

  for (const scenario of everyFailureRow) {
    const outcome = await importWebArticle('https://example.com/a', {
      metadata,
      fetcher: createFirecrawlFetcher({ key: () => key.peek(), fetch: fakeFetchFor(scenario) }),
    }).then(
      (result): ImportResult | Error => result,
      (error: unknown): ImportResult | Error => (error instanceof Error ? error : new Error(String(error))),
    )

    if (outcome instanceof Error) {
      expect(messageOf(outcome)).not.toContain(SENTINEL)
      /*
       * Also assert the error is not carrying it in a property a logger would
       * reach: an `Error` with `{ cause: response }` would pass a message check
       * and still leak through `JSON.stringify` or a devtools expansion.
       */
      expect(JSON.stringify(outcome, Object.getOwnPropertyNames(outcome))).not.toContain(SENTINEL)
    } else {
      for (const finding of outcome.report.findings) {
        expect(finding.message).not.toContain(SENTINEL)
      }
      expect(JSON.stringify(outcome)).not.toContain(SENTINEL)
    }
  }

  // The url AND the body of every request that was attempted.
  expect(recordedRequestUrls.join('|')).not.toContain(SENTINEL)
  // Guard against passing by never having sent anything at all.
  expect(recordedRequestUrls.length).toBeGreaterThan(0)
})

test('forget clears the key from memory, so the next import never reaches the network', async () => {
  let called = 0
  const key = createFirecrawlKeyStore()
  key.hold(SENTINEL)
  key.forget()

  await expect(importWebArticle('https://example.com/a', {
    metadata,
    fetcher: createFirecrawlFetcher({
      key: () => key.peek(),
      fetch: async () => { called += 1; return new Response('{}') },
    }),
  })).rejects.toThrow(/Firecrawl API key/)
  // The assertion that distinguishes "cleared" from "cleared the form field":
  // a stale captured key would have produced a request.
  expect(called).toBe(0)
})
