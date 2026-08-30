import type { FetchedArticle, WebArticleFetcher } from './web'

/**
 * The second implementation of `WebArticleFetcher`: an extraction service the
 * operator runs themselves, reached browser-direct over HTTPS at an origin they
 * pinned at build time.
 *
 * WHY BROWSER-DIRECT, AND WHY HTTPS. Measured 2026-08-30 against this
 * repository's own Chromium 151:
 *
 *  - `https://…` page → `http://127.0.0.1:PORT` is refused with "Permission was
 *    denied for this request to access the `loopback` address space". That is
 *    Local Network Access, not mixed content, and the permission is denied by
 *    default. The same request from an `http://127.0.0.1` page succeeded, which
 *    is the control that rules out every other explanation.
 *  - `https://…` page → `http://anything.else` is refused as mixed content,
 *    before the request exists (a route handler registered on the target fired
 *    zero times).
 *
 * So `http://localhost:11235`, the conventional way to run a local extractor,
 * is not a transport an HTTPS page can use — and it would serve only the one
 * machine sitting at it in any case. The operator fronts the service with a
 * TLS-terminating reverse proxy, which is what crawl4ai's own shipped
 * `config.yml` already tells them to do for any non-loopback exposure.
 *
 * WHY NOT BEHIND THE RELAY. `worker/relay.ts` runs on Cloudflare's edge and
 * cannot reach a machine on the operator's network at all, so routing through
 * it does not solve the loopback problem — it makes it unsolvable. And it would
 * gut relay rule 3 ("Allowlists destination hosts so this cannot become an open
 * proxy") while appearing to honour it: one allowlisted destination that
 * fetches whatever URL is named in the POST body is an open proxy with an extra
 * hop. `web-endpoints.test.ts` asserts this file never names the relay.
 *
 * NO CREDENTIAL TRAVELS FROM THIS BROWSER. Not a key field, not a store, not an
 * `authorization` header, not a build define. crawl4ai refuses to start on a
 * non-loopback bind without a credential, so a deployment may well have one —
 * and it is the operator's reverse proxy that supplies it, which is the whole
 * reason this path needs no key UI.
 */

/**
 * The two endpoints this app calls, named exactly once each.
 *
 * The service's crawl-stream, markdown-only, raw-HTML, screenshot, PDF,
 * script-execution, LLM and question routes appear nowhere in this file — and
 * deliberately are not spelled out even in prose, because
 * `web-endpoints.test.ts` greps this source and `scripts/smoke-dist.mjs` greps
 * the built bundle, and neither cares whether a match is code or a comment.
 * One URL in, one page out is a structural property, not an intention.
 *
 * The crawl route and not the markdown-only one: read from the vendor's
 * `deploy/docker/server.py` at tag v0.9.2 on 2026-08-30, that route returns no
 * status code and no post-redirect URL, and `web.ts` says of `statusCode` that
 * "a fetcher that cannot report this cannot be used".
 */
export const EXTRACTOR_CRAWL_PATH = '/crawl'
export const EXTRACTOR_HEALTH_PATH = '/health'

/**
 * The versions whose wire format this module was written against.
 *
 * The floor is not conservatism. `redirected_status_code` is absent from
 * `crawl4ai/models.py` at tag v0.8.0 and present at v0.9.0 (both read
 * 2026-08-30), and without it a redirected article reports its FIRST hop's
 * status — a `301` — which `importWebArticle` refuses as non-2xx. An 0.8
 * service would therefore refuse every redirected page and blame the publisher.
 * The 0.9 line is also the first whose shipped config binds loopback and
 * denies CORS by default, so it is the first safe to expose at all.
 *
 * The ceiling is the next minor, because a minor is the granularity at which
 * this vendor has moved these fields.
 */
export const EXTRACTOR_SUPPORTED_VERSIONS = { minimum: [0, 9, 0], below: [0, 10, 0] } as const

/**
 * The client deadline.
 *
 * Longer than the Firecrawl path's 60 seconds, and REASONED rather than
 * measured — no extraction container was reachable from the environment this
 * was written in, and this comment exists so nobody reads the number as an
 * observation. Two reasons for the larger budget: the rendering is being done
 * by the operator's own hardware, which may be a laptop rather than a fleet,
 * and no per-request credit is being spent while it waits.
 */
export const EXTRACTOR_REQUEST_TIMEOUT_MS = 90_000

/** Named so `web-key-containment`-style tests can assert on the exact string. */
const MALFORMED = 'The extraction service returned an unexpected response. '
  + 'Try again, or try a different page.'

