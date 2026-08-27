/**
 * The one way this app talks to a Canvas instance.
 */

/**
 * What the user typed in "Canvas address", turned into a bare https origin.
 *
 * People type a hostname, because that is what an institution gives them, and
 * they paste a whole course url, because that is what is in the address bar when
 * they go looking. Both have to land on the same origin, or the same institution
 * reached two ways looks like two destinations.
 *
 * IT REJECTS HERE RATHER THAN AT THE RELAY. `worker/allowlist-hosts.ts` refuses
 * anything that is not https, and it refuses it with "https required" against a
 * url the user never typed — so an address entered as `http://` would fail one
 * screen later, in someone else's words, pointing at a component the user has no
 * idea exists. The field that took the address is where the address is judged.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'https') {
    throw new Error(`Canvas address must be https, not ${scheme}.`)
  }
  let url: URL
  try {
    url = new URL(scheme ? trimmed : `https://${trimmed}`)
  } catch {
    throw new Error(`"${raw}" is not a Canvas address. It looks like https://yourschool.instructure.com.`)
  }
  return url.origin
}

/**
 * The only methods this product is allowed to use.
 *
 * E7: "a single transport permitting GET/POST/PUT that THROWS on DELETE, with a
 * test asserting no recorded request ever used it." The relay refuses DELETE too
 * (`ALLOWED_METHODS` in `worker/relay.ts`), so this is the second of two locks
 * rather than the only one — but it is the one that fails in OUR words, at the
 * call site, before anything leaves the browser.
 *
 * Why a product that pushes pages needs a lock against deleting them: it is
 * running against a live course an instructor is teaching from, with content
 * this app did not create and cannot see. There is no version of "clean up
 * first" that is worth the run that cleans up the wrong thing.
 */
export type CanvasMethod = 'GET' | 'POST' | 'PUT'

export interface TransportDeps {
  fetch: typeof globalThis.fetch
  /** Origin, already through `normalizeBaseUrl`. */
  baseUrl: string
  token: string
  /**
   * `/relay` in production, absent in tests that inject their own `fetch`.
   *
   * Canvas is the one integration that CANNOT go direct, and it is not a matter
   * of degree: an `Authorization: Bearer` header forces a CORS preflight, and
   * Canvas answers `OPTIONS` with a 404 — measured against four institutional
   * instances. There is no fetch mode that avoids it, so every call here is a
   * relay call or it is nothing.
   *
   * The token travels as a HEADER through `?url=`, never as `?access_token=` in
   * the query string. The query-string form is a "simple request" that would skip
   * the preflight and actually work — and is banned, because the browser cannot
   * read the response so nothing can tell whether it worked, and the token lands
   * in Canvas's own access logs. See the PRD's rejected loophole.
   */
  relayUrl?: string
  /** Test seam. Production leaves it out and really waits. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Told how long this call is about to wait out a throttle.
   *
   * The runner passes this up so the screen can say "Canvas is rate-limiting.
   * Waiting 23 s, then continuing automatically." — but only when the wait is
   * long enough to be worth a sentence (§7). Short waits stay invisible on
   * purpose: an interface that narrates every 400 ms hiccup reads as broken.
   */
  onWait?: (ms: number, attempt: number) => void
}

/** Doubling from 1 s, so four throttles cost ~15 s rather than ~4 s. */
const BASE_BACKOFF_MS = 1000
const MAX_ATTEMPTS = 6

/**
 * Whether Canvas is telling us to slow down.
 *
 * E7 says "exponential backoff on 429", and 429 is NOT the status Canvas
 * actually sends. Its documented throttling response is **403** with a body of
 * `403 Forbidden (Rate Limit Exceeded)` and `X-Rate-Limit-Remaining: 0` — the
 * same status it uses for "your token cannot do that", which is why the header
 * and the body, not the status, are what distinguish them. Retrying every 403
 * would mean retrying six times against a token that will never be allowed to
 * write, and reporting a permissions problem as a slow network.
 *
 * 429 is honoured as well, because a proxy in front of an institutional Canvas
 * may well send one, and it costs nothing to accept.
 */
function isThrottled(res: Response, body: string): boolean {
  if (res.status === 429) return true
  if (res.status !== 403) return false
  return res.headers.get('x-rate-limit-remaining') === '0' || /rate limit exceeded/i.test(body)
}

export interface Transport {
  request(path: string, init?: { method?: CanvasMethod; body?: unknown }): Promise<Response>
  /**
   * The last `X-Request-Cost` Canvas reported, for the runner's own pacing.
   * `undefined` until a request has come back carrying one.
   */
  lastCost(): number | undefined
}

export function createTransport(deps: TransportDeps): Transport {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let cost: number | undefined

  return {
    lastCost: () => cost,

    async request(path, init = {}) {
      const method = init.method ?? 'GET'
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
        throw new Error(
          `Canvas transport refuses ${method}. This product only ever reads, creates and updates.`,
        )
      }
      const target = `${deps.baseUrl}${path}`
      const url = deps.relayUrl ? `${deps.relayUrl}?url=${encodeURIComponent(target)}` : target
      const headers: Record<string, string> = { authorization: `Bearer ${deps.token}` }
      // `content-type` is one of the four the relay forwards upstream, and
      // without it Canvas will not interpret the body at all.
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const request = {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      }

      for (let attempt = 0; ; attempt++) {
        const res = await deps.fetch(url, request)
        const reported = Number(res.headers.get('x-request-cost'))
        if (Number.isFinite(reported)) cost = reported

        if (res.status < 400) return res

        /*
         * The body is read to TELL a throttle from a permissions failure, which
         * means it cannot also be handed back unread. `res.clone()` is what buys
         * both, and it is cheap here: Canvas's error bodies are a line of text,
         * not the 168 KB page bodies this product reads on the way in.
         */
        const body = await res.clone().text()
        if (!isThrottled(res, body) || attempt >= MAX_ATTEMPTS - 1) return res

        const wait = BASE_BACKOFF_MS * 2 ** attempt
        deps.onWait?.(wait, attempt + 1)
        await sleep(wait)
      }
    },
  }
}
