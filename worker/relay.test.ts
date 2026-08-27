import worker from './relay'

const CANVAS_ORIGIN = 'https://canvas.ubc.ca'
const SELF_HOSTED_MODE = {
  DEPLOYMENT_MODE: 'self-hosted-canvas' as const,
  SELF_HOSTED_CANVAS_ORIGIN: CANVAS_ORIGIN,
}

function req(target: string, init: RequestInit = {}) {
  return new Request(`https://relay.example/relay?url=${encodeURIComponent(target)}`, init)
}

test('forwards an allowed GET and returns the upstream body', async () => {
  const fetchMock = vi.fn(async () => new Response('hello', { status: 200 }))
  const res = await worker.fetch(req('https://openstax.org/rex/release.json'), { fetch: fetchMock })
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('hello')
  expect(fetchMock).toHaveBeenCalledOnce()
})

test('makes an upstream HTML response inert and non-cacheable on the app origin', async () => {
  const html = '<!doctype html><script>parent.postMessage("executed", "*")</script>'
  const res = await worker.fetch(req('https://openstax.org/rex/release.json'), {
    fetch: async () => new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  })

  expect(res.headers.get('content-type')).toContain('text/html')
  expect(res.headers.get('content-security-policy')).toContain('sandbox')
  expect(res.headers.get('content-disposition')).toBe('attachment; filename="relay-response"')
  expect(res.headers.get('cache-control')).toBe('no-store')
  // The body remains byte-for-byte available to fetch callers; only a browser
  // document is forced into the inert delivery mode above.
  expect(await res.text()).toBe(html)
})

test('forwards the Authorization header upstream', async () => {
  let seen: Headers | undefined
  const fetchMock = vi.fn(async (r: Request) => { seen = r.headers; return new Response('{}') })
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { headers: { Authorization: 'Bearer secret' } }),
    { fetch: fetchMock, ...SELF_HOSTED_MODE },
  )
  expect(seen?.get('Authorization')).toBe('Bearer secret')
})

test('never logs', async () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { headers: { Authorization: 'Bearer secret' } }),
    { fetch: async () => new Response('{}'), ...SELF_HOSTED_MODE },
  )
  expect(spy).not.toHaveBeenCalled()
  expect(errSpy).not.toHaveBeenCalled()
  spy.mockRestore(); errSpy.mockRestore()
})

/**
 * Relay rule 1 — "forwards bytes, never parses a response body" — is what keeps
 * CPU under the free tier's 10ms, so the test has to be able to SEE a violation.
 * Spying on `.text()` alone could not: a regression reaching for `.json()`,
 * `.arrayBuffer()`, `.blob()` or `.formData()` would pass unnoticed. Every
 * body-consuming method is watched, and `bodyUsed` is checked afterwards as the
 * backstop that catches a consumer none of these spies knows about.
 */
test('never reads the upstream body — by any of the five ways of reading one', async () => {
  const upstream = new Response('payload')
  const spies = (['text', 'json', 'arrayBuffer', 'blob', 'formData'] as const).map(
    (method) => [method, vi.spyOn(upstream, method)] as const,
  )

  const res = await worker.fetch(req('https://openstax.org/x'), { fetch: async () => upstream })

  for (const [method, spy] of spies) {
    expect(spy, `upstream.${method}() was called`).not.toHaveBeenCalled()
  }
  expect(upstream.bodyUsed).toBe(false)
  // And the bytes still reach the caller, unread by the relay itself.
  expect(await res.text()).toBe('payload')
})

test('rejects a disallowed target with 403', async () => {
  const res = await worker.fetch(req('https://evil.example/secret'), { fetch: async () => new Response('x') })
  expect(res.status).toBe(403)
})