export interface SelfHostedExtractorDependencies {
  /**
   * The operator's pinned origin, injected rather than read from the build
   * define here.
   *
   * That is what keeps this whole module testable in the ordinary `unit`
   * project with no build switch at all — the same reason `firecrawl.ts` takes
   * its key as a dependency. `WebArticleImporter` supplies the compiled
   * constant, and it is the only caller that knows one exists.
   */
  origin: string
  /** Injected so the suite runs with no network, as `RelayDeps` does. */
  fetch?: typeof globalThis.fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Map a `/crawl` status to app-authored copy.
 *
 * The service's own error text is DATA, not copy, and is never shown — the same
 * rule `firecrawl.ts` states and for the same reason. The only value
 * interpolated here is `status`, a number.
 *
 * The families differ from Firecrawl's because the vocabulary differs: there is
 * no key to be wrong and no credit balance to exhaust. What there is instead is
 * a service the operator configured, so every message points at the thing the
 * operator can change.
 */
function crawlStatusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'The extraction service refused the request because it requires a credential. '
      + 'The operator’s reverse proxy should be supplying it; this app never sends one.'
  }
  if (status === 404) {
    return 'The extraction service answered, but not at the address this app expects. '
      + 'Check the origin this build was pinned to.'
  }
  if (status === 413) {
    return 'The extraction service rejected the request as too large. Try a shorter address.'
  }
  if (status === 429) {
    return 'The extraction service is rate-limiting requests. Wait a moment and import the page again.'
  }
  if (status === 500) {
    /*
     * Read from the vendor's `deploy/docker/server.py` at tag v0.9.2 on
     * 2026-08-30: the crawl route raises HTTP 500 when every result in the
     * batch has `success: false`. So a page the service could not fetch — a
     * dead host, a navigation error — arrives as a 500 rather than as a 200
     * carrying an error, and this is the branch that names it.
     */
    return 'The extraction service could not fetch that page. '
      + 'Check the address, or try a different page.'
  }
  if (status === 503 || status === 504) {
    return 'The extraction service is busy or timed out. Wait a moment and import the page again.'
  }
  return `The extraction service refused the request (HTTP ${status}). `
    + 'Ask the operator of this deployment to check its logs.'
}

/**
 * The version handshake, split out because it is a decision rather than a
 * parse: an unrecognisable version is as unusable as an unsupported one, and
 * both must say something an operator can act on.
 *
 * Only the REGEX-MATCHED digits are interpolated, never the raw field, so a
 * service answering with a paragraph cannot put its own text in this app's
 * interface.
 */
