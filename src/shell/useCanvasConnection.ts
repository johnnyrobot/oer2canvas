import { useCallback, useState } from 'react'
import type { CanvasClient, CanvasCourse, CanvasPage, CanvasUser } from '../canvas/client'
import type { CredentialStore } from '../canvas/credentials'
import { normalizeBaseUrl } from '../canvas/transport'

/**
 * The Destination screen's Canvas half, as a state machine with a network in it.
 *
 * Separated from `App` because it is the one part of this workflow with four
 * asynchronous states that can each fail differently, and because §2.5 spells
 * out distinct copy for each — which is only worth having if there is one place
 * that decides which one applies.
 */

export interface CanvasConnection {
  status: 'idle' | 'connecting'
  user?: CanvasUser
  courses?: readonly CanvasCourse[]
  selectedCourseId?: number
  pages?: readonly CanvasPage[]
  pagesError: boolean
  error?: string
  /** Normalized origin, retained only in memory for result links. */
  baseUrl?: string
  client?: CanvasClient
  connect(address: string, token: string): Promise<void>
  pickCourse(id: number): Promise<void>
  retryPages(): Promise<void>
  forget(): Promise<void>
}

export interface CanvasConnectionDeps {
  store: CredentialStore
  /** Injected so tests never construct a transport, let alone a fetch. */
  createClient(baseUrl: string, token: string): CanvasClient
}

/*
 * §2.5's copy, in one place.
 *
 * "Check the address and token" names BOTH fields on purpose. When nothing
 * answers at that host the app genuinely cannot tell which of the two is wrong,
 * and picking one would send half of the people who hit this to check the field
 * that was already correct.
 */
const CONNECT_FAILED = 'Could not connect to Canvas. Check the address and token, then try again.'
const COURSES_FAILED = 'Could not load your courses. Check your connection, then try again.'

export function useCanvasConnection(deps: CanvasConnectionDeps): CanvasConnection {
  const [status, setStatus] = useState<'idle' | 'connecting'>('idle')
  const [user, setUser] = useState<CanvasUser | undefined>()
  const [courses, setCourses] = useState<readonly CanvasCourse[] | undefined>()
  const [client, setClient] = useState<CanvasClient | undefined>()
  const [selectedCourseId, setSelectedCourseId] = useState<number | undefined>()
  const [pages, setPages] = useState<readonly CanvasPage[] | undefined>()
  const [pagesError, setPagesError] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [baseUrl, setBaseUrl] = useState<string | undefined>()

  const loadPages = useCallback(
    async (from: CanvasClient, courseId: number) => {
      setPagesError(false)
      // Cleared, not left stale: the previous course's pages describe a course
      // this screen is no longer talking about, and the Plan screen would collide
      // the selection against them.
      setPages(undefined)
      try {
        setPages(await from.listPages(courseId))
      } catch {
        /*
         * `pages` stays UNDEFINED, and that is the whole point of this catch.
         * `[]` would tell the Plan screen the course is empty and every page is
         * new — a claim this app has no evidence for, about the one question
         * where being wrong means silently overwriting someone's work.
         */
        setPagesError(true)
      }
    },
    [],
  )

  const connect = useCallback(
    async (address: string, token: string) => {
      setStatus('connecting')
      setError(undefined)
      try {
        // Throws on a plaintext or malformed address, in the words of the field
        // that took it, before anything is sent anywhere.
        const baseUrl = normalizeBaseUrl(address)
        const fresh = deps.createClient(baseUrl, token)
        const who = await fresh.verify()

        // The base URL is a harmless convenience; the token remains held only in
        // the credential store's module-scoped session state.
        await deps.store.save({ baseUrl, token })

        setClient(fresh)
        setBaseUrl(baseUrl)
        setUser(who)
        try {
          setCourses(await fresh.listCourses())
        } catch {
          setCourses(undefined)
          setError(COURSES_FAILED)
        }
      } catch (e) {
        setUser(undefined)
        setCourses(undefined)
        setClient(undefined)
        setBaseUrl(undefined)
        setError(e instanceof Error && /address/i.test(e.message) ? e.message : CONNECT_FAILED)
      } finally {
        setStatus('idle')
      }
    },
    [deps],
  )

  const pickCourse = useCallback(
    async (id: number) => {
      setSelectedCourseId(id)
      if (client) await loadPages(client, id)
    },
    [client, loadPages],
  )

  const retryPages = useCallback(async () => {
    if (client && selectedCourseId !== undefined) await loadPages(client, selectedCourseId)
  }, [client, selectedCourseId, loadPages])

  const forget = useCallback(async () => {
    await deps.store.forget()
    // The whole connection goes, not just the stored copy. Leaving the course
    // list on screen after forgetting the token would offer a course that
    // nothing can now be pushed to.
    setClient(undefined)
    setBaseUrl(undefined)
    setUser(undefined)
    setCourses(undefined)
    setSelectedCourseId(undefined)
    setPages(undefined)
    setPagesError(false)
  }, [deps])

  return {
    status, user, courses, selectedCourseId, pages, pagesError, error, baseUrl, client,
    connect, pickCourse, retryPages, forget,
  }
}
