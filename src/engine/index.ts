import { validateAllowlist } from './allowlist'
import { createAuditor } from './audit/auditor'
import { createIframeRunner } from './audit/iframe-runner'
import { enforceGate } from './gate'
import type { GateDeps, GateResult } from './gate'
import { compileSection, sectionContext, mergeQueues } from './compile/index'
import type { Step } from './compile/index'
import { OPENSTAX } from './compile/context'
import type { HumanDecisions, PublisherProfile } from './compile/context'
import type { Chapter } from '../sources/types'
import type { CompiledChapter, CompiledSection } from '../contracts/index'

export { CANVAS_ALT_TEXT_MAX_LENGTH, altTextLength, fitCanvasAltText } from './alt-text'
export { SELECTED_VLM_MODEL, VLM_MODELS, draftAltText } from './vlm'
export { createBrowserVlmRuntime } from './vlm-runtime'

/**
 * Layer 2's entry point, re-exported so the queue screen has one engine import.
 * It compiles without gating; see its own docblock for why the gate is left
 * absent rather than stale.
 */
export { recompileSections } from './compile/index'

/**
 * Audit one section's HTML through the full gate.
 *
 * The runner owns an iframe for the life of the call and is disposed in a
 * `finally` — a chapter with 15 sections should construct ONE runner and reuse
 * it, which is what `compileAndAuditChapter` below does.
 */
export async function auditSection(html: string): Promise<GateResult> {
  const runner = createIframeRunner()
  try {
    return await enforceGate(html, { validateAllowlist, audit: createAuditor(runner) })
  } finally {
    await runner.dispose()
  }
}

/**
 * What the caller is told between sections.
 *
 * `done` is the index of the section being worked on, not the count finished —
 * a caller rendering "N of M" wants `done + 1`. `phase: 'done'` is the one call
 * where `done === total` and `title` is empty, so the status line neither sticks
 * on the last section nor has to infer completion from the promise settling.
 */
export interface CompileProgress {
  phase: 'compile' | 'audit' | 'done'
  done: number
  total: number
  title: string
}

/**
 * Compile and gate a chapter, one section at a time.
 *
 * The runner is constructed ONCE and reused for all sections, which is why this
 * function exists rather than the caller looping over `auditSection`.
 *
 * COMPILE AND AUDIT ARE INTERLEAVED, section by section, rather than compiling
 * the whole chapter and then auditing it. Not for the reason it looks like:
 * `compileChapter` does run every section synchronously ahead of the audit loop,
 * but that pass is only ~57 ms for a real 12-section chapter (0-15 ms per
 * section, the 523 KB one included), so it was never the cause of the initial
 * dead air. What interleaving actually buys is one loop with one place to
 * honour the signal, so a cancel lands within a section in BOTH phases instead
 * of the compile pass being an uninterruptible prologue. Nothing about the
 * output depends on the order — the queue is deduped across the finished
 * sections either way.
 *
 * It YIELDS between sections. The audit is permanently main-thread — an iframe
 * `ScanRunner` needs a DOM and `getComputedStyle`, so the parent spec's
 * `pipeline.worker` is not achievable for this stage — and fifteen sections back
 * to back freeze the tab with one status line for the whole chapter.
 *
 * A section that failed to compile is passed through WITHOUT a gate. Auditing
 * its empty html would manufacture a clean verdict for a section that produced
 * nothing.
 *
 * `signal` is checked before each phase of each section, so a cancel lands
 * within one section rather than at the end of the chapter, and rejects with an
 * `AbortError` — `App` needs to tell a cancel from a failure, because one is
 * announced and the other is not.
 */
export async function compileAndAuditChapter(
  chapter: Chapter,
  // `HumanDecisions`: absent on a first compile; present when the queue asks
  // for the chapter rebuilt and re-gated with every answer and edit applied.
  opts: HumanDecisions & {
    profile?: PublisherProfile
    onProgress?: (progress: CompileProgress) => void
    /**
     * Each section as it finishes its gate, before the chapter is done.
     *
     * The queue screen opens on the first section that has items rather than
     * waiting for the chapter (§3.6): an instructor with 25 items should spend
     * compile time answering, not watching progress text. `onProgress` cannot
     * carry that — it reports where the run is, not what it produced — so this
     * is the seam, and it is additive: a caller that does not pass it gets
     * exactly the behaviour it always had.
     */
    onSection?: (section: CompiledSection, index: number) => void
    signal?: AbortSignal
    /** Test seams. Production passes neither. */
    deps?: GateDeps
    steps?: readonly Step[]
  } = {},
): Promise<CompiledChapter> {
  const profile = opts.profile ?? OPENSTAX
  const total = chapter.sections.length
  // Before the runner is constructed, so an already-aborted signal allocates no
  // iframe and runs no step.
  opts.signal?.throwIfAborted()
  const runner = opts.deps ? undefined : createIframeRunner()
  try {
    const deps: GateDeps = opts.deps ?? { validateAllowlist, audit: createAuditor(runner!) }
    const audited: CompiledSection[] = []
    for (const [index, section] of chapter.sections.entries()) {
      opts.signal?.throwIfAborted()
      opts.onProgress?.({ phase: 'compile', done: index, total, title: section.title })
      // Hand the event loop back so the status line above actually paints.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const compiled = compileSection(
        section,
        sectionContext(chapter, section, profile, opts),
        opts.steps,
      )

      opts.signal?.throwIfAborted()
      opts.onProgress?.({ phase: 'audit', done: index, total, title: section.title })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const done = compiled.error
        ? compiled
        : { ...compiled, gate: await enforceGate(compiled.html, deps) }
      audited.push(done)
      opts.onSection?.(done, index)
    }
    // Checked once more so a cancel that lands during the LAST section's audit
    // rejects rather than returning a chapter the user asked to stop.
    opts.signal?.throwIfAborted()
    opts.onProgress?.({ phase: 'done', done: total, total, title: '' })
    return { chapter, sections: audited, queue: mergeQueues(audited) }
  } finally {
    await runner?.dispose()
  }
}
