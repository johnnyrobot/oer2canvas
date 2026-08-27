import type { CompiledChapter, CompiledSection } from '../contracts/index'
import type { CanvasClient, PageWrite } from '../canvas/client'
import type { KeyValueStore } from '../canvas/credentials'
import { runPush } from './push-session'

const section = (id: string, title: string): CompiledSection => ({
  id, title, html: `<p>${id}</p>`, notes: [], queue: [],
})
const chapter = (title: string, sections: CompiledSection[]): CompiledChapter => ({
  chapter: { title } as CompiledChapter['chapter'], sections, queue: [],
})
const CHAPTERS = [chapter('Chapter 1', [section('a', 'Introduction'), section('b', 'Polynomials')])]

function fakeDisk(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => { data.set(k, v) },
    remove: async (k) => { data.delete(k) },
  }
}

function fakeClient(failOn?: string) {
  const wrote: string[] = []
  const client = {
    async upsertPage(_c: number, p: PageWrite) {
      if (p.title === failOn) throw new Error('Canvas fell over')
      wrote.push(p.title)
      return { url: p.existingUrl ?? `canvas-${p.title}`, title: p.title }
    },
  } as unknown as CanvasClient
  return { client, wrote }
}

const run = (client: CanvasClient, journal: KeyValueStore, existingPages?: { url: string; title: string }[]) =>
  runPush({ client, courseId: 7, courseName: 'Intro Algebra', chapters: CHAPTERS, journal, existingPages })

test('a completed run leaves no journal behind to resume from', async () => {
  const journal = fakeDisk()
  const report = await run(fakeClient().client, journal)

  expect(report.landed).toHaveLength(2)
  expect(report.courseName).toBe('Intro Algebra')
  // A journal left behind after a clean run would offer Resume for work that is
  // finished, which is how a user ends up pushing the same chapter twice.
  expect(journal.data.has('canvas.journal')).toBe(false)
})

test('an interrupted run leaves a journal, and the next run resumes from it', async () => {
  const journal = fakeDisk()
  const first = await run(fakeClient('Polynomials').client, journal)
  expect(first.stoppedBy?.title).toBe('Polynomials')
  expect(journal.data.get('canvas.journal')).toEqual({
    courseId: 7,
    landed: ['chapter-1-introduction'],
  })

  const second = fakeClient()
  const report = await run(second.client, journal)
  // Only the page that never landed is re-sent.
  expect(second.wrote).toEqual(['Polynomials'])
  expect(report.landed).toHaveLength(2)
  expect(journal.data.has('canvas.journal')).toBe(false)
})

// A journal is about ONE course. Resuming into a different one would skip pages
// that are not there, and report them as landed.
test('a journal from another course is ignored rather than resumed into this one', async () => {
  const journal = fakeDisk()
  journal.data.set('canvas.journal', { courseId: 99, landed: ['chapter-1-introduction'] })
  const { client, wrote } = fakeClient()
  await run(client, journal)
  expect(wrote).toEqual(['Introduction', 'Polynomials'])
})

test('the report carries what each page did to the course', async () => {
  const journal = fakeDisk()
  const report = await run(fakeClient().client, journal, [
    { url: 'chapter-1-introduction', title: 'Introduction' },
  ])
  expect(report.landed.map((p) => p.outcome)).toEqual(['updated', 'created'])
})

/*
  The staleness this would otherwise have. §2.4's page list is loaded on the
  Destination screen, before any chapter is even picked. By the time a SECOND
  push runs in the same session, that list is a description of the course as it
  was before the first push — so trusting it would report every page as new and
  create a duplicate of every one of them.
*/
test('re-reads the course immediately before writing, rather than trusting a list from earlier', async () => {
  const journal = fakeDisk()
  const seen: string[] = []
  const client = {
    listPages: async () => [{ url: 'canvas-Introduction', title: 'Introduction' }],
    async upsertPage(_c: number, p: PageWrite) {
      seen.push(`${p.title}:${p.existingUrl ?? 'create'}`)
      return { url: p.existingUrl ?? `canvas-${p.title}`, title: p.title }
    },
  } as unknown as CanvasClient

  const report = await runPush({
    client, courseId: 7, courseName: 'Intro Algebra', chapters: CHAPTERS, journal,
    // Deliberately stale: it says the course is empty, and it is not.
    existingPages: [],
  })

  expect(seen).toEqual(['Introduction:canvas-Introduction', 'Polynomials:create'])
  expect(report.landed.map((p) => p.outcome)).toEqual(['updated', 'created'])
})
