/**
 * The queue session: everything the screen knows that the engine does not.
 *
 * A pure `(session, event) => session`, deliberately, so every rule in the
 * interaction design is testable with nothing rendered and no browser. The hook
 * in `useQueueSession.ts` is a shell over this; if logic starts accumulating
 * there instead, it has gone to the wrong place.
 *
 * NOTHING HERE MUTATES THE QUEUE. Answers shrink it by changing what compile
 * emits, which arrives back as a `recompiled` event. Skip does not touch it at
 * all. That is what makes skip structurally invisible to `isPublishable`
 * (D5.10): there is no code path from skipping to publishable, because skipping
 * cannot reach the only thing `isPublishable` reads.
 */
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { GateResult } from '../../engine/gate'
import type { QueueAnswer } from '../../engine/compile/answers'
import { queueKeyOf, validateAnswer } from '../../engine/compile/answers'
import { mergeQueues } from '../../engine/compile/index'
import { TABLE_REFUSAL } from '../../engine/compile/steps/tables'

/**
 * Triage, then writing, then structure (D5.8).
 *
 * Load-bearing, not cosmetic. A confirm-decorative item answered "needs a
 * description" becomes an ALT answer — so with alt second, every conversion
 * lands in a group the instructor has not reached yet. Put alt first and those
 * conversions land behind the cursor, in a group they believe they finished.
 */
const KIND_ORDER = ['confirm-decorative', 'alt', 'table-headers'] as const

/**
 * The three kinds, named as the card list and the announcements name them.
 *
 * One table, because the jump list, the answered list and the live region must
 * not drift apart — an instructor hearing "image needing a description" and
 * reading "needs alt text" has to work out that they are the same thing.
 */
export const KIND_WORD: Record<QueueItem['kind'], string> = {
  'confirm-decorative': 'image marked decorative',
  alt: 'image needing a description',
  'table-headers': 'table missing headers',
}

/** The same three, as a group is named in §3.1 and §3.2. Plural, lower case. */
const GROUP_WORD: Record<QueueItem['kind'], string> = {
  'confirm-decorative': 'images marked decorative',
  alt: 'images needing descriptions',
  'table-headers': 'tables missing headers',
}

export function traversal(queue: readonly QueueItem[], skipped: ReadonlySet<string>): string[] {
  const keys = queue
    .map((item, index) => ({ key: queueKeyOf(item), kind: item.kind, index }))
    .sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.index - b.index,
    )
    .map((entry) => entry.key)
  // Skipped items keep their relative order and go to the end of the WHOLE
  // traversal, not the end of their group: they are the tail of one linear walk,
  // which is what makes "keep going" reach them without a separate mode (D5.10).
  return [...keys.filter((k) => !skipped.has(k)), ...keys.filter((k) => skipped.has(k))]
}

/**
 * The sections an answer to `key` changes.
 *
 * This IS the propagation D5.2 promises: `CompiledChapter.queue` is deduped by
 * hash, so one image answered there may be an item in five different sections'
 * queues, and every one of them has to recompile. Walking the sections rather
 * than the merged queue is what finds the other four.
 */
export function sectionsAffectedBy(compiled: CompiledChapter, key: string): string[] {
  const ids = new Set<string>()
  for (const section of compiled.sections) {
    if (section.queue.some((item) => queueKeyOf(item) === key)) ids.add(section.id)
  }
  return [...ids]
}

/**
 * What the header line counts, and the one arithmetic in this screen.
 *
 * `answered + remaining + skipped` is invariant across the session: an answer
 * moves an item from remaining to answered, a skip moves it from remaining to
 * skipped, and a recompile removes the answered item from the queue while its
 * answer stays in the map. So the TOTAL the card and the header quote is this
 * sum, not `queue.length` — which shrinks as work is done and would make
 * "Item 5 of 25" turn into "Item 5 of 21" underneath the reader.
 */
export function counts(s: QueueSession): {
  answered: number
  remaining: number
  skipped: number
  total: number
} {
  const answered = s.answers.size
  const skipped = [...s.skipped].filter((k) => !s.answers.has(k)).length
  const remaining = s.compiled.queue.filter(
    (i) => !s.answers.has(queueKeyOf(i)) && !s.skipped.has(queueKeyOf(i)),
  ).length
  return { answered, remaining, skipped, total: answered + remaining + skipped }
}

