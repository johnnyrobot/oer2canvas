/**
 * The consent line and the button. The disclosure — what leaves the browser,
 * the provider's data-use sentence, the terms link — is ABOVE the button,
 * expanded on the first run of the session and collapsed but present after.
 * Nothing is sent until the button is pressed.
 */
import { ExternalLink } from 'lucide-react'
import type { LlmProvider } from '../../engine/idea/llm/providers'
import type { RunState } from './useModelRuns'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'

export function AskModel({ provider, state, onSend, onCancel, firstRun }: {
  provider: LlmProvider | undefined
  state: RunState
  onSend: () => void
  onCancel: () => void
  /** Expanded disclosure on the first run of the session; collapsed but present afterwards. */
  firstRun: boolean
}) {
  const c = IDEA_COPY.llm
  if (!provider) return <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.none}</p>
  const disclosure = (
    <p className="m-0 text-xs text-neutral-700 dark:text-neutral-300">
      {c.sends} {provider.dataUse}{' '}
      <a href={provider.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
        {c.terms(provider.label)}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
      </a>
    </p>
  )
  return (
    <div className="flex flex-col gap-2">
      {firstRun ? disclosure : <details><summary className="cursor-pointer text-xs">{c.sends.split(':')[0]}</summary>{disclosure}</details>}
      {state.status === 'running' ? (
        <div className="flex items-center gap-2">
          <span role="status" className="text-sm">{c.sending(provider.label)}</span>
          <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`} onClick={onCancel}>{c.cancel}</button>
        </div>
      ) : (
        <div>
          <button type="button" className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`} onClick={onSend}>{c.send(provider.label)}</button>
        </div>
      )}
      {state.status === 'failed' && (
        <p role="alert" className="m-0 text-sm">
          {c.error[state.failure]}{state.failure === 'rate-limited' ? ` ${state.message}` : ''}
        </p>
      )}
    </div>
  )
}
