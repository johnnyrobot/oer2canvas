/**
 * Where the image goes, what it says to a student who cannot see it, and
 * what the page will owe for it — all three before "Use". Alt text is
 * required and judged by THE SAME RULES THE QUEUE'S SAVE USES: spec §6.3
 * had a new image "enter the accessibility queue", but that session is
 * closed by the time IDEA runs, so the check is made here, earlier, with the
 * same function. The rebuilt section is re-audited by the gate regardless.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { tasl, type ImageHit } from '../../engine/idea/images/search'
import type { ImagePlacement } from '../../engine/idea/edits'
import { validateAnswer } from '../../engine/compile/answers'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const PRIMARY = `${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`
const QUIET = `${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`

export interface PlacementOption { placement: ImagePlacement; label: string }

export function PlaceImageDialog({ hit, options, onUse, onCancel, busy, error }: {
  hit: ImageHit
  options: readonly PlacementOption[]
  onUse: (choice: { placement: ImagePlacement; alt: string; caption: string }) => void
  onCancel: () => void
  /** The bytes are being fetched and prepared; Use is withheld until they are. */
  busy: boolean
  /** Why the last Use added nothing (an opaque host, a byte stream that is not a raster). */
  error: string
}) {
  const id = useId()
  const c = IDEA_COPY.placeImage
  const [alt, setAlt] = useState('')
  const [caption, setCaption] = useState('')
  const [index, setIndex] = useState(0)
  const [refusal, setRefusal] = useState('')
  const first = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const credit = tasl(hit)

  const submit = () => {
    // `validateAnswer` is layer 1 of the alt gate; an image placed here is
    // judged exactly as one answered in the queue.
    const verdict = validateAnswer({ type: 'alt', text: alt })
    if (verdict.refused) { setRefusal(verdict.message); return }
    const option = options[index] ?? options[0]
    if (!option) return
    onUse({ placement: option.placement, alt: alt.trim(), caption: caption.trim() })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-t`}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <h5 id={`${id}-t`} className="m-0 text-base font-semibold">{c.title}</h5>
      <div className="flex gap-3">
        <img src={hit.thumbUrl} alt="" width={120} height={Math.round((120 * hit.height) / Math.max(1, hit.width))} className="h-auto w-30 shrink-0" />
        <div className="text-sm">
          <p className="m-0 font-semibold">{hit.title}</p>
          {hit.creator && <p className="m-0">{IDEA_COPY.imageSearch.by(hit.creator)}</p>}
          <p className="m-0">{hit.license.name}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold" htmlFor={`${id}-alt`}>{c.alt}</label>
        <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{c.altHint}</p>
        <textarea id={`${id}-alt`} ref={first} rows={2} className={FIELD} value={alt} onChange={(e) => { setAlt(e.target.value); setRefusal('') }} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{c.caption}</span>
        <input type="text" className={`${FIELD} ${TARGET}`} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{c.where}</span>
        <select className={`${FIELD} ${TARGET}`} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {options.map((o, i) => <option key={`${o.placement.kind}:${o.placement.elementId}`} value={i}>{o.label}</option>)}
        </select>
      </label>
      <p className="m-0 text-sm">{c.obligation(credit.text)}</p>
      {credit.shareAlike && <p className="m-0 text-sm">{c.shareAlike}</p>}
      {(refusal || error) && <p role="alert" className="m-0 text-sm">{refusal || error}</p>}
      <div className="flex items-center gap-2">
        {busy
          ? <span role="status" className="text-sm">{c.fetching}</span>
          : <button type="button" className={PRIMARY} onClick={submit}>{c.use}</button>}
        <button type="button" className={QUIET} onClick={onCancel}>{c.cancel}</button>
      </div>
    </div>
  )
}
