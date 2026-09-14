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
import { PRIMARY, QUIET } from './styles'

/**
 * The sentence a failed run is reported with — the same one under a category
 * button and under the Rubric 1 draft button. A rate limit carries the
 * provider's own retry message; every other failure is the copy's sentence.
 */
export function RunFailure({ state }: { state: Extract<RunState, { status: 'failed' }> }) {
  return (
    <p role="alert" className="m-0 text-sm">
      {IDEA_COPY.llm.error[state.failure]}{state.failure === 'rate-limited' ? ` ${state.message}` : ''}
    </p>
  )
}

export function AskModel({ provider, state, onSend, onCancel, firstRun, label, sends, disabled }: {
  provider: LlmProvider | undefined
  state: RunState
  onSend: () => void
  onCancel: () => void
  /** Expanded disclosure on the first run of the session; collapsed but present afterwards. */
  firstRun: boolean
  /** Overrides the button's default "Send this section to …" text, for a second button in the same zone. */
  label?: string
  /** Overrides the disclosure's first sentence; `provider.dataUse` and the terms link still follow it. */
  sends?: string
  disabled?: boolean
}) {
  const c = IDEA_COPY.llm
  if (!provider) return <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.none}</p>
  const sendsText = sends ?? c.sends
  const disclosure = (
    <p className="m-0 text-xs text-neutral-700 dark:text-neutral-300">
      {sendsText} {provider.dataUse}{' '}
      <a href={provider.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
        {c.terms(provider.label)}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
      </a>
    </p>
  )
  return (
    <div className="flex flex-col gap-2">
      {firstRun ? disclosure : <details><summary className="cursor-pointer text-xs">{sendsText.split(':')[0]}</summary>{disclosure}</details>}
      {state.status === 'running' ? (
        <div className="flex items-center gap-2">
          <span role="status" className="text-sm">{c.sending(provider.label)}</span>
          <button type="button" className={QUIET} onClick={onCancel}>{c.cancel}</button>
        </div>
      ) : (
        <div>
          <button type="button" className={PRIMARY} onClick={onSend} disabled={disabled}>{label ?? c.send(provider.label)}</button>
        </div>
      )}
      {state.status === 'failed' && <RunFailure state={state} />}
    </div>
  )
}
