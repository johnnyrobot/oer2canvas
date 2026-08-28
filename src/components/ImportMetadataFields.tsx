import { useEffect, useRef } from 'react'
import {
  RIGHTS_AUTHORITIES,
  type ImportMetadata,
  type RightsAuthority,
} from '../import/types'
import { requireRightsAuthority } from '../import/common'

export interface ImportMetadataDraft {
  title: string
  author: string
  sourceName: string
  sourceUrl: string
  licenseName: string
  licenseUrl: string
  rightsAuthority: RightsAuthority | ''
  rightsAcknowledged: boolean
}

const RIGHTS_LABELS: Readonly<Record<RightsAuthority, string>> = {
  own: 'I created or own this content',
  permission: 'I have permission to republish or adapt it',
  'open-license': 'Its license permits this use',
  'public-domain': 'It is in the public domain',
}

export const IMPORT_RIGHTS_OPTIONS = RIGHTS_AUTHORITIES.map((value) => ({
  value,
  label: RIGHTS_LABELS[value],
}))

export function emptyImportMetadata(): ImportMetadataDraft {
  return {
    title: '',
    author: '',
    sourceName: '',
    sourceUrl: '',
    licenseName: '',
    licenseUrl: '',
    rightsAuthority: '',
    rightsAcknowledged: false,
  }
}

export function completeImportMetadata(draft: ImportMetadataDraft): ImportMetadata {
  requireRightsAuthority(draft.rightsAuthority)
  return {
    title: draft.title,
    ...(draft.author.trim() ? { author: draft.author.trim() } : {}),
    ...(draft.sourceName.trim() ? { sourceName: draft.sourceName.trim() } : {}),
    ...(draft.sourceUrl.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
    ...(draft.licenseName.trim() ? { licenseName: draft.licenseName.trim() } : {}),
    ...(draft.licenseUrl.trim() ? { licenseUrl: draft.licenseUrl.trim() } : {}),
    rightsAuthority: draft.rightsAuthority,
    rightsAcknowledged: draft.rightsAcknowledged,
  }
}

export function useImportErrorFocus(error: string) {
  const element = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (error) element.current?.focus()
  }, [error])
  return element
}

export function ImportMetadataFields({
  value,
  onChange,
  idPrefix,
}: {
  value: ImportMetadataDraft
  onChange: (next: ImportMetadataDraft) => void
  idPrefix: string
}) {
  const update = <Key extends keyof ImportMetadataDraft>(
    key: Key,
    next: ImportMetadataDraft[Key],
  ) => onChange({ ...value, [key]: next })

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Document title
          <input required value={value.title} onChange={(event) => update('title', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <label className="block text-sm font-medium">
          Author or organization
          <input value={value.author} onChange={(event) => update('author', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <label className="block text-sm font-medium">
          Publisher or source
          <input value={value.sourceName} onChange={(event) => update('sourceName', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <label className="block text-sm font-medium">
          Public source URL
          <input type="url" value={value.sourceUrl} onChange={(event) => update('sourceUrl', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <label className="block text-sm font-medium">
          License name
          <input value={value.licenseName} onChange={(event) => update('licenseName', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
        <label className="block text-sm font-medium">
          License URL
          <input type="url" value={value.licenseUrl} onChange={(event) => update('licenseUrl', event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-900" />
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Permission to republish</legend>
        <div className="mt-2 grid gap-2">
          {IMPORT_RIGHTS_OPTIONS.map((option) => (
            <label key={option.value} className="flex min-h-9 items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-rights-authority`}
                value={option.value}
                checked={value.rightsAuthority === option.value}
                onChange={() => update('rightsAuthority', option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.rightsAcknowledged}
          onChange={(event) => update('rightsAcknowledged', event.target.checked)}
          className="mt-1"
        />
        <span>I am responsible for rights and for the final accessibility review.</span>
      </label>
    </>
  )
}
