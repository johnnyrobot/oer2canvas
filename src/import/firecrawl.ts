import type { FetchedArticle, WebArticleFetcher } from './web'

/**
 * The one endpoint this app calls. Used exactly once, below.
 *
 * `/v2/crawl`, `/v2/map`, `/v2/search`, `/v2/batch` and `/v2/agent` appear
 * nowhere in this file, and `web-endpoints.test.ts` asserts that mechanically
 * against both this source and the built bundle. One URL in, one page out is a
 * structural property here, not an intention.
 */
export const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape'

/**
 * The vendor's own documented default for the `timeout` body parameter
 * (Firecrawl `/v2/scrape` API reference, read 2026-08-29). It is SENT
 * explicitly as well as used as the client deadline, so a future revision of
 * the vendor's default cannot make the two disagree.
 *
 * `PARSER_PROBE_LIMITS.parserTimeoutMs` (30 000) is deliberately not reused: it
 * budgets local WASM CPU, and a network round trip that includes a headless
 * browser rendering someone's site is a different thing.
 */
export const FIRECRAWL_REQUEST_TIMEOUT_MS = 60_000

export interface FirecrawlDependencies {
  /**
   * A GETTER, not a string. The panel holds the key and can forget it between
   * the render and the submit; a captured string would outlive Forget key.
   */
  key: () => string | undefined
  /** Injected so the suite runs with no network, as `RelayDeps` does. */
  fetch?: typeof globalThis.fetch
}

const UNEXPECTED = 'Firecrawl returned an unexpected response. Try again, or try a different page.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Map a status to app-authored copy.
 *
 * The vendor's own error text is DATA, not copy, and is never shown. Measured
 * 2026-08-29, the 403 body is an apology ending in a link to a vendor-controlled
 * enterprise intake form; rendering it would put a stranger's URL in this app's
 * interface. The only value interpolated anywhere in this file is
 * `response.status`, a number.
 */
function statusMessage(status: number): string {
  if (status === 401) {
    return 'Firecrawl rejected this API key. Check that it is current and pasted in full.'
  }
  if (status === 403) {
    return 'Firecrawl could not read this site. Some publishers block automated readers, '
      + 'and Firecrawl declines some sites outright.'
  }
  if (status === 429) {
    return 'Firecrawl is rate-limiting this key. Wait a moment and import the page again.'
  }
  /*
   * The generic branch. Firecrawl's rate-limit documentation lists no `402`
   * (verified absent, 2026-08-29), so quota exhaustion is INFERRED to land here
   * rather than in a branch of its own — which is why the credit balance is
   * mentioned in the general case instead of being claimed for a specific code.
   */
  return `Firecrawl refused the request (HTTP ${status}). Check your plan's credit balance.`
}

