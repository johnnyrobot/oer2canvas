/**
 * The six-phase workflow, and the rules for when each phase is reachable.
 *
 * This is a pure module on purpose: the sidebar is a PROGRESS MODEL, not
 * decoration, and "can I go here yet, and if not why not" is the one piece of
 * it worth testing without a DOM.
 *
 * AN UNREACHABLE PHASE IS DISABLED WITH A REASON, NEVER HIDDEN. Hiding steps is
 * how the app being replaced lost the user's sense of the workflow: they could
 * not see that a destination existed, so they never wondered where their chapter
 * was going. Every phase is always in the sidebar; some of them say why not yet.
 */

/**
 * Every phase is named for what the USER does, not what the machine does.
 *
 * Compiling and auditing is the app's work; the user's work is confirming the
 * handful of things only a human can decide — is this image decorative, does
 * this table have headers. When there is nothing to confirm, this phase asks
 * for nothing and says so.
 *
 * IDEA is the one OPTIONAL phase. It is a reflective review against the ASCCC
 * OERI IDEA Framework, and it never gates Plan: the accessibility queue is a
 * legal requirement, this is not, and a mandatory equity gate is how a tool
 * gets abandoned. It is always in the sidebar, and it never reads "done" on
 * its own — an instructor decides when their review is finished.
 */
export type PhaseId = 'destination' | 'chapters' | 'review' | 'idea' | 'plan' | 'result'

export const PHASE_ORDER: readonly PhaseId[] = [
  'destination', 'chapters', 'review', 'idea', 'plan', 'result',
] as const

export const PHASE_LABEL: Readonly<Record<PhaseId, string>> = {
  destination: 'Destination',
  chapters: 'Content',
  review: 'Review',
  idea: 'IDEA',
  plan: 'Plan',
  result: 'Result',
}

/** Where the work is going. Both arms are first-class; neither is a fallback. */
export type Destination =
  | { kind: 'canvas'; courseId: number; courseName: string }
  | { kind: 'cartridge' }

export interface ShellState {
  destination?: Destination
  selectedCount: number
  /** Selected chapters that have finished compile + audit. */
  preparedCount: number
  /** Queue items still awaiting a human answer, across the whole selection. */
  unansweredCount: number
  /** IDEA categories with a complete rating, across the selection. Never gates anything. */
  ideaRated: number
  /** IDEA categories in the selection: 8 per prepared chapter. */
  ideaTotal: number
  /** True once a push or download has been committed at least once. */
  committed: boolean
}

export type PhaseAvailability =
  | { state: 'done' }
  /** `detail` is read after the name — "IDEA, optional" — and shown beside it. */
  | { state: 'available'; detail?: string }
  /** `reason` completes the sentence "Plan — <reason>", and is read aloud. */
  | { state: 'unavailable'; reason: string }

export const EMPTY_SHELL: ShellState = {
  selectedCount: 0,
  preparedCount: 0,
  unansweredCount: 0,
  ideaRated: 0,
  ideaTotal: 0,
  committed: false,
}

/** What the IDEA phase says beside its name. Never empty — absence is information. */
export function ideaSummary(rated: number, total: number): string {
  if (rated === 0) return 'optional'
  return `${rated} of ${total} rated`
}

/**
 * `done` beats `unavailable`: a phase you have already satisfied never reads as
 * blocked just because a LATER phase moved on. Walking back to Destination after
 * choosing one must not present it as forbidden.
 */
export function phaseAvailability(s: ShellState): Record<PhaseId, PhaseAvailability> {
  const hasDestination = s.destination !== undefined
  const hasSelection = s.selectedCount > 0
  const prepared = hasSelection && s.preparedCount >= s.selectedCount
  const queueClear = s.unansweredCount === 0

  return {
    destination: hasDestination ? { state: 'done' } : { state: 'available' },

    chapters: hasSelection
      ? { state: 'done' }
      : hasDestination
        ? { state: 'available' }
        : { state: 'unavailable', reason: 'choose where this goes first' },

    review: prepared && queueClear
      ? { state: 'done' }
      : hasSelection
        ? { state: 'available' }
        : { state: 'unavailable', reason: 'select chapters first' },

    // Never `done`: a rated review is a review the instructor considers
    // finished, and only they know that. `available` with a detail instead.
    idea: !hasSelection
      ? { state: 'unavailable', reason: 'select chapters first' }
      : !prepared
        ? { state: 'unavailable', reason: 'checks are still running' }
        : { state: 'available', detail: ideaSummary(s.ideaRated, s.ideaTotal) },

    plan: s.committed
      ? { state: 'done' }
      : !hasSelection
        ? { state: 'unavailable', reason: 'select chapters first' }
        : !prepared
          ? { state: 'unavailable', reason: 'checks are still running' }
          // D5, and the reason the gate is named in the sidebar rather than only
          // discovered at the commit button: nothing publishes until the queue is
          // empty, so Plan is not somewhere you can stand and be surprised.
          : !queueClear
            ? { state: 'unavailable', reason: `${s.unansweredCount} items still need answers` }
            : { state: 'available' },

    result: s.committed
      ? { state: 'available' }
      : { state: 'unavailable', reason: 'nothing has been sent yet' },
  }
}

/** What the top bar's destination chip says. Never empty — absence is information. */
export function destinationLabel(d: Destination | undefined): string {
  if (!d) return 'Choose where this goes'
  return d.kind === 'canvas' ? d.courseName : 'Cartridge file'
}

/** What the top bar's selection chip says. Never empty, for the same reason. */
export function selectionLabel(count: number): string {
  if (count === 0) return 'No chapters selected'
  return count === 1 ? '1 chapter' : `${count} chapters`
}
