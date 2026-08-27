import {
  isAllowedTarget,
  isPressbooksTarget,
  normalizeSelfHostedCanvasOrigin,
} from './allowlist-hosts'

/**
 * A byte-forwarding relay for hosts that serve no CORS headers.
 *
 * CONSTRAINTS (see the spec's "relay contract"):
 *  1. Forwards bytes. NEVER parses, inspects, or rewrites a response body.
 *     This is what keeps CPU under the free tier's 10ms per invocation.
 *  2. Writes nothing. No storage, and no logging of any header.
 *  3. Allowlists destination hosts so this cannot become an open proxy.
 *
 * Header hygiene follows from where this sits rather than from the contract: it
 * is SAME-ORIGIN with the app, so it forwards an explicit request-header
 * allowlist (never the app's cookies), strips `Set-Cookie` from what comes back,
 * and refuses any request carrying a foreign `Origin`. See each rule below.
 *
 * Deps are injected so tests run with no network.
 */
export interface RelayDeps {
  fetch: typeof globalThis.fetch
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT'])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECT_HOPS = 5

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-b2c-target',
  'access-control-max-age': '600',
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  // `/relay` shares the app origin, but its upstream bytes are not trusted
  // application markup. A sandboxed document has no script execution and no
  // access to this origin's DOM or IndexedDB, even when a caller navigates to
  // the URL instead of fetching it.
  'content-security-policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

/**
 * Request headers forwarded upstream. Everything else is dropped.
 *
 * An allowlist, not a denylist, because of where this relay sits: it is
 * SAME-ORIGIN with the app (`run_worker_first: ["/relay"]`), so a browser
 * `fetch('/relay?url=…')` uses the default `credentials: 'same-origin'` and
 * attaches the app's own cookies. Forwarding the incoming headers wholesale
 * hands those cookies to whatever host the `url` parameter names. A denylist
 * would have to keep pace with everything a browser or Cloudflare adds on the
 * way in (`cookie`, `referer`, `sec-fetch-*`, `cf-connecting-ip`, …); an
 * allowlist means a header only travels if someone decided it should.
 *
 * These four are the only incoming headers the app needs: `authorization` for the Canvas
 * bearer token, `content-type` so a POST/PUT body is interpreted, and
 * `accept`/`accept-language` so content negotiation still works. Pressbooks gets
 * one additional fixed, target-derived user agent below; it never comes from
 * the caller.
 */
const FORWARDED_REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language']
const PRESSBOOKS_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 oer2canvas/1.0'

/**
 * Response headers the relay refuses to hand back to the page.
 *
 * `Set-Cookie` is the one that matters. Copying it back lets any target set a
 * cookie on the app ORIGIN — the origin that owns browser-local workflow state —
 * via nothing more than `/relay?url=https://attacker.example/api/v1/x`.
 */
const STRIPPED_RESPONSE_HEADERS = ['set-cookie', 'set-cookie2']
const RELAY_RESPONSE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'content-disposition': 'attachment; filename="relay-response"',
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface RelayEnv {
  RELAY_LIMITER?: RateLimiter
  /** Explicit authority mode. Public mode overrides even a stale Canvas binding. */
  DEPLOYMENT_MODE?: 'public-cartridge-only' | 'self-hosted-canvas'
  /** Exact HTTPS origin of the paired, operator-administered Canvas instance. */
  SELF_HOSTED_CANVAS_ORIGIN?: string
  fetch?: typeof globalThis.fetch
}

function forwardableHeaders(source: Headers): Headers {
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(name)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

function publisherHeaders(source: Headers, target: URL): Headers {
  const headers = forwardableHeaders(source)
  // UCF's Pressbooks CloudFront distribution rejects the Workers runtime's
  // default user agent. This fixed value is target-derived, never copied from
  // the browser, and applies only to the enumerated Pressbooks networks.
  if (isPressbooksTarget(target)) headers.set('user-agent', PRESSBOOKS_USER_AGENT)
  return headers
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const name of STRIPPED_RESPONSE_HEADERS) headers.delete(name)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v)
  for (const [k, v] of Object.entries(RELAY_RESPONSE_HEADERS)) headers.set(k, v)
  // Body is passed through untouched — never read, never buffered.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function fail(status: number, reason: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      ...RELAY_RESPONSE_HEADERS,
      ...extraHeaders,
    },
  })
}

