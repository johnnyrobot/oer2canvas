import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Compass, Download, Info, Plus, RefreshCw, School } from 'lucide-react'
import { CanvasConnect } from './CanvasConnect'
import type { CompiledChapter } from '../contracts/index'
import type { PushedPage, PushStop } from '../canvas/push'
import type { Destination } from './phases'

/**
 * The three screens the redesign adds, at shell depth.
 *
 * Destination is real: choosing a cartridge is a complete, credential-free
 * decision and the shell's progress model needs something genuine to react to.
 * Plan and Result own the final handoff: they describe the pages before a write
 * and the exact pages after a write, rather than hiding an irreversible action
 * behind a generic “continue” button.
 */

const CARD =
  'flex flex-col gap-3 rounded-lg border bg-white p-5 text-left dark:bg-neutral-900 ' +
  'border-neutral-200 dark:border-neutral-800'

export function DestinationScreen({
  destination, onChoose, canvas,
}: {
  destination?: Destination
  onChoose: (d: Destination) => void
  /** Everything the connection region needs. Owned by whoever owns the client. */
  canvas?: Parameters<typeof CanvasConnect>[0]
}) {
  const chosen = destination?.kind
  /*
    WHICH CARD IS OPEN, which is not the same thing as which destination is
    CHOSEN — and conflating the two is what this screen used to do. Picking the
    Canvas card committed a destination of `courseId: 0, courseName: 'A Canvas
    course'`, so the top bar and the Plan screen both went on to name a course
    that does not exist. Canvas is a decision that STARTS here and is finished by
    choosing a real course.
  */
  const [opened, setOpened] = useState<'canvas' | 'cartridge' | undefined>(
    chosen === 'canvas' && canvas === undefined ? undefined : chosen,
  )
  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="text-xl font-semibold">Where should these chapters go?</h2>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        Pick this first. It decides what the rest of the workflow can show you — including
        which pages already exist and what a second run would do.
      </p>

      {/*
        Equal weight, deliberately. The cartridge path is a first-class product
        and not a fallback for people without a token. A card styled as the
        lesser option would misrepresent the supported output paths.
      */}
      <div className={`mt-6 grid gap-4 ${canvas ? 'sm:grid-cols-2' : ''}`}>
        {canvas && (
          <button
            type="button"
            onClick={() => setOpened('canvas')}
            aria-pressed={opened === 'canvas'}
            className={`${CARD} ${opened === 'canvas' ? 'outline outline-2 outline-brand-500' : ''}`}
          >
            <School className="size-6 text-brand-700 dark:text-brand-300" aria-hidden="true" />
            <span className="font-semibold">A Canvas course</span>
            <span className="text-sm text-neutral-700 dark:text-neutral-300">
              Pushes pages straight into a course you choose. Running it again{' '}
              <strong>updates the same pages</strong> — it never leaves second copies.
            </span>
            <span className="mt-auto text-xs text-neutral-600 dark:text-neutral-400">
              You will connect Canvas, pick a course, and see its existing pages before anything
              is sent.
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => { setOpened('cartridge'); onChoose({ kind: 'cartridge' }) }}
          aria-pressed={opened === 'cartridge'}
          className={`${CARD} ${opened === 'cartridge' ? 'outline outline-2 outline-brand-500' : ''}`}
        >
          <Download className="size-6 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <span className="font-semibold">A cartridge file</span>
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            Downloads a Common Cartridge you import yourself. No account, no token, nothing
            to connect.
          </span>
          <span className="mt-auto text-xs text-neutral-700 dark:text-neutral-300">
            {/*
              This card used to warn that importing again duplicates. It was
              repeating the PRD rather than a measurement, and the measurement
              says otherwise — see `reRunBehaviour` in `shell/plan.ts`.
            */}
            Importing it again <strong>updates the same pages</strong> rather than duplicating
            them.
          </span>
        </button>
      </div>

      {opened === 'canvas' && canvas && (
        <CanvasConnect
          {...canvas}
          onPickCourse={(id) => {
            canvas.onPickCourse(id)
            const course = canvas.courses?.find((c) => c.id === id)
            // The destination is only real once it names a course that exists.
            if (course) onChoose({ kind: 'canvas', courseId: id, courseName: course.name })
          }}
        />
      )}

      {opened === 'cartridge' && (
        <p className="mt-6 text-sm text-neutral-700 dark:text-neutral-300">
          Nothing to set up. Pick your chapters next.
        </p>
      )}
    </section>
  )
}

/** What a push did, as the Result screen needs it. */
export interface PushReport {
  courseName: string
  courseId?: number
  courseBaseUrl?: string
  landed: readonly PushedPage[]
  stoppedBy?: PushStop
  remaining: readonly PushedPage[]
}

