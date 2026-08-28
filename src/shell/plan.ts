import { isPublishable, type CompiledChapter, type CompiledSection } from '../contracts/index'
import { pageTargets } from '../engine/export/page-identity'
import type { CanvasPage } from '../canvas/client'
import { resolveTargets } from '../canvas/resolve'
import type { Destination } from './phases'

/**
 * What committing would actually do, worked out before anything happens.
 *
 * ONE PAGE PER SECTION, NOT PER CHAPTER. The design document's §7 sketched
 * "5 chapters become 5 pages", and that is wrong about this pipeline: `compile`
 * emits one `CompiledSection` per section, each with its own html and its own
 * gate verdict, and the cartridge makes one resource per section. A chapter of
 * twelve sections is twelve Canvas pages. A summary that said "5 pages" would
 * understate a real push by an order of magnitude, which is exactly the kind of
 * surprise this screen exists to prevent.
 */

export type PageStatus =
  | { kind: 'new' }
  /** A page with this slug is already in the course, and a push would replace it. */
  | { kind: 'overwrite' }
  /**
   * Canvas is chosen and a guess is refused. `reason` decides the words: a page
   * list that never loaded is a network problem worth retrying, while an
   * ambiguous match is a course whose pages this app cannot tell apart, where
   * retrying changes nothing at all.
   */
  | { kind: 'unknown'; reason: 'not-loaded' | 'ambiguous' }

export interface PlanPage {
  sectionId: string
  /** Page title as it would be created. */
  title: string
  /** The chapter it came from — pages are grouped under it, never flattened away. */
  chapterTitle: string
  status: PageStatus
}

export interface PlanGroup {
  chapterTitle: string
  pages: PlanPage[]
  /** Sections that failed to compile, and so become no page at all. */
  failed: number
}

export interface Plan {
  groups: PlanGroup[]
  pageCount: number
  chapterCount: number
  /** One sentence, in the indicative. The answer to "what will happen". */
  summary: string
  /** Everything standing between here and a commit. Empty means ready. */
  blockers: string[]
}

