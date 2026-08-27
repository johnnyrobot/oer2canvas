import type { CompiledChapter } from '../contracts/index'
import { pageTargets } from '../engine/export/page-identity'
import type { CanvasClient, CanvasPage } from './client'
import { resolveTargets } from './resolve'

/**
 * The sequential write queue. E7's runner.
 *
 * SEQUENTIAL, and not as a simplification. Canvas's own documentation says a
 * client making no more than one simultaneous request is unlikely to be
 * throttled, and that parallel requests carry a pre-flight penalty — so a
 * concurrent runner would be slower in the case that matters, on top of being
 * ruder. It also fits the free Worker's six-connection ceiling for nothing.
 */

/**
 * What happened to one page, in the words the Result screen uses.
 *
 * `unknown` is a real answer and not a missing one. It means the course's page
 * list was never loaded — the §2.4 request failed, or the user reached the Plan
 * screen another way — and the same rule holds here as on the Plan screen: THE
 * APP MAY NOT SILENTLY GUESS. Reporting a page as "created" when it may well
 * have overwritten an instructor's own work is the single most expensive lie
 * this screen could tell.
 */
export type PushOutcome = 'created' | 'updated' | 'unknown'

export interface PushedPage {
  slug: string
  title: string
  chapterTitle: string
  outcome: PushOutcome
  /** Canvas's actual page url, returned after a write or known from resolution. */
  url?: string
}

/**
 * Where a run stopped, when it did.
 *
 * NO ROLLBACK, and this type is what makes that honest rather than merely true.
 * A push that dies at page 7 of 15 leaves those 7 in the course — undoing them
 * would mean deleting pages in a live course, which is the one thing the
 * transport is built to refuse. So the run reports three things instead: what
 * landed, what it tripped over, and what never got sent.
 */
export interface PushStop {
  slug: string
  title: string
  /** In the user's words, ready to render. */
  reason: string
}

export interface PushResult {
  landed: PushedPage[]
  /** Absent when the whole selection went through. */
  stoppedBy?: PushStop
  /** Not sent — the one that failed, and everything after it. Offered as Resume. */
  remaining: PushedPage[]
}

export interface PushRequest {
  client: CanvasClient
  courseId: number
  chapters: readonly CompiledChapter[]
  /**
   * Slugs a previous attempt already put in the course. Resume reads this.
   *
   * Skipping them is not about correctness — every write is an idempotent PUT,
   * so re-sending would land the same bytes in the same place. It is about the
   * two things that are actually scarce: an instructor's afternoon, and Canvas's
   * rate limit. Resuming a run that died at page 12 of 60 should cost 48
   * requests, not 60.
   */
  alreadyLanded?: readonly string[]
  /**
   * The pages already in the course, from §2.4's list.
   *
   * Load-bearing twice over. It decides `outcome` — read BEFORE the run, never
   * inferred from the write's response, because Canvas's reply looks identical
   * whether it created or updated. And it decides WHERE each write is aimed:
   * Canvas will not let a client choose a page url, so the only page that can be
   * overwritten is one whose url came out of this list. See `resolve.ts`.
   *
   * Absent, every write creates and every outcome is honestly `unknown`.
   */
  existingPages?: readonly CanvasPage[]
  /**
   * Called after EVERY page, with everything that has landed so far.
   *
   * This is the journal, and the timing is the whole point of it. A run that
   * saved its state once at the end would save nothing in precisely the case the
   * journal exists for — the tab that closes, the laptop that sleeps, the browser
   * that is killed mid-run. Written per page, the worst a crash costs is the one
   * page that was in flight.
   */
  onLanded?: (landed: readonly PushedPage[]) => void
  /**
   * Cancel. Checked BETWEEN pages, never in the middle of one.
   *
   * A push cannot be aborted mid-request the way a fetch can, because the
   * interesting half of the request happens on Canvas's side: a `PUT` whose
   * connection is dropped may still have created the page. Stopping cleanly at a
   * page boundary means the journal's account of what landed is one this app can
   * actually stand behind, which is the whole basis of offering Resume.
   */
  signal?: AbortSignal
  onProgress?: (progress: PushProgress) => void
}

/** Where the run is. `done` is the INDEX being worked on, so a caller wants `done + 1`. */
export interface PushProgress {
  done: number
  total: number
  title: string
}

/** Anything at all can be thrown; only an `Error` is guaranteed to have a message. */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function pushToCourse(req: PushRequest): Promise<PushResult> {
  const targets = resolveTargets(pageTargets(req.chapters), req.existingPages)
  const describe = (t: (typeof targets)[number]): PushedPage => ({
    slug: t.slug,
    title: t.section.title,
    chapterTitle: t.chapterTitle,
    outcome:
      req.existingPages === undefined || t.ambiguous
        ? 'unknown'
        : t.existingUrl !== undefined
          ? 'updated'
          : 'created',
    ...(t.existingUrl !== undefined ? { url: t.existingUrl } : {}),
  })

  const done = new Set(req.alreadyLanded ?? [])
  const landed: PushedPage[] = []
  for (const [index, target] of targets.entries()) {
    if (req.signal?.aborted) {
      return {
        landed,
        stoppedBy: {
          slug: target.slug,
          title: target.section.title,
          // Not an error, and it does not read as one. The user did this on
          // purpose and the only thing they need to know is where it got to.
          reason: 'Stopped at your request.',
        },
        remaining: targets.slice(index).map(describe),
      }
    }
    req.onProgress?.({ done: index, total: targets.length, title: target.section.title })
    if (done.has(target.slug)) {
      // Reported as landed without being re-sent: the result describes the
      // COURSE, not this attempt's share of the work.
      landed.push(describe(target))
      continue
    }
    let stored: CanvasPage
    try {
      stored = await req.client.upsertPage(req.courseId, {
        title: target.section.title,
        ...(target.existingUrl !== undefined ? { existingUrl: target.existingUrl } : {}),
        // VERBATIM, exactly as the cartridge publishes it. The audited artifact
        // and the published artifact have to be the same bytes or the gate's
        // verdict says nothing about what the instructor actually got.
        body: target.section.html,
      })
    } catch (e) {
      /*
       * STOP, rather than skip and carry on.
       *
       * A run that pressed on past a failure would hand back a course in a state
       * nobody chose: some chapters current, some stale, no way to tell which
       * without opening all of them. Whatever stopped page 7 — an expired token,
       * a course that got unpublished mid-run, Canvas having a bad afternoon —
       * is overwhelmingly likely to stop page 8 as well, so continuing mostly
       * buys fourteen more copies of the same error.
       */
      return {
        landed,
        stoppedBy: { slug: target.slug, title: target.section.title, reason: messageOf(e) },
        remaining: targets.slice(index).map(describe),
      }
    }
    landed.push({ ...describe(target), url: stored.url || target.existingUrl || target.slug })
    req.onLanded?.([...landed])
  }
  return { landed, remaining: [] }
}