/**
 * The relay's answer to a transport failure — DNS, TLS, connection reset: a
 * typo'd institutional Canvas host, or a publisher outage.
 *
 * Every `upstreamFetch` call is wrapped in this, because an unhandled rejection
 * escapes the worker entirely and Cloudflare answers with its own Error 1101
 * page, which carries NO CORS HEADERS. The browser then reports an opaque
 * "blocked by CORS policy" that points the user at the relay's configuration
 * instead of at the host that is down. `fail()` carries the CORS headers, so the
 * page gets a readable 502 and can say what actually happened.
 */
function unreachable(): Response {
  return fail(502, 'upstream unreachable')
}

/**
 * Follows a chain of GET redirects by hand instead of `redirect: 'follow'`.
 * The built-in follow would chase a `Location` header to ANY host, including
 * one outside the allowlist — exactly the open-proxy hole relay rule 3
 * exists to close. So each hop's target is re-validated with
 * `isAllowedTarget` before it is fetched, at most `MAX_REDIRECT_HOPS` times.
 *
 * `Authorization` is dropped whenever a hop crosses to a different origin —
 * the same guard a browser applies — so a Canvas bearer token can never leak
 * to another host via a redirect. Only status and headers are read to make
 * this decision; the body is never touched.
 */
async function followGetRedirects(
  upstreamFetch: typeof globalThis.fetch,
  initialRequest: Request,
  initialUrl: URL,
  selfHostedCanvasOrigin?: string,
): Promise<Response> {
  let currentRequest = initialRequest
  let currentUrl = initialUrl
  let hops = 0

  for (;;) {
    let res: Response
    try {
      res = await upstreamFetch(currentRequest)
    } catch {
      return unreachable()
    }
    if (!REDIRECT_STATUSES.has(res.status)) return withCors(res)

    const location = res.headers.get('location')
    if (!location) return withCors(res) // redirect status but no target — not really a redirect

    hops++
    if (hops > MAX_REDIRECT_HOPS) return fail(502, 'too many redirects')

    let nextUrl: URL
    try {
      // Location may be relative — resolve it against the URL just requested,
      // not the relay's own URL.
      nextUrl = new URL(location, currentUrl)
    } catch {
      return fail(502, 'invalid redirect location')
    }

    const check = isAllowedTarget(nextUrl.toString(), selfHostedCanvasOrigin)
    if (!check.ok) return fail(403, check.reason)

    const headers = new Headers(currentRequest.headers)
    if (check.url.origin !== currentUrl.origin) headers.delete('authorization')
    if (isPressbooksTarget(check.url)) headers.set('user-agent', PRESSBOOKS_USER_AGENT)
    else headers.delete('user-agent')

    currentRequest = new Request(check.url.toString(), {
      method: 'GET',
      headers,
      redirect: 'manual',
    })
    currentUrl = check.url
  }
}

