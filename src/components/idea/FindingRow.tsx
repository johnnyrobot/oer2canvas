/**
 * One finding, STRINGS ONLY, with the four decisions the spec gives it.
 *
 * A quotation finding lists Keep first: the Framework's rule for historical
 * usage is to add context, not rewrite, and button order is the one hint the
 * card gives about which answer is usually right.
 */
import { useId, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { IdeaFinding } from '../../engine/idea/findings'
import type { IdeaEditsEvent } from '../../engine/idea/edits'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const BTN = `${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`
const PRIMARY = `${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const ROW = 'flex flex-col gap-2 rounded-md border border-neutral-300 p-3 dark:border-neutral-700'
const MUTED = 'text-neutral-600 dark:text-neutral-400'

type Mode = 'idle' | 'edit' | 'context'

export function FindingRow({
  finding, sectionTitle, onEvent, onFocus,
}: {
  finding: IdeaFinding
  sectionTitle: string
  onEvent: (event: IdeaEditsEvent) => void
  onFocus: (target: { sectionId: string; elementId: string } | undefined) => void
}) {
  const id = useId()
  const [mode, setMode] = useState<Mode>('idle')
  // Shared by the two fields and initialised to the replacement; the context
  // field shows it as empty until something else is typed.
  const [text, setText] = useState(finding.kind === 'edit' ? finding.replacement : '')
  const c = IDEA_COPY.findings
  const focusProps = finding.elementId
    ? {
        onFocus: () => onFocus({ sectionId: finding.sectionId, elementId: finding.elementId! }),
        onBlur: () => onFocus(undefined),
      }
    : {}
  const rowClass = `${ROW} ${finding.origin === 'draft' ? 'b2c-idea-draft' : ''}`
  const origin = (
    <span className="rounded border border-current px-1 text-xs uppercase tracking-wide">
      {finding.origin === 'draft' ? c.draft : c.rule}
    </span>
  )
  const source = finding.rule?.sourceUrl && (
    <a href={finding.rule.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline">
      {new URL(finding.rule.sourceUrl).hostname}
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only">({IDEA_COPY.opensNewTab})</span>
    </a>
  )
  const dismiss = (
    <button type="button" className={BTN} onClick={() => onEvent({ type: 'dismiss', key: finding.key })} {...focusProps}>
      {c.dismiss}
    </button>
  )

  if (finding.kind === 'observation') {
    const suggestion = finding.columns.suggestion
    return (
      <li className={rowClass} {...focusProps}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {origin}
          <span className="font-semibold">{c.observation}</span>
          <span className={MUTED}>{c.where(sectionTitle)}</span>
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {Object.entries(finding.columns).filter(([k]) => k !== 'suggestion').map(([k, v]) => (
            <div key={k} className="contents">
              <dt className={MUTED}>{k}</dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
        </dl>
        {finding.rule?.note && <p className="m-0 text-sm">{finding.rule.note}</p>}
        {source}
        {suggestion ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{c.suggestionLabel}: <span className="font-semibold">{suggestion}</span></span>
            {finding.elementId && (
              <button type="button" className={PRIMARY} onClick={() => onEvent({ type: 'replace', key: finding.key, replacement: suggestion })} {...focusProps}>
                {c.useSuggestion}
              </button>
            )}
            {dismiss}
          </div>
        ) : (
          <div>{dismiss}</div>
        )}
      </li>
    )
  }

  const replace = (
    <button type="button" className={finding.inQuotation ? BTN : PRIMARY} onClick={() => onEvent({ type: 'replace', key: finding.key, replacement: finding.replacement })} {...focusProps}>
      {c.replace}
    </button>
  )
  const keepContext = (
    <button type="button" className={finding.inQuotation ? PRIMARY : BTN} onClick={() => setMode('context')} {...focusProps}>
      {c.keep}
    </button>
  )
  const editBtn = (
    <button type="button" className={BTN} onClick={() => { setText(finding.replacement); setMode('edit') }} {...focusProps}>
      {c.edit}
    </button>
  )
  const keepAsIs = (
    <button type="button" className={BTN} onClick={() => onEvent({ type: 'keep', key: finding.key })} {...focusProps}>
      {c.keepAsIs}
    </button>
  )

  return (
    <li className={rowClass}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {origin}
        <span className="font-semibold">{finding.original}</span>
        <span aria-hidden="true">→</span>
        <span className="sr-only">replace with</span>
        <span className="font-semibold">{finding.replacement}</span>
        {finding.inQuotation && <span className={MUTED}>{c.inQuotation}</span>}
        <span className={MUTED}>{c.where(sectionTitle)}</span>
      </div>
      {finding.rule.note && <p className="m-0 text-sm">{finding.rule.note}</p>}
      {source}
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {finding.inQuotation ? <>{keepContext}{replace}</> : <>{replace}{editBtn}{keepContext}</>}
          {keepAsIs}
          {dismiss}
        </div>
      )}
      {mode === 'edit' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-r`}>{c.replacementLabel}</label>
          <input id={`${id}-r`} className={`${FIELD} ${TARGET}`} value={text} onChange={(e) => setText(e.target.value)} {...focusProps} />
          <button type="button" className={PRIMARY} onClick={() => { onEvent({ type: 'replace', key: finding.key, replacement: text }); setMode('idle') }}>{c.save}</button>
          <button type="button" className={BTN} onClick={() => setMode('idle')}>{c.cancel}</button>
        </div>
      )}
      {mode === 'context' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-c`}>{c.contextLabel}</label>
          <input
            id={`${id}-c`}
            className={`${FIELD} ${TARGET}`}
            placeholder={c.contextPlaceholder}
            value={text === finding.replacement ? '' : text}
            onChange={(e) => setText(e.target.value)}
            {...focusProps}
          />
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              const context = text === finding.replacement ? '' : text.trim()
              onEvent(context ? { type: 'keep', key: finding.key, context } : { type: 'keep', key: finding.key })
              setMode('idle')
            }}
          >
            {c.save}
          </button>
          <button type="button" className={BTN} onClick={() => setMode('idle')}>{c.cancel}</button>
        </div>
      )}
    </li>
  )
}
