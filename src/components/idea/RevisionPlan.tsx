/**
 * Crosswalk Step 5 as one card per chapter, after Summary and Suggestions.
 * The send carries the review's decisions and no section text. The result
 * is two lists: an instructor plan (a table) and student-facing drafts with
 * a Copy button each and NOTHING else — no Place, no Replace. Model text
 * reaches a page only through the instructor pasting it into the existing
 * edit path, which is the decision recorded in the spec's §1.
 */
import { Copy as CopyIcon, Download } from 'lucide-react'
import type { LlmProvider } from '../../engine/idea/llm/providers'
import type { PlanDraft } from '../../engine/idea/llm/parse'
import { AskModel } from './AskModel'
import type { RunState, StoredDraft } from './useModelRuns'
import { IDEA_COPY } from './copy'
import { CARD, PRIMARY, QUIET, TABLE, TD, TH } from './styles'

export function RevisionPlan({
  provider, state, stored, firstRun, canPlan, onSend, onCancel, onExport, onAnnounce,
  writeText = (text) => navigator.clipboard.writeText(text),
}: {
  provider: LlmProvider | undefined
  state: RunState
  stored: StoredDraft<PlanDraft> | undefined
  firstRun: boolean
  /** False when the chapter has no rating, note, accepted edit, or session draft. */
  canPlan: boolean
  onSend: () => void
  onCancel: () => void
  onExport: (format: 'md' | 'json') => string
  onAnnounce: (message: string) => void
  /** Test seam; production uses the clipboard. */
  writeText?: (text: string) => Promise<void>
}) {
  const c = IDEA_COPY.llm.plan
  const download = (format: 'md' | 'json') => onAnnounce(IDEA_COPY.export.done(onExport(format)))
  const copy = (text: string) => { void writeText(text).then(() => onAnnounce(c.copied)).catch(() => {}) }
  const plan = stored ? [...stored.draft.plan].sort((a, b) => a.priority - b.priority) : []
  return (
    <section aria-label={c.heading} className={CARD}>
      <h2 className="m-0 text-base font-semibold">{c.heading}</h2>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.intro}</p>
      {!canPlan && <p className="m-0 text-sm">{c.nothing}</p>}
      <AskModel
        provider={provider} state={state} firstRun={firstRun} onSend={onSend} onCancel={onCancel}
        sends={c.sends} disabled={!canPlan}
        {...(provider ? { label: c.send(provider.label) } : {})}
      />
      {stored && (
        <div className="b2c-idea-draft flex flex-col gap-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
          <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-semibold">{IDEA_COPY.llm.rubricDraft.column}: </span>{c.unverified}
          </p>
          <table className={TABLE} aria-label={c.table}>
            <thead><tr>
              <th className={TH}>{c.priority}</th><th className={TH}>{c.where}</th><th className={TH}>{c.issue}</th>
              <th className={TH}>{c.revision}</th><th className={TH}>{c.rationale}</th><th className={TH}>{c.licence}</th>
            </tr></thead>
            <tbody>
              {plan.map((p, i) => (
                <tr key={i}>
                  <td className={TD}>{p.priority}</td><td className={TD}>{p.where}</td><td className={TD}>{p.issue}</td>
                  <td className={TD}>{p.revision}</td><td className={TD}>{p.rationale}</td><td className={TD}>{p.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stored.draft.studentText.length > 0 && (
            <>
              <h3 className="m-0 text-sm font-semibold">{c.student}</h3>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {stored.draft.studentText.map((s, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{s.where} — {c.purpose}: {s.purpose}</p>
                    <p className="m-0 whitespace-pre-wrap text-sm">{s.text}</p>
                    <div>
                      <button type="button" className={`${QUIET} inline-flex items-center gap-2`} onClick={() => copy(s.text)}>
                        <CopyIcon className="size-4" aria-hidden="true" />{c.copy}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.howToUse}</p>
            </>
          )}
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
