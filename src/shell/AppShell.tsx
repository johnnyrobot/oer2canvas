import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen, Check, CheckCircle2, ClipboardList, Compass, ListChecks,
  Monitor, Moon, PanelLeft, Scale, Settings, Sun, type LucideIcon,
} from 'lucide-react'
import {
  PHASE_LABEL, PHASE_ORDER, destinationLabel, phaseAvailability, selectionLabel,
  type PhaseId, type ShellState,
} from './phases'
import { useTheme, type AppTheme } from './useTheme'
import { SelectionTray, type TrayItem } from './SelectionTray'

/**
 * The persistent app shell.
 *
 * THE ONE IDEA: navigation sits BESIDE the screen, it does not replace it. The
 * app this supersedes routed by unmounting — pick a book and the book list was
 * simply gone — so the user could never see that a destination existed, never
 * wondered where their chapter was going, and had no way back that did not feel
 * like starting over. Every phase is on screen at all times; some of them say
 * why they are not ready yet.
 */

const PHASE_ICON: Readonly<Record<PhaseId, LucideIcon>> = {
  destination: Compass,
  chapters: BookOpen,
  review: ListChecks,
  idea: Scale,
  plan: ClipboardList,
  result: CheckCircle2,
}

const THEMES: readonly { theme: AppTheme; label: string; icon: LucideIcon }[] = [
  { theme: 'light', label: 'Light', icon: Sun },
  { theme: 'dark', label: 'Dark', icon: Moon },
  { theme: 'system', label: 'System', icon: Monitor },
]

/** Every control in here clears SC 2.5.8's 24x24 floor by construction. */
const TARGET = 'min-h-9 min-w-9'

export interface AppShellProps {
  active: PhaseId
  onNavigate: (phase: PhaseId) => void
  shell: ShellState
  /** Mounted empty rather than conditionally rendered — see the live regions below. */
  status?: string
  error?: string
  /** Rendered only while work is in flight, adjacent to the status it cancels. */
  onCancel?: () => void
  /**
   * What the selection chip opens. Absent while nothing is selected, in which
   * case the chip falls back to navigating to Chapters — there is nothing to
   * inspect, and a tray reading "0 chapters" would be a dead end.
   */
  selection?: {
    items: readonly TrayItem[]
    onRemove: (id: string) => void
    onClear: () => void
  }
  children: ReactNode
}