test('rejects Canvas-shaped traffic by default without reaching upstream', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', {
      headers: { authorization: 'Bearer secret' },
    }),
    { fetch: fetchMock },
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'canvas access disabled' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('explicit public mode overrides a stale Canvas-origin binding', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses'),
    {
      fetch: fetchMock,
      DEPLOYMENT_MODE: 'public-cartridge-only',
      SELF_HOSTED_CANVAS_ORIGIN: CANVAS_ORIGIN,
    },
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'canvas access disabled' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('an opted-in relay accepts only its exact pinned Canvas origin', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const res = await worker.fetch(
    req('https://canvas.other.edu/api/v1/courses'),
    { fetch: fetchMock, ...SELF_HOSTED_MODE },
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'canvas origin not allowed' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('publisher targets reject credentials and write methods', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const credentialed = await worker.fetch(
    req('https://openstax.org/rex/release.json', {
      headers: { authorization: 'Bearer must-not-travel' },
    }),
    { fetch: fetchMock },
  )
  const write = await worker.fetch(
    req('https://openstax.org/rex/release.json', { method: 'POST', body: '{}' }),
    { fetch: fetchMock },
  )
  expect(credentialed.status).toBe(403)
  expect(write.status).toBe(405)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('publisher targets reject credentials embedded in the target URL', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const credentialQueries = [
    'access_token=publisher-secret',
    'oauth_token=publisher-secret',
    'refresh_token=publisher-secret',
    'bearer_token=publisher-secret',
    'subscription_key=publisher-secret',
    'access_token[]=publisher-secret',
    'X-Amz-Signature=publisher-secret',
  ]
  for (const query of credentialQueries) {
    const response = await worker.fetch(
      req(`https://openstax.org/rex/release.json?${query}`),
      { fetch: fetchMock },
    )
    expect(response.status, query).toBe(403)
  }
  const userInfo = await worker.fetch(
    req('https://publisher-secret@openstax.org/rex/release.json'),
    { fetch: fetchMock },
  )
  expect(userInfo.status).toBe(403)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a missing url param with 400', async () => {
  const res = await worker.fetch(new Request('https://relay.example/relay'), { fetch: async () => new Response('x') })
  expect(res.status).toBe(400)
})

test('serves a cache-free health check without touching upstream', async () => {
  const fetchMock = vi.fn(async () => new Response('unexpected'))
  const res = await worker.fetch(new Request('https://relay.example/healthz'), { fetch: fetchMock })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    ok: true,
    service: 'oer2canvas-relay',
    canvasPushEnabled: false,
  })
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive, nosnippet, noimageindex')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('health reports Canvas push only for a valid explicit self-host configuration', async () => {
  const res = await worker.fetch(
    new Request('https://relay.example/healthz'),
    { fetch: async () => new Response('unexpected'), ...SELF_HOSTED_MODE },
  )
  expect((await res.json()).canvasPushEnabled).toBe(true)
})

test('marks successful and rejected relay responses as non-indexable', async () => {
  const successful = await worker.fetch(
    req('https://openstax.org/rex/release.json'),
    { fetch: async () => new Response('{}') },
  )
  const rejected = await worker.fetch(
    req('https://example.com/'),
    { fetch: async () => new Response('unexpected') },
  )

  for (const response of [successful, rejected]) {
    expect(response.headers.get('x-robots-tag')).toBe(
      'noindex, nofollow, noarchive, nosnippet, noimageindex',
    )
  }
})

test('rejects DELETE with 405', async () => {
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses/1/pages/x', { method: 'DELETE' }),
    { fetch: async () => new Response('x') },
  )
  expect(res.status).toBe(405)
})

test('answers a CORS preflight', async () => {
  const res = await worker.fetch(
    new Request('https://relay.example/relay?url=x', { method: 'OPTIONS' }),
    { fetch: async () => new Response('x') },
  )
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-headers')).toContain('authorization')
})

// --- Amendment 2 (Ruling P): manual redirect handling ---------------------