/** A section that failed to compile emits nothing, so it can never become a page. */
function publishable(s: CompiledSection): boolean {
  return !s.error && s.html.length > 0
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildPlan(
  chapters: readonly CompiledChapter[],
  destination: Destination | undefined,
  unansweredCount: number,
  /**
   * The pages already in the chosen course, from §2.4's list.
   *
   * `undefined` and `[]` mean DIFFERENT THINGS and the difference is the point.
   * `undefined` is "nobody has looked" — the course list never loaded, or the
   * request failed — and every page stays `unknown`, because THE PLAN MAY NOT
   * SILENTLY GUESS. `[]` is knowledge: the course was read and it has no pages,
   * so everything really is new and the screen can say so.
   */
  existingPages?: readonly CanvasPage[],
): Plan {
  /*
   * Resolved by the SAME function the push writes with, not by a rule restated
   * here. A collision column computed differently from the writer would be a
   * prediction about a page that never gets touched — worse than no column,
   * because it would be believed.
   */
  const resolved = resolveTargets(pageTargets(chapters), existingPages)
  const statusOf = new Map(
    resolved.map((r) => [
      r.section.id,
      existingPages === undefined
        ? ({ kind: 'unknown', reason: 'not-loaded' } as const)
        : r.ambiguous
          ? ({ kind: 'unknown', reason: 'ambiguous' } as const)
          : r.existingUrl !== undefined
            ? ({ kind: 'overwrite' } as const)
            : ({ kind: 'new' } as const),
    ]),
  )

  const groups: PlanGroup[] = chapters.map((c) => ({
    chapterTitle: c.chapter.title,
    pages: c.sections.filter(publishable).map((s) => ({
      sectionId: s.id,
      title: s.title,
      chapterTitle: c.chapter.title,
      status:
        destination?.kind !== 'canvas'
          ? ({ kind: 'new' } as const)
          : (statusOf.get(s.id) ?? ({ kind: 'unknown', reason: 'not-loaded' } as const)),
    })),
    failed: c.sections.filter((s) => !publishable(s)).length,
  }))

  const pageCount = groups.reduce((n, g) => n + g.pages.length, 0)
  const chapterCount = groups.length
  const where =
    destination?.kind === 'canvas' ? destination.courseName : 'a cartridge file'
  const overwrites = groups.reduce(
    (n, g) => n + g.pages.filter((p) => p.status.kind === 'overwrite').length,
    0,
  )
  /*
   * The sentence §2.4 exists to make possible. Stated in the indicative and up
   * front, because "2 would overwrite pages already in the course" is the one
   * fact an instructor needs BEFORE pressing the button, and the one they can do
   * nothing about after.
   */
  const collision =
    overwrites === 0
      ? ''
      : ` ${overwrites} would overwrite ${overwrites === 1 ? 'a page' : 'pages'} already in ${where}.`
  const summary =
    `${plural(chapterCount, 'chapter', 'chapters')} ${chapterCount === 1 ? 'becomes' : 'become'} ` +
    `${plural(pageCount, 'page', 'pages')} in ${where}.${collision}`

  const blockers: string[] = []
  if (!destination) blockers.push('Choose where this goes first.')
  if (pageCount === 0) blockers.push('Nothing to publish — no section compiled successfully.')
  // D5, and the reason it is stated here as well as in the sidebar: nothing
  // publishes until the queue is empty, and a commit button that refuses without
  // saying why is how a user concludes the app is broken.
  if (unansweredCount > 0) {
    blockers.push(`${plural(unansweredCount, 'item', 'items')} still ${unansweredCount === 1 ? 'needs' : 'need'} answers.`)
  }
  const failed = groups.reduce((n, g) => n + g.failed, 0)
  if (failed > 0) {
    blockers.push(`${plural(failed, 'section', 'sections')} failed to compile and would be left out.`)
  }

  /*
   * Direct push writes `wiki_page.body` and nothing else — see
   * `src/canvas/client.ts`, which has no file-upload path at all. A page carrying
   * a packaged reference would therefore import with a broken image. Cartridge
   * export is the only route that carries the bytes, so the plan says so rather
   * than letting the push half-succeed. Issue 09 owns the Files-API design that
   * would lift this.
   */
  const packagedAssetCount = chapters.reduce(
    (total, compiled) => total + (compiled.chapter.assets?.length ?? 0),
    0,
  )
  if (packagedAssetCount > 0 && destination?.kind === 'canvas') {
    blockers.push(
      `This import packages ${plural(packagedAssetCount, 'image', 'images')}. ` +
        'Pushing to a course cannot upload them, so export a cartridge instead.',
    )
  }

  /*
   * The gate itself, and it is `isPublishable` rather than `passedChecks`.
   *
   * Its doc comment names this slice in capitals for a reason: `passedChecks` is
   * upstream's contract and is `true` whenever `blockers` is empty, knowing
   * nothing about `needsHumanReview` and nothing at all about the queue. The
   * counts above catch an unanswered queue, but they say nothing about a section
   * whose audit found a definite WCAG failure — so without this, a chapter with
   * a real blocker and an empty queue would export clean. D5 is that nothing
   * publishes until the whole thing is publishable.
   */
  const unpublishable = chapters.filter((c) => !isPublishable(c))
  if (unpublishable.length > 0 && unansweredCount === 0 && failed === 0) {
    // `isPublishable` conflates two states that mean different things to a user:
    // a section with no `gate` has not been AUDITED, while a gate carrying
    // blockers has been audited and failed. Reporting the first as
    // "accessibility blockers" would send someone hunting for a defect that was
    // never found, so they are counted apart.
    const withBlockers = unpublishable.filter((c) =>
      c.sections.some((s) => (s.gate?.conformance.blockers.length ?? 0) > 0),
    ).length
    if (withBlockers > 0) {
      blockers.push(
        `${plural(withBlockers, 'chapter', 'chapters')} ${withBlockers === 1 ? 'has' : 'have'} ` +
          'accessibility blockers that must be fixed first.',
      )
    }
    const unaudited = unpublishable.length - withBlockers
    if (unaudited > 0) {
      blockers.push(
        `${plural(unaudited, 'chapter', 'chapters')} ${unaudited === 1 ? 'has' : 'have'} ` +
          'not finished its checks.',
      )
    }
  }

  return { groups, pageCount, chapterCount, summary, blockers }
}

/**
 * What running this again does, in the indicative.
 *
 * THE TWO DESTINATIONS DO NOT DISAGREE, AND THIS FILE USED TO SAY THEY DID.
 *
 * The PRD asserts that importing a cartridge "duplicates rather than updates —
 * an asymmetry inherent to the format", and that assertion was written into this
 * product's copy three times before anyone checked it. Measured, on a live
 * Canvas, with BOTH importers: importing the same cartridge into the same course
 * a second time produced 8 pages and 8 pages — no duplicates, no second copies,
 * and `updated_at` still equal to `created_at`. Canvas's own import screen says
 * as much: "Previously imported content from the same course will be replaced.
 * Manually added content will remain."
 *
 * It works because every page carries a stable identifier derived from its
 * section id, which is a property of OUR exporter, not of the format — see
 * `cartridge.ts`, where position-derived identifiers were rejected for a
 * different reason and turn out to buy this as well. A cartridge that numbered
 * its resources by position really would duplicate.
 *
 * Never "may", never "might" — and never an asymmetry that is not there.
 */
export function reRunBehaviour(d: Destination | undefined): { tone: 'info' | 'caution'; text: string } | undefined {
  if (!d) return undefined
  if (d.kind === 'canvas') {
    return {
      tone: 'info',
      text: 'Pushing to Canvas updates in place. If you run this push again later, these same pages are overwritten with the new content — no second copies are created.',
    }
  }
  return {
    tone: 'info',
    text: 'Importing this file again updates the pages it created rather than duplicating them, because each one carries a stable identifier. Pages you added yourself in Canvas are left alone.',
  }
}

/** What the commit button says. Names the count and the destination, never just "Continue". */
export function commitLabel(d: Destination | undefined, pageCount: number): string {
  if (d?.kind === 'canvas') return `Push ${plural(pageCount, 'page', 'pages')} to ${d.courseName}`
  return `Download cartridge — ${plural(pageCount, 'page', 'pages')}`
}