export function ResultScreen({
  filename, chapters, push, onResume, onDownloadAgain,
}: {
  filename?: string
  chapters: readonly CompiledChapter[]
  push?: PushReport
  onResume?: () => void
  onDownloadAgain?: () => void
}) {
  if (push) return <PushResult push={push} onResume={onResume} />
  if (!filename) {
    return (
      <Placeholder
        icon={Compass}
        title="What landed"
        lead="Item by item, including a run that stopped part-way."
        body="There is no rollback: a push that dies at item 7 of 15 leaves those 7 in place, says so, and offers to resume."
      />
    )
  }

  const pages = chapters.reduce(
    (n, c) => n + c.sections.filter((sec) => !sec.error && sec.html.length > 0).length,
    0,
  )
  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <CheckCircle2 className="size-6 text-brand-700 dark:text-brand-300" aria-hidden="true" />
        Cartridge downloaded
      </h2>
      <p className="mt-2 text-sm">
        <strong>{filename}</strong> — {pages === 1 ? '1 page' : `${pages} pages`} from{' '}
        {chapters.length === 1 ? '1 chapter' : `${chapters.length} chapters`}.
      </p>

      {/*
        The handoff, not an endpoint: the user is holding a file and still has to
        do something with it. Naming the exact Canvas path is the difference
        between a finished task and a file in a downloads folder.
      */}
      <h3 className="mt-6 text-sm font-semibold">Importing it</h3>
      <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        In Canvas: <strong>Course Settings → Import Course Content → Common Cartridge 1.x
        Package</strong>, then choose this file.
      </p>

      {/*
        Measured on a live Canvas with both importers: a second import of the
        same file produced no duplicates and left `updated_at` untouched. This
        used to say the opposite, in the indicative, because the PRD asserted it.
      */}
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-brand-500 bg-brand-50 p-4 text-sm text-brand-700 dark:border-brand-500 dark:bg-neutral-900 dark:text-brand-300">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>
          Importing this file again updates the pages it created rather than duplicating
          them. Pages you added yourself in Canvas are left alone.
        </p>
      </div>
      {onDownloadAgain && (
        <button
          type="button"
          className="mt-4 rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold dark:border-neutral-700"
          onClick={onDownloadAgain}
        >
          Download again
        </button>
      )}
    </section>
  )
}

/**
 * §8 — item by item, including a run that stopped part-way.
 *
 * THERE IS NO ROLLBACK, and this screen is where that stops being an
 * implementation note and becomes something the user has to be told. A push that
 * died at page 7 of 15 left seven pages in a live course. An instructor who is
 * not told will either go looking for a course they believe is untouched, or
 * re-run the whole thing — and the second one is only safe BECAUSE every write
 * is an idempotent PUT, which is not a thing anybody should have to know.
 */
function PushResult({ push, onResume }: { push: PushReport; onResume?: () => void }) {
  const total = push.landed.length + push.remaining.length
  const stopped = push.stoppedBy !== undefined

  return (
    <section className="mx-auto max-w-2xl">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        {stopped ? (
          <AlertTriangle className="size-6 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-6 text-brand-700 dark:text-brand-300" aria-hidden="true" />
        )}
        {stopped ? 'Push stopped part-way' : 'Pushed to Canvas'}
      </h2>

      <p className="mt-2 text-sm" role="status">
        {stopped
          ? `${push.landed.length} of ${total} pages reached ${push.courseName}. They are left in place — nothing was undone.`
          : `${total} ${total === 1 ? 'page' : 'pages'} in ${push.courseName}.`}
      </p>

      {push.stoppedBy && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>
            Stopped at <strong>{push.stoppedBy.title}</strong>. {push.stoppedBy.reason}
          </span>
        </div>
      )}

      {stopped && onResume && push.remaining.length > 0 && (
        <button
          type="button"
          className="mt-4 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
          onClick={onResume}
        >
          Resume — {push.remaining.length} {push.remaining.length === 1 ? 'page' : 'pages'} left
        </button>
      )}

      <ul className="mt-6 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
        {push.landed.map((p) => (
        <li key={p.slug} className="flex items-center justify-between gap-3 py-2">
            <span>
              {p.title}
              <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                {p.chapterTitle}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <Outcome outcome={p.outcome} />
              {p.url && push.courseBaseUrl && push.courseId !== undefined && (
                <a
                  href={`${push.courseBaseUrl}/courses/${push.courseId}/pages/${encodeURIComponent(p.url)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  View in Canvas<span className="sr-only">: {p.title} (opens in new tab)</span>
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Icon AND words. What a run did to an existing page is not a thing to encode in colour. */
function Outcome({ outcome }: { outcome: PushedPage['outcome'] }) {
  if (outcome === 'updated') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-amber-800 dark:text-amber-200">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Replaced an existing page
      </span>
    )
  }
  if (outcome === 'created') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
        <Plus className="size-3.5" aria-hidden="true" />
        Created
      </span>
    )
  }
  // The course was never read, so whether this replaced anything is genuinely
  // not known. Saying "Created" here would be the screen inventing a fact.
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
      Sent
    </span>
  )
}

function Placeholder({
  icon: Icon, title, lead, body,
}: { icon: typeof Compass; title: string; lead: string; body: string }) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
      <Icon className="mx-auto size-8 text-neutral-500" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{lead}</p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        No result has been recorded
      </p>
    </section>
  )
}