export interface QueueSession {
  compiled: CompiledChapter
  answers: ReadonlyMap<string, QueueAnswer>
  /** Accept-with-note text, by key. The answered list shows it; nothing re-derives it. */
  notes: ReadonlyMap<string, string>
  skipped: ReadonlySet<string>
  /** Section ids whose gate no longer describes their bytes. */
  dirty: ReadonlySet<string>
  /**
   * Allowlist-REPAIRED bytes for a section awaiting re-audit, by section id
   * (D5.5). Repaired, not merely compiled: `ChapterView` may render only
   * repaired html, and that is a safety invariant rather than bookkeeping —
   * repair is what removes `on*` handlers and `<script>` subtrees. A section
   * with a gate renders `gate.html` and has no entry here.
   */
  displayHtml: ReadonlyMap<string, string>
  cursor: string | undefined
  /** Set by a refused answer, cleared by the next event. Drives the alert region. */
  refusal?: string
  /**
   * What the polite live region should say about the event that produced this
   * session. Derived here rather than in the view for the reason this whole
   * module exists: an announcement is interaction design, and it is testable
   * with nothing rendered only while it lives in the reducer.
   *
   * Set by the events a person causes and left ALONE by the two that arrive on
   * their own (`recompiled`, `audited`) — a background verdict landing must not
   * wipe a sentence a screen reader is still reading out.
   */
  announcement?: string
}

export type QueueEvent =
  | { type: 'answer'; key: string; answer: QueueAnswer }
  | { type: 'skip'; key: string }
  | { type: 'revisit'; key: string }
  | { type: 'jump'; key: string }
  /**
   * More of the chapter finished compiling (§3.6).
   *
   * DELIBERATELY NOT `recompiled`, which they superficially resemble. That one
   * reads an answered key still sitting in a rebuilt section's queue as a
   * refusal — a sound inference there, because the section had its chance to
   * consume the answer. These sections never had that chance: they came off the
   * FIRST compile, which ran before the answer existed. Sending them through
   * `recompiled` would drop good answers as refused, one per late section.
   */
  | { type: 'compiled'; sections: readonly CompiledSection[]; final?: boolean }
  /**
   * Layer 2 landed. Carries whole sections because one answer can change
   * several: an image answered by content hash propagates to every section that
   * uses that image (D5.2).
   */
  | { type: 'recompiled'; sections: readonly { section: CompiledSection; displayHtml: string }[] }
  /** Layer 3 landed. `forHtml` is the bytes it was run against — see `reduce`. */
  | { type: 'audited'; sectionId: string; forHtml: string; gate: GateResult }

/**
 * An answer compile would not apply, said in the instructor's terms.
 *
 * `fixTables` refuses a structural answer it cannot carry out safely and leaves
 * the item queued — the correctness half, and what stops a headerless table
 * shipping gate-clean. But an item that silently reappears reads as a bug, and
 * the obvious next move is to press the same option again. So the reason
 * travels back in the section's notes and becomes this.
 */
const refusalCopy = (reason: string): string =>
  `Not applied: ${reason}, so those cells cannot become headers without claiming a structure ` +
  'this table does not have. Choose another option, or mark it a layout table.'

/**
 * Defensive. A refused answer that carried no reason is a bug somewhere, but the
 * one outcome that must not happen is keeping an answer the html does not
 * reflect, so this says something rather than nothing and drops it anyway.
 */
const REFUSAL_WITHOUT_REASON =
  'Not applied: that answer could not be applied to this item. Choose another option, or skip ' +
  'it for now.'

/**
 * The announcements, in the wording §3 gives them.
 *
 * Every string below is quoted from the UX spec. They are not paraphrasable and
 * not summarisable: the live region is the ONLY place a screen-reader user is
 * told their place, and "place-keeping is triple-redundant" (§6) counts this as
 * the third leg alongside the card's position line and the header's counts.
 */

/** The item a key names, or nothing if the recompile has already removed it. */
function itemOf(s: QueueSession, key: string | undefined): QueueItem | undefined {
  return key === undefined ? undefined : s.compiled.queue.find((i) => queueKeyOf(i) === key)
}

/**
 * "Item 4 of 25 — image marked decorative", about wherever the cursor now is.
 *
 * `answered + 1` rather than an index into the traversal, because that is the
 * number the card prints, and two place-keepers disagreeing is worse than one.
 */
function place(s: QueueSession): string | undefined {
  const item = itemOf(s, s.cursor)
  if (!item) return undefined
  const tally = counts(s)
  return `Item ${tally.answered + 1} of ${tally.total} — ${KIND_WORD[item.kind]}`
}