test('follows a GET redirect to an allowed target and returns the final body', async () => {
  let calls = 0
  const fetchMock = vi.fn(async () => {
    calls++
    if (calls === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://openstax.org/rex/target2.json' },
      })
    }
    return new Response('final body', { status: 200 })
  })
  const res = await worker.fetch(req('https://openstax.org/rex/target1.json'), { fetch: fetchMock })
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('final body')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('a GET redirect to a disallowed target returns 403 and does not issue the second fetch', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
  )
  const res = await worker.fetch(req('https://openstax.org/rex/target1.json'), { fetch: fetchMock })
  expect(res.status).toBe(403)
  expect(fetchMock).toHaveBeenCalledOnce()
})

test('a GET redirect cannot add publisher credentials in the target URL', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://openstax.org/rex/target.json?refresh_token=secret' },
    }),
  )
  const res = await worker.fetch(req('https://openstax.org/rex/start.json'), { fetch: fetchMock })
  expect(res.status).toBe(403)
  expect(fetchMock).toHaveBeenCalledOnce()
})

test('drops Authorization when a Canvas redirect crosses to a publisher origin', async () => {
  let secondRequestAuth: string | null = 'unset'
  let calls = 0
  const fetchMock = vi.fn(async (r: Request) => {
    calls++
    if (calls === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://assets.openstax.org/b' },
      })
    }
    secondRequestAuth = r.headers.get('Authorization')
    return new Response('ok', { status: 200 })
  })
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/a', { headers: { Authorization: 'Bearer secret' } }),
    { fetch: fetchMock, ...SELF_HOSTED_MODE },
  )
  expect(secondRequestAuth).toBeNull()
})

test('preserves Authorization when a redirect stays on the pinned Canvas origin', async () => {
  let secondRequestAuth: string | null = 'unset'
  let calls = 0
  const fetchMock = vi.fn(async (r: Request) => {
    calls++
    if (calls === 1) {
      return new Response(null, { status: 302, headers: { location: 'https://canvas.ubc.ca/api/v1/b' } })
    }
    secondRequestAuth = r.headers.get('Authorization')
    return new Response('ok', { status: 200 })
  })
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/a', { headers: { Authorization: 'Bearer secret' } }),
    { fetch: fetchMock, ...SELF_HOSTED_MODE },
  )
  expect(secondRequestAuth).toBe('Bearer secret')
})

test('a redirect chain longer than 5 hops returns 502', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://canvas.ubc.ca/api/v1/next' },
    }),
  )
  const res = await worker.fetch(req('https://canvas.ubc.ca/api/v1/start'), {
    fetch: fetchMock,
    ...SELF_HOSTED_MODE,
  })
  expect(res.status).toBe(502)
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

test('a POST receiving a 302 returns that 302 to the caller rather than following it', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://canvas.ubc.ca/api/v1/elsewhere' },
    }),
  )
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { method: 'POST' }),
    { fetch: fetchMock, ...SELF_HOSTED_MODE },
  )
  expect(res.status).toBe(302)
  expect(fetchMock).toHaveBeenCalledOnce()
})

test('a relative Location resolves against the target origin, not the relay origin', async () => {
  const seenUrls: string[] = []
  const fetchMock = vi.fn(async (r: Request) => {
    seenUrls.push(r.url)
    if (seenUrls.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/other/path' } })
    }
    return new Response('final', { status: 200 })
  })
  const res = await worker.fetch(req('https://openstax.org/foo/bar'), { fetch: fetchMock })
  expect(res.status).toBe(200)
  expect(seenUrls[1]).toBe('https://openstax.org/other/path')
})

// --- Transport failures ---------------------------------------------------
//
// An unhandled rejection out of the worker means Cloudflare's own Error 1101
// page, which carries NO CORS headers — so the browser reports "blocked by CORS
// policy" for what is really a host that does not resolve.

test('a GET whose upstream is unreachable returns a CORS-bearing 502', async () => {
  const res = await worker.fetch(req('https://openstax.org/x'), {
    fetch: async () => {
      throw new TypeError('fetch failed')
    },
  })
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'upstream unreachable' })
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
})

