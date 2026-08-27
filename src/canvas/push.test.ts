import type { CompiledChapter, CompiledSection } from '../contracts/index'
import type { CanvasClient, CanvasPage, PageWrite } from './client'
import { CanvasError } from './client'
import { pushToCourse } from './push'

const section = (id: string, title: string, over: Partial<CompiledSection> = {}): CompiledSection => ({
  id, title, html: `<p>body of ${id}</p>`, notes: [], queue: [], ...over,
})

const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})

const CHAPTERS = [
  chapter('Chapter 1', [section('a', 'Introduction'), section('b', 'Polynomials')]),
  chapter('Chapter 2', [section('c', 'Radicals')]),
]

/** A client that records writes, and can be told to fail on a given slug. */
function fakeClient(failOn?: { slug: string; error: Error }) {
  const wrote: PageWrite[] = []
  const client = {
    async upsertPage(_courseId: number, page: PageWrite): Promise<CanvasPage> {
      if (failOn && page.title === failOn.slug) throw failOn.error
      wrote.push(page)
      return { url: page.existingUrl ?? `canvas-${page.title}`, title: page.title }
    },
  } as unknown as CanvasClient
  return { client, wrote }
}

test('pushes every section as its own page, in book order', async () => {
  const { client, wrote } = fakeClient()
  const result = await pushToCourse({ client, courseId: 17, chapters: CHAPTERS })

  expect(wrote.map((w) => w.title)).toEqual(['Introduction', 'Polynomials', 'Radicals'])
  expect(result.landed).toHaveLength(3)
  expect(result.stoppedBy).toBeUndefined()
})

test('publishes the compiled html verbatim, the same bytes the audit passed', async () => {
  const { client, wrote } = fakeClient()
  const html = '<p>exact  bytes</p><math><mo>−</mo></math>'
  await pushToCourse({
    client,
    courseId: 1,
    chapters: [chapter('Ch', [section('a', 'One', { html })])],
  })
  expect(wrote[0]!.body).toBe(html)
})

test('a failure stops the run, leaves what landed in place, and names where it stopped', async () => {
  const { client, wrote } = fakeClient({
    slug: 'Polynomials',
    error: new CanvasError('canvas', 500, 'Canvas refused the request. (HTTP 500)'),
  })
  const result = await pushToCourse({ client, courseId: 17, chapters: CHAPTERS })

  // No rollback: the one that succeeded before the failure stays.
  expect(result.landed.map((p) => p.slug)).toEqual(['chapter-1-introduction'])
  expect(result.stoppedBy).toMatchObject({ title: 'Polynomials', reason: expect.stringMatching(/500/) })
  // And it stops rather than carrying on into chapter 2.
  expect(wrote.map((w) => w.title)).toEqual(['Introduction'])
  expect(result.remaining.map((p) => p.title)).toEqual(['Polynomials', 'Radicals'])
})

test('resuming does not re-send the pages that already landed', async () => {
  const { client, wrote } = fakeClient()
  const result = await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    alreadyLanded: ['chapter-1-introduction'],
  })

  expect(wrote.map((w) => w.title)).toEqual(['Polynomials', 'Radicals'])
  // Still reported as landed — the run's answer is about the course, not about
  // which attempt put each page there.
  expect(result.landed.map((p) => p.slug)).toEqual([
    'chapter-1-introduction',
    'chapter-1-polynomials',
    'chapter-2-radicals',
  ])
})

test('records what landed after every page, so a closed tab can resume', async () => {
  const { client } = fakeClient({
    slug: 'Radicals',
    error: new Error('tab closed'),
  })
  const snapshots: string[][] = []
  await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    onLanded: (landed) => snapshots.push(landed.map((p) => p.slug)),
  })

  // Written as it goes, not once at the end — an end-of-run save is exactly the
  // save a crashed tab never performs.
  expect(snapshots).toEqual([
    ['chapter-1-introduction'],
    ['chapter-1-introduction', 'chapter-1-polynomials'],
  ])
})

test('a cancel stops the run and keeps what has already landed', async () => {
  const controller = new AbortController()
  const wrote: string[] = []
  const client = {
    async upsertPage(_c: number, page: PageWrite) {
      wrote.push(page.title)
      if (wrote.length === 1) controller.abort()
      return { url: page.title, title: page.title }
    },
  } as unknown as CanvasClient

  const result = await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    signal: controller.signal,
  })

  expect(wrote).toEqual(['Introduction'])
  expect(result.landed.map((p) => p.slug)).toEqual(['chapter-1-introduction'])
  expect(result.stoppedBy?.reason).toMatch(/stopped/i)
  expect(result.remaining.map((p) => p.title)).toEqual(['Polynomials', 'Radicals'])
})

test('says which pages it overwrote and which it created, from the course it read first', async () => {
  const { client } = fakeClient()
  const result = await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    existingPages: [
      { url: 'chapter-1-introduction', title: 'Introduction' },
      { url: 'syllabus', title: 'Syllabus' },
    ],
  })

  expect(result.landed.map((p) => [p.title, p.outcome])).toEqual([
    ['Introduction', 'updated'],
    ['Polynomials', 'created'],
    ['Radicals', 'created'],
  ])
})

test('claims nothing about overwriting when the course was never read', async () => {
  const { client } = fakeClient()
  const result = await pushToCourse({ client, courseId: 17, chapters: CHAPTERS })
  expect(result.landed.map((p) => p.outcome)).toEqual(['unknown', 'unknown', 'unknown'])
})

/*
  The measurement that reshaped this runner. A page Canvas named itself is
  recognised by TITLE, and the write has to aim at Canvas's url — aiming at our
  own slug would create a duplicate rather than update, every single run.
*/
test('overwrites at the url Canvas chose, not at the slug we would have picked', async () => {
  const { client, wrote } = fakeClient()
  await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    existingPages: [{ url: '1-dot-polynomials', title: 'Polynomials' }],
  })
  expect(wrote.map((w) => w.existingUrl)).toEqual([undefined, '1-dot-polynomials', undefined])
})

test('reports where it is before each page, so the screen is never silent mid-run', async () => {
  const { client } = fakeClient()
  const seen: string[] = []
  await pushToCourse({
    client,
    courseId: 17,
    chapters: CHAPTERS,
    onProgress: (p) => seen.push(`${p.done + 1} of ${p.total}: ${p.title}`),
  })
  expect(seen).toEqual([
    '1 of 3: Introduction',
    '2 of 3: Polynomials',
    '3 of 3: Radicals',
  ])
})