function versionRefusal(raw: unknown): string | undefined {
  const matched = typeof raw === 'string' ? /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(raw) : null
  if (!matched) {
    return 'The extraction service did not report a version this app recognises. '
      + `Ask the operator to run a version from ${describeSupported()}.`
  }
  const found = [Number(matched[1]), Number(matched[2]), Number(matched[3])] as const
  const { minimum, below } = EXTRACTOR_SUPPORTED_VERSIONS
  if (compare(found, minimum) < 0 || compare(found, below) >= 0) {
    return `The extraction service reports version ${matched[0]}, which this app does not support. `
      + `Ask the operator to run a version from ${describeSupported()}.`
  }
  return undefined
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let at = 0; at < 3; at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function describeSupported(): string {
  const { minimum, below } = EXTRACTOR_SUPPORTED_VERSIONS
  return `${minimum.join('.')} up to but not including ${below.join('.')}`
}

export function createSelfHostedExtractorFetcher(
  deps: SelfHostedExtractorDependencies,
): WebArticleFetcher {
  const doFetch = deps.fetch ?? globalThis.fetch

  return async (url, signal) => {
    /*
     * The precondition, re-checked here.
     *
     * `vite.deployment.ts` already ran the full rule at build time, so this is
     * belt and braces — but the Canvas path has the Worker as a second,
     * independent enforcer of its pinned origin and this path has none, so the
     * module enforces its own. It is a BUILD error, phrased as one, because a
     * user can do nothing about it.
     */
    let origin: URL
    try {
      origin = new URL(deps.origin)
    } catch {
      throw new Error('This build has no valid extraction-service origin. Ask its operator to rebuild it.')
    }
    if (origin.protocol !== 'https:' || origin.pathname !== '/') {
      throw new Error('This build has no valid extraction-service origin. Ask its operator to rebuild it.')
    }
    signal.throwIfAborted()

    /*
     * Two abort sources, one request, two different messages — a user who
     * pressed Cancel and a request that outran its deadline should not be told
     * the same thing. Written by hand rather than with `AbortSignal.any` /
     * `AbortSignal.timeout` for the reason `firecrawl.ts` records: the `unit`
     * project is jsdom, whose `AbortSignal` is not Node's, and an environment
     * assumption here would be a test that passes for the wrong reason.
     *
     * One controller and one deadline cover BOTH requests below, so the health
     * check and the crawl share a single budget rather than getting one each.
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
            `The extraction service did not answer in ${EXTRACTOR_REQUEST_TIMEOUT_MS / 1000} seconds. `
            + 'Try again, or try a page with less on it.',
          ))
        }, EXTRACTOR_REQUEST_TIMEOUT_MS)
      })

      /*
       * THE HANDSHAKE RUNS FIRST, AND COSTS ONE EXTRA ROUND TRIP ON PURPOSE.
       *
       * An unreachable service, a mis-pinned origin, or a version that cannot
       * report a redirected page's status is reported BEFORE the operator's
       * browser spends a minute and a half rendering someone's site. The health
       * route is public on a correctly configured service — read from the
       * vendor's `server.py` at tag v0.9.2 on 2026-08-30, its auth gate exempts
       * exactly the health and token routes — so this works whether or not the
       * operator's proxy injects a credential.
       */
      const healthRequest = doFetch(`${origin.origin}${EXTRACTOR_HEALTH_PATH}`, {
        method: 'GET',
        // No cookie of this app's belongs on this call, and the service sets
        // `access-control-allow-credentials: true` for the origins it allows —
        // which would make a credentialed request depend on cookie state the
        // operator never intended to be part of it.
        credentials: 'omit',
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') throw error
        /*
         * A CORS refusal is INDISTINGUISHABLE from being offline: the browser
         * deliberately hides which. So name both — and CORS is the likelier of
         * the two here, because the service ships `cors_allow_origins: []` and
         * installs no CORS middleware at all until an operator lists an origin
         * (read from its `deploy/docker/config.yml` and `server.py` at tag
         * v0.9.2 on 2026-08-30). Never offer the relay: it cannot reach the
         * operator's machine, and pointing at it would start the argument this
         * design settled.
         */
        throw new TypeError(
          `Could not reach the extraction service at ${origin.origin}. It may not be running, `
          + 'or its CORS configuration may not list this app’s address.',
        )
      })

      const health = await Promise.race([healthRequest, deadline, cancelled])
      if (!health.ok) {
        throw new Error(
          `The extraction service answered its health check with HTTP ${health.status}. `
          + 'Ask the operator of this deployment to check that it is running.',
        )
      }
      const reported: unknown = await health.json().catch(() => undefined)
      if (!isRecord(reported) || reported.status !== 'ok') {
        throw new Error(
          `${origin.origin} answered, but it is not an extraction service this app can use. `
          + 'Check the origin this build was pinned to.',
        )
      }
      const refusal = versionRefusal(reported.version)
      if (refusal) throw new Error(refusal)

      const crawlRequest = doFetch(`${origin.origin}${EXTRACTOR_CRAWL_PATH}`, {
        method: 'POST',
        // `content-type` and nothing else. In particular no `authorization`:
        // there is no credential on this path, and adding one would need a
        // place to hold it, which is exactly what this deployment mode exists
        // to not have.
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({
          /*
           * A list of exactly one. The route's own schema allows up to a
           * hundred (`urls: List[str] = Field(min_length=1, max_length=100)`,
           * read from the vendor's `deploy/docker/schemas.py` at tag v0.9.2 on
           * 2026-08-30) and this app sends one, forever. `self-hosted-extractor.test.ts`
           * asserts the length, so a batch cannot be introduced quietly.
           */
          urls: [url.href],
          /*
           * DELIBERATELY EMPTY, AND THAT IS THE JAVASCRIPT-RENDERING GUARANTEE.
           *
           * The route drives a real headless browser through a navigation; the
           * ways to make it return something less than a rendered page are all
           * opt-ins in these two configuration objects. Sending them empty
           * means this app cannot have opted out, and the test asserts they are
           * empty rather than asserting on a live site — which is the only half
           * of the guarantee that can be checked without running the service.
           */
          browser_config: {},
          crawler_config: {},
        }),
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') throw error
        throw new TypeError(
          `Could not reach the extraction service at ${origin.origin}. It may not be running, `
          + 'or its CORS configuration may not list this app’s address.',
        )
      })

      const response = await Promise.race([crawlRequest, deadline, cancelled])
      if (!response.ok) throw new Error(crawlStatusMessage(response.status))

      const envelope: unknown = await response.json().catch(() => { throw new Error(MALFORMED) })

      /*
       * Fail closed. Every field below is required, and a missing one is a
       * refusal rather than a default — a half-parsed envelope would produce a
       * half-import that looks like a successful one.
       *
       * The envelope shape is `{success, results, server_processing_time_s, …}`
       * where each result is the vendor's crawl-result model serialised, and
       * `markdown` is an OBJECT rather than a string because that model
       * overrides its own serialisation to emit one (read from
       * `deploy/docker/api.py` and `crawl4ai/models.py` at tag v0.9.2 on
       * 2026-08-30).
       */
      if (!isRecord(envelope) || envelope.success !== true) throw new Error(MALFORMED)
      const results = envelope.results
      if (!Array.isArray(results) || results.length !== 1) throw new Error(MALFORMED)
      const result: unknown = results[0]
      if (!isRecord(result) || result.success !== true) throw new Error(MALFORMED)

      /*
       * `raw_markdown`, always — never the content-filtered variant.
       *
       * That variant is empty unless the operator configured a content filter
       * (`fit_markdown` is computed only when one is present, and the default
       * generator has none; read from
       * `crawl4ai/markdown_generation_strategy.py` at tag v0.9.2 on
       * 2026-08-30). Preferring it when non-empty would make the imported page
       * depend on a piece of operator configuration this app cannot see and
       * cannot report: two operators on the same version would import the same
       * URL into different pages and neither could tell why. `raw_markdown` is
       * always populated and is generated from the service's cleaned HTML, so
       * it is the one deterministic choice.
       *
       * The cost, stated rather than hidden: the Firecrawl path asks for the
       * main content only and this has no equivalent, so a self-hosted import
       * carries more page chrome. That is visible in the preview and editable
       * in the page plan.
       */
      const markdown = result.markdown
      if (!isRecord(markdown) || typeof markdown.raw_markdown !== 'string') {
        throw new Error(MALFORMED)
      }

      /*
       * THE REDIRECT TRAP, AND THE REASON THIS IS NOT `result.status_code`.
       *
       * Read from `crawl4ai/async_crawler_strategy.py` at tag v0.9.2 on
       * 2026-08-30: the strategy walks `request.redirected_from` backwards and
       * assigns `status_code` from the EARLIEST response in the chain, while
       * `redirected_status_code` comes from the response the browser actually
       * ended on. So on any redirected article `status_code` is a `301`, and
       * `importWebArticle` — which refuses a non-2xx origin status — would
       * refuse every redirected page and blame the publisher.
       *
       * Preferring the post-redirect status is therefore not a nicety; it is
       * the difference between working and looking broken. The fallback covers
       * the pre-0.9 shape the handshake above already refuses, so it should be
       * unreachable, and is kept because "unreachable" is a claim about a
       * version check rather than about this line.
       */
      const statusCode = typeof result.redirected_status_code === 'number'
        ? result.redirected_status_code
        : result.status_code
      if (typeof statusCode !== 'number') throw new Error(MALFORMED)

      const finalHref = typeof result.redirected_url === 'string' ? result.redirected_url : url.href
      let finalUrl: URL
      try {
        finalUrl = new URL(finalHref)
      } catch {
        throw new Error(MALFORMED)
      }

      /*
       * `response_headers` belongs to the SAME earliest response as
       * `status_code` above, so on a redirected fetch its content type
       * describes the redirect and not the article — an HTML content type for
       * a `301` that landed on a PDF.
       *
       * (Spelled that way rather than with the media type's own slashed name:
       * `web-endpoints.test.ts` greps this file for the service's other routes
       * and does not care whether a match is code or a comment. The existing
       * test's comment records catching its own author the same way.)
       *
       * `importWebArticle` treats a present content type as AUTHORITATIVE and an
       * absent one as "unknown, fall through to the path check". Reporting a
       * header about the wrong resource would therefore be worse than reporting
       * nothing, so this reports it only when nothing was redirected. The
       * narrowing is deliberate and is stated in the documentation rather than
       * left to be discovered.
       */
      const headers = result.response_headers
      const contentType = finalUrl.href === url.href && isRecord(headers)
        && typeof headers['content-type'] === 'string'
        ? headers['content-type']
        : undefined

      const article: FetchedArticle = {
        markdown: markdown.raw_markdown,
        finalUrl,
        // Carried UP, never refused here: the non-2xx refusal belongs to
        // `importWebArticle` so that it is identical for every fetcher.
        statusCode,
        parser: 'self-hosted-extractor',
        ...(contentType !== undefined ? { contentType } : {}),
      }
      return article
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }
}