test('a POST whose upstream is unreachable returns a CORS-bearing 502', async () => {
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses/1/pages', { method: 'POST', body: '{}' }),
    {
      ...SELF_HOSTED_MODE,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    },
  )
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'upstream unreachable' })
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
})

test('a redirect hop whose upstream is unreachable returns 502, not a throw', async () => {
  let calls = 0
  const res = await worker.fetch(req('https://openstax.org/a'), {
    fetch: async () => {
      calls++
      if (calls === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://openstax.org/b' } })
      }
      throw new TypeError('fetch failed')
    },
  })
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'upstream unreachable' })
})

// --- Header hygiene -------------------------------------------------------

test('forwards only the four allowlisted request headers, and never a cookie', async () => {
  let seen: Headers | undefined
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', {
      headers: {
        // The relay is same-origin with the app, so a default-credentials
        // browser fetch attaches the app's OWN cookies to this request.
        cookie: 'b2c_session=secret',
        referer: 'https://book2canvas.example/private/path',
        'x-forwarded-for': '203.0.113.7',
        authorization: 'Bearer token',
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-language': 'en-CA',
      },
    }),
    {
      fetch: async (r: Request) => { seen = r.headers; return new Response('{}') },
      ...SELF_HOSTED_MODE,
    },
  )
  expect(seen?.get('authorization')).toBe('Bearer token')
  expect(seen?.get('content-type')).toBe('application/json')
  expect(seen?.get('accept')).toBe('application/json')
  expect(seen?.get('accept-language')).toBe('en-CA')
  expect(seen?.get('cookie')).toBeNull()
  expect(seen?.get('referer')).toBeNull()
  expect(seen?.get('x-forwarded-for')).toBeNull()
})

test('uses a fixed compatible user agent only for Pressbooks targets', async () => {
  const seen: { pressbooks?: string | null; canvas?: string | null } = {}
  await worker.fetch(req('https://pressbooks.online.ucf.edu/book/wp-json/pressbooks/v2/toc', {
    headers: { 'user-agent': 'attacker-controlled' },
  }), { fetch: async (request: Request) => { seen.pressbooks = request.headers.get('user-agent'); return new Response('{}') } })
  await worker.fetch(req('https://canvas.ubc.ca/api/v1/courses', {
    headers: { 'user-agent': 'attacker-controlled' },
  }), {
    fetch: async (request: Request) => { seen.canvas = request.headers.get('user-agent'); return new Response('{}') },
    ...SELF_HOSTED_MODE,
  })
  expect(seen.pressbooks).toContain('oer2canvas/1.0')
  expect(seen.pressbooks).not.toContain('attacker-controlled')
  expect(seen.canvas).toBeNull()
})

test('strips Set-Cookie from the upstream response', async () => {
  // Otherwise `/relay?url=https://attacker.example/api/v1/x` sets a cookie on
  // the app origin, where browser-local workflow state lives.
  const res = await worker.fetch(req('https://canvas.ubc.ca/api/v1/courses'), {
    ...SELF_HOSTED_MODE,
    fetch: async () =>
      new Response('{}', {
        headers: { 'set-cookie': 'evil=1; Path=/', 'x-kept': 'yes' },
      }),
  })
  expect(res.headers.get('set-cookie')).toBeNull()
  expect(res.headers.get('x-kept')).toBe('yes')
})

