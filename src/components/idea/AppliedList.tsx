/**
 * Every edit the instructor has made to the chapter, each with Undo. An entry
 * whose original is no longer where its key says (`stale`) says so: the edit
 * is kept in the map — a decision is not thrown away because the text moved —
 * but the compile step did not apply it, and the list must not claim it did.
 */
import { useId } from 'react'
import { parseIdeaEditKey } from '../../engine/idea/edits'
import type { AppliedEdit } from '../../engine/idea/applied'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'

export function AppliedList({
  applied, onUndo,
}: {
  applied: readonly AppliedEdit[]
  onUndo: (key: string) => void
}) {
  const ids = useId()
  if (applied.length === 0) return null
  const c = IDEA_COPY.applied
  return (
    <div>
      <h5 className="mb-1 text-sm font-semibold">{c.heading}</h5>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {applied.map(({ key, edit, stale, sectionTitle }, i) => {
          const { original } = parseIdeaEditKey(key)
          const what = edit.kind === 'replace' ? c.replaced(original, edit.replacement)
            : edit.kind === 'image' ? c.image(edit.alt)
            : c.kept(original, edit.context)
          // The button's NAME stays "Undo"; the change it undoes is its
          // description, so a screen reader hears both without the visible
          // text appearing twice.
          const whatId = `${ids}-${i}`
          return (
            <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
              <span id={whatId}>{what}</span>
              <span className="text-neutral-600 dark:text-neutral-400">{IDEA_COPY.findings.where(sectionTitle)}</span>
              {stale && (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="text-neutral-600 dark:text-neutral-400">{c.stale}</span>
                </>
              )}
              <button
                type="button"
                className={`${TARGET} rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700`}
                aria-describedby={whatId}
                onClick={() => onUndo(key)}
              >
                {c.undo}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