/** How much unanswered work each kind is still holding. */
function groupSize(s: QueueSession, kind: QueueItem['kind']): number {
  // Skipped items count: they are unanswered work in that group, and the
  // instructor is going to be walked back through every one of them.
  return s.compiled.queue.filter((i) => i.kind === kind && !s.answers.has(queueKeyOf(i))).length
}

/**
 * "Group 2 of 3 — images needing descriptions. 8 items." — appended, not
 * substituted, when an action lands the cursor in a different kind.
 *
 * Appended because the spec asks for one announcement per action and dropping
 * either half loses something: the action half is the confirmation, the group
 * half is the only warning that the rhythm is about to change from one
 * keystroke to a sentence of typing.
 */
function groupChange(before: QueueSession, after: QueueSession): string {
  const was = itemOf(before, before.cursor)?.kind
  const now = itemOf(after, after.cursor)?.kind
  if (!now || was === now) return ''
  // Numbered against KIND_ORDER — the FIXED sequence of three — and not against
  // whichever groups still have work. A countdown would renumber the writing
  // group from "2 of 3" to "1 of 2" the moment triage emptied, which is the one
  // thing a place-keeper must never do; and these three groups are a designed
  // order (D5.8), not a set that happens to be present in this chapter.
  const at = KIND_ORDER.indexOf(now)
  return ` Group ${at + 1} of ${KIND_ORDER.length} — ${GROUP_WORD[now]}. ${groupSize(after, now)} items.`
}

/**
 * §3.3. The moment the non-skipped work ends, which is the moment of maximum
 * risk of abandonment — so it is a statement of what is left, never a
 * completion. There is no celebration copy in this file and there must not be.
 */
function tailWarning(s: QueueSession): string | undefined {
  const tally = counts(s)
  if (tally.remaining > 0 || tally.skipped === 0) return undefined
  return (
    `All remaining items are ones you skipped. ${tally.skipped} skipped — publishing stays ` +
    'locked until they are answered.'
  )
}

/**
 * What the queue says about itself when it opens (§3.1), or about a section it
 * could not process (§3.7), which replaces it — a missing section is the more
 * important thing to have heard, and it carries its own count.
 *
 * Groups with nothing in them are left out rather than read as "0 tables
 * missing headers", which is a sentence about nothing.
 */
function entryAnnouncement(s: QueueSession): string {
  const tally = counts(s)
  const failed = s.compiled.sections.filter((x) => x.error)
  if (failed.length > 0) {
    return (
      failed.map((x) => `Section ${x.title} could not be processed.`).join(' ') +
      ' The chapter cannot be published while a section is missing. ' +
      `${tally.total} items from the remaining sections.`
    )
  }
  // §3.8 routes a chapter with nothing to review around this screen entirely,
  // so an empty queue has no entry line rather than a sentence about nothing.
  if (tally.total === 0) return ''
  const groups = KIND_ORDER.map((kind) => ({ kind, size: groupSize(s, kind) }))
    .filter((g) => g.size > 0)
    .map((g) => `${g.size} ${GROUP_WORD[g.kind]}`)
    .join(', ')
  return `Review queue. ${tally.total} items: ${groups}. Item 1 of ${tally.total}.`
}

export function newSession(compiled: CompiledChapter): QueueSession {
  const base: QueueSession = {
    compiled,
    answers: new Map(),
    notes: new Map(),
    skipped: new Set(),
    dirty: new Set(),
    displayHtml: new Map(),
    cursor: traversal(compiled.queue, new Set())[0],
  }
  // Seeded here, but the VIEW must still mount its live region empty and paint
  // this one tick later: a region that already has content when it is inserted
  // is not announced at all.
  const entry = entryAnnouncement(base)
  return entry ? { ...base, announcement: entry } : base
}

/** The keys still to be decided: everything queued that has not been answered. */
function pending(s: QueueSession, answers: ReadonlyMap<string, QueueAnswer>, skipped: ReadonlySet<string>): string[] {
  return traversal(s.compiled.queue, skipped).filter((k) => !answers.has(k))
}

/**
 * The next item after `key`, walking FORWARD from where it sat before the event.
 *
 * Computed against the order as it was, not as it now is: answering the middle
 * of three items removes it from the new order, and looking `key` up there would
 * find nothing and send the instructor back to the top. Wraps, so skipping the
 * last item lands on the first rather than nowhere — an item can always be
 * skipped again, and a trap state is worse than a loop.
 */