export function createFirecrawlFetcher(deps: FirecrawlDependencies): WebArticleFetcher {
  const doFetch = deps.fetch ?? globalThis.fetch

  return async (url, signal) => {
    // Read at CALL time, so Forget key takes effect between a render and a submit.
    const key = deps.key()
    if (!key) {
      throw new Error('Enter your Firecrawl API key before importing a web page.')
    }
    signal.throwIfAborted()

    /*
     * Two abort sources, one request, and two different messages — a user who
     * pressed Cancel and a request that outran its deadline should not be told
     * the same thing. Each source rejects the race with its own reason, so which
     * one fired is carried by the rejection rather than by a flag.
     *
     * Written by hand rather than with `AbortSignal.any`/`AbortSignal.timeout`:
     * the `unit` project is jsdom, whose `AbortSignal` is not Node's, and an
     * environment assumption here would be a test that passes for the wrong
     * reason.
     */
    const controller = new AbortController()
    let rejectCancelled: (reason: unknown) => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
    const onAbort = () => {
      controller.abort(signal.reason)
      rejectCancelled(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(
            `Firecrawl did not answer in ${FIRECRAWL_REQUEST_TIMEOUT_MS / 1000} seconds. `
            + 'Try again, or try a page with less on it.',
          ))
        }, FIRECRAWL_REQUEST_TIMEOUT_MS)
      })

      const request = doFetch(FIRECRAWL_ENDPOINT, {
        method: 'POST',
        headers: {
          // The key travels here and nowhere else: never a query parameter,
          // never an interpolated message, never a rendered string.
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        /*
         * The wildcard `access-control-allow-origin: *` measured on every
         * status makes this mandatory — a browser rejects a wildcard response
         * for a credentialed request — and no cookie of this app's belongs on a
         * vendor call in any case.
         */
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({
          url: url.href,
          // Markdown only. The link set is never requested, so link-following
          // code cannot be written by accident: it would have nothing to follow.
          formats: ['markdown'],
          /*
           * Measured 2026-08-29: the DEFAULT is `[{"type":"pdf"}]`, and with it
           * a PDF URL is silently text-extracted server-side. `[]` makes a PDF
           * arrive as a PDF, so `importWebArticle` can refuse it and point at
           * the Document tab — where the scanned-page signals actually exist.
           */
          parsers: [],
          // The article rather than the whole page. The measurement quoted in
          // `web.ts`'s `markdown` comment was taken with this on.
          onlyMainContent: true,
          timeout: FIRECRAWL_REQUEST_TIMEOUT_MS,
        }),
      }).catch((error: unknown) => {
        // An abort surfaces here too; let it through as itself so the race's
        // reason is not overwritten with a network message.
        if (error instanceof Error && error.name === 'AbortError') throw error
        /*
         * A CORS refusal is INDISTINGUISHABLE from being offline: the browser
         * deliberately hides which it was. So name both rather than guess — and
         * never offer the relay, which would put a user's vendor credential on
         * this project's infrastructure and turn the relay into the open proxy
         * its own header forbids.
         */
        throw new TypeError(
          'Could not reach Firecrawl. This browser may be offline, or browser requests to '
          + 'api.firecrawl.dev may be blocked by a network policy or an extension.',
        )
      })

      const response = await Promise.race([request, deadline, cancelled])

      if (!response.ok) throw new Error(statusMessage(response.status))

      // `.json()` throws on a non-JSON body, which is itself an unexpected
      // response rather than something to parse around.
      const envelope: unknown = await response.json().catch(() => { throw new Error(UNEXPECTED) })

      /*
       * Fail closed. Every field below is required, and a missing one is a
       * refusal rather than a default — a half-parsed envelope would produce a
       * half-import that looks like a successful one.
       */
      if (!isRecord(envelope) || envelope.success !== true) throw new Error(UNEXPECTED)
      const data = envelope.data
      if (!isRecord(data) || typeof data.markdown !== 'string') throw new Error(UNEXPECTED)
      const meta = data.metadata
      if (!isRecord(meta) || typeof meta.statusCode !== 'number') throw new Error(UNEXPECTED)

      // Post-redirect first: `url` is where the fetch ended up, `sourceURL` is
      // what was asked for.
      const finalHref = typeof meta.url === 'string' ? meta.url
        : typeof meta.sourceURL === 'string' ? meta.sourceURL
          : url.href
      let finalUrl: URL
      try {
        finalUrl = new URL(finalHref)
      } catch {
        throw new Error(UNEXPECTED)
      }

      const article: FetchedArticle = {
        markdown: data.markdown,
        finalUrl,
        // Carried UP, never refused here: the non-2xx refusal belongs to
        // `importWebArticle` so that it is identical for every fetcher.
        statusCode: meta.statusCode,
        parser: 'firecrawl',
        ...(typeof meta.contentType === 'string' ? { contentType: meta.contentType } : {}),
        ...(meta.cacheState === 'hit' && typeof meta.cachedAt === 'string'
          ? { cachedAt: meta.cachedAt }
          : {}),
      }
      return article
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/*
 * Three things above are Firecrawl's SHAPE, not the seam's. A second
 * `WebArticleFetcher` — the self-hosted extractor described in `web.ts` — must
 * supply the same CONCEPTS by whatever means its own service offers:
 *
 *  - `parsers: []` means "do not transcode a PDF for me". The general concept
 *    is that a fetcher must report a PDF as a PDF, not as text, so the shared
 *    refusal can fire. A fetcher that silently text-extracts PDFs would publish
 *    a scan-derived page with none of the scanned-page signals issue 11 exists
 *    to compute.
 *  - `metadata.statusCode` means "the status the ORIGIN gave", which is not the
 *    status the extractor gave. `importWebArticle` refuses a non-2xx origin and
 *    can only do that if the fetcher reports it.
 *  - the 401/403/429 taxonomy is Firecrawl's auth and quota vocabulary. A
 *    self-hosted extractor has neither a key nor a credit balance, and will
 *    have failures of its own; the contract at the seam is not the status codes
 *    but the RULE — throw an `Error` whose message is built from a status and a
 *    fixed string, never from the request, the headers, or an interpolated
 *    response body.
 */
