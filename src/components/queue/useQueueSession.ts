/**
 * A React shell over the session reducer. Plumbing, deliberately.
 *
 * The reducer in `session.ts` is the testable unit and holds every rule; this
 * owns only the two things a pure function cannot: recompiling the sections an
 * answer changed (layer 2) and draining the background re-audits (layer 3). If
 * a rule starts living here, it has gone to the wrong place.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import type { QueueAnswer } from '../../engine/compile/answers'
import type { IdeaEdit } from '../../engine/idea/edits'
import { recompileSections } from '../../engine/compile'
import { validateAllowlist } from '../../engine/allowlist'
import { newSession, reduce, sectionsAffectedBy, type QueueSession } from './session'
import { drainReaudits } from './reaudit'

/** A recompiled section and the allowlist-repaired bytes to render for it. */
export interface Rebuilt {
  section: CompiledSection
  displayHtml: string
}

export interface QueueSessionDeps {
  recompile: (
    chapter: Chapter,
    sectionIds: readonly string[],
    opts: { answers: ReadonlyMap<string, QueueAnswer>; ideaEdits?: ReadonlyMap<string, IdeaEdit> },
  ) => Promise<readonly Rebuilt[]>
  audit: (html: string) => Promise<GateResult>
}

export const defaultDeps: QueueSessionDeps = {
  async recompile(chapter, sectionIds, opts) {
    const sections = recompileSections(chapter, sectionIds, opts)
    // Repaired here rather than at render time, because `ChapterView`'s rule is
    // that only repaired html is ever set as innerHTML — repair is what removes
    // `on*` handlers and `<script>` subtrees, and it is a safety invariant, not
    // a formatting step.
    return Promise.all(
      sections.map(async (section) => ({
        section,
        displayHtml: (await validateAllowlist(section.html)).html,
      })),
    )
  },
  audit: (html) => import('../../engine').then(({ auditSection }) => auditSection(html)),
}

/** Identity of a verdict-in-waiting: a section AND the bytes it would describe. */
const stamp = (sectionId: string, html: string): string => `${sectionId} ${html}`

/**
 * `ideaEdits` are the IDEA phase's decisions, applied by the compile step from
 * source. They travel with every recompile here so that an answer in an
 * edited section rebuilds it WITH its wording — otherwise the bytes handed to
 * Plan would depend on whether this rebuild or the IDEA phase's landed last.
 * Read through a ref: a change to the edits is the IDEA phase's recompile to
 * make, not this one's.
 */
export function useQueueSession(
  compiled: CompiledChapter,
  deps: QueueSessionDeps = defaultDeps,
  opts: { ideaEdits?: ReadonlyMap<string, IdeaEdit> } = {},
) {
  const [session, dispatch] = useReducer(reduce, compiled, newSession)
  const ideaEdits = useRef(opts.ideaEdits)
  ideaEdits.current = opts.ideaEdits

  const answer = useCallback(
    (key: string, value: QueueAnswer) => dispatch({ type: 'answer', key, answer: value }),
    [],
  )
  const skip = useCallback((key: string) => dispatch({ type: 'skip', key }), [])
  const revisit = useCallback((key: string) => dispatch({ type: 'revisit', key }), [])
  const jump = useCallback((key: string) => dispatch({ type: 'jump', key }), [])
  /**
   * More sections came off the first compile (§3.6). `final` on the last call,
   * which is what corrects the provisional total the header has been qualifying.
   */
  const arrived = useCallback(
    (sections: readonly CompiledSection[], final?: boolean) =>
      dispatch({ type: 'compiled', sections, final }),
    [],
  )

  // --- layer 2: recompile what an answer changed ------------------------------
  const lastAnswers = useRef(session.answers)
  useEffect(() => {
    const previous = lastAnswers.current
    lastAnswers.current = session.answers
    if (previous === session.answers) return

    const added = [...session.answers.keys()].filter((k) => !previous.has(k))
    const removed = [...previous.keys()].filter((k) => !session.answers.has(k))
    if (added.length === 0 && removed.length === 0) return

    // A REVISIT RECOMPILES EVERYTHING. Its item is no longer in any queue —
    // that is what being answered means — so there is nothing left to look it up
    // by. Recompiling the chapter is ~57 ms for twelve sections and undo is
    // rare; carrying a key-to-sections map through the session just to narrow
    // this would be state that exists for one uncommon path.
    const ids =
      removed.length > 0
        ? session.compiled.sections.map((s) => s.id)
        : [...new Set(added.flatMap((k) => sectionsAffectedBy(session.compiled, k)))]
    if (ids.length === 0) return

    let live = true
    const recompileOpts = { answers: session.answers, ...(ideaEdits.current ? { ideaEdits: ideaEdits.current } : {}) }
    void deps.recompile(session.compiled.chapter, ids, recompileOpts).then((sections) => {
      if (live && sections.length > 0) dispatch({ type: 'recompiled', sections })
    })
    return () => {
      live = false
    }
  }, [session.answers, session.compiled, deps])

  // --- layer 3: re-audit dirty sections, one at a time -------------------------
  const draining = useRef(false)
  const started = useRef(new Set<string>())
  const [drains, setDrains] = useState(0)
  useEffect(() => {
    if (draining.current) return
    const byId = new Map(session.compiled.sections.map((s) => [s.id, s]))
    // Skipped rather than re-run: the stamp carries the bytes, so a section that
    // changed again gets a fresh audit while one that did not is left alone.
    const todo = [...session.dirty].filter((id) => {
      const section = byId.get(id)
      return section !== undefined && !started.current.has(stamp(id, section.html))
    })
    if (todo.length === 0) return

    draining.current = true
    for (const id of todo) started.current.add(stamp(id, byId.get(id)!.html))
    const controller = new AbortController()
    void drainReaudits(
      todo,
      async (id) => {
        const forHtml = byId.get(id)!.html
        return { forHtml, gate: await deps.audit(forHtml) }
      },
      (id, result) =>
        dispatch({ type: 'audited', sectionId: id, forHtml: result.forHtml, gate: result.gate }),
      { signal: controller.signal },
    ).finally(() => {
      draining.current = false
      // Wakes this effect again. A drain whose verdicts were ALL dropped as
      // stale dispatches nothing, so without this the sections it could not
      // finish would sit dirty with nothing scheduled to look at them.
      setDrains((n) => n + 1)
    })
    return () => controller.abort()
  }, [session, drains, deps])

  return { session, answer, skip, revisit, jump, arrived }
}

export type { QueueSession }
