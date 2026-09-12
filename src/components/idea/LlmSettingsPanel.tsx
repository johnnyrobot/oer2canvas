/**
 * Provider, key, model. The key field is a password input: it is never
 * rendered as text unless the user presses Show key. The panel says which
 * device holds the key and offers its own Forget key — slice 1's *Forget all
 * IDEA reviews* leaves the key alone, and the copy says so.
 *
 * A provider the CORS probe failed is listed, disabled, with the sentence
 * that says why and a link to the measurement. Hiding it would leave the
 * user wondering why it is not there.
 */
import { useEffect, useId, useState } from 'react'
import { Eye, EyeOff, ExternalLink } from 'lucide-react'
import { PROVIDERS, providerById, type ProviderId } from '../../engine/idea/llm/providers'
import type { LlmSettings } from '../../engine/idea/llm/settings'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const REPO = 'https://github.com/johnnyrobot/oer2canvas/blob/main/'

export function LlmSettingsPanel({
  settings, onSave, onForget,
}: {
  settings: LlmSettings | undefined
  onSave: (s: LlmSettings) => void
  onForget: () => void
}) {
  const id = useId()
  const c = IDEA_COPY.llm
  const firstOffered = PROVIDERS.find((p) => p.offered)?.id ?? 'gemini'
  const [provider, setProvider] = useState<ProviderId>(settings?.provider ?? firstOffered)
  const [key, setKey] = useState(settings?.key ?? '')
  const [model, setModel] = useState(settings?.model ?? providerById(provider).defaultModel)
  const [shown, setShown] = useState(false)
  const current = providerById(provider)

  // The store loads after mount; a saved record arriving later fills the
  // fields, and Forget key empties them.
  useEffect(() => {
    setProvider(settings?.provider ?? firstOffered)
    setKey(settings?.key ?? '')
    setModel(settings?.model ?? providerById(settings?.provider ?? firstOffered).defaultModel)
  }, [settings, firstOffered])

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="text-sm font-semibold">{c.legend}</legend>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.intro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.provider}</span>
          <select
            className={`${FIELD} ${TARGET}`}
            value={provider}
            onChange={(e) => { const p = e.target.value as ProviderId; setProvider(p); setModel(providerById(p).defaultModel) }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.offered}>{p.offered ? p.label : `${p.label} (not available)`}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-key`}>{c.key}</label>
          <div className="flex gap-1">
            <input
              id={`${id}-key`}
              type={shown ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD} ${TARGET} w-64`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="button"
              className={`${TARGET} rounded-md border border-neutral-300 px-2 dark:border-neutral-700`}
              aria-label={shown ? c.hideKey : c.showKey}
              aria-pressed={shown}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.model}</span>
          <input type="text" className={`${FIELD} ${TARGET} w-56`} value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <button
          type="button"
          className={`${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`}
          onClick={() => onSave({ provider, key, model })}
        >
          {c.save}
        </button>
        {settings && (
          <button
            type="button"
            className={`${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`}
            onClick={onForget}
          >
            {c.forget}
          </button>
        )}
      </div>
      <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.stored}</p>
      <p className="m-0 text-xs">
        {current.dataUse}{' '}
        <a href={current.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
          {c.terms(current.label)}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
        </a>
      </p>
      {PROVIDERS.filter((p) => !p.offered).map((p) => (
        <p key={p.id} className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
          {c.notOffered(p.label)}{' '}
          <a href={`${REPO}${p.evidence}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
            {c.evidence}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
          </a>
        </p>
      ))}
    </fieldset>
  )
}
