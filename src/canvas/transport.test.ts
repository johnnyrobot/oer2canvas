import { createTransport, normalizeBaseUrl } from './transport'

test('accepts a bare host and makes it an https origin', () => {
  expect(normalizeBaseUrl('yourschool.instructure.com')).toBe('https://yourschool.instructure.com')
})

test('reduces a pasted course url to its origin', () => {
  expect(normalizeBaseUrl('https://yourschool.instructure.com/courses/17/pages')).toBe(
    'https://yourschool.instructure.com',
  )
})

test('refuses a plaintext http address rather than failing later at the relay', () => {
  expect(() => normalizeBaseUrl('http://yourschool.instructure.com')).toThrow(/https/i)
})

test('refuses an address that is not a host at all', () => {
  expect(() => normalizeBaseUrl('not a host')).toThrow(/address/i)
})

/** Records what was actually sent, so a test can assert a request never happened. */
function recordingFetch(reply: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = []
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    })
    return reply(url, init)
  }
  return Object.assign(fn as unknown as typeof globalThis.fetch, { calls })
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })

function transport(reply: (url: string, init?: RequestInit) => Response, extra = {}) {
  const fetch = recordingFetch(reply)
  return {
    fetch,
    t: createTransport({
      fetch,
      baseUrl: 'https://school.instructure.com',
      token: 'secret-token',
      ...extra,
    }),
  }
}

test('refuses DELETE, and sends nothing at all', async () => {
  const { fetch, t } = transport(() => ok({}))
  await expect(
    t.request('/api/v1/courses/1/pages/intro', { method: 'DELETE' as 'GET' }),
  ).rejects.toThrow(/DELETE/)
  expect(fetch.calls).toHaveLength(0)
})

test('sends Canvas requests through the relay, with the token in a header the relay forwards', async () => {
  const { fetch, t } = transport(() => ok({ id: 1 }), { relayUrl: '/relay' })
  await t.request('/api/v1/users/self')
  const call = fetch.calls[0]!
  expect(call.url).toBe(
    '/relay?url=' + encodeURIComponent('https://school.instructure.com/api/v1/users/self'),
  )
  expect(call.headers.get('authorization')).toBe('Bearer secret-token')
})

test('never puts the token in the url, where Canvas would log it', async () => {
  const { fetch, t } = transport(() => ok({ id: 1 }), { relayUrl: '/relay' })
  await t.request('/api/v1/users/self')
  expect(fetch.calls[0]!.url).not.toContain('secret-token')
})

test('sends a PUT body as json', async () => {
  const { fetch, t } = transport(() => ok({}), { relayUrl: '/relay' })
  await t.request('/api/v1/courses/1/pages/intro', {
    method: 'PUT',
    body: { wiki_page: { title: 'Intro', body: '<p>x</p>' } },
  })
  const call = fetch.calls[0]!
  expect(call.method).toBe('PUT')
  expect(call.headers.get('content-type')).toBe('application/json')
  expect(JSON.parse(call.body as string)).toEqual({ wiki_page: { title: 'Intro', body: '<p>x</p>' } })
})

/** A reply script: each call shifts the next response off the front. */
function scripted(...responses: Response[]) {
  const queue = [...responses]
  return () => queue.shift() ?? ok({})
}

const throttled = () =>
  new Response('403 Forbidden (Rate Limit Exceeded)', {
    status: 403,
    headers: { 'x-rate-limit-remaining': '0' },
  })

test('retries a rate-limited request after waiting, and returns the eventual success', async () => {
  const slept: number[] = []
  const { fetch, t } = transport(scripted(throttled(), ok({ id: 7 })), {
    relayUrl: '/relay',
    sleep: async (ms: number) => { slept.push(ms) },
  })
  const res = await t.request('/api/v1/users/self')
  expect(await res.json()).toEqual({ id: 7 })
  expect(fetch.calls).toHaveLength(2)
  expect(slept).toHaveLength(1)
})

test('backs off exponentially across repeated rate limits', async () => {
  const slept: number[] = []
  const { t } = transport(scripted(throttled(), throttled(), throttled(), ok({ id: 7 })), {
    relayUrl: '/relay',
    sleep: async (ms: number) => { slept.push(ms) },
  })
  await t.request('/api/v1/users/self')
  expect(slept).toEqual([...slept].sort((a, b) => a - b))
  expect(slept[slept.length - 1]!).toBeGreaterThan(slept[0]!)
})

test('does not retry a permissions 403, which carries no rate-limit signal', async () => {
  const slept: number[] = []
  const forbidden = new Response('user not authorized to perform that action', { status: 403 })
  const { fetch, t } = transport(scripted(forbidden, ok({ id: 7 })), {
    relayUrl: '/relay',
    sleep: async (ms: number) => { slept.push(ms) },
  })
  const res = await t.request('/api/v1/courses/1/pages/intro', { method: 'PUT', body: {} })
  expect(res.status).toBe(403)
  expect(fetch.calls).toHaveLength(1)
  expect(slept).toEqual([])
})

test('gives up rather than retrying a throttle forever', async () => {
  const slept: number[] = []
  const { fetch, t } = transport(() => throttled(), {
    relayUrl: '/relay',
    sleep: async (ms: number) => { slept.push(ms) },
  })
  const res = await t.request('/api/v1/users/self')
  expect(res.status).toBe(403)
  expect(fetch.calls.length).toBeLessThan(10)
  expect(slept.length).toBe(fetch.calls.length - 1)
})

test('reports the last X-Request-Cost Canvas charged', async () => {
  const { t } = transport(() => ok({ id: 1 }, { 'x-request-cost': '0.043' }), { relayUrl: '/relay' })
  expect(t.lastCost()).toBeUndefined()
  await t.request('/api/v1/users/self')
  expect(t.lastCost()).toBeCloseTo(0.043)
})
