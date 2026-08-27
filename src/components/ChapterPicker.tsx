import type { ChapterOutline } from '../sources/openstax'
import { prepareLabel } from '../shell/selection'

/**
 * Pick chapters — plural, and reversibly.
 *
 * The single-pick version navigated away on click, which made the selection
 * invisible and unchangeable: there was nothing to look at and no way to change
 * your mind. §2.3 wants one queue across the WHOLE selection, and a selection
 * you cannot see is not one.
 *
 * `role="list"` is not redundant: Tailwind's preflight sets `list-style: none`,
 * and an unmarkered `ul` stops being announced as a list in Safari + VoiceOver.
 */
export function ChapterPicker({
  outlines, selected, onToggle, onPrepare, onChangeBook,
}: {
  outlines: ChapterOutline[]
  selected: readonly ChapterOutline[]
  onToggle: (o: ChapterOutline) => void
  onPrepare: () => void
  onChangeBook: () => void
}) {
  const chosen = new Set(selected.map((s) => s.id))
  const sections = selected.reduce((n, o) => n + o.sections.length, 0)

  return (
    <section aria-labelledby="picker-heading" className="mx-auto max-w-3xl pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="picker-heading" className="text-xl font-semibold">Chapters</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Choose as many as you like. They are checked together, so an image used in more than
            one chapter is only asked about once.
          </p>
        </div>
        <button
          type="button"
          onClick={onChangeBook}
          className="min-h-9 shrink-0 rounded-md border border-neutral-300 px-3 text-sm font-medium hover:border-brand-500 dark:border-neutral-700"
        >
          Choose a different book
        </button>
      </div>

      <ul role="list" className="mt-4 flex flex-col gap-2">
        {outlines.map((o) => {
          const isChosen = chosen.has(o.id)
          return (
            <li key={o.id}>
              {/*
                A real checkbox in a real label. The obvious alternative — a
                button with `aria-pressed` — loses the group semantics that let a
                screen reader user hear "3 of 13 selected", and loses the native
                Space toggle every keyboard user already knows.
              */}
              <label
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${
                  isChosen
                    ? 'border-brand-500 bg-brand-50 dark:bg-neutral-800'
                    : 'border-neutral-200 bg-white hover:border-brand-500 dark:border-neutral-800 dark:bg-neutral-900'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChosen}
                  onChange={() => onToggle(o)}
                  className="size-5 shrink-0 accent-brand-700"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{o.title}</span>
                <span className="shrink-0 text-sm text-neutral-600 dark:text-neutral-400">
                  ({o.sections.length} sections)
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      {/*
        The action sits with the selection rather than in the shell chrome: it is
        the answer to "what happens to these", and a commit control parked far
        from the thing it commits is how somebody prepares the wrong set.

        Rendered only when something is selected — unlike the chips above, which
        teach a concept by naming their empty state, this is a control that would
        do nothing.
      */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur md:pl-72 dark:border-neutral-800 dark:bg-neutral-950/95">
          <div className="mx-auto flex max-w-3xl items-center gap-4">
            <p className="min-w-0 flex-1 truncate text-sm">
              <strong>{prepareLabel(selected.length).replace('Prepare ', '')}</strong>
              <span className="text-neutral-600 dark:text-neutral-400">
                {` — ${sections} sections in total`}
              </span>
            </p>
            <button
              type="button"
              onClick={onPrepare}
              className="min-h-9 shrink-0 rounded-md bg-brand-700 px-4 text-sm font-medium text-white"
            >
              {prepareLabel(selected.length)}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