export function AppShell({
  active, onNavigate, shell, status = '', error = '', onCancel, selection, children,
}: AppShellProps) {
  const availability = phaseAvailability(shell)
  const { theme, setTheme } = useTheme()
  const [trayOpen, setTrayOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Focus returns here on close; a keyboard user who closes the tray should be
  // back on the control that opened it, not at the top of the document.
  const chipRef = useRef<HTMLButtonElement>(null)
  const canOpenTray = (selection?.items.length ?? 0) > 0

  // Screen changes are navigation, even though the shell stays mounted. Move
  // focus to the persistent heading so keyboard and screen-reader users get a
  // reliable handoff instead of remaining on the control that caused the move.
  useEffect(() => {
    headingRef.current?.focus()
  }, [active])

  return (
    <div className="flex min-h-screen bg-stone-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <aside
        id="workflow-navigation"
        aria-label="Workflow navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-white transition-transform dark:border-neutral-800 dark:bg-neutral-950 md:static md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex min-h-16 items-center justify-center gap-3 border-b border-neutral-200 px-3 md:justify-start md:px-4 dark:border-neutral-800">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-700 text-white">
            <BookOpen className="size-5" aria-hidden="true" />
          </div>
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-semibold">oer2canvas</p>
            <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
              OER chapters, accessibly, into Canvas
            </p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-2 py-4 md:px-3" aria-label="Workflow">
          {PHASE_ORDER.map((id) => (
              <PhaseButton
                key={id}
                id={id}
                active={active === id}
                availability={availability[id]}
                onNavigate={(next) => {
                  onNavigate(next)
                  setMobileNavOpen(false)
                }}
              />
          ))}
        </nav>

        <div className="border-t border-neutral-200 p-2 md:p-3 dark:border-neutral-800">
          <div className="flex gap-1" role="group" aria-label="Colour theme">
            {THEMES.map(({ theme: t, label, icon: Icon }) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                /*
                 * `aria-pressed` in addition to the visual highlight. The
                 * reference app carries the active state in colour and shadow
                 * alone, which is exactly the colour-only carrier this app
                 * refuses to ship in other people's content (SC 1.4.1).
                 */
                aria-pressed={theme === t}
                title={label}
                className={`${TARGET} flex flex-1 items-center justify-center rounded-md border text-neutral-700 dark:text-neutral-300 ${
                  theme === t
                    ? 'border-brand-500 bg-brand-50 text-brand-700 outline outline-brand-500 dark:bg-neutral-800 dark:text-brand-300'
                    : 'border-transparent hover:bg-stone-100 dark:hover:bg-neutral-900'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b border-neutral-200 bg-white px-4 md:px-6 dark:border-neutral-800 dark:bg-neutral-950">
          <button
            type="button"
            className={`${TARGET} grid shrink-0 place-items-center rounded-md md:hidden`}
            aria-label="Toggle navigation"
            aria-expanded={mobileNavOpen}
            aria-controls="workflow-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </button>
          <h1 ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold">{PHASE_LABEL[active]}</h1>

          {/*
            The two chips answer "what am I taking" and "where is it going" from
            every screen in the app, which is priority 1 of the redesign. They
            are never hidden when empty: a chip that disappears teaches nothing,
            while one reading "No chapters selected" teaches the concept.
          */}
          <Chip
            ref={chipRef}
            icon={BookOpen}
            onClick={() => (canOpenTray ? setTrayOpen(true) : onNavigate('chapters'))}
            label={selectionLabel(shell.selectedCount)}
            expanded={canOpenTray ? trayOpen : undefined}
          />
          <Chip
            icon={Compass}
            onClick={() => onNavigate('destination')}
            label={destinationLabel(shell.destination)}
            primary={shell.destination === undefined}
          />
          <button
            ref={settingsButtonRef}
            type="button"
            className={`${TARGET} grid shrink-0 place-items-center rounded-md`}
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" aria-hidden="true" />
          </button>
        </header>

        {/*
          Both live regions are mounted from first render and never hidden, empty
          or not. A live region INSERTED at the moment it gains content is
          announced unreliably across screen reader/browser pairs; one already in
          the accessibility tree when its text changes is not. Carried over from
          the app being replaced, which got this right.
        */}
        <div className="px-4 md:px-6">
          <div className="flex flex-wrap items-center gap-3 py-2">
            <p role="status" aria-live="polite" className="text-sm text-neutral-700 dark:text-neutral-300">{status}</p>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`}
              >
                Cancel
              </button>
            )}
          </div>
          <p role="alert" className="text-sm text-red-700 empty:m-0 dark:text-red-400">{error}</p>
        </div>

        <main className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-6">{children}</main>
      </div>

      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {trayOpen && selection && canOpenTray && (
        <SelectionTray
          items={selection.items}
          onRemove={selection.onRemove}
          onClear={selection.onClear}
          onClose={() => {
            setTrayOpen(false)
            chipRef.current?.focus()
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => {
            setSettingsOpen(false)
            // Wait until the dialog has unmounted; otherwise the browser may
            // move focus to the next control while React removes the focused
            // close button.
            window.setTimeout(() => settingsButtonRef.current?.focus(), 0)
          }}
        />
      )}
    </div>
  )
}

function SettingsDialog({
  theme,
  onThemeChange,
  onClose,
}: {
  theme: AppTheme
  onThemeChange: (theme: AppTheme) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="settings-heading" className="text-lg font-semibold">Settings</h2>
            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              Choose how oer2canvas looks. Content and source pages stay in your browser.
            </p>
          </div>
          <button ref={closeRef} type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={onClose}>
            Close
          </button>
        </div>
        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Colour theme</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {THEMES.map(({ theme: candidate, label }) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={theme === candidate}
                className={`${TARGET} rounded-md border px-2 text-sm ${theme === candidate ? 'border-brand-700 bg-brand-50 text-brand-700 dark:bg-neutral-800 dark:text-brand-300' : 'border-neutral-300 dark:border-neutral-700'}`}
                onClick={() => onThemeChange(candidate)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </div>
  )
}

function Chip({
  ref, icon: Icon, label, onClick, primary = false, expanded,
}: {
  ref?: React.Ref<HTMLButtonElement>
  icon: LucideIcon
  label: string
  onClick: () => void
  primary?: boolean
  /** Present only when this chip controls a disclosure, so it is never a lie. */
  expanded?: boolean
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      className={`${TARGET} hidden shrink-0 items-center gap-2 rounded-full border px-3 text-sm sm:flex ${
        primary
          ? 'border-brand-700 bg-brand-700 text-white'
          : 'border-neutral-300 text-neutral-800 dark:border-neutral-700 dark:text-neutral-200'
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="max-w-40 truncate">{label}</span>
    </button>
  )
}

function PhaseButton({
  id, active, availability, onNavigate,
}: {
  id: PhaseId
  active: boolean
  availability: ReturnType<typeof phaseAvailability>[PhaseId]
  onNavigate: (p: PhaseId) => void
}) {
  const Icon = PHASE_ICON[id]
  const blocked = availability.state === 'unavailable'
  return (
    <button
      type="button"
      /*
       * `aria-disabled`, NOT `disabled`. A `disabled` button leaves the tab
       * order, so the reason it carries becomes unreachable by keyboard — which
       * turns "disabled with a reason" back into the hidden step this shell
       * exists to stop shipping.
       */
      aria-disabled={blocked}
      aria-current={active ? 'page' : undefined}
      onClick={() => { if (!blocked) onNavigate(id) }}
      className={`${TARGET} flex items-center gap-3 rounded-md px-2 text-sm md:px-3 ${
        active ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-neutral-800 dark:text-brand-300' : ''
      } ${blocked ? 'text-neutral-500 dark:text-neutral-500' : 'text-neutral-800 hover:bg-stone-100 dark:text-neutral-200 dark:hover:bg-neutral-900'}`}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="hidden truncate md:inline">{PHASE_LABEL[id]}</span>
      {availability.state === 'done' && (
        <>
          <Check className="ml-auto hidden size-4 shrink-0 text-brand-700 md:inline dark:text-brand-300" aria-hidden="true" />
          <span className="sr-only">done</span>
        </>
      )}
      {availability.state === 'available' && availability.detail && (
        <span className="ml-auto hidden truncate text-xs text-neutral-600 md:inline dark:text-neutral-400">
          <span className="sr-only">, </span>
          {availability.detail}
        </span>
      )}
      {/*
        The reason travels with the control rather than living in a tooltip: it
        is read out on focus, and it is the difference between "this is shut" and
        "this is shut because you have not chosen a destination".
      */}
      {blocked && <span className="sr-only">{`— ${availability.reason}`}</span>}
    </button>
  )
}