function nextAfter(before: readonly string[], after: readonly string[], key: string): string | undefined {
  if (after.length === 0) return undefined
  const at = before.indexOf(key)
  if (at < 0) return after[0]
  for (let step = 1; step <= before.length; step++) {
    const candidate = before[(at + step) % before.length]!
    if (after.includes(candidate)) return candidate
  }
  return after[0]
}

export function reduce(s: QueueSession, event: QueueEvent): QueueSession {
  // Every event clears it. A refusal describes one submission of one card, and
  // one that outlived its card would be read as a verdict on the next one. The
  // announcement goes with it for the same reason — except on the two events
  // nobody pressed, which put it back below.
  const { refusal: _refusal, announcement: _announcement, ...base } = s
  const cleared: QueueSession = base

  switch (event.type) {
    case 'answer': {
      const verdict = validateAnswer(event.answer)
      if (verdict.refused) {
        // The item stays current and nothing is recorded. This is layer 1 of the
        // three, and it is the reason a junk draft never reaches the gate at all.
        return { ...cleared, refusal: verdict.message }
      }
      const before = pending(s, s.answers, s.skipped)
      const answers = new Map(s.answers).set(event.key, event.answer)
      const notes = new Map(s.notes)
      if (verdict.note) notes.set(event.key, verdict.note)
      else notes.delete(event.key)
      // Answered beats skipped: the header line counts the two separately, and
      // an item left in both would be counted twice.
      const skipped = new Set(s.skipped)
      skipped.delete(event.key)
      const next: QueueSession = {
        ...cleared,
        answers,
        notes,
        skipped,
        cursor: nextAfter(before, pending(s, answers, skipped), event.key),
      }
      // §3.4's "Queue clear" belongs to the app, not here: it claims the checks
      // passed, and this reducer has no standing to say that — the gates are
      // still being re-run at the moment the last answer lands.
      const where = place(next)
      const said =
        tailWarning(next) ??
        (where === undefined
          ? `Answered. ${counts(next).remaining} remain.`
          : `Answered. ${where}. ${counts(next).remaining} remain.${groupChange(s, next)}`)
      return { ...next, announcement: said }
    }

    case 'skip': {
      // No answer, nothing removed. See this module's docblock.
      const before = pending(s, s.answers, s.skipped)
      const skipped = new Set(s.skipped).add(event.key)
      const next: QueueSession = {
        ...cleared,
        skipped,
        cursor: nextAfter(before, pending(s, s.answers, skipped), event.key),
      }
      const tally = counts(next)
      const head = `Skipped. It will come back at the end. ${tally.skipped} skipped.`
      const where = place(next)
      const said =
        tailWarning(next) ??
        (where === undefined ? head : `${head} ${where}.${groupChange(s, next)}`)
      return { ...next, announcement: said }
    }

    case 'revisit': {
      // A map delete is the whole of undo, because an answer is plain data and
      // nothing answer-shaped was ever written into CompiledChapter (D5.11).
      const answers = new Map(s.answers)
      answers.delete(event.key)
      const notes = new Map(s.notes)
      notes.delete(event.key)
      // The item becomes current: the instructor pressed Revisit because they
      // want to change it, and leaving the cursor elsewhere makes the press look
      // like it did nothing but remove a row from a collapsed list.
      const next: QueueSession = { ...cleared, answers, notes, cursor: event.key }
      const tally = counts(next)
      return {
        ...next,
        announcement:
          `Answer removed. The item is back in the queue. Item ${tally.answered + 1} of ${tally.total}.`,
      }
    }

    case 'jump':
      // No announcement, and that is deliberate rather than unfinished: §3 gives
      // copy for every other action and none for this one, focus lands on the
      // new card's primary control, and a sentence invented here would be the
      // one string on this screen the spec has not been held to.
      return { ...cleared, cursor: event.key }

    case 'compiled': {
      const arriving = new Map(event.sections.map((x) => [x.id, x]))
      const known = new Set(s.compiled.sections.map((x) => x.id))
      const sections = [
        ...s.compiled.sections.map((x) => arriving.get(x.id) ?? x),
        ...event.sections.filter((x) => !known.has(x.id)),
      ]
      const compiled: CompiledChapter = { ...s.compiled, sections, queue: mergeQueues(sections) }
      const next: QueueSession = { ...cleared, compiled }
      // The cursor is left where it is whenever it still points at work. Late
      // items join the END of their group, so an instructor part-way through
      // triage is not moved by a section arriving — which is the whole promise
      // §3.6 makes when it opens the queue early.
      const still = pending(next, next.answers, next.skipped)
      const cursor = s.cursor && still.includes(s.cursor) ? s.cursor : still[0]
      return {
        ...next,
        cursor,
        // Nobody pressed this either, so it says nothing until the run ends —
        // and then it corrects the total the early counts were honest about
        // being provisional.
        announcement: event.final
          ? `All sections processed. ${counts(next).total} items in the queue.`
          : s.announcement,
      }
    }

    case 'recompiled': {
      const replaced = new Map(event.sections.map((r) => [r.section.id, r]))
      const sections = s.compiled.sections.map((section) => {
        const next = replaced.get(section.id)
        // The gate is DROPPED, not carried over. A verdict about bytes that no
        // longer exist is the false assurance this product exists to prevent,
        // and "absent until the section has been audited" is the contract's own
        // wording for what to do instead (D5.4).
        return next ? next.section : section
      })
      const dirty = new Set(s.dirty)
      const displayHtml = new Map(s.displayHtml)
      for (const { section, displayHtml: html } of event.sections) {
        dirty.add(section.id)
        displayHtml.set(section.id, html)
      }
      const compiled: CompiledChapter = { ...s.compiled, sections, queue: mergeQueues(sections) }

      // AN ANSWER STILL QUEUED IN A SECTION THAT WAS JUST REBUILT WAS REFUSED.
      // That is the whole detection, and it needs no new contract field: the
      // section had its chance to consume the answer and did not. Scoped to the
      // rebuilt sections deliberately — an answered key sitting in some OTHER
      // section's queue means that section has not been recompiled yet, which is
      // a completely different thing.
      const refused = [...s.answers.keys()].filter((key) =>
        event.sections.some((r) => r.section.queue.some((i) => queueKeyOf(i) === key)),
      )
      const answers = new Map(s.answers)
      const notes = new Map(s.notes)
      for (const key of refused) {
        // Dropped, not kept. An item both answered and queued is filtered out of
        // the traversal by the answer and still counted by `isPublishable` — the
        // instructor could never reach it and the chapter could never publish.
        answers.delete(key)
        notes.delete(key)
      }
      const reason = refused.length
        ? event.sections
            .flatMap((r) => r.section.notes)
            .find((n) => n.message.startsWith(TABLE_REFUSAL))
            ?.message.slice(TABLE_REFUSAL.length)
        : undefined

      const next = { ...cleared, compiled, answers, notes, dirty, displayHtml }
      // The cursor may have been on an item the recompile just answered away —
      // or on one it just refused, which stays put so the card that caused the
      // message is the card showing it.
      const still = pending(next, answers, next.skipped)
      const cursor = refused[0] ?? (s.cursor && still.includes(s.cursor) ? s.cursor : still[0])
      return {
        ...next,
        cursor,
        // Nobody pressed this, so it carries the previous announcement forward
        // rather than blanking a sentence mid-read — unless it refused an
        // answer, in which case "Answered." is now false and the alert region
        // is about to say why.
        ...(refused.length
          ? { refusal: reason ? refusalCopy(reason) : REFUSAL_WITHOUT_REASON }
          : { announcement: s.announcement }),
      }
    }

    case 'audited': {
      const section = s.compiled.sections.find((x) => x.id === event.sectionId)
      // THE COMMIT RULE. An audit takes seconds, and in those seconds the
      // instructor may answer another item in the same section. A verdict is
      // committed only if the bytes it was run against are still the section's;
      // otherwise it is dropped and the section stays dirty for the next pass.
      // Committing a stale one would put a green gate on a section that changed
      // underneath it.
      // `s`, not `cleared`: nothing happened, so nothing about the session
      // changes — including whatever the live region is still reading out.
      if (!section || section.html !== event.forHtml) return s
      const sections = s.compiled.sections.map((x) =>
        x.id === event.sectionId ? { ...x, gate: event.gate } : x,
      )
      const dirty = new Set(s.dirty)
      dirty.delete(event.sectionId)
      // The gate's own html is now the thing to render, so the stand-in goes.
      const displayHtml = new Map(s.displayHtml)
      displayHtml.delete(event.sectionId)
      const next: QueueSession = { ...cleared, compiled: { ...s.compiled, sections }, dirty, displayHtml }
      const tally = counts(next)
      // §3.5. Said only when the last re-check lands AND there is nothing left
      // to answer, because that sentence is a publishability claim and the one
      // thing this screen must never do is make one it cannot support.
      const finished =
        dirty.size === 0 && tally.remaining === 0 && tally.skipped === 0
          ? 'All checks finished. The chapter is ready to publish.'
          : s.announcement
      return { ...next, announcement: finished }
    }
  }
}
