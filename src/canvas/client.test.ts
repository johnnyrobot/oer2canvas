import { createCanvasClient } from './client'
import { createTransport } from './transport'

function client(reply: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string }[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, method: init?.method ?? 'GET' })
    return reply(url, init)
  }) as unknown as typeof globalThis.fetch
  const transport = createTransport({
    fetch,
    baseUrl: 'https://school.instructure.com',
    token: 'secret-token',
    sleep: async () => {},
  })
  return { calls, c: createCanvasClient(transport) }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

test('verifying a connection names who the token belongs to', async () => {
  const { c } = client(() => json({ id: 1, name: 'Ada Lovelace' }))
  expect(await c.verify()).toEqual({ id: 1, name: 'Ada Lovelace' })
})

test('a rejected token is reported as a token problem, not an address problem', async () => {
  const { c } = client(() => new Response('user authorisation required', { status: 401 }))
  await expect(c.verify()).rejects.toMatchObject({ kind: 'token' })
})

test('an unreachable host is reported as an address problem, not a token problem', async () => {
  const { c } = client(() =>
    new Response(JSON.stringify({ error: 'upstream unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(c.verify()).rejects.toMatchObject({ kind: 'address' })
})

const course = (id: number, name: string, type: string, term = 'Fall 2026') => ({
  id,
  name,
  enrollments: [{ type }],
  term: { name: term },
})

test('offers only the courses the token could actually add a page to', async () => {
  const { c } = client(() =>
    json([
      course(1, 'Intro Algebra', 'teacher'),
      course(2, 'Astronomy 101', 'student'),
      course(3, 'Biology 101', 'ta'),
      course(4, 'Design Studio', 'designer'),
    ]),
  )
  expect((await c.listCourses()).map((x) => x.name)).toEqual([
    'Intro Algebra',
    'Biology 101',
    'Design Studio',
  ])
})

test('carries the term through, because two courses share a name across years', async () => {
  const { c } = client(() => json([course(1, 'Intro Algebra', 'teacher', 'Spring 2027')]))
  expect((await c.listCourses())[0]).toEqual({ id: 1, name: 'Intro Algebra', term: 'Spring 2027' })
})

test('follows Canvas pagination rather than stopping at the first page', async () => {
  const { calls, c } = client((url) =>
    url.includes('page=2')
      ? json([course(2, 'Biology 101', 'teacher')])
      : json([course(1, 'Intro Algebra', 'teacher')], {
          headers: {
            link: '<https://school.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next"',
          },
        }),
  )
  expect((await c.listCourses()).map((x) => x.name)).toEqual(['Intro Algebra', 'Biology 101'])
  expect(calls).toHaveLength(2)
})

test('lists the pages already in a course, with what §2.4 shows for each', async () => {
  const { calls, c } = client(() =>
    json([
      { title: 'Syllabus', url: 'syllabus', updated_at: '2026-08-12T09:00:00Z' },
      { title: 'Lab safety', url: 'lab-safety', updated_at: '2026-08-03T14:30:00Z' },
    ]),
  )
  expect(await c.listPages(17)).toEqual([
    { title: 'Syllabus', url: 'syllabus', updatedAt: '2026-08-12T09:00:00Z' },
    { title: 'Lab safety', url: 'lab-safety', updatedAt: '2026-08-03T14:30:00Z' },
  ])
  expect(calls[0]!.url).toContain('/api/v1/courses/17/pages')
})

/*
  MEASURED on a live Canvas: `PUT /pages/:url` does NOT create at `:url`, and
  `wiki_page[url]` is ignored. A page can only be created by letting Canvas name
  it, so creating is a POST and the url comes back in the reply.
*/
test('creating a page POSTs, because Canvas names the page itself', async () => {
  const bodies: unknown[] = []
  const { calls, c } = client((_url, init) => {
    bodies.push(JSON.parse(init!.body as string))
    return json({ url: '1-dot-4-polynomials', title: '1.4 Polynomials' })
  })
  const stored = await c.upsertPage(17, { title: '1.4 Polynomials', body: '<p>hello</p>' })

  expect(calls[0]!.method).toBe('POST')
  expect(calls[0]!.url).toContain('/api/v1/courses/17/pages')
  expect(bodies[0]).toEqual({
    wiki_page: { title: '1.4 Polynomials', body: '<p>hello</p>', published: true },
  })
  // The url Canvas chose, reported back — we did not pick it and cannot.
  expect(stored.url).toBe('1-dot-4-polynomials')
})

// The only shape of request that updates rather than duplicating.
test('updating aims at the url Canvas already has, never at a slug of our own', async () => {
  const { calls, c } = client(() => json({ url: '1-dot-4-polynomials', title: '1.4 Polynomials' }))
  await c.upsertPage(17, {
    title: '1.4 Polynomials',
    body: '<p>hello</p>',
    existingUrl: '1-dot-4-polynomials',
  })
  expect(calls[0]!.method).toBe('PUT')
  expect(calls[0]!.url).toContain('/api/v1/courses/17/pages/1-dot-4-polynomials')
})

test('publishes the page, because an unpublished one reads as a failed run', async () => {
  const bodies: { wiki_page: { published: boolean } }[] = []
  const { c } = client((_url, init) => {
    bodies.push(JSON.parse(init!.body as string))
    return json({ url: 'x', title: 'x' })
  })
  await c.upsertPage(1, { title: 'x', body: '<p/>' })
  expect(bodies[0]!.wiki_page.published).toBe(true)
})

/*
  MEASURED 2026-08-24 driving the app through `wrangler dev`: a POST from the
  browser came back 403 `{"error":"cross-origin request not allowed"}` — from the
  RELAY, not from Canvas — and this client reported it as "That token is not
  allowed to do this in this course." Which sent the reader to check Canvas
  permissions for a token that was fine, about a course that was fine.

  The relay answers its own refusals with a singular `error` string; Canvas uses
  a plural `errors` array. That is the discriminator.
*/
test('a relay refusal is reported against the relay, not as a Canvas permission problem', async () => {
  const { c } = client(() =>
    new Response(JSON.stringify({ error: 'cross-origin request not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(c.listPages(1)).rejects.toMatchObject({ kind: 'relay' })
  await expect(c.listPages(1)).rejects.toThrow(/cross-origin request not allowed/)
})

test('a genuine Canvas permission refusal is still reported as one', async () => {
  const { c } = client(() =>
    new Response(JSON.stringify({ errors: [{ message: 'user not authorized' }] }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(c.listPages(1)).rejects.toMatchObject({ kind: 'permission' })
})

// The relay's own vocabulary for a host it will not forward to. Reported as a
// relay problem too: no token and no course has anything to do with it.
test('a blocked target is reported against the relay', async () => {
  const { c } = client(() =>
    new Response(JSON.stringify({ error: 'host not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(c.upsertPage(1, { title: 'x', body: '<p/>' })).rejects.toMatchObject({ kind: 'relay' })
})
