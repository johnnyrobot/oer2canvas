/**
 * Layer 2 and 3 for the IDEA phase, mirroring `useQueueSession`: an edit
 * recompiles the sections it changed (from source, with the queue's answers
 * AND the edits), then re-audits them one at a time, and hands the gated
 * sections back so `prepared` describes the bytes the export will ship.
 *
 * The diff is computed on the map of edited-section-ids per chapter, so an
 * undo that empties a section's edits recompiles that section too — its bytes
 * have to go back to what they were.
 *
 * A run that is superseded before its audits land is cancelled — its result
 * would describe edits that no longer exist — and every section it had not
 * reported is CARRIED INTO THE NEXT RUN. Without that, undoing the last edit
 * in one section and then editing another before the gate returned would
 * leave the first section "re-checking" forever, with its old bytes.
 */
import { useEffect, useRef, useState } from 'react'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import type { PublisherProfile } from '../../engine/compile/context'
import type { QueueAnswer } from '../../engine/compile/answers'
import { recompileSections } from '../../engine/compile/index'
import { sectionsWithEdits, type IdeaEdit, type IdeaEdits } from '../../engine/idea/edits'
import { reviewKeyOf } from './useIdeaReviews'

export interface IdeaRecompileDeps {
  recompile: (
    chapter: Chapter,
    sectionIds: readonly string[],
    opts: { profile: PublisherProfile; answers: ReadonlyMap<string, QueueAnswer>; ideaEdits: ReadonlyMap<string, IdeaEdit> },
  ) => CompiledSection[]
  audit: (html: string) => Promise<GateResult>
}

export const defaultIdeaRecompileDeps: IdeaRecompileDeps = {
  recompile: (chapter, ids, opts) => recompileSections(chapter, ids, opts),
  // The full gate, as the queue runs it: `auditSection` repairs through the
  // allowlist and audits the repaired bytes, and `gate.html` is what renders.
  audit: (html) => import('../../engine').then(({ auditSection }) => auditSection(html)),
}

/** Section ids that currently carry at least one edit, per chapter key. */
function editedSections(edits: ReadonlyMap<string, IdeaEdits>): Map<string, Set<string>> {
  return new Map([...edits].map(([key, e]) => [key, sectionsWithEdits(e)]))
}

export function useIdeaRecompile({
  prepared, answers, edits, profileOf, onRebuilt, deps = defaultIdeaRecompileDeps,
}: {
  prepared: readonly CompiledChapter[]
  answers: ReadonlyMap<string, QueueAnswer>
  edits: ReadonlyMap<string, IdeaEdits>
  profileOf: (chapter: Chapter) => PublisherProfile
  onRebuilt: (chapterKey: string, sections: readonly CompiledSection[]) => void
  deps?: IdeaRecompileDeps
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  // Read through a ref, not listed as a dependency: a caller that builds the
  // deps object inline would otherwise restart the effect on every render,
  // and the effect's own `setPending` causes one.
  const depsRef = useRef(deps)
  depsRef.current = deps
  const last = useRef<Map<string, Set<string>>>(new Map())
  /** Sections a cancelled run had not reported, owed to the next run. */
  const unfinished = useRef<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    const now = editedSections(edits)
    const work: { chapterKey: string; ids: string[] }[] = []
    for (const compiled of prepared) {
      const chapterKey = reviewKeyOf(compiled.chapter)
      const before = last.current.get(chapterKey) ?? new Set<string>()
      const after = now.get(chapterKey) ?? new Set<string>()
      const owed = unfinished.current.get(chapterKey) ?? new Set<string>()
      // Every section with an edit now (a second edit in an already-edited
      // section changes bytes too), plus every section that just lost its
      // last one, plus whatever a cancelled run still owed. That over-
      // recompiles by one section per edit, which is 0–15 ms.
      const changed = [...new Set([...before, ...after, ...owed])]
      if (changed.length > 0) work.push({ chapterKey, ids: changed })
    }
    last.current = now
    unfinished.current = new Map()
    if (work.length === 0) return

    let live = true
    const started = new Set(work.flatMap((w) => w.ids))
    const done = new Map<string, Set<string>>()
    setPending((p) => new Set([...p, ...started]))
    const { recompile, audit } = depsRef.current
    void (async () => {
      for (const { chapterKey, ids } of work) {
        const compiled = prepared.find((c) => reviewKeyOf(c.chapter) === chapterKey)
        if (!compiled) continue
        const ideaEdits = edits.get(chapterKey)?.edits ?? new Map<string, IdeaEdit>()
        const rebuilt = recompile(compiled.chapter, ids, { profile: profileOf(compiled.chapter), answers, ideaEdits })
        const gated: CompiledSection[] = []
        for (const s of rebuilt) {
          if (s.error) { gated.push(s); continue }
          gated.push({ ...s, gate: await audit(s.html) })
        }
        if (!live) return
        onRebuilt(chapterKey, gated)
        done.set(chapterKey, new Set(ids))
      }
      if (live) setPending((p) => new Set([...p].filter((id) => !started.has(id))))
    })()
    return () => {
      live = false
      // Whatever this run had not reported is owed to the next one, which the
      // cleanup's caller is about to start.
      for (const { chapterKey, ids } of work) {
        const reported = done.get(chapterKey)
        const owed = ids.filter((id) => !reported?.has(id))
        if (owed.length > 0) unfinished.current.set(chapterKey, new Set(owed))
      }
    }
    // `prepared` is deliberately NOT a dependency: `onRebuilt` replaces
    // sections in it, and re-running on that replacement would loop. Nor are
    // `profileOf` and `onRebuilt`: they are read when the run starts. (The
    // repo runs no lint rule over this list; the omission is the design.)
  }, [edits, answers])

  return { pending }
}
