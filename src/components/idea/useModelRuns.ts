/**
 * Per-category run state for the model. Nothing here runs on mount, on
 * phase entry, or on recompile: `runCategory`, `runRubric`, `runBook`, and
 * `runPlan` are called by a button's click handler and by nothing else. One
 * in-flight request per key; a second click while running is ignored;
 * cancel aborts; unmount aborts everything.
 *
 * Runs and drafts are React state and nothing else. A reload starts clean.
 * A draft the instructor accepts goes through the edits reducer like a rule
 * finding and persists there; the draft itself does not.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BOOK_TIMEOUT_MS, complete as defaultComplete, LlmError, type LlmFailure } from '../../engine/idea/llm/client'
import { providerById } from '../../engine/idea/llm/providers'
import type { LlmSettings } from '../../engine/idea/llm/settings'
import {
  bookPrompt, categoryPrompt, planPrompt, rubricPrompt,
  type BookChapterInput, type DraftableCategory, type PlanInput, type SectionInput,
} from '../../engine/idea/llm/prompts'
import {
  draftsToFindings, parseBookResponse, parseCategoryResponse, parsePlanResponse, parseRubricResponse,
  type BookDraft, type PlanDraft, type RubricDraft,
} from '../../engine/idea/llm/parse'
import { overCeiling, promptTokens } from '../../engine/idea/llm/size'
import type { IdeaFinding } from '../../engine/idea/findings'

export type RunState =
  | { status: 'idle' }
  | { status: 'running'; controller: AbortController }
  | { status: 'done'; findings: IdeaFinding[]; at: number }
  | { status: 'failed'; failure: LlmFailure; message: string }

export const runKey = (chapterKey: string, sectionId: string, category: string) => `${chapterKey}::${sectionId}::${category}`
export const rubricRunKey = (chapterKey: string) => `${chapterKey}::rubric`
export const bookRunKey = (bookTitle: string) => `book::${bookTitle}`
export const planRunKey = (chapterKey: string) => `${chapterKey}::plan`

/** A parsed draft with who drafted it and when — the export's provenance sentence reads these. */
export interface StoredDraft<T> { draft: T; provider: string; at: number }

const UNREADABLE = 'could not read the reply'

export function useModelRuns({ settings, deps = { complete: defaultComplete } }: { settings: LlmSettings | undefined; deps?: { complete: typeof defaultComplete } }) {
  const [runs, setRuns] = useState<ReadonlyMap<string, RunState>>(new Map())
  const [rubricDrafts, setRubricDrafts] = useState<ReadonlyMap<string, RubricDraft>>(new Map())
  const [bookDrafts, setBookDrafts] = useState<ReadonlyMap<string, StoredDraft<BookDraft>>>(new Map())
  const [planDrafts, setPlanDrafts] = useState<ReadonlyMap<string, StoredDraft<PlanDraft>>>(new Map())
  const live = useRef<Map<string, AbortController>>(new Map())

  const set = useCallback((key: string, state: RunState) => {
    setRuns((m) => { const n = new Map(m); n.set(key, state); return n })
  }, [])

  const start = useCallback((key: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (!settings) return
    if (live.current.has(key)) return
    const controller = new AbortController()
    live.current.set(key, controller)
    set(key, { status: 'running', controller })
    work(controller.signal)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        const err = e instanceof LlmError ? e : new LlmError('unreachable', 'Unexpected failure.')
        set(key, { status: 'failed', failure: err.failure, message: err.message })
      })
      .finally(() => { if (live.current.get(key) === controller) live.current.delete(key) })
  }, [settings, set])

  const runCategory = useCallback((chapterKey: string, category: DraftableCategory, input: SectionInput, html: string) => {
    if (!settings) return
    const key = runKey(chapterKey, input.sectionId, category)
    start(key, async (signal) => {
      const provider = providerById(settings.provider)
      const { text } = await deps.complete(provider, settings, categoryPrompt(category, input), signal)
      if (signal.aborted) return
      set(key, { status: 'done', findings: draftsToFindings(category, input.sectionId, html, parseCategoryResponse(text)), at: Date.now() })
    })
  }, [start, set, settings, deps])

  const runRubric = useCallback((chapterKey: string, chapterTitle: string, sections: SectionInput[]) => {
    if (!settings) return
    const key = rubricRunKey(chapterKey)
    start(key, async (signal) => {
      const provider = providerById(settings.provider)
      const { text } = await deps.complete(provider, settings, rubricPrompt(chapterTitle, sections), signal)
      if (signal.aborted) return
      setRubricDrafts((m) => { const n = new Map(m); n.set(chapterKey, parseRubricResponse(text)); return n })
      set(key, { status: 'done', findings: [], at: Date.now() })
    })
  }, [start, set, settings, deps])

  const runBook = useCallback((bookTitle: string, chapters: readonly BookChapterInput[], region: string) => {
    if (!settings) return
    const provider = providerById(settings.provider)
    const messages = bookPrompt(bookTitle, chapters, region)
    // The card disables Send above the ceiling; this is the same rule with no UI in front of it.
    if (overCeiling(promptTokens(messages), provider)) return
    const key = bookRunKey(bookTitle)
    start(key, async (signal) => {
      const { text } = await deps.complete(provider, settings, messages, signal, { timeoutMs: BOOK_TIMEOUT_MS })
      if (signal.aborted) return
      let draft: BookDraft
      try { draft = parseBookResponse(text) } catch { throw new LlmError('unreachable', UNREADABLE) }
      setBookDrafts((m) => { const n = new Map(m); n.set(bookTitle, { draft, provider: provider.label, at: Date.now() }); return n })
      set(key, { status: 'done', findings: [], at: Date.now() })
    })
  }, [start, set, settings, deps])

  const runPlan = useCallback((chapterKey: string, input: PlanInput) => {
    if (!settings) return
    const provider = providerById(settings.provider)
    const key = planRunKey(chapterKey)
    start(key, async (signal) => {
      const { text } = await deps.complete(provider, settings, planPrompt(input), signal)
      if (signal.aborted) return
      let draft: PlanDraft
      try { draft = parsePlanResponse(text) } catch { throw new LlmError('unreachable', UNREADABLE) }
      setPlanDrafts((m) => { const n = new Map(m); n.set(chapterKey, { draft, provider: provider.label, at: Date.now() }); return n })
      set(key, { status: 'done', findings: [], at: Date.now() })
    })
  }, [start, set, settings, deps])

  const cancel = useCallback((key: string) => {
    live.current.get(key)?.abort()
    live.current.delete(key)
    set(key, { status: 'idle' })
  }, [set])

  const cancelAll = useCallback(() => { for (const k of [...live.current.keys()]) cancel(k) }, [cancel])

  // Phase exit / unmount aborts everything in flight.
  useEffect(() => {
    const map = live.current
    return () => { for (const c of map.values()) c.abort() }
  }, [])

  return { runs, runCategory, runRubric, runBook, runPlan, rubricDrafts, bookDrafts, planDrafts, cancel, cancelAll }
}