test('rejects a request carrying a foreign Origin', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { headers: { origin: 'https://evil.example' } }),
    { fetch: fetchMock },
  )
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: 'cross-origin request not allowed' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('rate-limits a direct client before it can reach upstream', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const limiter = { limit: vi.fn(async () => ({ success: false })) }
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { headers: { 'cf-connecting-ip': '203.0.113.10' } }),
    { fetch: fetchMock, RELAY_LIMITER: limiter, ...SELF_HOSTED_MODE },
  )

  expect(res.status).toBe(429)
  expect(await res.json()).toEqual({ error: 'rate limit exceeded' })
  expect(res.headers.get('retry-after')).toBe('60')
  expect(limiter.limit).toHaveBeenCalledWith({ key: 'relay:203.0.113.10' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('allows a legitimate request when the limiter approves it', async () => {
  const limiter = { limit: vi.fn(async () => ({ success: true })) }
  const res = await worker.fetch(
    req('https://openstax.org/rex/release.json', { headers: { 'cf-connecting-ip': '203.0.113.11' } }),
    { fetch: async () => new Response('{}'), RELAY_LIMITER: limiter },
  )
  expect(res.status).toBe(200)
  expect(limiter.limit).toHaveBeenCalledOnce()
})

test('fails closed when a deployed environment has no rate-limit binding', async () => {
  const fetchMock = vi.fn(async () => new Response('{}'))
  const res = await worker.fetch(req('https://openstax.org/rex/release.json'), {
    SOME_OTHER_BINDING: 'present',
  })
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'rate limit unavailable' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('rejects a foreign-Origin preflight before answering it', async () => {
  const res = await worker.fetch(
    new Request('https://relay.example/relay?url=x', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    }),
    { fetch: async () => new Response('x') },
  )
  expect(res.status).toBe(403)
})

test("accepts a request carrying the relay's own Origin", async () => {
  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses', { headers: { origin: 'https://relay.example' } }),
    {
      fetch: async () => new Response('ok', { status: 200 }),
      ...SELF_HOSTED_MODE,
    },
  )
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('ok')
})

// --- Body forwarding ------------------------------------------------------
//
// This is the path every Canvas page body will take in slice 7, and it had no
// coverage at all. It also pins the `duplex: 'half'` in the upstream
// `RequestInit`: without it this test cannot even run, because undici throws
// `RequestInit: duplex option is required when sending a body` when `body` is a
// stream — which `request.body` always is.

test('forwards a POST body upstream byte for byte', async () => {
  let receivedBody: string | undefined
  let receivedType: string | null = null
  const payload = JSON.stringify({ title: 'Chapter 1', body: '<p>hello</p>' })

  const res = await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses/1/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: payload,
    }),
    {
      ...SELF_HOSTED_MODE,
      fetch: async (r: Request) => {
        receivedType = r.headers.get('content-type')
        receivedBody = await r.text()
        return new Response('{"ok":true}', { status: 201 })
      },
    },
  )

  expect(receivedBody).toBe(payload)
  expect(receivedType).toBe('application/json')
  expect(res.status).toBe(201)
  expect(await res.text()).toBe('{"ok":true}')
})

test('forwards a PUT body upstream byte for byte', async () => {
  let receivedBody: string | undefined
  await worker.fetch(
    req('https://canvas.ubc.ca/api/v1/courses/1/pages/intro', {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body: '<p>updated</p>',
    }),
    {
      ...SELF_HOSTED_MODE,
      fetch: async (r: Request) => {
        receivedBody = await r.text()
        return new Response(null, { status: 204 })
      },
    },
  )
  expect(receivedBody).toBe('<p>updated</p>')
})

test('sends no body upstream for a GET', async () => {
  let hadBody: boolean | undefined
  await worker.fetch(req('https://openstax.org/x'), {
    fetch: async (r: Request) => { hadBody = r.body !== null; return new Response('ok') },
  })
  expect(hadBody).toBe(false)
})

// --- Amendment 1 (Ruling C): defensive resolution of the injected fetch ---

test('the deployed call shape (env instead of deps) still performs the request', async () => {
  const globalFetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
  vi.stubGlobal('fetch', globalFetchMock)
  try {
    const someEnvObjectWithNoFetchProperty = { SOME_BINDING: 'value' }
    const res = await worker.fetch(req('https://openstax.org/x'), {
      ...someEnvObjectWithNoFetchProperty,
      RELAY_LIMITER: { limit: async () => ({ success: true }) },
    })
    expect(res.status).toBe(200)
    expect(globalFetchMock).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})
