import { renderHook, act, waitFor } from '@testing-library/react'
import { useCanvasConnection } from './useCanvasConnection'
import type { CanvasClient } from '../canvas/client'
import { CanvasError } from '../canvas/client'
import { createCredentialStore, type KeyValueStore } from '../canvas/credentials'

function fakeDisk(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => { data.set(k, v) },
    remove: async (k) => { data.delete(k) },
  }
}

const COURSES = [
  { id: 7, name: 'Intro Algebra', term: 'Fall 2026' },
  { id: 8, name: 'Biology 101', term: 'Fall 2026' },
]
const PAGES = [{ title: 'Syllabus', url: 'syllabus', updatedAt: '2026-08-12T09:00:00Z' }]

function fakeClient(over: Partial<CanvasClient> = {}): CanvasClient {
  return {
    verify: async () => ({ id: 1, name: 'Ada Lovelace' }),
    listCourses: async () => COURSES,
    listPages: async () => PAGES,
    upsertPage: async (_c, p) => ({ url: p.existingUrl ?? p.title, title: p.title }),
    ...over,
  } as CanvasClient
}

function setup(client = fakeClient(), disk = fakeDisk()) {
  const made: { baseUrl: string; token: string }[] = []
  const hook = renderHook(() =>
    useCanvasConnection({
      store: createCredentialStore(disk),
      createClient: (baseUrl, token) => {
        made.push({ baseUrl, token })
        return client
      },
    }),
  )
  return { hook, made, disk }
}

test('connecting verifies the token and loads the courses it can author in', async () => {
  const { hook, made } = setup()
  await act(async () => { await hook.result.current.connect('school.instructure.com', 't') })

  // The address was normalised on the way in, not left as typed.
  expect(made[0]!.baseUrl).toBe('https://school.instructure.com')
  await waitFor(() => expect(hook.result.current.user?.name).toBe('Ada Lovelace'))
  expect(hook.result.current.courses).toEqual(COURSES)
  expect(hook.result.current.error).toBeUndefined()
})

// §2.5, quoted. The copy names both fields because when nothing answers at all
// the app genuinely cannot tell which one is wrong.
test('a refused token reports §2.5 copy rather than an HTTP status', async () => {
  const client = fakeClient({
    verify: async () => { throw new CanvasError('token', 401, 'Canvas did not accept that access token. (HTTP 401)') },
  })
  const { hook } = setup(client)
  await act(async () => { await hook.result.current.connect('school.instructure.com', 'bad') })

  await waitFor(() =>
    expect(hook.result.current.error).toBe(
      'Could not connect to Canvas. Check the address and token, then try again.',
    ),
  )
  expect(hook.result.current.user).toBeUndefined()
})

test('choosing a course loads the pages already in it', async () => {
  const { hook } = setup()
  await act(async () => { await hook.result.current.connect('school.instructure.com', 't') })
  await act(async () => { await hook.result.current.pickCourse(7) })

  await waitFor(() => expect(hook.result.current.pages).toEqual(PAGES))
  expect(hook.result.current.selectedCourseId).toBe(7)
})

// The course stays chosen so the retry is one step, not two — and the Plan
// screen must be told the collisions are UNKNOWN rather than empty.
test('a failed page load keeps the course and refuses to claim the course is empty', async () => {
  const client = fakeClient({ listPages: async () => { throw new Error('offline') } })
  const { hook } = setup(client)
  await act(async () => { await hook.result.current.connect('school.instructure.com', 't') })
  await act(async () => { await hook.result.current.pickCourse(7) })

  await waitFor(() => expect(hook.result.current.pagesError).toBe(true))
  expect(hook.result.current.selectedCourseId).toBe(7)
  expect(hook.result.current.pages).toBeUndefined()
})

test('a token is never written to disk, even after a successful connection', async () => {
  const { hook, disk } = setup()
  await act(async () => { await hook.result.current.connect('school.instructure.com', 'secret') })
  expect(disk.data.has('canvas.token')).toBe(false)
})

test('forgetting drops the connection as well as the token', async () => {
  const { hook, disk } = setup()
  await act(async () => { await hook.result.current.connect('school.instructure.com', 'secret') })
  await act(async () => { await hook.result.current.forget() })

  expect(disk.data.has('canvas.token')).toBe(false)
  expect(hook.result.current.user).toBeUndefined()
  expect(hook.result.current.courses).toBeUndefined()
})
