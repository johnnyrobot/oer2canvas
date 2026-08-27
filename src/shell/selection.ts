import type { CompiledChapter, CompiledSection } from '../contracts/index'
import { mergeQueues } from '../engine/compile/index'

/**
 * The selection: chapters chosen to prepare together, and how they are viewed
 * as one thing and then taken apart again.
 *
 * §2.3's requirement is "ONE QUEUE ACROSS THE WHOLE SELECTION, deduplicated by
 * image content hash". That is not a convenience — an image reused in four
 * chapters must be asked about once, and the dedupe only works if every
 * chapter's items are in the same queue. So preparation produces a
 * `CompiledChapter` per chapter, `mergeSelection` presents them to the queue as
 * one, and `regroup` takes the ANSWERED result apart again.
 *
 * `regroup` reads sections back out of the merged, answered chapter rather than
 * off the originals. An answer rebuilds the section it touched, so the
 * pre-answer copy is stale by construction, and rendering it would show a
 * verdict beside bytes it does not describe.
 */

/** One `CompiledChapter` over every selected chapter's sections, in order. */
export function mergeSelection(chapters: readonly CompiledChapter[]): CompiledChapter | undefined {
  if (chapters.length === 0) return undefined
  const sections = chapters.flatMap((c) => c.sections)
  // `chapter` is the first one's, and is only ever read for display. `regroup`
  // is what restores per-chapter identity before anything is shown.
  return { chapter: chapters[0]!.chapter, sections, queue: mergeQueues(sections) }
}

/**
 * Split an answered merged chapter back into one `CompiledChapter` per original.
 *
 * Membership is by section id, which is safe because these are publisher page
 * identifiers — OpenStax uses page uuids — and are unique across a book rather
 * than only within a chapter.
 */
export function regroup(
  originals: readonly CompiledChapter[],
  answered: CompiledChapter,
): CompiledChapter[] {
  const bySection = new Map<string, CompiledSection>(answered.sections.map((s) => [s.id, s]))
  return originals.map((c) => {
    const sections = c.sections.map((s) => bySection.get(s.id) ?? s)
    return { ...c, sections, queue: mergeQueues(sections) }
  })
}

/** Add or remove one chapter, preserving the order chapters were listed in. */
export function toggle<T extends { id: string }>(
  selected: readonly T[], item: T, order: readonly T[],
): T[] {
  const has = selected.some((s) => s.id === item.id)
  const next = has ? selected.filter((s) => s.id !== item.id) : [...selected, item]
  const rank = new Map(order.map((o, i) => [o.id, i]))
  // Sorted by the book's own order rather than by click order: a tray listing
  // chapters 7, 2, 9 describes the user's clicking, not their selection.
  return [...next].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
}

/** "Prepare 3 chapters" / "Prepare 1 chapter" — never "Prepare 1 chapters". */
export function prepareLabel(count: number): string {
  return count === 1 ? 'Prepare 1 chapter' : `Prepare ${count} chapters`
}
