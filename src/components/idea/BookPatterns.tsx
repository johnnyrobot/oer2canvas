/**
 * Crosswalk Appendix B's "Full OER Review (chapter-level patterns)" as one
 * card above the chapter picker. One call over every prepared chapter of
 * this book; the size is stated before Send and the button is disabled above
 * the provider's ceiling — nothing is ever truncated. The result is a draft
 * with no human field beside it: there is no book-level rating in Rubric 1,
 * so there is nothing to copy into, by construction.
 */
import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { categoryById } from '../../engine/idea/framework'
import type { LlmProvider } from '../../engine/idea/llm/providers'
import { bookPrompt, type BookChapterInput } from '../../engine/idea/llm/prompts'
import type { BookDraft } from '../../engine/idea/llm/parse'
import { overCeiling, promptTokens, wordCount } from '../../engine/idea/llm/size'
import { AskModel } from './AskModel'
import type { RunState, StoredDraft } from './useModelRuns'
import { IDEA_COPY, RATING_COPY } from './copy'
import { PRIMARY } from './styles'

const CARD = 'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
const TABLE = 'w-full border-collapse text-sm'
const TH = 'border-b border-neutral-300 py-1 pr-3 text-left font-semibold dark:border-neutral-700'
const TD = 'border-b border-neutral-200 py-1 pr-3 align-top dark:border-neutral-800'

export function BookPatterns({
  bookTitle, chapters, region, provider, state, stored, firstRun, onSend, onCancel, onExport, onAnnounce,
}: {
  bookTitle: string
  chapters: readonly BookChapterInput[]
  region: string
  provider: LlmProvider | undefined
  state: RunState
  stored: StoredDraft<BookDraft> | undefined
  firstRun: boolean
  onSend: () => void
  onCancel: () => void
  /** Produces the download and returns its filename, which the status line announces. */
  onExport: (format: 'md' | 'json') => string
  onAnnounce: (message: string) => void
}) {
  const c = IDEA_COPY.llm.book
  // Built here so the size sentence describes exactly what Send would post.
  const size = useMemo(() => {
    if (chapters.length < 2) return undefined
    const tokens = promptTokens(bookPrompt(bookTitle, chapters, region))
    const words = chapters.reduce((n, ch) => n + ch.sections.reduce((m, s) => m + wordCount(s.text), 0), 0)
    return { tokens, words }
  }, [bookTitle, chapters, region])
  if (chapters.length < 2 || !size) return null
  const over = provider ? overCeiling(size.tokens, provider) : false
  const download = (format: 'md' | 'json') => onAnnounce(IDEA_COPY.export.done(onExport(format)))
  return (
    <section aria-label={c.heading} className={CARD}>
      <h2 className="m-0 text-base font-semibold">{c.heading}</h2>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.intro}</p>
      {provider && (
        <p className="m-0 text-sm">
          {over ? c.over(size.tokens, provider.label, provider.contextTokens) : c.size(chapters.length, size.words, provider.label)}
        </p>
      )}
      <AskModel
        provider={provider} state={state} firstRun={firstRun} onSend={onSend} onCancel={onCancel}
        {...(provider ? { label: c.send(provider.label) } : {})}
        sends={c.sends}
        disabled={over}
      />
      {stored && (
        <div className="b2c-idea-draft flex flex-col gap-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
          <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-semibold">{IDEA_COPY.llm.rubricDraft.column}: </span>{c.unverified}
          </p>
          <h3 className="m-0 text-sm font-semibold">{c.summary}</h3>
          <p className="m-0 whitespace-pre-wrap text-sm">{stored.draft.summary}</p>
          <table className={TABLE} aria-label={c.areas}>
            <thead><tr><th className={TH}>{c.area}</th><th className={TH}>{c.rating}</th><th className={TH}>{c.notes}</th></tr></thead>
            <tbody>
              {stored.draft.areas.map((a) => (
                <tr key={a.area}>
                  <td className={TD}>{a.area} {categoryById(a.area).rubricTitle}</td>
                  <td className={TD}>{a.rating ? RATING_COPY[a.rating] : c.noDraft}</td>
                  <td className={TD}>{a.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className={TABLE} aria-label={c.revisions}>
            <thead><tr><th className={TH}>{c.where}</th><th className={TH}>{c.revision}</th><th className={TH}>{c.rationale}</th></tr></thead>
            <tbody>
              {stored.draft.revisions.map((r, i) => (
                <tr key={i}><td className={TD}>{r.where}</td><td className={TD}>{r.revision}</td><td className={TD}>{r.rationale}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${PRIMARY} inline-flex items-center gap-2`} onClick={() => download('md')}>
              <Download className="size-4" aria-hidden="true" />{c.markdown}
            </button>
            <button type="button" className={`${PRIMARY} inline-flex items-center gap-2`} onClick={() => download('json')}>
              <Download className="size-4" aria-hidden="true" />{c.json}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