export default {
  // The second parameter is intentionally typed `unknown`, not defaulted.
  // The Workers runtime always calls `fetch(request, env, ctx)` — it passes
  // `env` as the second argument on every invocation — so a default
  // parameter (`deps = { fetch: globalThis.fetch }`) would never kick in in
  // production, and `deps.fetch` would be undefined there, throwing on every
  // request. Resolve it defensively instead: fall back to the global fetch
  // whenever the injected one isn't present. Do not "simplify" this back to
  // a default parameter.
  async fetch(request: Request, deps?: unknown): Promise<Response> {
    // Wrapped, not handed over bare, so the receiver of the call is the global
    // and not this module's local binding. A bare detached call (`const f =
    // fetch; f(url)`) is fine everywhere — WebIDL substitutes the global for a
    // null/undefined receiver — but a call through a property of a plain object
    // is not: browsers reject it with `TypeError: Illegal invocation`, delivered
    // as a rejected promise. The app's own client (`createDefaultOpenStaxClient`)
    // is wrapped for that reason; these two call sites should not differ in a way
    // that reads as accidental.
    const env = deps as RelayEnv | undefined
    const selfHostedCanvasOrigin = env?.DEPLOYMENT_MODE === 'self-hosted-canvas'
      ? normalizeSelfHostedCanvasOrigin(env.SELF_HOSTED_CANVAS_ORIGIN)
      : undefined
    const upstreamFetch: typeof globalThis.fetch =
      env?.fetch ?? ((...args) => globalThis.fetch(...args))
    const injectedFetch = typeof env?.fetch === 'function'

    // Same-origin only. A browser attaches `Origin` to every cross-origin fetch
    // and to every preflight; a same-origin request either omits it or sends
    // this relay's own origin; a non-browser client (curl, a server) sends none.
    // So rejecting a MISMATCHED origin — rather than requiring one — turns away
    // browser-driven abuse of the account-wide 100,000 requests/day free-tier
    // budget without breaking any legitimate caller. It is deliberately not an
    // authentication check: `Origin` is trivially forged outside a browser, and
    // it is the host allowlist, not this, that stops the relay being a general
    // proxy. Checked before anything else, including OPTIONS, so a foreign
    // origin cannot even get a preflight answered.
    const origin = request.headers.get('origin')
    if (origin !== null && origin !== new URL(request.url).origin) {
      return fail(403, 'cross-origin request not allowed')
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, ...SECURITY_HEADERS, ...RELAY_RESPONSE_HEADERS },
      })
    }

    const requestUrl = new URL(request.url)

    if (requestUrl.pathname === '/healthz' && request.method === 'GET') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'oer2canvas-relay',
        canvasPushEnabled: selfHostedCanvasOrigin !== undefined,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          ...SECURITY_HEADERS,
          ...RELAY_RESPONSE_HEADERS,
        },
      })
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return fail(405, 'method not allowed')
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return fail(400, 'missing url parameter')

    const check = isAllowedTarget(target, selfHostedCanvasOrigin)
    if (!check.ok) return fail(403, check.reason)

    // Publisher adapters are read-only and credential-free. Canvas bearer
    // tokens and write methods exist only behind the exact configured Canvas
    // origin above, never merely behind a path that resembles `/api/v1/`.
    if (check.kind === 'publisher' && request.method !== 'GET') {
      return fail(405, 'method not allowed for publisher')
    }
    if (check.kind === 'publisher' && request.headers.has('authorization')) {
      return fail(403, 'credentials not allowed for publisher')
    }

    // Production must carry the binding declared in wrangler.jsonc. This is the
    // relay/upstream abuse boundary; the zone WAF rule runs earlier and protects
    // the Worker invocation quota. The injected fetch path is the unit-test seam
    // and deliberately runs without a Cloudflare binding. Failing closed for a
    // real Worker environment keeps a future deployment from silently reverting
    // to an unbounded public relay.
    const limiter = env?.RELAY_LIMITER
    if (limiter === undefined && !injectedFetch) {
      return fail(503, 'rate limit unavailable')
    }
    if (limiter !== undefined) {
      const clientKey = request.headers.get('cf-connecting-ip') ?? 'anonymous'
      try {
        const result = await limiter.limit({ key: `relay:${clientKey}` })
        if (!result.success) return fail(429, 'rate limit exceeded', { 'retry-after': '60' })
      } catch {
        return fail(503, 'rate limit unavailable')
      }
    }

    const upstream = new Request(check.url.toString(), {
      method: request.method,
      headers: publisherHeaders(request.headers, check.url),
      body: request.method === 'GET' ? undefined : request.body,
      redirect: 'manual',
      // `duplex: 'half'` declares "the request body is a stream and the response
      // will not start before it is finished". undici/Node REQUIRES it whenever
      // `body` is a stream and throws `RequestInit: duplex option is required
      // when sending a body` without it — which is what the relay's own POST
      // test hits, since the body arrives as `request.body`, a stream. workerd
      // accepts it and forwards the bytes unchanged (verified 2026-08-21 under
      // `wrangler dev`: the constructed request's body read back as the exact
      // POSTed bytes). So it is required in one runtime, harmless in the other,
      // and belongs here rather than in the test.
      duplex: 'half',
    } as RequestInit)

    if (request.method === 'GET') {
      return followGetRedirects(
        upstreamFetch,
        upstream,
        check.url,
        selfHostedCanvasOrigin,
      )
    }

    // POST/PUT: never follow a redirect — replaying a body across hops is
    // not something a byte-forwarding relay should attempt, and the Canvas
    // API does not redirect writes. Hand the redirect response straight back.
    try {
      return withCors(await upstreamFetch(upstream))
    } catch {
      return unreachable()
    }
  },
}
