/**
 * The search region under 7.1: query, source, licence set, results. Every
 * hit shown has a licence the app allows — the adapters drop the rest — and
 * the licence badge is beside each thumbnail so the choice is made with the
 * obligation in view. No ranking, no filtering by anything the Framework
 * would call identity: the instructor's words are the query (spec §6.2).
 */
import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import {
  ALLOWED_LICENSES, LICENSE_LABEL, type ImageHit, type ImageProvider, type ImageSearch as Port, type License,
} from '../../engine/idea/images/search'
import { useImageSearch } from './useImageSearch'
import { IDEA_COPY } from './copy'
import { FIELD, PRIMARY, QUIET, TARGET } from './styles'


export interface ImageSource { label: string; url: string }

export function ImageSearch({ initialQuery = '', onChoose, onClose, sources, providers }: {
  initialQuery?: string
  onChoose: (hit: ImageHit) => void
  onClose: () => void
  /** The Framework's own list for 7.1, offered when a search finds nothing and as a fallback. */
  sources: readonly ImageSource[]
  /** Test seam; production uses the hook's default providers. */
  providers?: readonly Port[]
}) {
  const c = IDEA_COPY.imageSearch
  const { providers: ports, state, search, cancel } = useImageSearch(providers ? { providers } : {})
  const offered = ports.filter((p) => p.offered)
  const [provider, setProvider] = useState<ImageProvider>(offered[0]?.id ?? 'commons')
  const [query, setQuery] = useState(initialQuery)
  const [licenses, setLicenses] = useState<ReadonlySet<License>>(() => new Set(ALLOWED_LICENSES))
  const toggle = (l: License) => setLicenses((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n })

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-300 p-3 dark:border-neutral-700" role="region" aria-label={c.heading}>
      <div className="flex items-start gap-2">
        <p className="m-0 flex-1 text-sm font-semibold">{c.heading}</p>
        <button type="button" onClick={onClose} className={`${TARGET} inline-flex items-center justify-center rounded-md`} aria-label={c.close}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{c.guidance}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => { e.preventDefault(); search(provider, query, ALLOWED_LICENSES.filter((l) => licenses.has(l))) }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.query}</span>
          <input type="text" className={`${FIELD} ${TARGET} w-64`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{c.provider}</span>
          <select className={`${FIELD} ${TARGET}`} value={provider} onChange={(e) => setProvider(e.target.value as ImageProvider)}>
            {ports.map((p) => <option key={p.id} value={p.id} disabled={!p.offered}>{p.label}</option>)}
          </select>
        </label>
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="text-sm">{c.licenses}</legend>
          {ALLOWED_LICENSES.map((l) => (
            <label key={l} className={`${TARGET} flex items-center gap-1 text-sm`}>
              <input type="checkbox" checked={licenses.has(l)} onChange={() => toggle(l)} />
              {LICENSE_LABEL[l]}
              {l === 'by-sa' && <span className="sr-only"> ({c.shareAlikeNote})</span>}
            </label>
          ))}
        </fieldset>
        {state.status === 'searching'
          ? <button type="button" className={QUIET} onClick={cancel}>{c.cancel}</button>
          : <button type="submit" className={PRIMARY}>{c.search}</button>}
      </form>
      {ports.filter((p) => !p.offered).map((p) => (
        <p key={p.id} className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.notOffered(p.label)}</p>
      ))}
      {state.status === 'searching' && <p role="status" className="m-0 text-sm">{c.searching}</p>}
      {state.status === 'failed' && <p role="alert" className="m-0 text-sm">{state.message}</p>}
      {state.status === 'done' && state.hits.length === 0 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm">{c.none}</p>
          <MoreSources sources={sources} open />
        </div>
      )}
      {state.status === 'done' && state.hits.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4">
          {state.hits.map((h) => (
            <li key={`${h.provider}:${h.id}`} className="flex flex-col gap-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700">
              {/*
                alt="" on purpose: the title and creator are the accessible
                text beside the thumbnail, and a duplicated title would be
                read twice.
              */}
              <img src={h.thumbUrl} alt="" width={160} height={Math.round((160 * h.height) / Math.max(1, h.width))} className="h-auto w-full object-cover" loading="lazy" />
              <span className="font-semibold">{h.title}</span>
              {h.creator && <span>{c.by(h.creator)}</span>}
              <span className="self-start rounded border border-current px-1">{h.license.name}</span>
              <a href={h.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                {c.sourceLink}<ExternalLink className="size-3" aria-hidden="true" /><span className="sr-only">({IDEA_COPY.opensNewTab})</span>
              </a>
              <button type="button" className={`${PRIMARY} px-2`} onClick={() => onChoose(h)}>
                {c.use}<span className="sr-only">: {h.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.status !== 'done' && <MoreSources sources={sources} />}
    </div>
  )
}

function MoreSources({ sources, open }: { sources: readonly ImageSource[]; open?: boolean }) {
  if (sources.length === 0) return null
  return (
    <details open={open}>
      <summary className="cursor-pointer text-sm">{IDEA_COPY.imageSearch.more}</summary>
      <ul className="m-0 list-none p-0 text-sm">
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
              {s.label}<span className="sr-only"> ({IDEA_COPY.opensNewTab})</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}
