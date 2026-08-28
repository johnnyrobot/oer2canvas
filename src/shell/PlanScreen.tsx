import { AlertTriangle, FileText, HelpCircle, Info, Plus, RefreshCw } from 'lucide-react'
import type { CompiledChapter } from '../contracts/index'
import type { CanvasPage } from '../canvas/client'
import { buildPlan, commitLabel, reRunBehaviour, type PageStatus } from './plan'
import type { Destination } from './phases'
import type { ImportFinding } from '../import/types'

/**
 * What committing would do, before it does it.
 *
 * Its job is to show what Canvas pages exist and what will be created, answering
 * all three questions on one screen: what am I taking, where is it going,
 * what happens when I commit.
 *
 * Pages are grouped under their chapter rather than flattened into one list.
 * One chapter is many pages here (one per section), so a flat list of 36 rows
 * would lose the only structure the user actually chose.
 */
export function PlanScreen({
  destination, chapters, unansweredCount, onCommit, existingPages, assetCount, importFindings,
}: {
  destination?: Destination
  chapters: readonly CompiledChapter[]
  unansweredCount: number
  onCommit?: () => void
  /**
   * The chosen course's existing pages, from §2.4. Absent means nobody looked,
   * and the difference from `[]` is load-bearing — see `buildPlan`.
   */
  existingPages?: readonly CanvasPage[]
  /** Present for browser imports, whose packaged assets must be disclosed exactly. */
  assetCount?: number
  /** Parser uncertainty remains visible after the import preview is left behind. */
  importFindings?: readonly ImportFinding[]
}) {
  const plan = buildPlan(chapters, destination, unansweredCount, existingPages)
  const behaviour = reRunBehaviour(destination)
  const ready = plan.blockers.length === 0

  if (chapters.length === 0) {
    return (
      <section className="mx-auto max-w-2xl text-center">
        <h2 className="text-lg font-semibold">Nothing to plan</h2>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          Pick chapters first, and this will show exactly what they become.
        </p>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold">Review the plan</h2>

      {/* The operation summary in one line. */}
      <p className="mt-2 text-base">{plan.summary}</p>
      {assetCount !== undefined && (
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
          Packaged assets: {assetCount.toLocaleString()}.
        </p>
      )}
      {importFindings && importFindings.length > 0 && (
        <section
          aria-labelledby="import-findings-heading"
          className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <h3 id="import-findings-heading" className="font-semibold">Import findings</h3>
          <p className="mt-1">
            These extraction findings remain part of the plan and require attention during final review.
          </p>
          <ul role="list" className="mt-2 list-disc space-y-1 pl-5">
            {importFindings.map((finding) => (
              <li key={`${finding.code}-${finding.sectionId ?? ''}`}>
                <strong>{finding.severity === 'blocker' ? 'Blocker' : 'Warning'}:</strong>{' '}
                {finding.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {behaviour && (
        <div
          className={`mt-4 flex items-start gap-3 rounded-lg border p-4 text-sm ${
            behaviour.tone === 'caution'
              ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
              : 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-neutral-900 dark:text-brand-300'
          }`}
        >
          {/*
            Icon AND text, never colour alone: an amber box that means "caution"
            to a sighted user means nothing to anyone else, and this is the one
            fact on the screen a user cannot discover any other way.
          */}
          {behaviour.tone === 'caution'
            ? <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            : <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
          <p>{behaviour.text}</p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-5">
        {plan.groups.map((g) => (
          <div key={g.chapterTitle}>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {g.chapterTitle}
              <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">
                {g.pages.length === 1 ? '1 page' : `${g.pages.length} pages`}
              </span>
            </h3>

            {g.failed > 0 && (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                {g.failed === 1 ? '1 section' : `${g.failed} sections`} failed to compile and
                would be left out.
              </p>
            )}

            {/*
              `role="list"` restores what Tailwind's preflight removes: an
              unmarkered `ul` stops being announced as a list in Safari +
              VoiceOver, and losing the item count on a 36-page plan is losing
              the number the user came here for.
            */}
            <ul role="list" className="mt-2 flex flex-col gap-1">
              {g.pages.map((p) => (
                <li
                  key={p.sectionId}
                  className="flex items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <FileText className="size-4 shrink-0 text-neutral-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <StatusTag status={p.status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <button
          type="button"
          onClick={onCommit}
          aria-disabled={!ready || !onCommit}
          className={`min-h-9 rounded-md px-4 text-sm font-medium ${
            ready && onCommit
              ? 'bg-brand-700 text-white'
              : 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'
          }`}
        >
          {commitLabel(destination, plan.pageCount)}
        </button>

        {/*
          Reasons as adjacent VISIBLE text, not a tooltip on a disabled control.
          A button that refuses without saying why is how a user concludes the
          app is broken, and a `title` is unreachable by keyboard and by touch.
        */}
        {plan.blockers.length > 0 && (
          <ul role="list" className="mt-3 flex flex-col gap-1">
            {plan.blockers.map((b) => (
              <li key={b} className="text-sm text-neutral-700 dark:text-neutral-300">{b}</li>
            ))}
          </ul>
        )}
        {/*
          A ready plan with nothing to commit means ONE thing now: Canvas is the
          destination and there is no verified connection behind it. The cartridge
          always has a writer, and a destination that was never chosen shows up as
          a blocker above rather than here.

          This used to say "producing the file is not built yet — that is the
          cartridge writer, and it is the next thing", which was true when the plan
          screen landed and is now false twice over. Naming the actual remedy is
          the difference between a dead end and a next step.
        */}
        {ready && !onCommit && (
          <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
            Connect Canvas on the Destination screen to push these pages. Nothing is sent
            until you do.
          </p>
        )}
      </div>
    </section>
  )
}

function StatusTag({ status }: { status: PageStatus }) {
  /*
    ICON AND WORDS, never colour alone. "You are about to overwrite your own
    work" is the most expensive thing on this screen to miss, and a tag that
    said it in amber would say it only to people who can see amber.
  */
  if (status.kind === 'overwrite') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-amber-800 dark:text-amber-200">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Replaces an existing page
      </span>
    )
  }
  if (status.kind === 'new') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
        <Plus className="size-3.5" aria-hidden="true" />
        New page
      </span>
    )
  }
  // Refused, not guessed — and the two refusals are not the same refusal. One
  // is a list that never arrived; the other is a course containing two pages
  // with this title and nothing to say which is this section's.
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
      <HelpCircle className="size-3.5" aria-hidden="true" />
      {status.reason === 'ambiguous'
        ? 'New or update — two pages in the course share this title'
        : 'New or update — existing pages couldn’t be loaded'}
    </span>
  )
}
