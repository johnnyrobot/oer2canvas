import type { CompiledChapter } from '../contracts/index'
import type { CanvasClient, CanvasPage } from '../canvas/client'
import type { KeyValueStore } from '../canvas/credentials'
import { pushToCourse, type PushProgress } from '../canvas/push'
import type { PushReport } from './screens'

/**
 * A push, with its journal — E7's "resumable journal in IndexedDB, not a
 * function call".
 *
 * `pushToCourse` is deliberately ignorant of storage: it takes what already
 * landed and reports what it added. This is the half that remembers, and keeping
 * them apart is what lets the runner be tested without a disk and the journal be
 * tested without a network.
 */

const JOURNAL_KEY = 'canvas.journal'

interface Journal {
  courseId: number
  landed: string[]
}

function journalFor(raw: unknown, courseId: number): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const j = raw as Partial<Journal>
  /*
   * A JOURNAL BELONGS TO ONE COURSE. Resuming a Biology run into an Algebra
   * course would skip pages that were never written there and then report them
   * as landed — a false account of a live course, which is the one thing this
   * screen must never produce.
   */
  if (j.courseId !== courseId) return []
  return Array.isArray(j.landed) ? j.landed : []
}

export async function runPush(deps: {
  client: CanvasClient
  courseId: number
  courseName: string
  chapters: readonly CompiledChapter[]
  journal: KeyValueStore
  existingPages?: readonly CanvasPage[]
  signal?: AbortSignal
  onProgress?: (progress: PushProgress) => void
}): Promise<PushReport> {
  const alreadyLanded = journalFor(await deps.journal.get(JOURNAL_KEY), deps.courseId)

  /*
   * RE-READ THE COURSE, rather than trusting the list the Destination screen
   * loaded. That list was fetched before a single chapter had been picked, and
   * by the time a second push runs in the same session it describes a course
   * that no longer exists — every page this run already created would look new,
   * and Canvas would be handed a create for a page that is already there. Since
   * Canvas names pages itself, that does not overwrite: it DUPLICATES.
   *
   * One request against the accuracy of every collision this run reports, and
   * against the product's central promise. If it fails, the run falls back to
   * what the screen had rather than refusing — a stale list is worse than a
   * fresh one and much better than none.
   */
  let existingPages = deps.existingPages
  try {
    existingPages = await deps.client.listPages(deps.courseId)
  } catch {
    // Kept as it was. The outcomes this produces may be wrong about a page
    // somebody else added since; they will not be wrong about ours.
  }

  const result = await pushToCourse({
    client: deps.client,
    courseId: deps.courseId,
    chapters: deps.chapters,
    alreadyLanded,
    ...(existingPages ? { existingPages } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
    // Per page, because an end-of-run save is the save a crashed tab never
    // performs — see `PushRequest.onLanded`.
    onLanded: (landed) => {
      void deps.journal.set(JOURNAL_KEY, {
        courseId: deps.courseId,
        landed: landed.map((p) => p.slug),
      } satisfies Journal)
    },
  })

  if (result.stoppedBy === undefined) {
    // Cleared on success, or the Result screen would offer to resume a run that
    // is finished — which is how somebody pushes the same chapter twice.
    await deps.journal.remove(JOURNAL_KEY)
  }

  return {
    courseName: deps.courseName,
    landed: result.landed,
    remaining: result.remaining,
    ...(result.stoppedBy ? { stoppedBy: result.stoppedBy } : {}),
  }
}
