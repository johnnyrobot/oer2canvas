import { useEffect, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'

/**
 * What you have picked, visible from anywhere and changeable without going back.
 *
 * §4 of the redesign. The selection chip used to navigate to Chapters, which is
 * not the same thing: it answered "how many?" by making you leave the screen you
 * were on and find them again in a list of forty. A selection you cannot inspect
 * in place is barely a selection — it is a number.
 *
 * `role="dialog"` with `aria-modal`, Escape to close, focus moved in on open and
 * returned to the chip on close. That is the minimum for something that appears
 * over the page; without the focus return, a keyboard user who closes the tray is
 * dropped at the top of the document.
 */

export interface TrayItem {
  id: string
  title: string
  sectionCount: number
}

export function SelectionTray({
  items, onRemove, onClear, onClose,
}: {
  items: readonly TrayItem[]
  onRemove: (id: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const pages = items.reduce((n, i) => n + i.sectionCount, 0)

  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/*
        The scrim closes on click but is `aria-hidden`: it is a pointer
        affordance, and announcing "button" for the whole page would be a lie.
        Escape is the keyboard equivalent, and the close button is the visible one.
      */}
      <div
        className="fixed inset-0 z-40 bg-neutral-950/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tray-heading"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="flex min-h-16 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
          <BookOpen className="size-5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="tray-heading" className="text-sm font-semibold">
              {items.length === 1 ? '1 chapter selected' : `${items.length} chapters selected`}
            </h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {pages === 1 ? '1 section in total' : `${pages} sections in total`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close selection"
            className="grid min-h-9 min-w-9 place-items-center rounded-md"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <ul role="list" className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-3">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{i.title}</span>
                <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                  {i.sectionCount === 1 ? '1 section' : `${i.sectionCount} sections`}
                </span>
              </span>
              {/*
                The chapter title is in the accessible name, not just "Remove":
                a list of eight identical "Remove" buttons is unusable by anyone
                navigating by control.
              */}
              <button
                type="button"
                onClick={() => onRemove(i.id)}
                aria-label={`Remove ${i.title} from the selection`}
                className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-md text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          {/*
            Two-step rather than a confirm dialog. §1.5 asks that anything which
            throws work away confirms; a second click on a button that has
            changed its own label does that without stacking a modal on a modal,
            and it resets on close so the armed state cannot be stumbled into
            later.
          */}
          <button
            type="button"
            onClick={() => {
              if (!confirmingClear) return setConfirmingClear(true)
              onClear()
              setConfirmingClear(false)
              onClose()
            }}
            className="min-h-9 w-full rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700"
          >
            {confirmingClear ? 'Clear all — click again to confirm' : 'Clear all'}
          </button>
        </div>
      </div>
    </>
  )
}
